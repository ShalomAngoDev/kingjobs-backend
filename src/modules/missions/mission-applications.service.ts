import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  JobberServiceStatus,
  MissionApplicationStatus,
  MissionAssignmentStatus,
  MissionStatus,
  type Mission,
} from '@prisma/client';
import { calculateAge } from '../../common/utils/age';
import { isUniqueViolation } from '../../common/utils/prisma-errors';
import { EmailService } from '../../infrastructure/email/email.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { assertUserCanOperateAsJobber } from '../verifications/operational-gates';
import { JobberEligibilityService } from '../eligibility/jobber-eligibility.service';
import { JobberServiceEligibilitySync } from '../eligibility/jobber-service-eligibility-sync.service';
import {
  notifyClientApplicationReceived,
  notifyJobberApplicationRejected,
  notifyJobberApplicationSelected,
  notifyJobberMissionFilled,
} from '../notifications/notification-events';
import { NotificationsService } from '../notifications/notifications.service';
import type { ApplyMissionDto } from './dto/apply-mission.dto';
import {
  buildApplicationReceivedClientEmail,
  buildApplicationSelectedJobberEmail,
} from './mission-emails';
import { MissionLifecycleService } from './mission-lifecycle.service';
import {
  serializeApplicationForClient,
  serializeApplicationForJobber,
  serializeAssignment,
  serializeMissionForJobber,
  serializeMissionWithStaffing,
} from './mission-serializers';
import { computeStaffing } from './mission-staffing';

@Injectable()
export class MissionApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eligibility: JobberEligibilityService,
    private readonly eligibilitySync: JobberServiceEligibilitySync,
    private readonly lifecycle: MissionLifecycleService,
    private readonly email: EmailService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Jobber : candidature à une mission PUBLISHED avec places restantes. */
  async apply(jobberUserId: string, missionId: string, dto: ApplyMissionDto) {
    const mission = await this.prisma.mission.findUnique({
      where: { id: missionId },
    });
    if (!mission) {
      throw new NotFoundException('Mission introuvable');
    }
    if (mission.clientUserId === jobberUserId) {
      throw new ForbiddenException(
        'Vous ne pouvez pas postuler à votre propre mission.',
      );
    }
    if (mission.status === MissionStatus.DRAFT) {
      throw new NotFoundException('Mission introuvable');
    }
    if (mission.status !== MissionStatus.PUBLISHED) {
      throw new ConflictException(
        'Cette mission n’accepte plus de candidatures.',
      );
    }

    const activeCount = await this.prisma.missionAssignment.count({
      where: { missionId, status: MissionAssignmentStatus.ACTIVE },
    });
    if (computeStaffing(mission.workersNeeded, activeCount).isFull) {
      throw new ConflictException(
        'Cette mission a déjà trouvé tous les Jobbers recherchés.',
      );
    }

    const alreadyAssigned = await this.prisma.missionAssignment.findFirst({
      where: {
        missionId,
        jobberUserId,
        status: MissionAssignmentStatus.ACTIVE,
      },
    });
    if (alreadyAssigned) {
      throw new ConflictException('Vous êtes déjà affecté à cette mission.');
    }

    await this.assertJobberEligible(jobberUserId, mission);

    const message = dto.message?.trim() || null;
    const existing = await this.prisma.missionApplication.findFirst({
      where: { missionId, jobberUserId },
    });

    if (existing) {
      const reopenable =
        existing.status === MissionApplicationStatus.WITHDRAWN ||
        existing.status === MissionApplicationStatus.ASSIGNMENT_CANCELLED;
      if (!reopenable) {
        throw new ConflictException(
          'Vous avez déjà une candidature pour cette mission.',
        );
      }
      const reactivated = await this.prisma.missionApplication.updateMany({
        where: {
          id: existing.id,
          status: {
            in: [
              MissionApplicationStatus.WITHDRAWN,
              MissionApplicationStatus.ASSIGNMENT_CANCELLED,
            ],
          },
        },
        data: {
          status: MissionApplicationStatus.PENDING,
          message,
          appliedAt: new Date(),
          withdrawnAt: null,
          selectedAt: null,
          rejectedAt: null,
          closedAt: null,
        },
      });
      if (reactivated.count !== 1) {
        throw new ConflictException('Candidature déjà mise à jour.');
      }
      const refreshed = await this.prisma.missionApplication.findUnique({
        where: { id: existing.id },
      });
      if (!refreshed) {
        throw new NotFoundException('Candidature introuvable');
      }
      await this.notifyClientNewApplication(mission, refreshed.id);
      return serializeApplicationForJobber(refreshed);
    }

    try {
      const created = await this.prisma.missionApplication.create({
        data: {
          missionId,
          jobberUserId,
          message,
          status: MissionApplicationStatus.PENDING,
        },
      });
      await this.notifyClientNewApplication(mission, created.id);
      return serializeApplicationForJobber(created);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          'Vous avez déjà une candidature pour cette mission.',
        );
      }
      throw error;
    }
  }

  /** Jobber : retire sa candidature PENDING uniquement. */
  async withdraw(
    jobberUserId: string,
    missionId: string,
    applicationId: string,
  ) {
    const application = await this.prisma.missionApplication.findUnique({
      where: { id: applicationId },
    });
    if (
      !application ||
      application.missionId !== missionId ||
      application.jobberUserId !== jobberUserId
    ) {
      throw new NotFoundException('Candidature introuvable');
    }
    if (application.status !== MissionApplicationStatus.PENDING) {
      throw new ConflictException(
        application.status === MissionApplicationStatus.SELECTED
          ? 'Vous avez été sélectionné : annulez votre affectation plutôt que de retirer la candidature.'
          : 'Cette candidature ne peut plus être retirée.',
      );
    }

    const result = await this.prisma.missionApplication.updateMany({
      where: { id: applicationId, status: MissionApplicationStatus.PENDING },
      data: {
        status: MissionApplicationStatus.WITHDRAWN,
        withdrawnAt: new Date(),
        closedAt: new Date(),
      },
    });
    if (result.count !== 1) {
      throw new ConflictException(
        'Cette candidature ne peut plus être retirée.',
      );
    }
    const updated = await this.prisma.missionApplication.findUnique({
      where: { id: applicationId },
    });
    if (!updated) {
      throw new NotFoundException('Candidature introuvable');
    }
    return serializeApplicationForJobber(updated);
  }

  /** Client propriétaire : liste des candidatures (profil public Jobber). */
  async listForClient(clientUserId: string, missionId: string) {
    const mission = await this.prisma.mission.findUnique({
      where: { id: missionId },
    });
    if (!mission || mission.clientUserId !== clientUserId) {
      throw new NotFoundException('Mission introuvable');
    }

    const [applications, activeCount] = await Promise.all([
      this.prisma.missionApplication.findMany({
        where: {
          missionId,
          status: {
            in: [
              MissionApplicationStatus.PENDING,
              MissionApplicationStatus.SELECTED,
              MissionApplicationStatus.REJECTED,
              MissionApplicationStatus.MISSION_FILLED,
            ],
          },
        },
        orderBy: { appliedAt: 'asc' },
        include: { assignment: true },
      }),
      this.prisma.missionAssignment.count({
        where: { missionId, status: MissionAssignmentStatus.ACTIVE },
      }),
    ]);

    const jobberIds = [...new Set(applications.map((a) => a.jobberUserId))];
    const jobbers = await this.prisma.user.findMany({
      where: { id: { in: jobberIds } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        jobberProfile: {
          select: {
            headline: true,
            bio: true,
            yearsOfExperience: true,
            skills: {
              select: { name: true, kind: true },
              take: 30,
            },
            experiences: {
              select: {
                title: true,
                organization: true,
                description: true,
              },
              take: 10,
              orderBy: { createdAt: 'desc' },
            },
            educations: {
              select: {
                title: true,
                institution: true,
              },
              take: 10,
              orderBy: { createdAt: 'desc' },
            },
            services: {
              where: { serviceId: mission.serviceId },
              select: {
                status: true,
                service: { select: { name: true, slug: true } },
              },
            },
          },
        },
        languages: { select: { code: true, label: true } },
      },
    });
    const byId = new Map(jobbers.map((j) => [j.id, j]));

    return {
      ...computeStaffing(mission.workersNeeded, activeCount),
      items: applications.flatMap((application) => {
        const jobber = byId.get(application.jobberUserId);
        if (!jobber) return [];
        return [
          {
            ...serializeApplicationForClient(application, jobber),
            assignment: application.assignment
              ? serializeAssignment(application.assignment)
              : null,
            jobber: {
              ...serializeApplicationForClient(application, jobber).jobber,
              yearsOfExperience:
                jobber.jobberProfile?.yearsOfExperience ?? null,
              languages: (jobber.languages ?? []).map((l) => ({
                code: l.code,
                label: l.label,
              })),
              skills: (jobber.jobberProfile?.skills ?? []).map((s) => ({
                name: s.name,
                kind: s.kind,
              })),
              experiences: (jobber.jobberProfile?.experiences ?? []).map(
                (e) => ({
                  title: e.title,
                  organization: e.organization,
                  description: e.description,
                }),
              ),
              educations: (jobber.jobberProfile?.educations ?? []).map((e) => ({
                title: e.title,
                institution: e.institution,
              })),
              service: jobber.jobberProfile?.services?.[0]
                ? {
                    name: jobber.jobberProfile.services[0].service.name,
                    slug: jobber.jobberProfile.services[0].service.slug,
                    status: jobber.jobberProfile.services[0].status,
                  }
                : null,
            },
          },
        ];
      }),
    };
  }

  /** Jobber : mes candidatures. */
  async listMine(jobberUserId: string) {
    const applications = await this.prisma.missionApplication.findMany({
      where: { jobberUserId },
      orderBy: { appliedAt: 'desc' },
      take: 100,
      include: {
        mission: true,
        assignment: true,
      },
    });

    const clientIds = [
      ...new Set(applications.map((row) => row.mission.clientUserId)),
    ];
    const clients = clientIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: clientIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [];
    const clientsById = new Map(clients.map((c) => [c.id, c]));

    return {
      items: applications.map((row) => ({
        ...serializeApplicationForJobber(row),
        assignment: row.assignment ? serializeAssignment(row.assignment) : null,
        mission: serializeMissionForJobber(
          row.mission,
          clientsById.get(row.mission.clientUserId) ?? null,
        ),
        statusLabel: applicationStatusLabelForJobber(row.status),
      })),
    };
  }

  /** Client : sélection (multi-Jobber, sans PAYMENT_REQUIRED BO04+). */
  async select(clientUserId: string, missionId: string, applicationId: string) {
    const mission = await this.prisma.mission.findUnique({
      where: { id: missionId },
    });
    if (!mission || mission.clientUserId !== clientUserId) {
      throw new NotFoundException('Mission introuvable');
    }

    const application = await this.prisma.missionApplication.findUnique({
      where: { id: applicationId },
    });
    if (!application || application.missionId !== missionId) {
      throw new NotFoundException('Candidature introuvable');
    }

    if (application.status === MissionApplicationStatus.PENDING) {
      try {
        await this.assertJobberEligible(application.jobberUserId, mission);
      } catch (error) {
        if (error instanceof ForbiddenException) {
          throw new ConflictException(
            'Ce Jobber n’est plus éligible pour cette mission.',
          );
        }
        throw error;
      }
    }

    const updated = await this.lifecycle.selectApplication(
      missionId,
      applicationId,
      clientUserId,
    );

    await this.notifyJobberSelected(
      updated,
      application.jobberUserId,
      applicationId,
    );

    // Autres candidatures clôturées MISSION_FILLED : notifier sans présenter comme un rejet.
    const filledApps = await this.prisma.missionApplication.findMany({
      where: {
        missionId,
        status: MissionApplicationStatus.MISSION_FILLED,
      },
      select: { id: true, jobberUserId: true },
    });
    for (const app of filledApps) {
      await notifyJobberMissionFilled(
        this.notifications,
        app.jobberUserId,
        app.id,
        missionId,
      ).catch(() => undefined);
    }

    const activeCount = await this.prisma.missionAssignment.count({
      where: { missionId, status: MissionAssignmentStatus.ACTIVE },
    });
    return serializeMissionWithStaffing(updated, activeCount);
  }

  /** Client : refuser une candidature PENDING. */
  async reject(clientUserId: string, missionId: string, applicationId: string) {
    await this.lifecycle.rejectApplication(
      missionId,
      applicationId,
      clientUserId,
    );
    const application = await this.prisma.missionApplication.findUnique({
      where: { id: applicationId },
    });
    if (!application) {
      throw new NotFoundException('Candidature introuvable');
    }
    const mission = await this.prisma.mission.findUnique({
      where: { id: missionId },
      select: { title: true },
    });
    if (mission) {
      await notifyJobberApplicationRejected(
        this.notifications,
        application.jobberUserId,
        application.id,
        missionId,
        mission.title,
      ).catch(() => undefined);
    }
    return serializeApplicationForJobber(application);
  }

  /** Annulation d'affectation (Client propriétaire ou Jobber affecté). */
  async cancelAssignment(
    actorUserId: string,
    missionId: string,
    assignmentId: string,
    reason?: string,
    asClient = false,
  ) {
    const updated = await this.lifecycle.cancelAssignment({
      missionId,
      assignmentId,
      actorUserId,
      reason,
      asClient,
    });
    const activeCount = await this.prisma.missionAssignment.count({
      where: { missionId, status: MissionAssignmentStatus.ACTIVE },
    });
    return serializeMissionWithStaffing(updated, activeCount);
  }

  async assertJobberEligible(
    jobberUserId: string,
    mission: Pick<Mission, 'serviceId' | 'minimumAge'>,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: jobberUserId },
      select: {
        status: true,
        dateOfBirth: true,
        legalGuardianStatus: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
        identityVerificationStatus: true,
      },
    });
    if (!user) {
      throw new ForbiddenException('Compte introuvable');
    }

    const profile = await this.prisma.jobberProfile.findUnique({
      where: { userId: jobberUserId },
    });
    if (!profile) {
      throw new ForbiddenException('Profil Jobber non activé');
    }

    assertUserCanOperateAsJobber(user, profile);

    const jobberService = await this.prisma.jobberService.findFirst({
      where: { jobberProfileId: profile.id, serviceId: mission.serviceId },
    });
    if (!jobberService) {
      throw new ForbiddenException(
        'Vous ne proposez pas ce service sur votre profil Jobber.',
      );
    }
    if (jobberService.status === JobberServiceStatus.SUSPENDED) {
      throw new ForbiddenException('Ce service est suspendu sur votre profil.');
    }

    const service = await this.prisma.service.findUnique({
      where: { id: mission.serviceId },
    });
    if (!service) {
      throw new NotFoundException('Service introuvable');
    }
    const requirements = await this.prisma.serviceRequirement.findMany({
      where: { serviceId: mission.serviceId, isActive: true },
    });
    const approvedDocumentTypeIds =
      await this.eligibilitySync.loadApprovedDocumentTypeIds(jobberUserId);

    const result = this.eligibility.evaluate({
      user,
      jobber: { status: profile.status },
      service,
      requirements,
      approvedDocumentTypeIds,
    });
    if (!result.eligible) {
      const documentReason = result.reasons.find(
        (r) =>
          r.code === 'DOCUMENT_REQUIREMENT_MISSING' ||
          r.code === 'PENDING_REQUIREMENT',
      );
      if (documentReason) {
        throw new ForbiddenException({
          message: `Un justificatif est requis pour cette mission. ${documentReason.message}`,
          reasons: result.reasons,
        });
      }
      throw new ForbiddenException({
        message:
          result.reasons[0]?.message ??
          'Vous n’êtes pas éligible à cette mission.',
        reasons: result.reasons,
      });
    }

    if (
      !user.dateOfBirth ||
      calculateAge(user.dateOfBirth) < mission.minimumAge
    ) {
      throw new ForbiddenException(
        `L’âge minimum requis pour cette mission (${mission.minimumAge} ans) n’est pas atteint.`,
      );
    }
  }

  private async notifyClientNewApplication(
    mission: Mission,
    applicationId: string,
  ) {
    // In-app d'abord (idempotent) ; email facultatif ensuite.
    try {
      await notifyClientApplicationReceived(
        this.notifications,
        mission.clientUserId,
        applicationId,
        mission.title,
      );
    } catch {
      // Notification in-app best-effort.
    }

    // V1 : 1 email par candidature (pas de digest). Documenté dans MISSION-APPLICATIONS.md.
    try {
      const client = await this.prisma.user.findUnique({
        where: { id: mission.clientUserId },
        select: { email: true, firstName: true },
      });
      if (!client?.email) return;
      const payload = buildApplicationReceivedClientEmail({
        clientFirstName: client.firstName,
        missionTitle: mission.title,
        missionReference: mission.reference,
      });
      await this.email.send({
        to: client.email,
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
      });
    } catch {
      // Email best-effort : absence d'email / échec d'envoi ne bloque jamais la candidature.
    }
  }

  private async notifyJobberSelected(
    mission: Mission,
    jobberUserId: string,
    applicationId: string,
  ) {
    try {
      await notifyJobberApplicationSelected(
        this.notifications,
        jobberUserId,
        applicationId,
        mission.id,
        mission.title,
      );
    } catch {
      // Notification in-app best-effort.
    }

    try {
      const jobber = await this.prisma.user.findUnique({
        where: { id: jobberUserId },
        select: { email: true, firstName: true },
      });
      if (!jobber?.email) return;
      const view = serializeMissionForJobber(mission);
      const payload = buildApplicationSelectedJobberEmail({
        jobberFirstName: jobber.firstName,
        missionTitle: mission.title,
        city: mission.city,
        district: mission.district,
        scheduledStartAt: mission.scheduledStartAt,
        workerGrossAmount: view.workerGrossAmount,
        currency: mission.currency,
      });
      await this.email.send({
        to: jobber.email,
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
      });
    } catch {
      // Email best-effort.
    }
  }
}

function applicationStatusLabelForJobber(
  status: MissionApplicationStatus,
): string {
  switch (status) {
    case MissionApplicationStatus.PENDING:
      return 'Candidature envoyée, en attente de réponse du Client.';
    case MissionApplicationStatus.SELECTED:
      return 'Vous avez été sélectionné.';
    case MissionApplicationStatus.REJECTED:
      return 'Votre candidature n’a pas été retenue.';
    case MissionApplicationStatus.MISSION_FILLED:
      return 'La mission a désormais trouvé tous les Jobbers recherchés.';
    case MissionApplicationStatus.WITHDRAWN:
      return 'Candidature retirée.';
    case MissionApplicationStatus.ASSIGNMENT_CANCELLED:
      return 'Affectation annulée.';
    default:
      return status;
  }
}

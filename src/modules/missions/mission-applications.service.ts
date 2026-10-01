import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  JobberServiceStatus,
  MissionApplicationStatus,
  MissionStatus,
  type Mission,
} from '@prisma/client';
import { calculateAge } from '../../common/utils/age';
import { isUniqueViolation } from '../../common/utils/prisma-errors';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { JobberEligibilityService } from '../eligibility/jobber-eligibility.service';
import type { ApplyMissionDto } from './dto/apply-mission.dto';
import { MissionLifecycleService } from './mission-lifecycle.service';
import {
  serializeApplicationForClient,
  serializeApplicationForJobber,
  serializeMissionWithAddress,
} from './mission-serializers';

@Injectable()
export class MissionApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eligibility: JobberEligibilityService,
    private readonly lifecycle: MissionLifecycleService,
  ) {}

  /** Jobber : candidature à une mission PUBLISHED. */
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
    // Un brouillon d'autrui est invisible.
    if (mission.status === MissionStatus.DRAFT) {
      throw new NotFoundException('Mission introuvable');
    }
    if (mission.status !== MissionStatus.PUBLISHED) {
      throw new ConflictException(
        'Cette mission n’accepte plus de candidatures.',
      );
    }

    await this.assertJobberEligible(jobberUserId, mission);

    const message = dto.message?.trim() || null;
    const existing = await this.prisma.missionApplication.findFirst({
      where: { missionId, jobberUserId },
    });

    if (existing) {
      if (existing.status !== MissionApplicationStatus.WITHDRAWN) {
        throw new ConflictException(
          'Vous avez déjà une candidature pour cette mission.',
        );
      }
      // Re-candidature après retrait : on réactive la ligne (unique missionId+jobber).
      const reactivated = await this.prisma.missionApplication.updateMany({
        where: { id: existing.id, status: MissionApplicationStatus.WITHDRAWN },
        data: {
          status: MissionApplicationStatus.PENDING,
          message,
          appliedAt: new Date(),
          withdrawnAt: null,
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

  /** Jobber : retire sa candidature PENDING. */
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
          ? 'Vous avez été sélectionné : annulez la mission au lieu de retirer la candidature.'
          : 'Cette candidature ne peut plus être retirée.',
      );
    }

    const result = await this.prisma.missionApplication.updateMany({
      where: { id: applicationId, status: MissionApplicationStatus.PENDING },
      data: {
        status: MissionApplicationStatus.WITHDRAWN,
        withdrawnAt: new Date(),
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

  /** Client propriétaire : liste des candidatures (infos Jobber publiques uniquement). */
  async listForClient(clientUserId: string, missionId: string) {
    const mission = await this.prisma.mission.findUnique({
      where: { id: missionId },
    });
    if (!mission || mission.clientUserId !== clientUserId) {
      throw new NotFoundException('Mission introuvable');
    }

    const applications = await this.prisma.missionApplication.findMany({
      where: {
        missionId,
        status: {
          in: [
            MissionApplicationStatus.PENDING,
            MissionApplicationStatus.SELECTED,
          ],
        },
      },
      orderBy: { appliedAt: 'asc' },
    });

    const jobbers = await this.prisma.user.findMany({
      where: { id: { in: applications.map((a) => a.jobberUserId) } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        jobberProfile: { select: { headline: true, bio: true } },
      },
    });
    const byId = new Map(jobbers.map((j) => [j.id, j]));

    return {
      items: applications.flatMap((application) => {
        const jobber = byId.get(application.jobberUserId);
        return jobber
          ? [serializeApplicationForClient(application, jobber)]
          : [];
      }),
    };
  }

  /** Client propriétaire : sélection transactionnelle (PUBLISHED → … → PAYMENT_REQUIRED). */
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

    // L'éligibilité est réévaluée à la sélection (profil/service ont pu changer).
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

    const updated = await this.lifecycle.selectApplication(
      missionId,
      applicationId,
      clientUserId,
    );
    return serializeMissionWithAddress(updated);
  }

  /**
   * Éligibilité complète d'un Jobber pour une mission :
   * profil Jobber, JobberService pour le service, moteur d'éligibilité, âge minimum de la mission.
   */
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

    const result = this.eligibility.evaluate({
      user,
      jobber: { status: profile.status },
      service,
      requirements,
    });
    if (!result.eligible) {
      throw new ForbiddenException({
        message: 'Vous n’êtes pas éligible à cette mission.',
        reasons: result.reasons,
      });
    }

    if (calculateAge(user.dateOfBirth) < mission.minimumAge) {
      throw new ForbiddenException(
        `L’âge minimum requis pour cette mission (${mission.minimumAge} ans) n’est pas atteint.`,
      );
    }
  }
}

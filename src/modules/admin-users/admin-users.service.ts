import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  MissionIncidentStatus,
  MissionStatus,
  Prisma,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { SessionsService } from '../auth/sessions.service';
import { JobberEligibilityService } from '../eligibility/jobber-eligibility.service';
import { JobberProfileCompletionService } from '../eligibility/jobber-profile-completion.service';
import {
  ADMIN_LIST_DEFAULT_LIMIT,
  type AdminClientsQueryDto,
  type AdminJobbersQueryDto,
  type AdminUserListQueryDto,
  type AdminUsersQueryDto,
} from './dto/admin-users-queries.dto';
import {
  ADMIN_USER_SELECT,
  decimalToNumber,
  paginate,
  toAdminUserItem,
  toJobberSummary,
  toSuspensionInfo,
} from './admin-users.serializers';

/** Statuts de mission considérés « actifs » (confirmée → en cours de clôture). */
export const ACTIVE_MISSION_STATUSES: readonly MissionStatus[] = [
  MissionStatus.CONFIRMED,
  MissionStatus.READY_TO_START,
  MissionStatus.IN_PROGRESS,
  MissionStatus.COMPLETION_PENDING,
];

/** Incidents non résolus (à traiter par le back-office). */
export const OPEN_INCIDENT_STATUSES: readonly MissionIncidentStatus[] = [
  MissionIncidentStatus.OPEN,
  MissionIncidentStatus.UNDER_REVIEW,
];

@Injectable()
export class AdminUsersService {
  private readonly logger = new Logger(AdminUsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionsService,
    private readonly eligibility: JobberEligibilityService,
    private readonly completion: JobberProfileCompletionService,
  ) {}

  // ---------------------------------------------------------------- dashboard

  async dashboard() {
    const [
      usersTotal,
      clientsTotal,
      jobbersTotal,
      byStatusRows,
      incidentsOpen,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.clientProfile.count(),
      this.prisma.jobberProfile.count(),
      this.prisma.mission.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.missionIncident.count({
        where: { status: { in: [...OPEN_INCIDENT_STATUSES] } },
      }),
    ]);

    const missionsByStatus = Object.fromEntries(
      Object.values(MissionStatus).map((status) => [status, 0]),
    ) as Record<MissionStatus, number>;
    for (const row of byStatusRows) {
      missionsByStatus[row.status] = row._count._all;
    }

    const missionsTotal = Object.values(missionsByStatus).reduce(
      (sum, n) => sum + n,
      0,
    );
    const missionsActive = ACTIVE_MISSION_STATUSES.reduce(
      (sum, status) => sum + missionsByStatus[status],
      0,
    );

    return {
      usersTotal,
      clientsTotal,
      jobbersTotal,
      missionsTotal,
      missionsActive,
      missionsPaymentRequired: missionsByStatus[MissionStatus.PAYMENT_REQUIRED],
      incidentsOpen,
      missionsByStatus,
    };
  }

  // -------------------------------------------------------------------- users

  async listUsers(query: AdminUsersQueryDto) {
    const and: Prisma.UserWhereInput[] = [];
    if (query.role) and.push({ role: query.role });
    if (query.hasClientProfile !== undefined) {
      and.push({
        clientProfile: query.hasClientProfile ? { isNot: null } : { is: null },
      });
    }
    if (query.hasJobberProfile !== undefined) {
      and.push({
        jobberProfile: query.hasJobberProfile ? { isNot: null } : { is: null },
      });
    }

    const { rows, total, page, limit } = await this.queryUsers(query, and);
    return paginate(
      rows.map((user) => toAdminUserItem(user)),
      page,
      limit,
      total,
    );
  }

  async getUser(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: ADMIN_USER_SELECT,
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable.');

    const missionsAsClient = user.clientProfile
      ? await this.prisma.mission.count({ where: { clientUserId: id } })
      : 0;

    return {
      ...toAdminUserItem(user),
      ...toSuspensionInfo(user),
      clientProfile: user.clientProfile
        ? {
            id: user.clientProfile.id,
            missionsCount: missionsAsClient,
            createdAt: user.clientProfile.createdAt.toISOString(),
            updatedAt: user.clientProfile.updatedAt.toISOString(),
          }
        : null,
      jobberProfile: toJobberSummary(user, this.completion),
    };
  }

  // ------------------------------------------------------------------ clients

  async listClients(query: AdminClientsQueryDto) {
    const { rows, total, page, limit } = await this.queryUsers(query, [
      { clientProfile: { isNot: null } },
    ]);

    const counts = rows.length
      ? await this.prisma.mission.groupBy({
          by: ['clientUserId'],
          where: { clientUserId: { in: rows.map((u) => u.id) } },
          _count: { _all: true },
        })
      : [];
    const missionsByClient = new Map(
      counts.map((row) => [row.clientUserId, row._count._all]),
    );

    return paginate(
      rows.map((user) => ({
        ...toAdminUserItem(user),
        clientProfileId: user.clientProfile?.id ?? null,
        missionsCount: missionsByClient.get(user.id) ?? 0,
      })),
      page,
      limit,
      total,
    );
  }

  // ------------------------------------------------------------------ jobbers

  async listJobbers(query: AdminJobbersQueryDto) {
    const and: Prisma.UserWhereInput[] = [
      {
        jobberProfile: query.jobberStatus
          ? { is: { status: query.jobberStatus } }
          : { isNot: null },
      },
    ];
    if (query.identityVerificationStatus) {
      and.push({
        identityVerificationStatus: query.identityVerificationStatus,
      });
    }

    const { rows, total, page, limit } = await this.queryUsers(query, and);
    return paginate(
      rows.map((user) => {
        const summary = toJobberSummary(user, this.completion);
        return {
          ...toAdminUserItem(user),
          jobberProfileId: summary?.id ?? null,
          headline: summary?.headline ?? null,
          yearsOfExperience: summary?.yearsOfExperience ?? null,
          servicesCount: summary?.servicesCount ?? 0,
          zonesCount: summary?.zonesCount ?? 0,
          profileCompletion: summary?.profileCompletion ?? null,
        };
      }),
      page,
      limit,
      total,
    );
  }

  /** `id` = identifiant du **User** (pas du JobberProfile). */
  async getJobber(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        ...ADMIN_USER_SELECT,
        jobberProfile: {
          include: {
            _count: ADMIN_USER_SELECT.jobberProfile.include._count,
            services: {
              orderBy: { createdAt: 'asc' },
              include: {
                service: {
                  include: { category: true, requirements: true },
                },
              },
            },
            skills: { orderBy: { name: 'asc' } },
            serviceAreas: { orderBy: [{ city: 'asc' }, { createdAt: 'asc' }] },
          },
        },
      },
    });
    if (!user || !user.jobberProfile) {
      throw new NotFoundException('Jobber introuvable.');
    }
    const profile = user.jobberProfile;

    const services = profile.services.map((js) => {
      const result = this.eligibility.evaluate({
        user,
        jobber: profile,
        service: js.service,
        requirements: js.service.requirements,
      });
      return {
        id: js.id,
        serviceId: js.serviceId,
        name: js.service.name,
        slug: js.service.slug,
        category: {
          id: js.service.category.id,
          name: js.service.category.name,
          slug: js.service.category.slug,
        },
        minimumAge: js.service.minimumAge,
        isServiceActive: js.service.isActive,
        status: js.status,
        yearsOfExperience: js.yearsOfExperience,
        experienceDescription: js.experienceDescription,
        eligibility: {
          eligible: result.eligible,
          computedStatus: result.status,
          reasons: result.reasons,
        },
      };
    });

    return {
      ...toAdminUserItem(user),
      ...toSuspensionInfo(user),
      jobberProfile: toJobberSummary(user, this.completion),
      services,
      eligibility: {
        eligibleServicesCount: services.filter((s) => s.eligibility.eligible)
          .length,
        totalServices: services.length,
      },
      skills: profile.skills.map((skill) => ({
        id: skill.id,
        name: skill.name,
        serviceId: skill.serviceId,
      })),
      serviceAreas: profile.serviceAreas.map((area) => ({
        id: area.id,
        countryCode: area.countryCode,
        administrativeArea: area.administrativeArea,
        city: area.city,
        district: area.district,
        latitude: decimalToNumber(area.latitude),
        longitude: decimalToNumber(area.longitude),
        radiusKm: decimalToNumber(area.radiusKm),
        isActive: area.isActive,
      })),
    };
  }

  // ------------------------------------------------- suspension / réactivation

  async suspend(actor: AuthenticatedUser, targetId: string, reason: string) {
    const target = await this.loadTargetForModeration(actor, targetId);

    if (target.status === UserStatus.CLOSED) {
      throw new UnprocessableEntityException(
        'Un compte fermé ne peut pas être suspendu.',
      );
    }
    if (target.status === UserStatus.SUSPENDED) {
      throw new ConflictException('Ce compte est déjà suspendu.');
    }

    const updated = await this.prisma.user.update({
      where: { id: targetId },
      data: {
        status: UserStatus.SUSPENDED,
        suspendedAt: new Date(),
        suspensionReason: reason,
      },
      select: ADMIN_USER_SELECT,
    });
    await this.sessions.revokeAllUserSessions(targetId);

    this.logger.warn(
      `admin_action=user.suspend actor=${actor.id} actorRole=${actor.role} target=${targetId} reason=${JSON.stringify(reason)}`,
    );

    return { ...toAdminUserItem(updated), ...toSuspensionInfo(updated) };
  }

  async reactivate(actor: AuthenticatedUser, targetId: string) {
    const target = await this.loadTargetForModeration(actor, targetId);

    if (target.status === UserStatus.CLOSED) {
      throw new UnprocessableEntityException(
        'Un compte fermé ne peut pas être réactivé.',
      );
    }
    if (target.status !== UserStatus.SUSPENDED) {
      throw new ConflictException('Ce compte n’est pas suspendu.');
    }

    const updated = await this.prisma.user.update({
      where: { id: targetId },
      data: {
        status: UserStatus.ACTIVE,
        suspendedAt: null,
        suspensionReason: null,
      },
      select: ADMIN_USER_SELECT,
    });

    this.logger.warn(
      `admin_action=user.reactivate actor=${actor.id} actorRole=${actor.role} target=${targetId}`,
    );

    return { ...toAdminUserItem(updated), ...toSuspensionInfo(updated) };
  }

  // ---------------------------------------------------------------- internals

  private async loadTargetForModeration(
    actor: AuthenticatedUser,
    targetId: string,
  ) {
    if (actor.id === targetId) {
      throw new ForbiddenException(
        'Vous ne pouvez pas modifier le statut de votre propre compte.',
      );
    }
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, role: true, status: true },
    });
    if (!target) throw new NotFoundException('Utilisateur introuvable.');

    if (
      target.role === UserRole.SUPER_ADMIN &&
      actor.role !== UserRole.SUPER_ADMIN
    ) {
      throw new ForbiddenException(
        'Seul un SUPER_ADMIN peut modifier le statut d’un SUPER_ADMIN.',
      );
    }
    return target;
  }

  /** Requête paginée commune (filtres de base + filtres spécifiques `extra`). */
  private async queryUsers(
    query: AdminUserListQueryDto,
    extra: Prisma.UserWhereInput[],
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? ADMIN_LIST_DEFAULT_LIMIT;
    const and: Prisma.UserWhereInput[] = [...extra];

    if (query.status) and.push({ status: query.status });
    if (query.emailVerified !== undefined) {
      and.push({ emailVerifiedAt: query.emailVerified ? { not: null } : null });
    }
    if (query.phoneVerified !== undefined) {
      and.push({ phoneVerifiedAt: query.phoneVerified ? { not: null } : null });
    }
    // Chaque mot doit matcher au moins un champ (« jean dupont » fonctionne).
    for (const token of (query.search ?? '').split(/\s+/).filter(Boolean)) {
      const contains = { contains: token, mode: 'insensitive' as const };
      and.push({
        OR: [
          { firstName: contains },
          { lastName: contains },
          { email: contains },
          { phone: contains },
        ],
      });
    }

    const where: Prisma.UserWhereInput = and.length ? { AND: and } : {};
    const sort = query.sort ?? 'createdAt';
    const order = query.order ?? 'desc';

    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: ADMIN_USER_SELECT,
        orderBy: [{ [sort]: order }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return { rows, total, page, limit };
  }
}

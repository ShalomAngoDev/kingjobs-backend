import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  JobberServiceStatus,
  MissionActorType,
  MissionApplicationStatus,
  MissionStatus,
  type ClientProfile,
  type Mission,
  type Prisma,
} from '@prisma/client';
import { MISSION_LIMITS } from '../../common/constants/mission-limits';
import { calculateAge } from '../../common/utils/age';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { CancelMissionDto } from './dto/cancel-mission.dto';
import type { CreateMissionDto } from './dto/create-mission.dto';
import type {
  AdminMissionsQueryDto,
  AvailableMissionsQueryDto,
  MyMissionsQueryDto,
} from './dto/mission-queries.dto';
import type { UpdateMissionDto } from './dto/update-mission.dto';
import { MissionLifecycleService } from './mission-lifecycle.service';
import {
  computeMinimumAge,
  dedupeRiskFlags,
  resolvePagination,
} from './mission-rules';
import {
  serializeApplicationForJobber,
  serializeHistory,
  serializeIncident,
  serializeJobberSummary,
  serializeMissionAdmin,
  serializeMissionForUser,
  serializeMissionPublic,
  serializeMissionWithAddress,
} from './mission-serializers';

/** Champs modifiables uniquement tant que la mission est en DRAFT. */
const DRAFT_ONLY_FIELDS = [
  'countryCode',
  'city',
  'scheduledStartAt',
  'estimatedDurationMinutes',
  'clientPriceAmount',
  'riskFlags',
] as const;

const personSelect = {
  id: true,
  firstName: true,
  lastName: true,
  jobberProfile: { select: { headline: true, bio: true } },
} as const;

type Person = {
  id: string;
  firstName: string;
  lastName: string;
  jobberProfile?: { headline: string | null; bio: string | null } | null;
};

function nullableTrim(value: string | null | undefined) {
  if (value === undefined) {
    return undefined;
  }
  return value?.trim() || null;
}

@Injectable()
export class MissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: MissionLifecycleService,
  ) {}

  // ---------- Référence & profil client ----------

  /**
   * Référence lisible `KJ-YYYY-NNNNNN` via la séquence PostgreSQL `mission_reference_seq`
   * (jamais count+1). Si la séquence n'existe pas encore (migration non jouée),
   * elle est créée une fois puis la lecture est rejouée.
   */
  async generateReference(now: Date = new Date()): Promise<string> {
    let seq: number;
    try {
      seq = await this.nextSequenceValue();
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (!/mission_reference_seq/.test(message)) {
        throw error;
      }
      await this.prisma
        .$executeRaw`CREATE SEQUENCE IF NOT EXISTS mission_reference_seq`;
      seq = await this.nextSequenceValue();
    }
    return `KJ-${now.getUTCFullYear()}-${String(seq).padStart(6, '0')}`;
  }

  private async nextSequenceValue(): Promise<number> {
    const rows = await this.prisma.$queryRaw<
      Array<{ nextval: bigint | number | string }>
    >`SELECT nextval('mission_reference_seq')::bigint AS nextval`;
    const value = rows[0]?.nextval;
    if (value === undefined || value === null) {
      throw new Error('mission_reference_seq: valeur indisponible');
    }
    return Number(value);
  }

  /** ClientProfile créé à la demande (premier usage Client). */
  async ensureClientProfile(userId: string): Promise<ClientProfile> {
    const existing = await this.prisma.clientProfile.findUnique({
      where: { userId },
    });
    if (existing) {
      return existing;
    }
    try {
      return await this.prisma.clientProfile.create({ data: { userId } });
    } catch (error) {
      // Course entre deux créations concurrentes : on relit.
      const again = await this.prisma.clientProfile.findUnique({
        where: { userId },
      });
      if (again) {
        return again;
      }
      throw error;
    }
  }

  // ---------- Client : CRUD ----------

  async create(userId: string, dto: CreateMissionDto) {
    await this.ensureClientProfile(userId);

    const service = await this.prisma.service.findUnique({
      where: { id: dto.serviceId },
      include: { category: true },
    });
    if (!service || !service.isActive || !service.category.isActive) {
      throw new NotFoundException('Service introuvable ou inactif');
    }

    this.assertCoordinates(dto.latitude, dto.longitude);
    const scheduledStartAt = this.parseFutureDate(dto.scheduledStartAt);
    const riskFlags = dedupeRiskFlags(dto.riskFlags ?? []);
    const reference = await this.generateReference();

    // status, clientUserId, currency et snapshots sont TOUJOURS posés ici, jamais par le DTO.
    const mission = await this.prisma.$transaction(async (tx) => {
      const created = await tx.mission.create({
        data: {
          reference,
          clientUserId: userId,
          serviceId: service.id,
          title: dto.title.trim(),
          description: dto.description.trim(),
          countryCode: dto.countryCode ?? MISSION_LIMITS.DEFAULT_COUNTRY,
          city: dto.city.trim(),
          district: nullableTrim(dto.district) ?? null,
          addressLine: nullableTrim(dto.addressLine) ?? null,
          latitude: dto.latitude ?? null,
          longitude: dto.longitude ?? null,
          scheduledStartAt,
          estimatedDurationMinutes: dto.estimatedDurationMinutes ?? null,
          clientPriceAmount: dto.clientPriceAmount,
          currency: MISSION_LIMITS.DEFAULT_CURRENCY,
          minimumAge: computeMinimumAge(service.minimumAge, riskFlags),
          riskFlags,
          status: MissionStatus.DRAFT,
          serviceNameSnapshot: service.name,
          serviceSlugSnapshot: service.slug,
          categoryNameSnapshot: service.category.name,
          categorySlugSnapshot: service.category.slug,
        },
      });
      await tx.missionStatusHistory.create({
        data: {
          missionId: created.id,
          fromStatus: null,
          toStatus: MissionStatus.DRAFT,
          actorUserId: userId,
          reason: 'Création de la mission',
          metadata: { actorType: MissionActorType.CLIENT },
        },
      });
      return created;
    });

    return serializeMissionWithAddress(mission);
  }

  async update(userId: string, missionId: string, dto: UpdateMissionDto) {
    const mission = await this.requireOwned(userId, missionId);

    if (
      mission.status !== MissionStatus.DRAFT &&
      mission.status !== MissionStatus.PUBLISHED
    ) {
      throw new ConflictException(
        `La mission ne peut plus être modifiée (${mission.status}).`,
      );
    }
    if (mission.status === MissionStatus.PUBLISHED) {
      const forbidden = DRAFT_ONLY_FIELDS.filter((f) => dto[f] !== undefined);
      if (forbidden.length > 0) {
        throw new ConflictException(
          `Champs non modifiables sur une mission publiée : ${forbidden.join(', ')}.`,
        );
      }
    }

    const data: Prisma.MissionUncheckedUpdateManyInput = {};
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.description !== undefined)
      data.description = dto.description.trim();
    if (dto.countryCode !== undefined) data.countryCode = dto.countryCode;
    if (dto.city !== undefined) data.city = dto.city.trim();
    if (dto.district !== undefined) data.district = nullableTrim(dto.district);
    if (dto.addressLine !== undefined) {
      data.addressLine = nullableTrim(dto.addressLine);
    }
    if (dto.latitude !== undefined) data.latitude = dto.latitude;
    if (dto.longitude !== undefined) data.longitude = dto.longitude;
    if (dto.scheduledStartAt !== undefined) {
      data.scheduledStartAt =
        dto.scheduledStartAt === null
          ? null
          : this.parseFutureDate(dto.scheduledStartAt);
    }
    if (dto.estimatedDurationMinutes !== undefined) {
      data.estimatedDurationMinutes = dto.estimatedDurationMinutes;
    }
    if (dto.clientPriceAmount !== undefined) {
      data.clientPriceAmount = dto.clientPriceAmount;
    }

    if (Object.keys(data).length === 0 && dto.riskFlags === undefined) {
      throw new BadRequestException('Aucune modification fournie.');
    }

    if (dto.latitude !== undefined || dto.longitude !== undefined) {
      const lat =
        dto.latitude !== undefined ? dto.latitude : this.num(mission.latitude);
      const lng =
        dto.longitude !== undefined
          ? dto.longitude
          : this.num(mission.longitude);
      this.assertCoordinates(lat, lng);
    }

    if (dto.riskFlags !== undefined) {
      const service = await this.prisma.service.findUnique({
        where: { id: mission.serviceId },
      });
      if (!service) {
        throw new NotFoundException('Service introuvable');
      }
      const riskFlags = dedupeRiskFlags(dto.riskFlags);
      data.riskFlags = riskFlags;
      data.minimumAge = computeMinimumAge(service.minimumAge, riskFlags);
    }

    const result = await this.prisma.mission.updateMany({
      where: { id: missionId, clientUserId: userId, status: mission.status },
      data,
    });
    if (result.count !== 1) {
      throw new ConflictException(
        'La mission a changé entre-temps, veuillez réessayer.',
      );
    }
    const updated = await this.requireOwned(userId, missionId);
    return serializeMissionWithAddress(updated);
  }

  async publish(userId: string, missionId: string) {
    const mission = await this.lifecycle.publish(missionId, userId);
    return serializeMissionWithAddress(mission);
  }

  async cancel(userId: string, missionId: string, dto: CancelMissionDto) {
    const mission = await this.lifecycle.cancel(missionId, userId, dto);
    return serializeMissionForUser(mission, userId);
  }

  async requestCompletion(jobberUserId: string, missionId: string) {
    const mission = await this.lifecycle.requestCompletion(
      missionId,
      jobberUserId,
    );
    return serializeMissionForUser(mission, jobberUserId);
  }

  /**
   * PAYMENT_REQUIRED → CONFIRMED. Interne : aucun contrôleur ne l'expose.
   * Appelé par Backend 05 (webhook paiement) ou par les tests.
   */
  markPaymentConfirmed(missionId: string, actorUserId?: string | null) {
    return this.lifecycle.markPaymentConfirmed(missionId, actorUserId);
  }

  // ---------- Lectures ----------

  async listMine(userId: string, query: MyMissionsQueryDto) {
    const { page, limit, skip } = resolvePagination(query);
    const where: Prisma.MissionWhereInput = {
      clientUserId: userId,
      ...(query.status ? { status: query.status } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.mission.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.mission.count({ where }),
    ]);
    return {
      items: items.map((m) => serializeMissionWithAddress(m)),
      page,
      limit,
      total,
    };
  }

  /** Missions où le Jobber est sélectionné. */
  async listMineAsJobber(jobberUserId: string, query: MyMissionsQueryDto) {
    const { page, limit, skip } = resolvePagination(query);
    const where: Prisma.MissionWhereInput = {
      selectedJobberUserId: jobberUserId,
      ...(query.status ? { status: query.status } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.mission.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.mission.count({ where }),
    ]);
    return {
      items: items.map((m) => serializeMissionForUser(m, jobberUserId)),
      page,
      limit,
      total,
    };
  }

  /**
   * Missions publiées candidatables par ce Jobber : services ELIGIBLE de son profil,
   * âge suffisant, hors ses propres missions. Jamais d'adresse précise.
   */
  async listAvailable(jobberUserId: string, query: AvailableMissionsQueryDto) {
    const profile = await this.prisma.jobberProfile.findUnique({
      where: { userId: jobberUserId },
    });
    if (!profile) {
      throw new ForbiddenException('Profil Jobber non activé');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: jobberUserId },
      select: { dateOfBirth: true },
    });
    if (!user) {
      throw new ForbiddenException('Compte introuvable');
    }

    const jobberServices = await this.prisma.jobberService.findMany({
      where: {
        jobberProfileId: profile.id,
        status: JobberServiceStatus.ELIGIBLE,
      },
    });
    let serviceIds = jobberServices.map((s) => s.serviceId);
    if (query.serviceId) {
      serviceIds = serviceIds.filter((id) => id === query.serviceId);
    }

    const { page, limit, skip } = resolvePagination(query);
    if (serviceIds.length === 0) {
      return { items: [], page, limit, total: 0 };
    }

    const where: Prisma.MissionWhereInput = {
      status: MissionStatus.PUBLISHED,
      selectedJobberUserId: null,
      clientUserId: { not: jobberUserId },
      serviceId: { in: serviceIds },
      minimumAge: { lte: calculateAge(user.dateOfBirth) },
      ...(query.city
        ? { city: { equals: query.city, mode: 'insensitive' as const } }
        : {}),
    };
    const [missions, total] = await Promise.all([
      this.prisma.mission.findMany({
        where,
        orderBy: { publishedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.mission.count({ where }),
    ]);

    const applications = missions.length
      ? await this.prisma.missionApplication.findMany({
          where: {
            jobberUserId,
            missionId: { in: missions.map((m) => m.id) },
          },
        })
      : [];
    const appByMission = new Map(applications.map((a) => [a.missionId, a]));

    return {
      items: missions.map((mission) => {
        const application = appByMission.get(mission.id);
        return {
          ...serializeMissionPublic(mission),
          myApplication: application
            ? serializeApplicationForJobber(application)
            : null,
        };
      }),
      page,
      limit,
      total,
    };
  }

  /** Détail actor-aware : adresse seulement pour le Client et le Jobber sélectionné. */
  async getDetail(userId: string, missionId: string) {
    const mission = await this.prisma.mission.findUnique({
      where: { id: missionId },
    });
    if (!mission) {
      throw new NotFoundException('Mission introuvable');
    }

    if (mission.clientUserId === userId) {
      const [applicationsCount, people] = await Promise.all([
        this.prisma.missionApplication.count({
          where: {
            missionId,
            status: {
              in: [
                MissionApplicationStatus.PENDING,
                MissionApplicationStatus.SELECTED,
              ],
            },
          },
        }),
        this.loadPeople(
          mission.selectedJobberUserId ? [mission.selectedJobberUserId] : [],
        ),
      ]);
      const selected = mission.selectedJobberUserId
        ? people.get(mission.selectedJobberUserId)
        : undefined;
      return {
        ...serializeMissionWithAddress(mission),
        viewerRole: 'CLIENT' as const,
        applicationsCount,
        selectedJobber: selected ? serializeJobberSummary(selected) : null,
      };
    }

    if (mission.selectedJobberUserId === userId) {
      return {
        ...serializeMissionForUser(mission, userId),
        viewerRole: 'JOBBER' as const,
      };
    }

    // Tiers : uniquement les missions publiées, sans localisation précise.
    if (mission.status === MissionStatus.PUBLISHED) {
      const application = await this.prisma.missionApplication.findFirst({
        where: { missionId, jobberUserId: userId },
      });
      return {
        ...serializeMissionPublic(mission),
        viewerRole: 'VISITOR' as const,
        myApplication: application
          ? serializeApplicationForJobber(application)
          : null,
      };
    }

    throw new NotFoundException('Mission introuvable');
  }

  // ---------- Admin ----------

  async adminList(query: AdminMissionsQueryDto) {
    const { page, limit, skip } = resolvePagination(query);
    const where: Prisma.MissionWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.serviceId ? { serviceId: query.serviceId } : {}),
      ...(query.clientUserId ? { clientUserId: query.clientUserId } : {}),
      ...(query.selectedJobberUserId
        ? { selectedJobberUserId: query.selectedJobberUserId }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.mission.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.mission.count({ where }),
    ]);
    return { items: items.map(serializeMissionAdmin), page, limit, total };
  }

  async adminDetail(missionId: string) {
    const mission = await this.prisma.mission.findUnique({
      where: { id: missionId },
    });
    if (!mission) {
      throw new NotFoundException('Mission introuvable');
    }
    const ids = [mission.clientUserId, mission.selectedJobberUserId].filter(
      (id): id is string => Boolean(id),
    );
    const [people, applicationsCount, incidents] = await Promise.all([
      this.loadPeople(ids),
      this.prisma.missionApplication.count({ where: { missionId } }),
      this.prisma.missionIncident.findMany({
        where: { missionId },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    const client = people.get(mission.clientUserId);
    const jobber = mission.selectedJobberUserId
      ? people.get(mission.selectedJobberUserId)
      : undefined;

    return {
      ...serializeMissionAdmin(mission),
      client: client ? serializeJobberSummary(client) : null,
      selectedJobber: jobber ? serializeJobberSummary(jobber) : null,
      applicationsCount,
      incidents: incidents.map(serializeIncident),
    };
  }

  async adminHistory(missionId: string) {
    const mission = await this.prisma.mission.findUnique({
      where: { id: missionId },
      select: { id: true },
    });
    if (!mission) {
      throw new NotFoundException('Mission introuvable');
    }
    const history = await this.prisma.missionStatusHistory.findMany({
      where: { missionId },
      orderBy: { createdAt: 'asc' },
    });
    return {
      items: history.map((h) => serializeHistory(h, { includeMetadata: true })),
    };
  }

  // ---------- Helpers ----------

  private async requireOwned(
    userId: string,
    missionId: string,
  ): Promise<Mission> {
    const mission = await this.prisma.mission.findUnique({
      where: { id: missionId },
    });
    if (!mission || mission.clientUserId !== userId) {
      throw new NotFoundException('Mission introuvable');
    }
    return mission;
  }

  private async loadPeople(ids: string[]): Promise<Map<string, Person>> {
    if (ids.length === 0) {
      return new Map();
    }
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: personSelect,
    });
    return new Map(users.map((u) => [u.id, u]));
  }

  private assertCoordinates(
    latitude: number | null | undefined,
    longitude: number | null | undefined,
  ) {
    const hasLat = latitude !== undefined && latitude !== null;
    const hasLng = longitude !== undefined && longitude !== null;
    if (hasLat !== hasLng) {
      throw new BadRequestException(
        'Latitude et longitude doivent être fournies ensemble.',
      );
    }
  }

  private parseFutureDate(value: string | undefined): Date | null {
    if (value === undefined) {
      return null;
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('Date de début invalide.');
    }
    if (date.getTime() <= Date.now()) {
      throw new BadRequestException(
        'La date de début doit être dans le futur.',
      );
    }
    return date;
  }

  private num(value: { toString(): string } | number | null): number | null {
    return value === null ? null : Number(value.toString());
  }
}

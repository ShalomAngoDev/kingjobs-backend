import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MissionActorType,
  MissionApplicationStatus,
  MissionAssignmentStatus,
  MissionMediaType,
  MissionStatus,
  type ClientProfile,
  type Mission,
  type Prisma,
} from '@prisma/client';
import {
  MISSION_LIMITS,
  MISSION_MEDIA_ALLOWED_MIME,
} from '../../common/constants/mission-limits';
import type { AppConfig, PaymentConfig } from '../../config/configuration';
import {
  FILE_STORAGE,
  type FileStorageService,
  StorageObjectNotFoundError,
} from '../../infrastructure/storage/file-storage.types';
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
  serializeApplicationForClient,
  serializeApplicationForJobber,
  serializeAssignment,
  serializeHistory,
  serializeIncident,
  serializeJobberSummary,
  serializeMissionAdmin,
  serializeMissionForJobber,
  serializeMissionForUser,
  serializeMissionMedia,
  serializeMissionOccurrence,
  serializeMissionPublic,
  serializePaymentAdmin,
  serializeMissionWithAddress,
  serializeMissionWithStaffing,
} from './mission-serializers';
import { computeStaffing } from './mission-staffing';
import { assertMissionReadyForReview } from './mission-readiness';
import { parseDateOnly } from './mission-scheduling';
import { toOccurrenceCreateMany } from './mission-scheduling';
import { resolveCreateShape, resolveUpdatePricing, resolveUpdateScheduleShape } from './mission-shape';

/** Champs critiques interdits dès PUBLISHED (BO04.1). */
const DRAFT_ONLY_FIELDS = [
  'serviceId',
  'countryCode',
  'city',
  'scheduledStartAt',
  'scheduleStartDate',
  'scheduleEndDate',
  'startTime',
  'estimatedDurationMinutes',
  'durationKnown',
  'workersNeeded',
  'clientPriceAmount',
  'rateAmount',
  'rateScope',
  'pricingType',
  'riskFlags',
  'schedulingType',
  'selectedWeekdays',
  'scheduleSameHoursDaily',
  'occurrences',
] as const satisfies ReadonlyArray<keyof UpdateMissionDto>;

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
    private readonly configService: ConfigService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorageService,
  ) {}

  /** True si PAYMENT_PROVIDER=mock et hors production. */
  isPaymentSimulationEnabled(): boolean {
    const app = this.configService.getOrThrow<AppConfig>('app');
    const payment = this.configService.getOrThrow<PaymentConfig>('payment');
    return payment.provider === 'mock' && app.nodeEnv !== 'production';
  }

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
    const shape = resolveCreateShape(dto);
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
          locationNotes: shape.locationNotes,
          latitude: dto.latitude ?? null,
          longitude: dto.longitude ?? null,
          schedulingType: shape.schedulingType,
          scheduleStartDate: shape.scheduleStartDate,
          scheduleEndDate: shape.scheduleEndDate,
          scheduleSameHoursDaily: shape.scheduleSameHoursDaily,
          selectedWeekdays: shape.selectedWeekdays,
          durationKnown: shape.durationKnown,
          scheduledStartAt: shape.scheduledStartAt,
          estimatedDurationMinutes: shape.estimatedDurationMinutes,
          workersNeeded: shape.pricing.workersNeeded,
          pricingType: shape.pricing.pricingType,
          rateAmount: shape.pricing.rateAmount,
          rateScope: shape.pricing.rateScope,
          estimatedAmount: shape.pricing.estimatedAmount,
          clientPriceAmount: shape.pricing.clientPriceAmount,
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

      if (shape.occurrences.length > 0) {
        await tx.missionOccurrence.createMany({
          data: toOccurrenceCreateMany(created.id, shape.occurrences),
        });
      }

      const fresh = await tx.mission.findUnique({ where: { id: created.id } });
      if (!fresh) {
        throw new NotFoundException('Mission introuvable');
      }
      return fresh;
    });

    return serializeMissionWithAddress(mission);
  }

  async update(userId: string, missionId: string, dto: UpdateMissionDto) {
    const mission = await this.requireOwned(userId, missionId);

    if (
      mission.status !== MissionStatus.DRAFT &&
      mission.status !== MissionStatus.NEEDS_CHANGES &&
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
    if (dto.locationNotes !== undefined) {
      data.locationNotes = nullableTrim(dto.locationNotes);
    }
    if (dto.latitude !== undefined) data.latitude = dto.latitude;
    if (dto.longitude !== undefined) data.longitude = dto.longitude;

    if (dto.serviceId !== undefined) {
      if (
        mission.status !== MissionStatus.DRAFT &&
        mission.status !== MissionStatus.NEEDS_CHANGES
      ) {
        throw new ConflictException(
          'Le service ne peut plus être modifié sur cette mission.',
        );
      }
      const service = await this.prisma.service.findUnique({
        where: { id: dto.serviceId },
        include: { category: true },
      });
      if (!service || !service.isActive || !service.category.isActive) {
        throw new NotFoundException('Service introuvable ou inactif');
      }
      data.serviceId = service.id;
      data.serviceNameSnapshot = service.name;
      data.serviceSlugSnapshot = service.slug;
      data.categoryNameSnapshot = service.category.name;
      data.categorySlugSnapshot = service.category.slug;
      const riskFlags =
        dto.riskFlags !== undefined
          ? dedupeRiskFlags(dto.riskFlags)
          : mission.riskFlags;
      data.minimumAge = computeMinimumAge(service.minimumAge, riskFlags);
      if (dto.riskFlags !== undefined) {
        data.riskFlags = riskFlags;
      }
    }

    const scheduleShape = resolveUpdateScheduleShape(
      {
        schedulingType: mission.schedulingType,
        scheduleStartDate: mission.scheduleStartDate,
        scheduleEndDate: mission.scheduleEndDate,
        scheduleSameHoursDaily: mission.scheduleSameHoursDaily,
        selectedWeekdays: mission.selectedWeekdays,
        durationKnown: mission.durationKnown,
        estimatedDurationMinutes: mission.estimatedDurationMinutes,
        scheduledStartAt: mission.scheduledStartAt,
        locationNotes: mission.locationNotes,
        pricingType: mission.pricingType,
        rateAmount: mission.rateAmount,
        rateScope: mission.rateScope,
        clientPriceAmount: mission.clientPriceAmount,
        workersNeeded: mission.workersNeeded,
      },
      dto,
    );

    if (scheduleShape) {
      data.schedulingType = scheduleShape.schedulingType;
      data.scheduleStartDate = scheduleShape.scheduleStartDate;
      data.scheduleEndDate = scheduleShape.scheduleEndDate;
      data.scheduleSameHoursDaily = scheduleShape.scheduleSameHoursDaily;
      data.selectedWeekdays = scheduleShape.selectedWeekdays;
      data.durationKnown = scheduleShape.durationKnown;
      data.estimatedDurationMinutes = scheduleShape.estimatedDurationMinutes;
      data.scheduledStartAt = scheduleShape.scheduledStartAt;
      if (dto.locationNotes !== undefined) {
        data.locationNotes = scheduleShape.locationNotes;
      }
    } else {
      if (dto.scheduledStartAt !== undefined) {
        data.scheduledStartAt =
          dto.scheduledStartAt === null
            ? null
            : this.parseFutureDate(dto.scheduledStartAt);
      }
      if (dto.estimatedDurationMinutes !== undefined) {
        data.estimatedDurationMinutes = dto.estimatedDurationMinutes;
      }
      if (dto.durationKnown !== undefined) {
        data.durationKnown = dto.durationKnown;
      }
      if (dto.schedulingType !== undefined) {
        data.schedulingType = dto.schedulingType;
      }
      if (dto.selectedWeekdays !== undefined) {
        data.selectedWeekdays = dto.selectedWeekdays;
      }
      if (dto.scheduleSameHoursDaily !== undefined) {
        data.scheduleSameHoursDaily = dto.scheduleSameHoursDaily;
      }
    }

    if (dto.workersNeeded !== undefined) {
      data.workersNeeded = dto.workersNeeded;
    }

    const occurrenceCount = scheduleShape
      ? scheduleShape.occurrences.length
      : await this.prisma.missionOccurrence.count({
          where: { missionId },
        });
    const pricingFromFields = resolveUpdatePricing(
      {
        pricingType: mission.pricingType,
        rateAmount: mission.rateAmount,
        rateScope: mission.rateScope,
        clientPriceAmount: mission.clientPriceAmount,
        workersNeeded: mission.workersNeeded,
        estimatedDurationMinutes:
          scheduleShape?.estimatedDurationMinutes ??
          mission.estimatedDurationMinutes,
        durationKnown: scheduleShape?.durationKnown ?? mission.durationKnown,
        schedulingType:
          scheduleShape?.schedulingType ?? mission.schedulingType,
        occurrenceCount: Math.max(1, occurrenceCount),
      },
      dto,
    );
    // Priorité au pricing recalculé avec les nouvelles occurrences (CAS 3 HOURLY/DAILY).
    const pricing = scheduleShape?.pricing ?? pricingFromFields;
    if (pricing) {
      data.pricingType = pricing.pricingType;
      data.rateAmount = pricing.rateAmount;
      data.rateScope = pricing.rateScope;
      data.workersNeeded = pricing.workersNeeded;
      data.estimatedAmount = pricing.estimatedAmount;
      data.clientPriceAmount = pricing.clientPriceAmount;
    } else if (dto.clientPriceAmount !== undefined && !pricing) {
      data.clientPriceAmount = dto.clientPriceAmount;
      data.rateAmount = dto.clientPriceAmount;
    }

    if (
      Object.keys(data).length === 0 &&
      dto.riskFlags === undefined &&
      !scheduleShape
    ) {
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

    if (dto.riskFlags !== undefined && dto.serviceId === undefined) {
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

    await this.prisma.$transaction(async (tx) => {
      const result = await tx.mission.updateMany({
        where: { id: missionId, clientUserId: userId, status: mission.status },
        data,
      });
      if (result.count !== 1) {
        throw new ConflictException(
          'La mission a changé entre-temps, veuillez réessayer.',
        );
      }
      if (scheduleShape) {
        await tx.missionOccurrence.deleteMany({ where: { missionId } });
        if (scheduleShape.occurrences.length > 0) {
          await tx.missionOccurrence.createMany({
            data: toOccurrenceCreateMany(missionId, scheduleShape.occurrences),
          });
        }
      }
    });

    const updated = await this.requireOwned(userId, missionId);
    return serializeMissionWithAddress(updated);
  }

  async submitForPayment(userId: string, missionId: string) {
    const owned = await this.requireOwned(userId, missionId);
    await assertMissionReadyForReview(this.prisma, owned);
    const mission = await this.lifecycle.submitForPayment(missionId, userId);
    return serializeMissionWithAddress(mission);
  }

  async resubmitForReview(userId: string, missionId: string) {
    const owned = await this.requireOwned(userId, missionId);
    if (owned.status !== MissionStatus.NEEDS_CHANGES) {
      throw new ConflictException(
        'Seules les missions NEEDS_CHANGES peuvent être resoumises.',
      );
    }
    await assertMissionReadyForReview(this.prisma, owned);
    const mission = await this.lifecycle.resubmitForReview(missionId, userId);
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
   * Confirmation paiement (interne).
   * Appelé par PaymentsService (MockPaymentProvider DEV) ou futur webhook agrégateur.
   * Aucun contrôleur ne mutate status=PENDING_REVIEW directement.
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

    const missionIds = items.map((m) => m.id);
    const applicationCounts =
      missionIds.length === 0
        ? []
        : await this.prisma.missionApplication.groupBy({
            by: ['missionId'],
            where: {
              missionId: { in: missionIds },
              status: {
                in: [
                  MissionApplicationStatus.PENDING,
                  MissionApplicationStatus.SELECTED,
                ],
              },
            },
            _count: { _all: true },
          });
    const countByMission = new Map(
      applicationCounts.map((row) => [row.missionId, row._count._all]),
    );

    const mediaRows =
      missionIds.length === 0
        ? []
        : await this.prisma.missionMedia.findMany({
            where: { missionId: { in: missionIds } },
            orderBy: [{ missionId: 'asc' }, { sortOrder: 'asc' }],
            select: {
              id: true,
              missionId: true,
              mimeType: true,
            },
          });
    const photosByMission = new Map<
      string,
      Array<{ id: string; mimeType: string; url: string }>
    >();
    for (const row of mediaRows) {
      if (photosByMission.has(row.missionId)) continue;
      photosByMission.set(row.missionId, [
        {
          id: row.id,
          mimeType: row.mimeType,
          url: `/missions/${row.missionId}/media/${row.id}`,
        },
      ]);
    }

    return {
      items: items.map((m) => {
        const photos = photosByMission.get(m.id) ?? [];
        return {
          ...serializeMissionWithAddress(m),
          applicationsCount: countByMission.get(m.id) ?? 0,
          photos,
          coverImageUrl: photos[0]?.url ?? null,
        };
      }),
      page,
      limit,
      total,
    };
  }

  /** Missions où le Jobber a une affectation ACTIVE. */
  async listMineAsJobber(jobberUserId: string, query: MyMissionsQueryDto) {
    const { page, limit, skip } = resolvePagination(query);
    const assignments = await this.prisma.missionAssignment.findMany({
      where: {
        jobberUserId,
        status: MissionAssignmentStatus.ACTIVE,
        ...(query.status ? { mission: { status: query.status } } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      skip,
      take: limit,
      include: { mission: true },
    });
    const total = await this.prisma.missionAssignment.count({
      where: {
        jobberUserId,
        status: MissionAssignmentStatus.ACTIVE,
        ...(query.status ? { mission: { status: query.status } } : {}),
      },
    });
    return {
      items: assignments.map((row) => ({
        ...serializeMissionForUser(row.mission, jobberUserId, {
          hasActiveAssignment: true,
        }),
        assignment: serializeAssignment(row),
      })),
      page,
      limit,
      total,
    };
  }

  /**
   * WEBAPP-01.1 — EXPLORE FIRST.
   * Tous les Jobbers authentifiés (profil activé) consultent les Missions PUBLISHED.
   * Pas de filtre sur service ELIGIBLE / âge / vérification ici.
   * L’éligibilité est contrôlée uniquement à la candidature (assertJobberEligible).
   */
  async listAvailable(jobberUserId: string, query: AvailableMissionsQueryDto) {
    const profile = await this.prisma.jobberProfile.findUnique({
      where: { userId: jobberUserId },
    });
    if (!profile) {
      throw new ForbiddenException('Profil Jobber non activé');
    }

    const { page, limit, skip } = resolvePagination(query);
    const search = query.search?.trim();
    const dateFilter = this.buildAvailableDateFilter(query);

    const and: Prisma.MissionWhereInput[] = [];
    if (dateFilter) {
      and.push(dateFilter);
    }
    if (search) {
      and.push({
        OR: [
          { title: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
          { city: { contains: search, mode: 'insensitive' } },
          { district: { contains: search, mode: 'insensitive' } },
          { serviceNameSnapshot: { contains: search, mode: 'insensitive' } },
        ],
      });
    }
    const priceFilter = this.buildAvailablePriceFilter(query);
    if (priceFilter) {
      and.push(priceFilter);
    }

    const where: Prisma.MissionWhereInput = {
      status: MissionStatus.PUBLISHED,
      selectedJobberUserId: null,
      clientUserId: { not: jobberUserId },
      ...(query.serviceId ? { serviceId: query.serviceId } : {}),
      ...(query.city
        ? { city: { equals: query.city, mode: 'insensitive' as const } }
        : {}),
      ...(query.pricingType ? { pricingType: query.pricingType } : {}),
      ...(and.length > 0 ? { AND: and } : {}),
    };

    const [missions, total] = await Promise.all([
      this.prisma.mission.findMany({
        where,
        orderBy: { publishedAt: 'desc' },
        skip,
        take: limit,
        include: {
          client: {
            select: { firstName: true, lastName: true },
          },
        },
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

    const photosByMission = new Map<
      string,
      Array<{ id: string; mimeType: string; url: string }>
    >();
    await Promise.all(
      missions.map(async (mission) => {
        photosByMission.set(
          mission.id,
          await this.loadMissionPhotosPublic(mission.id),
        );
      }),
    );

    const occurrenceCounts = missions.length
      ? await this.prisma.missionOccurrence.groupBy({
          by: ['missionId'],
          where: { missionId: { in: missions.map((m) => m.id) } },
          _count: { _all: true },
        })
      : [];
    const occurrenceCountByMission = new Map(
      occurrenceCounts.map((row) => [row.missionId, row._count._all]),
    );

    return {
      items: missions.map((mission) => {
        const application = appByMission.get(mission.id);
        const photos = photosByMission.get(mission.id) ?? [];
        return {
          ...serializeMissionForJobber(mission, mission.client),
          myApplication: application
            ? serializeApplicationForJobber(application)
            : null,
          photos,
          coverImageUrl: photos[0]?.url ?? null,
          occurrenceCount: occurrenceCountByMission.get(mission.id) ?? 0,
        };
      }),
      page,
      limit,
      total,
    };
  }

  /** Détail actor-aware : adresse pour Client / Jobber avec affectation ACTIVE. */
  async getDetail(userId: string, missionId: string) {
    const mission = await this.prisma.mission.findUnique({
      where: { id: missionId },
    });
    if (!mission) {
      throw new NotFoundException('Mission introuvable');
    }

    const [activeCount, activeAssignment] = await Promise.all([
      this.prisma.missionAssignment.count({
        where: { missionId, status: MissionAssignmentStatus.ACTIVE },
      }),
      this.prisma.missionAssignment.findFirst({
        where: {
          missionId,
          jobberUserId: userId,
          status: MissionAssignmentStatus.ACTIVE,
        },
      }),
    ]);
    const staffing = computeStaffing(mission.workersNeeded, activeCount);

    if (mission.clientUserId === userId) {
      const [applicationsCount, assignments, photos, occurrences] =
        await Promise.all([
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
          this.prisma.missionAssignment.findMany({
            where: { missionId, status: MissionAssignmentStatus.ACTIVE },
            orderBy: { selectedAt: 'asc' },
          }),
          this.loadMissionPhotosPublic(missionId),
          this.prisma.missionOccurrence.findMany({
            where: { missionId },
            orderBy: [{ sortOrder: 'asc' }, { occurrenceDate: 'asc' }],
          }),
        ]);
      const people = await this.loadPeople(assignments.map((a) => a.jobberUserId));
      return {
        ...serializeMissionWithStaffing(mission, activeCount),
        viewerRole: 'CLIENT' as const,
        applicationsCount,
        photos,
        coverImageUrl: photos[0]?.url ?? null,
        occurrenceCount: occurrences.length,
        occurrences: occurrences.map(serializeMissionOccurrence),
        paymentSimulationEnabled: this.isPaymentSimulationEnabled(),
        assignments: assignments.map((a) => ({
          ...serializeAssignment(a),
          jobber: people.get(a.jobberUserId)
            ? serializeJobberSummary(people.get(a.jobberUserId)!)
            : null,
        })),
      };
    }

    if (activeAssignment) {
      const [application, photos, occurrences] = await Promise.all([
        this.prisma.missionApplication.findFirst({
          where: { missionId, jobberUserId: userId },
        }),
        this.loadMissionPhotosPublic(missionId),
        this.prisma.missionOccurrence.findMany({
          where: { missionId },
          orderBy: [{ sortOrder: 'asc' }, { occurrenceDate: 'asc' }],
        }),
      ]);
      return {
        ...serializeMissionForUser(mission, userId, {
          hasActiveAssignment: true,
        }),
        ...staffing,
        viewerRole: 'JOBBER' as const,
        photos,
        coverImageUrl: photos[0]?.url ?? null,
        occurrenceCount: occurrences.length,
        occurrences: occurrences.map(serializeMissionOccurrence),
        assignment: serializeAssignment(activeAssignment),
        myApplication: application
          ? serializeApplicationForJobber(application)
          : {
              id: activeAssignment.applicationId,
              missionId,
              status: MissionApplicationStatus.SELECTED,
              message: null,
              appliedAt: activeAssignment.selectedAt.toISOString(),
              withdrawnAt: null,
              selectedAt: activeAssignment.selectedAt.toISOString(),
              rejectedAt: null,
            },
      };
    }

    // Tiers / candidat : missions publiées, rémunération Jobber, sans localisation précise.
    if (mission.status === MissionStatus.PUBLISHED) {
      const [application, client, photos, occurrences] = await Promise.all([
        this.prisma.missionApplication.findFirst({
          where: { missionId, jobberUserId: userId },
        }),
        this.prisma.user.findUnique({
          where: { id: mission.clientUserId },
          select: { firstName: true, lastName: true },
        }),
        this.loadMissionPhotosPublic(missionId),
        this.prisma.missionOccurrence.findMany({
          where: { missionId },
          orderBy: [{ sortOrder: 'asc' }, { occurrenceDate: 'asc' }],
        }),
      ]);
      return {
        ...serializeMissionForJobber(mission, client),
        ...staffing,
        viewerRole: 'VISITOR' as const,
        myApplication: application
          ? serializeApplicationForJobber(application)
          : null,
        photos,
        coverImageUrl: photos[0]?.url ?? null,
        occurrenceCount: occurrences.length,
        occurrences: occurrences.map(serializeMissionOccurrence),
      };
    }

    // Jobber ayant déjà candidaté : accès lecture même si la mission n'est plus PUBLISHED.
    const priorApplication = await this.prisma.missionApplication.findFirst({
      where: { missionId, jobberUserId: userId },
    });
    if (priorApplication) {
      const [client, photos, occurrences] = await Promise.all([
        this.prisma.user.findUnique({
          where: { id: mission.clientUserId },
          select: { firstName: true, lastName: true },
        }),
        this.loadMissionPhotosPublic(missionId),
        this.prisma.missionOccurrence.findMany({
          where: { missionId },
          orderBy: [{ sortOrder: 'asc' }, { occurrenceDate: 'asc' }],
        }),
      ]);
      return {
        ...serializeMissionForJobber(mission, client),
        ...staffing,
        viewerRole: 'VISITOR' as const,
        myApplication: serializeApplicationForJobber(priorApplication),
        photos,
        coverImageUrl: photos[0]?.url ?? null,
        occurrenceCount: occurrences.length,
        occurrences: occurrences.map(serializeMissionOccurrence),
      };
    }

    throw new NotFoundException('Mission introuvable');
  }

  /**
   * Contenu binaire d'une photo Mission (Jobber candidat / Client / Jobber affecté).
   * Jamais de storageKey exposé.
   */
  async getMissionMediaContent(userId: string, missionId: string, mediaId: string) {
    await this.assertCanViewMissionMedia(userId, missionId);
    const media = await this.prisma.missionMedia.findFirst({
      where: { id: mediaId, missionId },
    });
    if (!media) {
      throw new NotFoundException('Photo introuvable');
    }
    try {
      const stream = await this.storage.getStream(media.storageKey);
      return {
        stream,
        mimeType: media.mimeType,
        sizeBytes: media.sizeBytes,
        filename: `mission-${media.id}`,
      };
    } catch (error) {
      if (error instanceof StorageObjectNotFoundError) {
        throw new NotFoundException('Photo introuvable');
      }
      throw error;
    }
  }

  /**
   * Upload photo Mission (Client owner, DRAFT / NEEDS_CHANGES).
   * Storage privé + MissionMedia — distinct du KYC.
   */
  async addMissionMedia(
    userId: string,
    missionId: string,
    input: {
      buffer: Buffer;
      mimeType: string;
      sizeBytes: number;
      originalFilename?: string | null;
    },
  ) {
    const mission = await this.requireOwned(userId, missionId);
    if (
      mission.status !== MissionStatus.DRAFT &&
      mission.status !== MissionStatus.NEEDS_CHANGES
    ) {
      throw new ConflictException(
        `Les photos ne peuvent plus être modifiées (${mission.status}).`,
      );
    }

    const count = await this.prisma.missionMedia.count({ where: { missionId } });
    if (count >= MISSION_LIMITS.MAX_MISSION_MEDIA) {
      throw new BadRequestException(
        `Vous pouvez ajouter jusqu'à ${MISSION_LIMITS.MAX_MISSION_MEDIA} photos.`,
      );
    }

    const mime = (input.mimeType || '').toLowerCase().trim();
    if (!(MISSION_MEDIA_ALLOWED_MIME as readonly string[]).includes(mime)) {
      throw new BadRequestException(
        'Format non autorisé. Utilisez JPEG, PNG ou WEBP.',
      );
    }
    if (
      !Number.isFinite(input.sizeBytes) ||
      input.sizeBytes <= 0 ||
      input.sizeBytes > MISSION_LIMITS.MAX_MISSION_MEDIA_BYTES
    ) {
      throw new BadRequestException('Chaque photo doit faire 5 Mo maximum.');
    }
    if (input.buffer.length !== input.sizeBytes) {
      throw new BadRequestException('Fichier incohérent.');
    }
    if (!matchesMissionImageMagic(mime, input.buffer)) {
      throw new BadRequestException(
        'Le fichier n’est pas une image valide (JPEG, PNG ou WEBP).',
      );
    }

    const put = await this.storage.put({
      buffer: input.buffer,
      mimeType: mime,
      ownerId: userId,
      keyPrefix: 'mission-media',
    });

    try {
      const maxSort = await this.prisma.missionMedia.aggregate({
        where: { missionId },
        _max: { sortOrder: true },
      });
      const sortOrder = (maxSort._max.sortOrder ?? -1) + 1;
      const created = await this.prisma.missionMedia.create({
        data: {
          missionId,
          mediaType: MissionMediaType.IMAGE,
          mimeType: mime,
          sizeBytes: input.sizeBytes,
          storageKey: put.key,
          uploadedByUserId: userId,
          sortOrder,
        },
      });
      return {
        id: created.id,
        mimeType: created.mimeType,
        sizeBytes: created.sizeBytes,
        sortOrder: created.sortOrder,
        url: `/missions/${missionId}/media/${created.id}`,
      };
    } catch (error) {
      await this.storage.delete(put.key).catch(() => undefined);
      throw error;
    }
  }

  /** Supprime MissionMedia + objet storage (owner, DRAFT / NEEDS_CHANGES). */
  async deleteMissionMedia(
    userId: string,
    missionId: string,
    mediaId: string,
  ) {
    const mission = await this.requireOwned(userId, missionId);
    if (
      mission.status !== MissionStatus.DRAFT &&
      mission.status !== MissionStatus.NEEDS_CHANGES
    ) {
      throw new ConflictException(
        `Les photos ne peuvent plus être modifiées (${mission.status}).`,
      );
    }
    const media = await this.prisma.missionMedia.findFirst({
      where: { id: mediaId, missionId },
    });
    if (!media) {
      throw new NotFoundException('Photo introuvable');
    }
    await this.prisma.missionMedia.delete({ where: { id: media.id } });
    await this.storage.delete(media.storageKey).catch(() => undefined);
    return { ok: true as const };
  }

  // ---------- Admin ----------

  async adminList(query: AdminMissionsQueryDto) {
    const { page, limit, skip } = resolvePagination(query);
    const and: Prisma.MissionWhereInput[] = [];
    if (query.status) and.push({ status: query.status });
    if (query.serviceId) and.push({ serviceId: query.serviceId });
    if (query.categoryId) {
      and.push({ service: { categoryId: query.categoryId } });
    }
    if (query.clientUserId) and.push({ clientUserId: query.clientUserId });
    if (query.selectedJobberUserId) {
      and.push({ selectedJobberUserId: query.selectedJobberUserId });
    }
    if (query.pricingType) and.push({ pricingType: query.pricingType });
    if (query.schedulingType) and.push({ schedulingType: query.schedulingType });
    if (query.city) {
      and.push({ city: { equals: query.city, mode: 'insensitive' } });
    }
    if (query.search?.trim()) {
      const s = query.search.trim();
      and.push({
        OR: [
          { reference: { contains: s, mode: 'insensitive' } },
          { title: { contains: s, mode: 'insensitive' } },
          { client: { email: { contains: s, mode: 'insensitive' } } },
          { client: { firstName: { contains: s, mode: 'insensitive' } } },
          { client: { lastName: { contains: s, mode: 'insensitive' } } },
        ],
      });
    }
    const where: Prisma.MissionWhereInput =
      and.length > 0 ? { AND: and } : {};

    const [items, total] = await Promise.all([
      this.prisma.mission.findMany({
        where,
        orderBy: [
          { submittedForReviewAt: 'desc' },
          { createdAt: 'desc' },
        ],
        skip,
        take: limit,
        include: {
          client: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      }),
      this.prisma.mission.count({ where }),
    ]);
    return {
      items: items.map((row) => ({
        ...serializeMissionAdmin(row),
        client: row.client
          ? {
              id: row.client.id,
              firstName: row.client.firstName,
              lastName: row.client.lastName,
              email: row.client.email,
            }
          : null,
      })),
      page,
      limit,
      total,
    };
  }

  async adminDetail(missionId: string) {
    const mission = await this.prisma.mission.findUnique({
      where: { id: missionId },
    });
    if (!mission) {
      throw new NotFoundException('Mission introuvable');
    }
    const [
      applications,
      assignments,
      incidents,
      occurrences,
      media,
      payments,
      clientUser,
    ] = await Promise.all([
      this.prisma.missionApplication.findMany({
        where: { missionId },
        orderBy: { appliedAt: 'asc' },
        include: { assignment: true },
      }),
      this.prisma.missionAssignment.findMany({
        where: { missionId },
        orderBy: { selectedAt: 'asc' },
      }),
      this.prisma.missionIncident.findMany({
        where: { missionId },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.missionOccurrence.findMany({
        where: { missionId },
        orderBy: [{ sortOrder: 'asc' }, { occurrenceDate: 'asc' }],
      }),
      this.prisma.missionMedia.findMany({
        where: { missionId },
        orderBy: { sortOrder: 'asc' },
      }),
      this.prisma.payment
        .findMany({
          where: { missionId },
          orderBy: { createdAt: 'desc' },
        })
        .catch(() => []),
      this.prisma.user.findUnique({
        where: { id: mission.clientUserId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          identityVerificationStatus: true,
          status: true,
        },
      }),
    ]);

    const jobberIds = [
      ...new Set([
        ...applications.map((a) => a.jobberUserId),
        ...assignments.map((a) => a.jobberUserId),
      ]),
    ];
    const people = await this.loadPeople(jobberIds);
    const activeCount = assignments.filter(
      (a) => a.status === MissionAssignmentStatus.ACTIVE,
    ).length;

    return {
      ...serializeMissionAdmin(mission),
      ...computeStaffing(mission.workersNeeded, activeCount),
      client: clientUser
        ? {
            id: clientUser.id,
            firstName: clientUser.firstName,
            lastName: clientUser.lastName,
            email: clientUser.email,
            phone: clientUser.phone,
            identityVerificationStatus: clientUser.identityVerificationStatus,
            status: clientUser.status,
          }
        : null,
      applicationsCount: applications.length,
      applications: applications.map((application) => {
        const jobber = people.get(application.jobberUserId);
        return {
          ...serializeApplicationForClient(
            application,
            jobber ?? {
              id: application.jobberUserId,
              firstName: '?',
              lastName: '?',
            },
          ),
          assignment: application.assignment
            ? serializeAssignment(application.assignment)
            : null,
        };
      }),
      assignments: assignments.map((assignment) => ({
        ...serializeAssignment(assignment),
        jobber: people.get(assignment.jobberUserId)
          ? serializeJobberSummary(people.get(assignment.jobberUserId)!)
          : null,
      })),
      incidents: incidents.map(serializeIncident),
      occurrences: occurrences.map(serializeMissionOccurrence),
      media: media.map(serializeMissionMedia),
      payments: payments.map(serializePaymentAdmin),
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

  /**
   * Filtre date liste Jobber : jour exact (`date`) ou plage (`dateFrom`/`dateTo`).
   * Couvre scheduleStartDate (DATE) et scheduledStartAt (timestamptz).
   */
  private buildAvailableDateFilter(
    query: AvailableMissionsQueryDto,
  ): Prisma.MissionWhereInput | null {
    if (query.date) {
      const day = parseDateOnly(query.date, 'date');
      const next = new Date(day.getTime() + 86_400_000);
      return {
        OR: [
          { scheduleStartDate: day },
          {
            AND: [
              { scheduledStartAt: { gte: day } },
              { scheduledStartAt: { lt: next } },
            ],
          },
        ],
      };
    }

    if (query.dateFrom || query.dateTo) {
      if (!query.dateFrom || !query.dateTo) {
        throw new BadRequestException(
          'dateFrom et dateTo doivent être fournis ensemble.',
        );
      }
      const from = parseDateOnly(query.dateFrom, 'dateFrom');
      const to = parseDateOnly(query.dateTo, 'dateTo');
      if (to.getTime() < from.getTime()) {
        throw new BadRequestException('dateTo doit être ≥ dateFrom.');
      }
      const toExclusive = new Date(to.getTime() + 86_400_000);
      return {
        OR: [
          {
            AND: [
              { scheduleStartDate: { gte: from } },
              { scheduleStartDate: { lte: to } },
            ],
          },
          {
            AND: [
              { scheduledStartAt: { gte: from } },
              { scheduledStartAt: { lt: toExclusive } },
            ],
          },
        ],
      };
    }

    return null;
  }

  /** Photos publiques Mission (ids + chemin relatif API, jamais storageKey). */
  private async loadMissionPhotosPublic(missionId: string) {
    const rows = await this.prisma.missionMedia.findMany({
      where: { missionId },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, mimeType: true },
    });
    return rows
      .filter((row) => row.mimeType.startsWith('image/'))
      .map((row) => ({
        id: row.id,
        mimeType: row.mimeType,
        url: `/missions/${missionId}/media/${row.id}`,
      }));
  }

  /** Accès photo : propriétaire Client, Jobber affecté, ou Jobber sur Mission PUBLISHED. */
  private async assertCanViewMissionMedia(userId: string, missionId: string) {
    const mission = await this.prisma.mission.findUnique({
      where: { id: missionId },
      select: {
        id: true,
        status: true,
        clientUserId: true,
      },
    });
    if (!mission) {
      throw new NotFoundException('Mission introuvable');
    }
    if (mission.clientUserId === userId) {
      return;
    }
    const assignment = await this.prisma.missionAssignment.findFirst({
      where: {
        missionId,
        jobberUserId: userId,
        status: MissionAssignmentStatus.ACTIVE,
      },
      select: { id: true },
    });
    if (assignment) {
      return;
    }
    if (mission.status === MissionStatus.PUBLISHED) {
      const profile = await this.prisma.jobberProfile.findUnique({
        where: { userId },
        select: { userId: true },
      });
      if (profile) {
        return;
      }
    }
    throw new ForbiddenException('Accès non autorisé à cette photo');
  }

  /** Filtre tarif proposé (FCFA) sur rateAmount puis clientPriceAmount. */
  private buildAvailablePriceFilter(
    query: AvailableMissionsQueryDto,
  ): Prisma.MissionWhereInput | null {
    const hasMin = query.minPrice !== undefined;
    const hasMax = query.maxPrice !== undefined;
    if (!hasMin && !hasMax) {
      return null;
    }
    if (
      hasMin &&
      hasMax &&
      query.minPrice !== undefined &&
      query.maxPrice !== undefined &&
      query.maxPrice < query.minPrice
    ) {
      throw new BadRequestException('maxPrice doit être ≥ minPrice.');
    }

    const range: { gte?: number; lte?: number } = {};
    if (hasMin) range.gte = query.minPrice;
    if (hasMax) range.lte = query.maxPrice;

    return {
      OR: [{ rateAmount: range }, { clientPriceAmount: range }],
    };
  }

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

/** Signature binaire minimale : le MIME navigateur n'est pas fiable. */
function matchesMissionImageMagic(mimeType: string, buffer: Buffer): boolean {
  if (buffer.length < 12) return false;
  switch (mimeType) {
    case 'image/jpeg':
      return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    case 'image/png':
      return (
        buffer[0] === 0x89 && buffer.subarray(1, 4).toString('ascii') === 'PNG'
      );
    case 'image/webp':
      return (
        buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
        buffer.subarray(8, 12).toString('ascii') === 'WEBP'
      );
    default:
      return false;
  }
}

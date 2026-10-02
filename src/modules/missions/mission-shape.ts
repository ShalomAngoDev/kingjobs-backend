import { BadRequestException } from '@nestjs/common';
import {
  MissionPricingType,
  MissionRateScope,
  MissionSchedulingType,
  MissionWeekday,
} from '@prisma/client';
import { MISSION_LIMITS } from '../../common/constants/mission-limits';
import type { CreateMissionDto } from './dto/create-mission.dto';
import type { UpdateMissionDto } from './dto/update-mission.dto';
import {
  computeMissionPricing,
  type PricingComputed,
} from './mission-pricing';
import {
  buildOccurrences,
  combineDateAndTime,
  parseDateOnly,
  primaryScheduledStartFromOccurrences,
  type OccurrenceInput,
} from './mission-scheduling';

export type ResolvedMissionShape = {
  pricing: PricingComputed;
  schedulingType: MissionSchedulingType;
  scheduleStartDate: Date | null;
  scheduleEndDate: Date | null;
  scheduleSameHoursDaily: boolean | null;
  selectedWeekdays: MissionWeekday[];
  durationKnown: boolean;
  estimatedDurationMinutes: number | null;
  scheduledStartAt: Date | null;
  occurrences: OccurrenceInput[];
  locationNotes: string | null;
};

function resolveRateAmount(dto: {
  rateAmount?: number;
  clientPriceAmount?: number;
}): number {
  if (dto.rateAmount !== undefined) {
    return dto.rateAmount;
  }
  if (dto.clientPriceAmount !== undefined) {
    return dto.clientPriceAmount;
  }
  throw new BadRequestException(
    'Indiquez rateAmount (ou clientPriceAmount en legacy FIXED).',
  );
}

export function resolveCreateShape(dto: CreateMissionDto): ResolvedMissionShape {
  const workersNeeded = dto.workersNeeded ?? 1;
  const pricingType = dto.pricingType ?? MissionPricingType.FIXED;
  const rateScope = dto.rateScope ?? MissionRateScope.PER_JOBBER;
  const rateAmount = resolveRateAmount(dto);
  const durationKnown = dto.durationKnown ?? true;
  const schedulingType = dto.schedulingType ?? MissionSchedulingType.ONCE;

  let scheduleStartDate: Date | null = null;
  let scheduleEndDate: Date | null = null;
  let scheduledStartAt: Date | null = null;

  if (dto.scheduleStartDate) {
    scheduleStartDate = parseDateOnly(dto.scheduleStartDate, 'scheduleStartDate');
    scheduleEndDate = dto.scheduleEndDate
      ? parseDateOnly(dto.scheduleEndDate, 'scheduleEndDate')
      : scheduleStartDate;
    scheduledStartAt = combineDateAndTime(scheduleStartDate, dto.startTime);
  } else if (dto.scheduledStartAt) {
    scheduledStartAt = new Date(dto.scheduledStartAt);
    if (Number.isNaN(scheduledStartAt.getTime())) {
      throw new BadRequestException('Date de début invalide.');
    }
    if (scheduledStartAt.getTime() <= Date.now()) {
      throw new BadRequestException('La date de début doit être dans le futur.');
    }
    scheduleStartDate = new Date(
      Date.UTC(
        scheduledStartAt.getUTCFullYear(),
        scheduledStartAt.getUTCMonth(),
        scheduledStartAt.getUTCDate(),
      ),
    );
    scheduleEndDate = scheduleStartDate;
  }

  const manualOccurrences: OccurrenceInput[] | undefined = dto.occurrences?.map(
    (row, index) => ({
      occurrenceDate: parseDateOnly(row.occurrenceDate, 'occurrenceDate'),
      plannedStartAt: row.plannedStartAt ? new Date(row.plannedStartAt) : null,
      plannedEndAt: row.plannedEndAt ? new Date(row.plannedEndAt) : null,
      estimatedDurationMinutes: row.estimatedDurationMinutes ?? null,
      sortOrder: index,
    }),
  );

  let occurrences: OccurrenceInput[] = [];
  if (scheduleStartDate) {
    occurrences = buildOccurrences({
      schedulingType,
      scheduleStartDate,
      scheduleEndDate,
      selectedWeekdays: dto.selectedWeekdays,
      scheduledStartAt,
      estimatedDurationMinutes: dto.estimatedDurationMinutes ?? null,
      durationKnown,
      occurrences: manualOccurrences,
    });
    scheduledStartAt =
      primaryScheduledStartFromOccurrences(occurrences) ?? scheduledStartAt;
  } else if (manualOccurrences?.length) {
    throw new BadRequestException(
      'scheduleStartDate est requis lorsque des occurrences sont fournies.',
    );
  }

  // Pour HOURLY multi-jours : computeMissionPricing additionne les occurrences.
  const pricing = computeMissionPricing({
    pricingType,
    rateAmount,
    rateScope,
    workersNeeded,
    estimatedDurationMinutes: dto.estimatedDurationMinutes ?? null,
    durationKnown,
    schedulingType,
    dayCount: Math.max(1, occurrences.length),
    occurrences,
  });

  const scheduleSameHoursDaily =
    schedulingType === MissionSchedulingType.ONCE
      ? null
      : (dto.scheduleSameHoursDaily ?? true);

  // SELECTED_DAYS : stocker la durée totale (somme) si le Client ne fournit pas
  // estimatedDurationMinutes mais que les occurrences en ont une.
  let resolvedEstimatedMinutes: number | null = null;
  if (durationKnown) {
    if (dto.estimatedDurationMinutes != null) {
      resolvedEstimatedMinutes = dto.estimatedDurationMinutes;
    } else if (schedulingType === MissionSchedulingType.SELECTED_DAYS) {
      const sum = occurrences.reduce((acc, row) => {
        if (
          row.estimatedDurationMinutes != null &&
          Number.isInteger(row.estimatedDurationMinutes)
        ) {
          return acc + row.estimatedDurationMinutes;
        }
        return acc;
      }, 0);
      resolvedEstimatedMinutes = sum > 0 ? sum : null;
    }
  }

  return {
    pricing,
    schedulingType,
    scheduleStartDate,
    scheduleEndDate,
    scheduleSameHoursDaily,
    selectedWeekdays: dto.selectedWeekdays ?? [],
    durationKnown,
    estimatedDurationMinutes: resolvedEstimatedMinutes,
    scheduledStartAt,
    occurrences,
    locationNotes: dto.locationNotes?.trim() || null,
  };
}

function formatDateOnlyUtc(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatTimeHmUtc(d: Date): string {
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Rebuild planning + occurrences on DRAFT / NEEDS_CHANGES update when schedule
 * fields are touched. Returns null if no schedule rebuild is needed.
 */
export function resolveUpdateScheduleShape(
  current: {
    schedulingType: MissionSchedulingType;
    scheduleStartDate: Date | null;
    scheduleEndDate: Date | null;
    scheduleSameHoursDaily: boolean | null;
    selectedWeekdays: MissionWeekday[];
    durationKnown: boolean;
    estimatedDurationMinutes: number | null;
    scheduledStartAt: Date | null;
    locationNotes: string | null;
    pricingType: MissionPricingType;
    rateAmount: number | null;
    rateScope: MissionRateScope;
    clientPriceAmount: number;
    workersNeeded: number;
  },
  dto: UpdateMissionDto,
): ResolvedMissionShape | null {
  const scheduleTouched =
    dto.schedulingType !== undefined ||
    dto.scheduleStartDate !== undefined ||
    dto.scheduleEndDate !== undefined ||
    dto.startTime !== undefined ||
    dto.scheduledStartAt !== undefined ||
    dto.selectedWeekdays !== undefined ||
    dto.durationKnown !== undefined ||
    dto.estimatedDurationMinutes !== undefined ||
    dto.occurrences !== undefined ||
    dto.scheduleSameHoursDaily !== undefined;

  if (!scheduleTouched) {
    return null;
  }

  const scheduleStartDate =
    dto.scheduleStartDate !== undefined
      ? dto.scheduleStartDate
      : current.scheduleStartDate
        ? formatDateOnlyUtc(current.scheduleStartDate)
        : current.scheduledStartAt
          ? formatDateOnlyUtc(current.scheduledStartAt)
          : undefined;

  const scheduleEndDate =
    dto.scheduleEndDate !== undefined
      ? dto.scheduleEndDate
      : current.scheduleEndDate
        ? formatDateOnlyUtc(current.scheduleEndDate)
        : undefined;

  const startTime =
    dto.startTime !== undefined
      ? dto.startTime ?? undefined
      : current.scheduledStartAt
        ? formatTimeHmUtc(current.scheduledStartAt)
        : undefined;

  const createLike = {
    serviceId: '00000000-0000-0000-0000-000000000000',
    title: 'placeholder',
    description: 'placeholder description for shape',
    city: 'placeholder',
    rateAmount:
      dto.rateAmount ??
      dto.clientPriceAmount ??
      current.rateAmount ??
      current.clientPriceAmount ??
      MISSION_LIMITS.MIN_PRICE_XOF,
    workersNeeded: dto.workersNeeded ?? current.workersNeeded,
    pricingType: dto.pricingType ?? current.pricingType,
    rateScope: dto.rateScope ?? current.rateScope,
    schedulingType: dto.schedulingType ?? current.schedulingType,
    scheduleStartDate,
    scheduleEndDate,
    startTime,
    scheduledStartAt:
      dto.scheduledStartAt !== undefined
        ? dto.scheduledStartAt ?? undefined
        : undefined,
    selectedWeekdays: dto.selectedWeekdays ?? current.selectedWeekdays,
    durationKnown: dto.durationKnown ?? current.durationKnown,
    estimatedDurationMinutes:
      dto.estimatedDurationMinutes !== undefined
        ? dto.estimatedDurationMinutes ?? undefined
        : current.estimatedDurationMinutes ?? undefined,
    scheduleSameHoursDaily:
      dto.scheduleSameHoursDaily !== undefined
        ? dto.scheduleSameHoursDaily ?? undefined
        : current.scheduleSameHoursDaily ?? undefined,
    occurrences: dto.occurrences,
    locationNotes:
      dto.locationNotes !== undefined
        ? dto.locationNotes ?? undefined
        : current.locationNotes ?? undefined,
  } as CreateMissionDto;

  return resolveCreateShape(createLike);
}

/** Merge partiel update → recalcul pricing si un champ tarifaire change. */
export function resolveUpdatePricing(
  current: {
    pricingType: MissionPricingType;
    rateAmount: number | null;
    rateScope: MissionRateScope;
    clientPriceAmount: number;
    workersNeeded: number;
    estimatedDurationMinutes: number | null;
    durationKnown: boolean;
    schedulingType: MissionSchedulingType;
    occurrenceCount: number;
  },
  dto: UpdateMissionDto,
): PricingComputed | null {
  const pricingTouched =
    dto.pricingType !== undefined ||
    dto.rateScope !== undefined ||
    dto.rateAmount !== undefined ||
    dto.clientPriceAmount !== undefined ||
    dto.workersNeeded !== undefined ||
    dto.estimatedDurationMinutes !== undefined ||
    dto.durationKnown !== undefined;

  if (!pricingTouched) {
    return null;
  }

  const rateAmount =
    dto.rateAmount ??
    dto.clientPriceAmount ??
    current.rateAmount ??
    current.clientPriceAmount;

  return computeMissionPricing({
    pricingType: dto.pricingType ?? current.pricingType,
    rateAmount,
    rateScope: dto.rateScope ?? current.rateScope,
    workersNeeded: dto.workersNeeded ?? current.workersNeeded,
    estimatedDurationMinutes:
      dto.estimatedDurationMinutes !== undefined
        ? dto.estimatedDurationMinutes
        : current.estimatedDurationMinutes,
    durationKnown: dto.durationKnown ?? current.durationKnown,
    schedulingType: dto.schedulingType ?? current.schedulingType,
    dayCount: Math.max(1, current.occurrenceCount),
  });
}

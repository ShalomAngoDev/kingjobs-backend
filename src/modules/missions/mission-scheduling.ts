import { BadRequestException } from '@nestjs/common';
import {
  MissionSchedulingType,
  MissionWeekday,
  type Prisma,
} from '@prisma/client';
import { MISSION_LIMITS } from '../../common/constants/mission-limits';

export type OccurrenceInput = {
  occurrenceDate: Date;
  plannedStartAt?: Date | null;
  plannedEndAt?: Date | null;
  estimatedDurationMinutes?: number | null;
  sortOrder: number;
};

function startOfUtcDay(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

function daysBetweenInclusive(start: Date, end: Date): number {
  const a = startOfUtcDay(start).getTime();
  const b = startOfUtcDay(end).getTime();
  return Math.floor((b - a) / 86_400_000) + 1;
}

function utcDayOfWeek(d: Date): number {
  return d.getUTCDay();
}

function weekdayFromUtcDay(day: number): MissionWeekday | null {
  const map: Record<number, MissionWeekday> = {
    0: MissionWeekday.SUN,
    1: MissionWeekday.MON,
    2: MissionWeekday.TUE,
    3: MissionWeekday.WED,
    4: MissionWeekday.THU,
    5: MissionWeekday.FRI,
    6: MissionWeekday.SAT,
  };
  return map[day] ?? null;
}

export function parseDateOnly(value: string, label: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException(`${label} : format attendu YYYY-MM-DD.`);
  }
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    throw new BadRequestException(`${label} : date invalide.`);
  }
  return date;
}

/** Combine date YYYY-MM-DD + heure HH:mm → Date UTC (V1 : heure locale BJ = UTC+0 pour démo). */
export function combineDateAndTime(
  dateOnly: Date,
  timeHm: string | undefined,
): Date | null {
  if (!timeHm) {
    return null;
  }
  if (!/^\d{2}:\d{2}$/.test(timeHm)) {
    throw new BadRequestException('Heure invalide (format HH:mm).');
  }
  const [hh, mm] = timeHm.split(':').map(Number);
  if (hh > 23 || mm > 59) {
    throw new BadRequestException('Heure invalide.');
  }
  return new Date(
    Date.UTC(
      dateOnly.getUTCFullYear(),
      dateOnly.getUTCMonth(),
      dateOnly.getUTCDate(),
      hh,
      mm,
      0,
      0,
    ),
  );
}

export function assertScheduleSpan(start: Date | null, end: Date | null) {
  if (!start) {
    throw new BadRequestException('La date de début du planning est requise.');
  }
  const endDate = end ?? start;
  if (endDate.getTime() < start.getTime()) {
    throw new BadRequestException(
      'La date de fin du planning ne peut pas être avant la date de début.',
    );
  }
  const span = daysBetweenInclusive(start, endDate);
  if (span > MISSION_LIMITS.MAX_SCHEDULE_SPAN_DAYS) {
    throw new BadRequestException(
      `La période ne peut pas dépasser ${MISSION_LIMITS.MAX_SCHEDULE_SPAN_DAYS} jours.`,
    );
  }
}

/**
 * Si le Client fournit des occurrences manuelles, elles doivent coller au type.
 * ONCE → exactement 1 occurrence.
 * SELECTED_DAYS (dates discrètes) → au moins 2 occurrences uniques.
 */
export function assertOccurrencesConsistentWithType(
  schedulingType: MissionSchedulingType,
  occurrences: OccurrenceInput[],
) {
  if (
    schedulingType === MissionSchedulingType.ONCE &&
    occurrences.length !== 1
  ) {
    throw new BadRequestException(
      'Une mission ONCE doit avoir exactement une occurrence.',
    );
  }
  if (occurrences.length === 0) {
    throw new BadRequestException('Au moins une occurrence est requise.');
  }
  if (occurrences.length > MISSION_LIMITS.MAX_SCHEDULE_OCCURRENCES) {
    throw new BadRequestException(
      `Trop de créneaux (${occurrences.length}). Maximum ${MISSION_LIMITS.MAX_SCHEDULE_OCCURRENCES}.`,
    );
  }
  if (
    schedulingType === MissionSchedulingType.SELECTED_DAYS &&
    occurrences.length < 2
  ) {
    throw new BadRequestException(
      'Sélectionnez au moins deux dates pour une mission sur plusieurs jours non consécutifs.',
    );
  }
  const seen = new Set<string>();
  for (const row of occurrences) {
    const key = row.occurrenceDate.toISOString().slice(0, 10);
    if (seen.has(key)) {
      throw new BadRequestException('Chaque date de mission doit être unique.');
    }
    seen.add(key);
  }
}

export function buildOccurrences(input: {
  schedulingType: MissionSchedulingType;
  scheduleStartDate: Date;
  scheduleEndDate?: Date | null;
  selectedWeekdays?: MissionWeekday[];
  scheduledStartAt?: Date | null;
  plannedEndAt?: Date | null;
  estimatedDurationMinutes?: number | null;
  durationKnown: boolean;
  occurrences?: OccurrenceInput[];
}): OccurrenceInput[] {
  if (input.occurrences?.length) {
    assertScheduleSpan(
      input.scheduleStartDate,
      input.scheduleEndDate ?? input.scheduleStartDate,
    );
    assertOccurrencesConsistentWithType(
      input.schedulingType,
      input.occurrences,
    );
    return input.occurrences.map((row, index) => ({
      ...row,
      sortOrder: row.sortOrder ?? index,
    }));
  }

  const end = input.scheduleEndDate ?? input.scheduleStartDate;
  assertScheduleSpan(input.scheduleStartDate, end);

  const startDay = startOfUtcDay(input.scheduleStartDate);
  const endDay = startOfUtcDay(end);
  const results: OccurrenceInput[] = [];
  let sortOrder = 0;

  if (input.schedulingType === MissionSchedulingType.ONCE) {
    results.push({
      occurrenceDate: startDay,
      plannedStartAt: input.scheduledStartAt ?? null,
      plannedEndAt: input.plannedEndAt ?? null,
      estimatedDurationMinutes: input.durationKnown
        ? (input.estimatedDurationMinutes ?? null)
        : null,
      sortOrder: sortOrder++,
    });
    return results;
  }

  if (
    input.schedulingType === MissionSchedulingType.SELECTED_DAYS &&
    (!input.selectedWeekdays || input.selectedWeekdays.length === 0)
  ) {
    throw new BadRequestException(
      'Sélectionnez au moins un jour pour SELECTED_DAYS.',
    );
  }

  const weekdaySet = new Set(input.selectedWeekdays ?? []);
  for (
    let cursor = new Date(startDay);
    cursor.getTime() <= endDay.getTime();
    cursor = new Date(cursor.getTime() + 86_400_000)
  ) {
    const include =
      input.schedulingType === MissionSchedulingType.CONSECUTIVE_DAYS
        ? true
        : weekdaySet.has(weekdayFromUtcDay(utcDayOfWeek(cursor))!);
    if (!include) {
      continue;
    }
    results.push({
      occurrenceDate: new Date(cursor),
      plannedStartAt: input.scheduledStartAt ?? null,
      plannedEndAt: input.plannedEndAt ?? null,
      estimatedDurationMinutes: input.durationKnown
        ? (input.estimatedDurationMinutes ?? null)
        : null,
      sortOrder: sortOrder++,
    });
  }

  assertOccurrencesConsistentWithType(input.schedulingType, results);
  return results;
}

/** Première occurrence → scheduledStartAt (tri / affichage legacy). */
export function primaryScheduledStartFromOccurrences(
  occurrences: OccurrenceInput[],
): Date | null {
  if (occurrences.length === 0) {
    return null;
  }
  const sorted = [...occurrences].sort(
    (a, b) => a.occurrenceDate.getTime() - b.occurrenceDate.getTime(),
  );
  const first = sorted[0];
  return first.plannedStartAt ?? first.occurrenceDate;
}

export function toOccurrenceCreateMany(
  missionId: string,
  rows: OccurrenceInput[],
): Prisma.MissionOccurrenceCreateManyInput[] {
  return rows.map((row) => ({
    missionId,
    occurrenceDate: row.occurrenceDate,
    plannedStartAt: row.plannedStartAt ?? null,
    plannedEndAt: row.plannedEndAt ?? null,
    estimatedDurationMinutes: row.estimatedDurationMinutes ?? null,
    sortOrder: row.sortOrder,
  }));
}

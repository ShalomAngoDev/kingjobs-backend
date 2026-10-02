import { BadRequestException } from '@nestjs/common';
import { MissionSchedulingType, MissionWeekday } from '@prisma/client';
import {
  assertOccurrencesConsistentWithType,
  buildOccurrences,
  parseDateOnly,
} from './mission-scheduling';

describe('mission-scheduling BO04.1', () => {
  it('ONCE génère une seule occurrence', () => {
    const start = parseDateOnly('2026-10-05', 'd');
    const rows = buildOccurrences({
      schedulingType: MissionSchedulingType.ONCE,
      scheduleStartDate: start,
      durationKnown: false,
    });
    expect(rows).toHaveLength(1);
  });

  it('rejette ONCE avec plusieurs occurrences manuelles', () => {
    const start = parseDateOnly('2026-10-05', 'd');
    expect(() =>
      buildOccurrences({
        schedulingType: MissionSchedulingType.ONCE,
        scheduleStartDate: start,
        durationKnown: true,
        occurrences: [
          { occurrenceDate: start, sortOrder: 0 },
          { occurrenceDate: start, sortOrder: 1 },
        ],
      }),
    ).toThrow(/exactement une occurrence/);
  });

  it('SELECTED_DAYS exige des jours', () => {
    expect(() =>
      buildOccurrences({
        schedulingType: MissionSchedulingType.SELECTED_DAYS,
        scheduleStartDate: parseDateOnly('2026-10-01', 'd'),
        scheduleEndDate: parseDateOnly('2026-10-10', 'd'),
        selectedWeekdays: [],
        durationKnown: true,
      }),
    ).toThrow(BadRequestException);
  });

  it('CONSECUTIVE_DAYS respecte max 30 jours', () => {
    expect(() =>
      buildOccurrences({
        schedulingType: MissionSchedulingType.CONSECUTIVE_DAYS,
        scheduleStartDate: parseDateOnly('2026-10-01', 'd'),
        scheduleEndDate: parseDateOnly('2026-11-05', 'd'),
        durationKnown: true,
      }),
    ).toThrow(/30 jours/);
  });

  it('SELECTED_DAYS accepte des dates discrètes manuelles sans weekdays', () => {
    const rows = buildOccurrences({
      schedulingType: MissionSchedulingType.SELECTED_DAYS,
      scheduleStartDate: parseDateOnly('2026-10-12', 'd'),
      scheduleEndDate: parseDateOnly('2026-10-20', 'd'),
      selectedWeekdays: [],
      durationKnown: true,
      occurrences: [
        {
          occurrenceDate: parseDateOnly('2026-10-12', 'd'),
          plannedStartAt: new Date('2026-10-12T09:00:00.000Z'),
          plannedEndAt: new Date('2026-10-12T17:00:00.000Z'),
          estimatedDurationMinutes: 480,
          sortOrder: 0,
        },
        {
          occurrenceDate: parseDateOnly('2026-10-15', 'd'),
          plannedStartAt: new Date('2026-10-15T09:00:00.000Z'),
          plannedEndAt: new Date('2026-10-15T17:00:00.000Z'),
          estimatedDurationMinutes: 480,
          sortOrder: 1,
        },
        {
          occurrenceDate: parseDateOnly('2026-10-20', 'd'),
          plannedStartAt: new Date('2026-10-20T09:00:00.000Z'),
          plannedEndAt: new Date('2026-10-20T17:00:00.000Z'),
          estimatedDurationMinutes: 480,
          sortOrder: 2,
        },
      ],
    });
    expect(rows).toHaveLength(3);
  });

  it('SELECTED_DAYS rejette une date en double', () => {
    const day = parseDateOnly('2026-10-12', 'd');
    expect(() =>
      buildOccurrences({
        schedulingType: MissionSchedulingType.SELECTED_DAYS,
        scheduleStartDate: day,
        scheduleEndDate: day,
        durationKnown: true,
        occurrences: [
          { occurrenceDate: day, sortOrder: 0 },
          { occurrenceDate: day, sortOrder: 1 },
        ],
      }),
    ).toThrow(/unique/);
  });

  it('SELECTED_DAYS génère Lun/Mer', () => {
    const rows = buildOccurrences({
      schedulingType: MissionSchedulingType.SELECTED_DAYS,
      scheduleStartDate: parseDateOnly('2026-10-05', 'd'), // lundi
      scheduleEndDate: parseDateOnly('2026-10-11', 'd'),
      selectedWeekdays: [MissionWeekday.MON, MissionWeekday.WED],
      durationKnown: true,
      estimatedDurationMinutes: 120,
    });
    expect(rows.length).toBeGreaterThanOrEqual(2);
    assertOccurrencesConsistentWithType(
      MissionSchedulingType.SELECTED_DAYS,
      rows,
    );
  });
});

import { BadRequestException } from '@nestjs/common';
import {
  MissionPricingType,
  MissionRateScope,
  MissionSchedulingType,
} from '@prisma/client';
import {
  computeCommissionSplit,
  computeMissionPricing,
  divideFcfaExactly,
  KINGJOBS_COMMISSION_BPS,
} from './mission-pricing';

describe('mission-pricing BO04.1', () => {
  describe('FIXED', () => {
    it('PER_JOBBER : 10 × 10_000 → total 100_000', () => {
      const r = computeMissionPricing({
        pricingType: MissionPricingType.FIXED,
        rateAmount: 10_000,
        rateScope: MissionRateScope.PER_JOBBER,
        workersNeeded: 10,
      });
      expect(r.workerGrossAmount).toBe(10_000);
      expect(r.estimatedTotalAmount).toBe(100_000);
      expect(r.clientPriceAmount).toBe(100_000);
    });

    it('TOTAL : 100_000 / 10 → 10_000 / Jobber', () => {
      const r = computeMissionPricing({
        pricingType: MissionPricingType.FIXED,
        rateAmount: 100_000,
        rateScope: MissionRateScope.TOTAL,
        workersNeeded: 10,
      });
      expect(r.workerGrossAmount).toBe(10_000);
      expect(r.estimatedTotalAmount).toBe(100_000);
    });

    it('workersNeeded = 1 : PER_JOBBER et TOTAL équivalents', () => {
      const a = computeMissionPricing({
        pricingType: MissionPricingType.FIXED,
        rateAmount: 10_000,
        rateScope: MissionRateScope.PER_JOBBER,
        workersNeeded: 1,
      });
      const b = computeMissionPricing({
        pricingType: MissionPricingType.FIXED,
        rateAmount: 10_000,
        rateScope: MissionRateScope.TOTAL,
        workersNeeded: 1,
      });
      expect(a.workerGrossAmount).toBe(b.workerGrossAmount);
      expect(a.estimatedTotalAmount).toBe(b.estimatedTotalAmount);
    });
  });

  describe('HOURLY', () => {
    it('PER_JOBBER : 2_000/h × 4h × 10 = 80_000', () => {
      const r = computeMissionPricing({
        pricingType: MissionPricingType.HOURLY,
        rateAmount: 2_000,
        rateScope: MissionRateScope.PER_JOBBER,
        workersNeeded: 10,
        estimatedDurationMinutes: 240,
        durationKnown: true,
      });
      expect(r.workerGrossAmount).toBe(8_000);
      expect(r.estimatedTotalAmount).toBe(80_000);
    });

    it('TOTAL : 20_000/h ensemble → 2_000/h/Jobber × 4h', () => {
      const r = computeMissionPricing({
        pricingType: MissionPricingType.HOURLY,
        rateAmount: 20_000,
        rateScope: MissionRateScope.TOTAL,
        workersNeeded: 10,
        estimatedDurationMinutes: 240,
        durationKnown: true,
      });
      expect(r.workerGrossAmount).toBe(8_000);
      expect(r.estimatedTotalAmount).toBe(80_000);
    });
  });

  describe('DAILY', () => {
    it('PER_JOBBER : 15_000/j × 3j × 2 = 90_000', () => {
      const r = computeMissionPricing({
        pricingType: MissionPricingType.DAILY,
        rateAmount: 15_000,
        rateScope: MissionRateScope.PER_JOBBER,
        workersNeeded: 2,
        dayCount: 3,
      });
      expect(r.workerGrossAmount).toBe(45_000);
      expect(r.estimatedTotalAmount).toBe(90_000);
    });

    it('TOTAL : 90_000/j ensemble / 2 Jobbers × 3j', () => {
      const r = computeMissionPricing({
        pricingType: MissionPricingType.DAILY,
        rateAmount: 90_000,
        rateScope: MissionRateScope.TOTAL,
        workersNeeded: 2,
        dayCount: 3,
      });
      expect(r.workerGrossAmount).toBe(135_000);
      expect(r.estimatedTotalAmount).toBe(270_000);
    });
  });

  describe('division FCFA', () => {
    it('rejette TOTAL non divisible (100_000 / 3)', () => {
      expect(() =>
        computeMissionPricing({
          pricingType: MissionPricingType.FIXED,
          rateAmount: 100_000,
          rateScope: MissionRateScope.TOTAL,
          workersNeeded: 3,
        }),
      ).toThrow(BadRequestException);
      expect(() => divideFcfaExactly(100_000, 3)).toThrow(
        /réparti équitablement entre les 3 Jobbers/,
      );
    });

    it('accepte 99_999 / 3', () => {
      expect(divideFcfaExactly(99_999, 3)).toBe(33_333);
    });
  });

  describe('commission future', () => {
    it('15 % sur 10_000 → commission 1_500, net 8_500', () => {
      expect(KINGJOBS_COMMISSION_BPS).toBe(1500);
      const split = computeCommissionSplit(10_000);
      expect(split.commissionAmount).toBe(1_500);
      expect(split.workerNetAmount).toBe(8_500);
    });
  });

  describe('SELECTED_DAYS multi-occurrences', () => {
    it('DAILY : 3 dates × 10_000 → 30_000 / Jobber', () => {
      const r = computeMissionPricing({
        pricingType: MissionPricingType.DAILY,
        rateAmount: 10_000,
        rateScope: MissionRateScope.PER_JOBBER,
        workersNeeded: 2,
        schedulingType: MissionSchedulingType.SELECTED_DAYS,
        dayCount: 3,
        occurrences: [
          {
            occurrenceDate: new Date('2026-10-12T00:00:00.000Z'),
            sortOrder: 0,
          },
          {
            occurrenceDate: new Date('2026-10-15T00:00:00.000Z'),
            sortOrder: 1,
          },
          {
            occurrenceDate: new Date('2026-10-20T00:00:00.000Z'),
            sortOrder: 2,
          },
        ],
      });
      expect(r.workerGrossAmount).toBe(30_000);
      expect(r.estimatedTotalAmount).toBe(60_000);
    });

    it('HOURLY : somme des durées (8h+4h+4h) × 2_000', () => {
      const r = computeMissionPricing({
        pricingType: MissionPricingType.HOURLY,
        rateAmount: 2_000,
        rateScope: MissionRateScope.PER_JOBBER,
        workersNeeded: 2,
        durationKnown: true,
        schedulingType: MissionSchedulingType.SELECTED_DAYS,
        occurrences: [
          {
            occurrenceDate: new Date('2026-10-12T00:00:00.000Z'),
            estimatedDurationMinutes: 480,
            sortOrder: 0,
          },
          {
            occurrenceDate: new Date('2026-10-15T00:00:00.000Z'),
            estimatedDurationMinutes: 240,
            sortOrder: 1,
          },
          {
            occurrenceDate: new Date('2026-10-20T00:00:00.000Z'),
            estimatedDurationMinutes: 240,
            sortOrder: 2,
          },
        ],
      });
      expect(r.workerGrossAmount).toBe(32_000);
      expect(r.estimatedTotalAmount).toBe(64_000);
    });

    it('FIXED : ne multiplie pas par le nombre de jours', () => {
      const r = computeMissionPricing({
        pricingType: MissionPricingType.FIXED,
        rateAmount: 25_000,
        rateScope: MissionRateScope.PER_JOBBER,
        workersNeeded: 1,
        schedulingType: MissionSchedulingType.SELECTED_DAYS,
        dayCount: 3,
        occurrences: [
          {
            occurrenceDate: new Date('2026-10-12T00:00:00.000Z'),
            sortOrder: 0,
          },
          {
            occurrenceDate: new Date('2026-10-15T00:00:00.000Z'),
            sortOrder: 1,
          },
          {
            occurrenceDate: new Date('2026-10-20T00:00:00.000Z'),
            sortOrder: 2,
          },
        ],
      });
      expect(r.workerGrossAmount).toBe(25_000);
      expect(r.estimatedTotalAmount).toBe(25_000);
    });
  });

  describe('limites', () => {
    it('rejette workersNeeded 0', () => {
      expect(() =>
        computeMissionPricing({
          pricingType: MissionPricingType.FIXED,
          rateAmount: 10_000,
          rateScope: MissionRateScope.PER_JOBBER,
          workersNeeded: 0,
        }),
      ).toThrow(BadRequestException);
    });

    it('rejette workersNeeded > 50', () => {
      expect(() =>
        computeMissionPricing({
          pricingType: MissionPricingType.FIXED,
          rateAmount: 10_000,
          rateScope: MissionRateScope.PER_JOBBER,
          workersNeeded: 51,
        }),
      ).toThrow(BadRequestException);
    });

    it('HOURLY exige durée multiple de 60', () => {
      expect(() =>
        computeMissionPricing({
          pricingType: MissionPricingType.HOURLY,
          rateAmount: 2_000,
          rateScope: MissionRateScope.PER_JOBBER,
          workersNeeded: 1,
          estimatedDurationMinutes: 90,
          durationKnown: true,
          schedulingType: MissionSchedulingType.ONCE,
        }),
      ).toThrow(/multiple de 60/);
    });
  });
});

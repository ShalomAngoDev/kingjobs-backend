import { MissionStatus } from '@prisma/client';
import {
  CATALOG_ADULT_ONLY_SLUGS,
  MISSION_LIMITS,
  RISK_FLAGS_REQUIRE_ADULT,
} from '../../common/constants/mission-limits';
import { CATALOG_SERVICE_SEEDS } from '../../common/constants/catalog-seed-data';
import {
  canSeeAddress,
  computeMinimumAge,
  resolvePagination,
} from './mission-rules';

describe('mission rules', () => {
  describe('catalogue adult-only services', () => {
    it.each([...CATALOG_ADULT_ONLY_SLUGS])(
      'seed "%s" has minimumAge 18',
      (slug) => {
        const seed = CATALOG_SERVICE_SEEDS.find((s) => s.slug === slug);
        expect(seed).toBeDefined();
        expect(seed?.minimumAge).toBe(18);
      },
    );
  });

  describe('computeMinimumAge', () => {
    it('keeps the service minimumAge without risk flags', () => {
      expect(computeMinimumAge(16, [])).toBe(16);
    });

    it.each([...RISK_FLAGS_REQUIRE_ADULT])('%s forces 18', (flag) => {
      expect(computeMinimumAge(16, [flag])).toBe(MISSION_LIMITS.ADULT_AGE);
    });

    it('OTHER_RESTRICTED_ACTIVITY alone does not force 18', () => {
      expect(computeMinimumAge(16, ['OTHER_RESTRICTED_ACTIVITY'])).toBe(16);
    });

    it('never lowers a higher service minimumAge', () => {
      expect(computeMinimumAge(21, ['DRIVING'])).toBe(21);
    });
  });

  describe('canSeeAddress', () => {
    const mission = {
      clientUserId: 'client',
      selectedJobberUserId: 'jobber' as string | null,
      status: MissionStatus.PAYMENT_REQUIRED as MissionStatus,
    };

    it('shows to the owner whatever the status', () => {
      expect(canSeeAddress({ ...mission, status: 'DRAFT' }, 'client')).toBe(
        true,
      );
    });

    it('shows to the selected jobber after selection but not when cancelled', () => {
      expect(canSeeAddress(mission, 'jobber')).toBe(true);
      expect(
        canSeeAddress(
          { ...mission, status: MissionStatus.CANCELLED },
          'jobber',
        ),
      ).toBe(false);
    });

    it('hides from everyone else', () => {
      expect(canSeeAddress(mission, 'other')).toBe(false);
      expect(canSeeAddress(mission, null)).toBe(false);
      expect(
        canSeeAddress(
          {
            ...mission,
            status: MissionStatus.PUBLISHED,
            selectedJobberUserId: null,
          },
          'jobber',
        ),
      ).toBe(false);
    });
  });

  describe('resolvePagination', () => {
    it('defaults and clamps', () => {
      expect(resolvePagination({})).toEqual({ page: 1, limit: 20, skip: 0 });
      expect(resolvePagination({ page: 3, limit: 500 })).toEqual({
        page: 3,
        limit: 50,
        skip: 100,
      });
      expect(resolvePagination({ page: -4, limit: 0 }).page).toBe(1);
    });
  });
});

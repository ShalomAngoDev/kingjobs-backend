import { MissionAssignmentStatus, MissionStatus } from '@prisma/client';
import {
  MISSION_LIMITS,
  RISK_FLAGS_REQUIRE_ADULT,
} from '../../common/constants/mission-limits';

/** minimumAge = max(service.minimumAge, 18 si un riskFlag exige un adulte). */
export function computeMinimumAge(
  serviceMinimumAge: number,
  riskFlags: readonly string[],
): number {
  const requiresAdult = riskFlags.some((flag) =>
    RISK_FLAGS_REQUIRE_ADULT.has(flag),
  );
  return Math.max(
    serviceMinimumAge,
    requiresAdult ? MISSION_LIMITS.ADULT_AGE : 0,
  );
}

export function dedupeRiskFlags<T extends string>(flags: readonly T[]): T[] {
  return Array.from(new Set(flags));
}

/** Statuts mission où l'adresse peut être visible pour un Jobber affecté (hors PUBLISHED partiel). */
export const ADDRESS_VISIBLE_TO_JOBBER_STATUSES: ReadonlySet<MissionStatus> =
  new Set<MissionStatus>([
    MissionStatus.PUBLISHED,
    MissionStatus.APPLICATION_SELECTED,
    MissionStatus.PAYMENT_REQUIRED,
    MissionStatus.CONFIRMED,
    MissionStatus.READY_TO_START,
    MissionStatus.IN_PROGRESS,
    MissionStatus.COMPLETION_PENDING,
    MissionStatus.COMPLETED,
    MissionStatus.DISPUTED,
  ]);

type AddressSubject = {
  clientUserId: string;
  selectedJobberUserId: string | null;
  status: MissionStatus;
};

/** Adresse / coordonnées : Client propriétaire, ou Jobber avec affectation ACTIVE. */
export function canSeeAddress(
  mission: AddressSubject,
  userId: string | null | undefined,
  options?: { hasActiveAssignment?: boolean },
): boolean {
  if (!userId) {
    return false;
  }
  if (mission.clientUserId === userId) {
    return true;
  }
  const isAssigned =
    options?.hasActiveAssignment === true ||
    mission.selectedJobberUserId === userId;
  return isAssigned && ADDRESS_VISIBLE_TO_JOBBER_STATUSES.has(mission.status);
}

export type Pagination = { page: number; limit: number; skip: number };

export function resolvePagination(query: {
  page?: number;
  limit?: number;
}): Pagination {
  const page = Math.max(1, Math.floor(query.page ?? 1));
  const limit = Math.min(50, Math.max(1, Math.floor(query.limit ?? 20)));
  return { page, limit, skip: (page - 1) * limit };
}

export { MissionAssignmentStatus };

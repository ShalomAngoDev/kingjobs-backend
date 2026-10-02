import { MissionAssignmentStatus } from '@prisma/client';

export type StaffingCounts = {
  workersNeeded: number;
  filledWorkers: number;
  remainingWorkers: number;
  isFull: boolean;
};

export function computeStaffing(
  workersNeeded: number,
  activeAssignmentsCount: number,
): StaffingCounts {
  const needed = Math.max(1, workersNeeded);
  const filled = Math.max(0, activeAssignmentsCount);
  const remaining = Math.max(0, needed - filled);
  return {
    workersNeeded: needed,
    filledWorkers: filled,
    remainingWorkers: remaining,
    isFull: remaining === 0,
  };
}

export const ACTIVE_ASSIGNMENT: MissionAssignmentStatus =
  MissionAssignmentStatus.ACTIVE;

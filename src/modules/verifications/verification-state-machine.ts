import { BadRequestException } from '@nestjs/common';
import {
  IdentityVerificationStatus,
  JobberStatus,
  VerificationCaseStatus,
} from '@prisma/client';

type Transitions<S extends string> = Readonly<Record<S, readonly S[]>>;

/**
 * Identité utilisateur.
 * REJECTED est terminal : aucune re-validation automatique, un refus ne se
 * lève que par une action explicite hors de ce flux.
 */
export const IDENTITY_TRANSITIONS: Transitions<IdentityVerificationStatus> = {
  [IdentityVerificationStatus.UNVERIFIED]: [IdentityVerificationStatus.PENDING],
  [IdentityVerificationStatus.PENDING]: [
    IdentityVerificationStatus.VERIFIED,
    IdentityVerificationStatus.NEEDS_CHANGES,
    IdentityVerificationStatus.REJECTED,
  ],
  [IdentityVerificationStatus.NEEDS_CHANGES]: [
    IdentityVerificationStatus.PENDING,
  ],
  [IdentityVerificationStatus.VERIFIED]: [],
  [IdentityVerificationStatus.REJECTED]: [],
};

/** Profil Jobber (hors suspension, gérée ailleurs). */
export const JOBBER_TRANSITIONS: Transitions<JobberStatus> = {
  [JobberStatus.DRAFT]: [JobberStatus.PENDING_VERIFICATION],
  [JobberStatus.PENDING_VERIFICATION]: [
    JobberStatus.ACTIVE,
    JobberStatus.NEEDS_CHANGES,
    JobberStatus.REJECTED,
  ],
  [JobberStatus.NEEDS_CHANGES]: [JobberStatus.PENDING_VERIFICATION],
  [JobberStatus.ACTIVE]: [],
  [JobberStatus.SUSPENDED]: [],
  [JobberStatus.REJECTED]: [],
};

/** Dossier de vérification. */
export const CASE_TRANSITIONS: Transitions<VerificationCaseStatus> = {
  [VerificationCaseStatus.DRAFT]: [VerificationCaseStatus.PENDING],
  [VerificationCaseStatus.PENDING]: [
    VerificationCaseStatus.APPROVED,
    VerificationCaseStatus.NEEDS_CHANGES,
    VerificationCaseStatus.REJECTED,
  ],
  [VerificationCaseStatus.NEEDS_CHANGES]: [VerificationCaseStatus.PENDING],
  [VerificationCaseStatus.APPROVED]: [],
  [VerificationCaseStatus.REJECTED]: [],
};

export function canTransitionIdentity(
  from: IdentityVerificationStatus,
  to: IdentityVerificationStatus,
): boolean {
  return IDENTITY_TRANSITIONS[from]?.includes(to) ?? false;
}

export function canTransitionJobber(from: JobberStatus, to: JobberStatus) {
  return JOBBER_TRANSITIONS[from]?.includes(to) ?? false;
}

export function canTransitionCase(
  from: VerificationCaseStatus,
  to: VerificationCaseStatus,
): boolean {
  return CASE_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertIdentityTransition(
  from: IdentityVerificationStatus,
  to: IdentityVerificationStatus,
): void {
  if (!canTransitionIdentity(from, to)) {
    throw new BadRequestException(
      `Transition d’identité interdite : ${from} vers ${to}`,
    );
  }
}

export function assertJobberTransition(from: JobberStatus, to: JobberStatus) {
  if (!canTransitionJobber(from, to)) {
    throw new BadRequestException(
      `Transition de profil Jobber interdite : ${from} vers ${to}`,
    );
  }
}

export function assertCaseTransition(
  from: VerificationCaseStatus,
  to: VerificationCaseStatus,
): void {
  if (!canTransitionCase(from, to)) {
    throw new BadRequestException(
      `Transition de dossier interdite : ${from} vers ${to}`,
    );
  }
}

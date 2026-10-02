import { ForbiddenException } from '@nestjs/common';
import {
  IdentityVerificationStatus,
  JobberStatus,
  LegalGuardianStatus,
  UserStatus,
  type JobberProfile,
  type User,
} from '@prisma/client';

export const CLIENT_IDENTITY_REQUIRED_MESSAGE =
  'Votre identité doit être vérifiée avant de publier une mission.';
export const IDENTITY_VERIFICATION_REQUIRED_CODE =
  'IDENTITY_VERIFICATION_REQUIRED';
export const JOBBER_PROFILE_REQUIRED_MESSAGE =
  'Votre profil doit être vérifié avant de pouvoir candidater à une mission.';

type OperatingUser = Pick<
  User,
  'status' | 'identityVerificationStatus' | 'legalGuardianStatus'
>;

function isGuardianCleared(status: LegalGuardianStatus): boolean {
  return (
    status === LegalGuardianStatus.NOT_REQUIRED ||
    status === LegalGuardianStatus.APPROVED
  );
}

/**
 * Un utilisateur peut agir comme Client (publier une mission) uniquement si :
 * compte actif, identité VERIFIED, autorisation du représentant légal non bloquante.
 */
export function assertUserCanOperateAsClient(
  user: OperatingUser | null | undefined,
): void {
  if (!user) {
    throw new ForbiddenException({
      code: IDENTITY_VERIFICATION_REQUIRED_CODE,
      message: CLIENT_IDENTITY_REQUIRED_MESSAGE,
    });
  }
  if (user.status !== UserStatus.ACTIVE) {
    throw new ForbiddenException('Votre compte n’est pas actif.');
  }
  if (user.identityVerificationStatus !== IdentityVerificationStatus.VERIFIED) {
    throw new ForbiddenException({
      code: IDENTITY_VERIFICATION_REQUIRED_CODE,
      message: CLIENT_IDENTITY_REQUIRED_MESSAGE,
    });
  }
  if (!isGuardianCleared(user.legalGuardianStatus)) {
    throw new ForbiddenException(
      'L’autorisation de votre représentant légal est requise.',
    );
  }
}

/**
 * Un utilisateur peut agir comme Jobber (candidater) uniquement si les règles
 * Client sont remplies ET que son profil Jobber est ACTIVE.
 */
export function assertUserCanOperateAsJobber(
  user: OperatingUser | null | undefined,
  jobberProfile: Pick<JobberProfile, 'status'> | null | undefined,
): void {
  if (!user) {
    throw new ForbiddenException(JOBBER_PROFILE_REQUIRED_MESSAGE);
  }
  if (user.status !== UserStatus.ACTIVE) {
    throw new ForbiddenException('Votre compte n’est pas actif.');
  }
  if (
    user.identityVerificationStatus !== IdentityVerificationStatus.VERIFIED ||
    !jobberProfile ||
    jobberProfile.status !== JobberStatus.ACTIVE
  ) {
    throw new ForbiddenException(JOBBER_PROFILE_REQUIRED_MESSAGE);
  }
  if (!isGuardianCleared(user.legalGuardianStatus)) {
    throw new ForbiddenException(
      'L’autorisation de votre représentant légal est requise.',
    );
  }
}

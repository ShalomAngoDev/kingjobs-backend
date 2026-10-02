import { isMinor } from '../../common/utils/age';
import type { SafeUser, UserWithJobber } from './auth.types';

export function toSafeUser(user: UserWithJobber): SafeUser {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    phone: user.phone,
    countryCode: user.countryCode,
    dateOfBirth: user.dateOfBirth
      ? user.dateOfBirth.toISOString().slice(0, 10)
      : null,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
    phoneVerifiedAt: user.phoneVerifiedAt?.toISOString() ?? null,
    status: user.status,
    role: user.role,
    identityVerificationStatus: user.identityVerificationStatus,
    legalGuardianStatus: user.legalGuardianStatus,
    isMinor: user.dateOfBirth ? isMinor(user.dateOfBirth) : false,
    hasJobberProfile: Boolean(user.jobberProfile),
    hasClientProfile: Boolean(user.clientProfile),
    jobberStatus: user.jobberProfile?.status ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}

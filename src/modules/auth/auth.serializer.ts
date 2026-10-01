import { isMinor } from '../../common/utils/age';
import type { SafeUser, UserWithJobber } from './auth.types';

export function toSafeUser(user: UserWithJobber): SafeUser {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    phone: user.phone,
    dateOfBirth: user.dateOfBirth.toISOString().slice(0, 10),
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
    phoneVerifiedAt: user.phoneVerifiedAt?.toISOString() ?? null,
    status: user.status,
    role: user.role,
    identityVerificationStatus: user.identityVerificationStatus,
    legalGuardianStatus: user.legalGuardianStatus,
    isMinor: isMinor(user.dateOfBirth),
    hasJobberProfile: Boolean(user.jobberProfile),
    jobberStatus: user.jobberProfile?.status ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}

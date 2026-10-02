import type {
  IdentityVerificationStatus,
  JobberStatus,
  LegalGuardianStatus,
  UserRole,
  UserStatus,
} from '@prisma/client';

export type JwtPayload = {
  sub: string;
  sid: string;
};

/** Utilisateur attaché à `request.user` après JwtStrategy. */
export type AuthenticatedUser = {
  id: string;
  email: string | null;
  role: UserRole;
  status: UserStatus;
  sessionId: string;
};

/** Réponse utilisateur sans passwordHash. */
export type SafeUser = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string;
  countryCode: string;
  dateOfBirth: string | null;
  emailVerifiedAt: string | null;
  phoneVerifiedAt: string | null;
  status: UserStatus;
  role: UserRole;
  identityVerificationStatus: IdentityVerificationStatus;
  legalGuardianStatus: LegalGuardianStatus;
  isMinor: boolean;
  hasJobberProfile: boolean;
  hasClientProfile: boolean;
  jobberStatus: JobberStatus | null;
  createdAt: string;
};

export type AuthTokensResponse = {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: string;
  user: SafeUser;
};

export type UserWithJobber = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string;
  countryCode: string;
  dateOfBirth: Date | null;
  emailVerifiedAt: Date | null;
  phoneVerifiedAt: Date | null;
  status: UserStatus;
  role: UserRole;
  identityVerificationStatus: IdentityVerificationStatus;
  legalGuardianStatus: LegalGuardianStatus;
  createdAt: Date;
  passwordHash?: string;
  jobberProfile?: { status: JobberStatus } | null;
  clientProfile?: { id: string } | null;
};

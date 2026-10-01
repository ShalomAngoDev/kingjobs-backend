import type { Prisma } from '@prisma/client';
import { calculateAge, isMinor } from '../../common/utils/age';
import type { JobberProfileCompletionService } from '../eligibility/jobber-profile-completion.service';

/**
 * Sélection explicite : `passwordHash`, tokens de compte, OTP et sessions
 * ne sont JAMAIS lus pour l'admin.
 */
export const ADMIN_USER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  dateOfBirth: true,
  status: true,
  role: true,
  emailVerifiedAt: true,
  phoneVerifiedAt: true,
  identityVerificationStatus: true,
  legalGuardianStatus: true,
  suspendedAt: true,
  suspensionReason: true,
  closedAt: true,
  createdAt: true,
  updatedAt: true,
  clientProfile: {
    select: { id: true, createdAt: true, updatedAt: true },
  },
  jobberProfile: {
    include: {
      _count: {
        select: {
          services: true,
          serviceAreas: { where: { isActive: true } },
        },
      },
    },
  },
} satisfies Prisma.UserSelect;

export type AdminUserRow = Prisma.UserGetPayload<{
  select: typeof ADMIN_USER_SELECT;
}>;

export type AdminUserListItem = ReturnType<typeof toAdminUserItem>;

export type PaginatedResult<T> = {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export function paginate<T>(
  items: T[],
  page: number,
  limit: number,
  total: number,
): PaginatedResult<T> {
  return { items, page, limit, total, totalPages: Math.ceil(total / limit) };
}

const iso = (value: Date | null | undefined) => value?.toISOString() ?? null;

/** Champs communs liste / détail (aucun secret). */
export function toAdminUserItem(user: AdminUserRow) {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    phone: user.phone,
    dateOfBirth: user.dateOfBirth.toISOString().slice(0, 10),
    age: calculateAge(user.dateOfBirth),
    status: user.status,
    role: user.role,
    emailVerifiedAt: iso(user.emailVerifiedAt),
    phoneVerifiedAt: iso(user.phoneVerifiedAt),
    identityVerificationStatus: user.identityVerificationStatus,
    legalGuardianStatus: user.legalGuardianStatus,
    isMinor: isMinor(user.dateOfBirth),
    hasClientProfile: Boolean(user.clientProfile),
    hasJobberProfile: Boolean(user.jobberProfile),
    jobberStatus: user.jobberProfile?.status ?? null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export function toSuspensionInfo(user: AdminUserRow) {
  return {
    suspendedAt: iso(user.suspendedAt),
    suspensionReason: user.suspensionReason,
    closedAt: iso(user.closedAt),
  };
}

export function toJobberSummary(
  user: AdminUserRow,
  completion: JobberProfileCompletionService,
) {
  const profile = user.jobberProfile;
  if (!profile) return null;
  const profileCompletion = completion.compute({
    ...profile,
    user: {
      firstName: user.firstName,
      lastName: user.lastName,
      emailVerifiedAt: user.emailVerifiedAt,
      phoneVerifiedAt: user.phoneVerifiedAt,
    },
  });
  return {
    id: profile.id,
    status: profile.status,
    headline: profile.headline,
    bio: profile.bio,
    yearsOfExperience: profile.yearsOfExperience,
    servicesCount: profile._count.services,
    zonesCount: profile._count.serviceAreas,
    profileCompletion,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

export function decimalToNumber(
  value: Prisma.Decimal | null | undefined,
): number | null {
  return value === null || value === undefined ? null : Number(value);
}

import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IdentityVerificationStatus,
  JobberStatus,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const ADMIN_LIST_MAX_LIMIT = 100;
export const ADMIN_LIST_DEFAULT_LIMIT = 20;

export const ADMIN_USER_SORT_FIELDS = [
  'createdAt',
  'lastName',
  'email',
] as const;
export type AdminUserSortField = (typeof ADMIN_USER_SORT_FIELDS)[number];

/** Trim des chaînes ; une chaîne vide devient `undefined`. */
const TrimToUndefined = () =>
  Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  });

/**
 * Booléen en query string. `enableImplicitConversion` transformerait "false"
 * en `true` : on relit donc la valeur brute (`obj[key]`).
 */
const QueryBoolean = () =>
  Transform(({ obj, key }: { obj: Record<string, unknown>; key: string }) => {
    const raw = obj[key];
    if (raw === undefined || raw === null || raw === '') return undefined;
    if (typeof raw === 'boolean') return raw;
    if (typeof raw === 'string') {
      const normalized = raw.trim().toLowerCase();
      if (normalized === 'true' || normalized === '1') return true;
      if (normalized === 'false' || normalized === '0') return false;
    }
    return raw; // rejeté par @IsBoolean()
  });

export class AdminPaginationQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: ADMIN_LIST_MAX_LIMIT,
    default: ADMIN_LIST_DEFAULT_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ADMIN_LIST_MAX_LIMIT)
  limit?: number;
}

/** Filtres communs à /admin/users, /admin/clients et /admin/jobbers. */
export class AdminUserListQueryDto extends AdminPaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Recherche prénom / nom / email / téléphone (insensible à la casse)',
    maxLength: 100,
  })
  @IsOptional()
  @TrimToUndefined()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @ApiPropertyOptional({ description: 'Email vérifié (true) ou non (false)' })
  @IsOptional()
  @QueryBoolean()
  @IsBoolean()
  emailVerified?: boolean;

  @ApiPropertyOptional({
    description: 'Téléphone vérifié (true) ou non (false)',
  })
  @IsOptional()
  @QueryBoolean()
  @IsBoolean()
  phoneVerified?: boolean;

  @ApiPropertyOptional({ enum: ADMIN_USER_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(ADMIN_USER_SORT_FIELDS)
  sort?: AdminUserSortField;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';
}

export class AdminUsersQueryDto extends AdminUserListQueryDto {
  @ApiPropertyOptional({ enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({ description: 'Possède un ClientProfile' })
  @IsOptional()
  @QueryBoolean()
  @IsBoolean()
  hasClientProfile?: boolean;

  @ApiPropertyOptional({ description: 'Possède un JobberProfile' })
  @IsOptional()
  @QueryBoolean()
  @IsBoolean()
  hasJobberProfile?: boolean;
}

export class AdminClientsQueryDto extends AdminUserListQueryDto {}

export class AdminJobbersQueryDto extends AdminUserListQueryDto {
  @ApiPropertyOptional({ enum: JobberStatus })
  @IsOptional()
  @IsEnum(JobberStatus)
  jobberStatus?: JobberStatus;

  @ApiPropertyOptional({ enum: IdentityVerificationStatus })
  @IsOptional()
  @IsEnum(IdentityVerificationStatus)
  identityVerificationStatus?: IdentityVerificationStatus;
}

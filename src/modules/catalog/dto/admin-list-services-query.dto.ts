import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const ADMIN_CATALOG_DEFAULT_PAGE_SIZE = 20;
export const ADMIN_CATALOG_MAX_PAGE_SIZE = 100;

const TrimToUndefined = () =>
  Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  });

export class AdminListServicesQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: ADMIN_CATALOG_MAX_PAGE_SIZE,
    default: ADMIN_CATALOG_DEFAULT_PAGE_SIZE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ADMIN_CATALOG_MAX_PAGE_SIZE)
  pageSize?: number;

  @ApiPropertyOptional({
    description: 'Filtre sur le nom ou le slug (insensible à la casse)',
  })
  @IsOptional()
  @TrimToUndefined()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ enum: ['active', 'inactive'] })
  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive';

  @ApiPropertyOptional({
    enum: [16, 18],
    description: '16 = minimumAge < 18, 18 = minimumAge >= 18',
  })
  @IsOptional()
  @Type(() => Number)
  @IsIn([16, 18])
  minAge?: 16 | 18;
}

import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  MissionIncidentStatus,
  MissionIncidentType,
  MissionPricingType,
  MissionSchedulingType,
  MissionStatus,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Trim } from './transforms';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class PaginationQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class MyMissionsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: MissionStatus })
  @IsOptional()
  @IsEnum(MissionStatus)
  status?: MissionStatus;
}

export class AvailableMissionsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  serviceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(120)
  city?: string;

  @ApiPropertyOptional({ description: 'Recherche titre / description / ville' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(160)
  search?: string;

  @ApiPropertyOptional({ enum: MissionPricingType })
  @IsOptional()
  @IsEnum(MissionPricingType)
  pricingType?: MissionPricingType;

  /** Tarif min (FCFA) : filtre sur rateAmount / clientPriceAmount. */
  @ApiPropertyOptional({ example: 5000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minPrice?: number;

  /** Tarif max (FCFA) inclus. */
  @ApiPropertyOptional({ example: 15000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxPrice?: number;

  /** Jour exact (YYYY-MM-DD) : scheduleStartDate ou scheduledStartAt ce jour-là. */
  @ApiPropertyOptional({ example: '2026-10-05' })
  @IsOptional()
  @Trim()
  @Matches(DATE_ONLY, { message: 'date : format attendu YYYY-MM-DD.' })
  date?: string;

  /** Début de plage inclusive (YYYY-MM-DD), ex. « Cette semaine ». */
  @ApiPropertyOptional({ example: '2026-10-05' })
  @IsOptional()
  @Trim()
  @Matches(DATE_ONLY, { message: 'dateFrom : format attendu YYYY-MM-DD.' })
  dateFrom?: string;

  /** Fin de plage inclusive (YYYY-MM-DD). */
  @ApiPropertyOptional({ example: '2026-10-11' })
  @IsOptional()
  @Trim()
  @Matches(DATE_ONLY, { message: 'dateTo : format attendu YYYY-MM-DD.' })
  dateTo?: string;
}

export class AdminMissionsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: MissionStatus })
  @IsOptional()
  @IsEnum(MissionStatus)
  status?: MissionStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  serviceId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  clientUserId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  selectedJobberUserId?: string;

  @ApiPropertyOptional({ enum: MissionPricingType })
  @IsOptional()
  @IsEnum(MissionPricingType)
  pricingType?: MissionPricingType;

  @ApiPropertyOptional({ enum: MissionSchedulingType })
  @IsOptional()
  @IsEnum(MissionSchedulingType)
  schedulingType?: MissionSchedulingType;

  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(120)
  city?: string;

  @ApiPropertyOptional({ description: 'Référence, titre ou email client' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(160)
  search?: string;
}

export class AdminIncidentsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: MissionIncidentStatus })
  @IsOptional()
  @IsEnum(MissionIncidentStatus)
  status?: MissionIncidentStatus;

  @ApiPropertyOptional({ enum: MissionIncidentType })
  @IsOptional()
  @IsEnum(MissionIncidentType)
  type?: MissionIncidentType;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  missionId?: string;
}

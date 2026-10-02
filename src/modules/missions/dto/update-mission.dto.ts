import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  MissionPricingType,
  MissionRateScope,
  MissionRiskFlag,
  MissionSchedulingType,
  MissionWeekday,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsISO31661Alpha2,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { MISSION_LIMITS } from '../../../common/constants/mission-limits';
import { MissionOccurrenceDto } from './create-mission.dto';
import { Trim, UpperCase } from './transforms';

/**
 * PATCH mission — jamais de status.
 * - DRAFT / NEEDS_CHANGES : champs métier ci-dessous.
 * - PUBLISHED : title, description, district, addressLine, locationNotes, lat/lng uniquement
 *   (champs critiques service/date/lieu/pricing/workers interdits côté service).
 */
export class UpdateMissionDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((_o, v) => v !== undefined)
  @IsUUID()
  serviceId?: string;

  @ApiPropertyOptional()
  @ValidateIf((_o, v) => v !== undefined)
  @Trim()
  @IsString()
  @MinLength(MISSION_LIMITS.TITLE_MIN)
  @MaxLength(MISSION_LIMITS.TITLE_MAX)
  title?: string;

  @ApiPropertyOptional()
  @ValidateIf((_o, v) => v !== undefined)
  @Trim()
  @IsString()
  @MinLength(10)
  @MaxLength(MISSION_LIMITS.DESCRIPTION_MAX)
  description?: string;

  @ApiPropertyOptional()
  @ValidateIf((_o, v) => v !== undefined)
  @UpperCase()
  @IsISO31661Alpha2()
  countryCode?: string;

  @ApiPropertyOptional()
  @ValidateIf((_o, v) => v !== undefined)
  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  city?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(120)
  district?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(MISSION_LIMITS.ADDRESS_MAX)
  addressLine?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(MISSION_LIMITS.LOCATION_NOTES_MAX)
  locationNotes?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-90)
  @Max(90)
  latitude?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-180)
  @Max(180)
  longitude?: number | null;

  @ApiPropertyOptional({ enum: MissionSchedulingType })
  @ValidateIf((_o, v) => v !== undefined)
  @IsEnum(MissionSchedulingType)
  schedulingType?: MissionSchedulingType;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  scheduleStartDate?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  scheduleEndDate?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/)
  startTime?: string | null;

  @ApiPropertyOptional({
    description:
      'true = mêmes horaires chaque jour (SELECTED_DAYS / CONSECUTIVE).',
    nullable: true,
  })
  @IsOptional()
  @IsBoolean()
  scheduleSameHoursDaily?: boolean | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  @IsOptional()
  @IsDateString()
  scheduledStartAt?: string | null;

  @ApiPropertyOptional({ enum: MissionWeekday, isArray: true })
  @ValidateIf((_o, v) => v !== undefined)
  @IsArray()
  @ArrayUnique()
  @IsEnum(MissionWeekday, { each: true })
  selectedWeekdays?: MissionWeekday[];

  @ApiPropertyOptional()
  @ValidateIf((_o, v) => v !== undefined)
  @IsBoolean()
  durationKnown?: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  @Min(MISSION_LIMITS.MIN_DURATION_MINUTES)
  @Max(MISSION_LIMITS.MAX_DURATION_MINUTES)
  estimatedDurationMinutes?: number | null;

  @ApiPropertyOptional({ type: [MissionOccurrenceDto] })
  @ValidateIf((_o, v) => v !== undefined)
  @IsArray()
  @ArrayMaxSize(MISSION_LIMITS.MAX_SCHEDULE_OCCURRENCES)
  @ValidateNested({ each: true })
  @Type(() => MissionOccurrenceDto)
  occurrences?: MissionOccurrenceDto[];

  @ApiPropertyOptional({
    minimum: MISSION_LIMITS.MIN_WORKERS_NEEDED,
    maximum: MISSION_LIMITS.MAX_WORKERS_NEEDED,
  })
  @ValidateIf((_o, v) => v !== undefined)
  @IsInt()
  @Min(MISSION_LIMITS.MIN_WORKERS_NEEDED)
  @Max(MISSION_LIMITS.MAX_WORKERS_NEEDED)
  workersNeeded?: number;

  @ApiPropertyOptional({ enum: MissionPricingType })
  @ValidateIf((_o, v) => v !== undefined)
  @IsEnum(MissionPricingType)
  pricingType?: MissionPricingType;

  @ApiPropertyOptional({ enum: MissionRateScope })
  @ValidateIf((_o, v) => v !== undefined)
  @IsEnum(MissionRateScope)
  rateScope?: MissionRateScope;

  @ApiPropertyOptional()
  @ValidateIf((_o, v) => v !== undefined)
  @IsInt()
  @Min(MISSION_LIMITS.MIN_PRICE_XOF)
  @Max(MISSION_LIMITS.MAX_PRICE_XOF)
  rateAmount?: number;

  @ApiPropertyOptional({
    description: 'Legacy alias rateAmount FIXED PER_JOBBER',
  })
  @ValidateIf((_o, v) => v !== undefined)
  @IsInt()
  @Min(MISSION_LIMITS.MIN_PRICE_XOF)
  @Max(MISSION_LIMITS.MAX_PRICE_XOF)
  clientPriceAmount?: number;

  @ApiPropertyOptional({ enum: MissionRiskFlag, isArray: true })
  @ValidateIf((_o, v) => v !== undefined)
  @IsArray()
  @ArrayMaxSize(Object.keys(MissionRiskFlag).length)
  @ArrayUnique()
  @IsEnum(MissionRiskFlag, { each: true })
  riskFlags?: MissionRiskFlag[];
}

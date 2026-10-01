import { ApiPropertyOptional } from '@nestjs/swagger';
import { MissionRiskFlag } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsISO31661Alpha2,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { MISSION_LIMITS } from '../../../common/constants/mission-limits';
import { Trim, UpperCase } from './transforms';

/**
 * PATCH mission — champs limités, jamais de status.
 * - DRAFT : tous les champs ci-dessous.
 * - PUBLISHED : title, description, district, addressLine, latitude, longitude uniquement.
 * `null` efface un champ optionnel (district, addressLine, coordonnées, date, durée).
 */
export class UpdateMissionDto {
  @ApiPropertyOptional()
  @ValidateIf((_o, v) => v !== undefined)
  @Trim()
  @IsString()
  @MinLength(3)
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

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  @IsOptional()
  @IsDateString()
  scheduledStartAt?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  @Min(MISSION_LIMITS.MIN_DURATION_MINUTES)
  @Max(MISSION_LIMITS.MAX_DURATION_MINUTES)
  estimatedDurationMinutes?: number | null;

  @ApiPropertyOptional()
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

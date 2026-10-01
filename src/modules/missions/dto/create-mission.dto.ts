import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { MISSION_LIMITS } from '../../../common/constants/mission-limits';
import { Trim, UpperCase } from './transforms';

/**
 * Création d'une mission (DRAFT).
 * Ne contient VOLONTAIREMENT ni status, ni clientUserId, ni snapshots, ni currency :
 * ValidationPipe(forbidNonWhitelisted) rejette tout champ inconnu.
 */
export class CreateMissionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  serviceId!: string;

  @ApiProperty({ minLength: 3, maxLength: MISSION_LIMITS.TITLE_MAX })
  @Trim()
  @IsString()
  @MinLength(3)
  @MaxLength(MISSION_LIMITS.TITLE_MAX)
  title!: string;

  @ApiProperty({ minLength: 10, maxLength: MISSION_LIMITS.DESCRIPTION_MAX })
  @Trim()
  @IsString()
  @MinLength(10)
  @MaxLength(MISSION_LIMITS.DESCRIPTION_MAX)
  description!: string;

  @ApiPropertyOptional({ default: MISSION_LIMITS.DEFAULT_COUNTRY })
  @IsOptional()
  @UpperCase()
  @IsISO31661Alpha2()
  countryCode?: string;

  @ApiProperty({ maxLength: 120 })
  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  city!: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(120)
  district?: string;

  @ApiPropertyOptional({
    maxLength: MISSION_LIMITS.ADDRESS_MAX,
    description:
      'Adresse précise — visible uniquement du Client et du Jobber sélectionné',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(MISSION_LIMITS.ADDRESS_MAX)
  addressLine?: string;

  @ApiPropertyOptional({ minimum: -90, maximum: 90 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional({ minimum: -180, maximum: 180 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-180)
  @Max(180)
  longitude?: number;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  scheduledStartAt?: string;

  @ApiPropertyOptional({
    minimum: MISSION_LIMITS.MIN_DURATION_MINUTES,
    maximum: MISSION_LIMITS.MAX_DURATION_MINUTES,
  })
  @IsOptional()
  @IsInt()
  @Min(MISSION_LIMITS.MIN_DURATION_MINUTES)
  @Max(MISSION_LIMITS.MAX_DURATION_MINUTES)
  estimatedDurationMinutes?: number;

  @ApiProperty({
    description: 'Prix en FCFA (XOF), entier',
    minimum: MISSION_LIMITS.MIN_PRICE_XOF,
    maximum: MISSION_LIMITS.MAX_PRICE_XOF,
  })
  @IsInt()
  @Min(MISSION_LIMITS.MIN_PRICE_XOF)
  @Max(MISSION_LIMITS.MAX_PRICE_XOF)
  clientPriceAmount!: number;

  @ApiPropertyOptional({ enum: MissionRiskFlag, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(Object.keys(MissionRiskFlag).length)
  @ArrayUnique()
  @IsEnum(MissionRiskFlag, { each: true })
  riskFlags?: MissionRiskFlag[];
}

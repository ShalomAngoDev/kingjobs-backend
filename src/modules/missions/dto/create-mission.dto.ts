import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
  ValidateNested,
} from 'class-validator';
import { MISSION_LIMITS } from '../../../common/constants/mission-limits';
import { Trim, UpperCase } from './transforms';

export class MissionOccurrenceDto {
  @ApiProperty({ description: 'YYYY-MM-DD' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  occurrenceDate!: string;

  @ApiPropertyOptional({ description: 'ISO date-time début prévu' })
  @IsOptional()
  @IsDateString()
  plannedStartAt?: string;

  @ApiPropertyOptional({ description: 'ISO date-time fin prévue' })
  @IsOptional()
  @IsDateString()
  plannedEndAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(MISSION_LIMITS.MIN_DURATION_MINUTES)
  @Max(MISSION_LIMITS.MAX_DURATION_MINUTES)
  estimatedDurationMinutes?: number;
}

/**
 * Création d'une mission (DRAFT).
 * Contrat mobile cible BO04.1 — pas de status / clientUserId / currency dans le body.
 *
 * Pricing :
 * - `rateAmount` = montant saisi (par Jobber OU budget global selon `rateScope`)
 * - `clientPriceAmount` legacy : si fourni sans `rateAmount`, traité comme FIXED PER_JOBBER
 */
export class CreateMissionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  serviceId!: string;

  @ApiProperty({
    minLength: MISSION_LIMITS.TITLE_MIN,
    maxLength: MISSION_LIMITS.TITLE_MAX,
  })
  @Trim()
  @IsString()
  @MinLength(MISSION_LIMITS.TITLE_MIN)
  @MaxLength(MISSION_LIMITS.TITLE_MAX)
  title!: string;

  @ApiProperty({ minLength: 10, maxLength: MISSION_LIMITS.DESCRIPTION_MAX })
  @Trim()
  @IsString()
  @MinLength(10)
  @MaxLength(MISSION_LIMITS.DESCRIPTION_MAX)
  description!: string;

  // ----- Localisation -----

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

  @ApiPropertyOptional({
    maxLength: 120,
    description: 'Quartier / zone (district)',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(120)
  district?: string;

  @ApiPropertyOptional({
    maxLength: MISSION_LIMITS.ADDRESS_MAX,
    description:
      'Adresse précise — visible Client + Jobber sélectionné uniquement',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(MISSION_LIMITS.ADDRESS_MAX)
  addressLine?: string;

  @ApiPropertyOptional({ maxLength: MISSION_LIMITS.LOCATION_NOTES_MAX })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(MISSION_LIMITS.LOCATION_NOTES_MAX)
  locationNotes?: string;

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

  // ----- Planning -----

  @ApiPropertyOptional({
    enum: MissionSchedulingType,
    default: MissionSchedulingType.ONCE,
  })
  @IsOptional()
  @IsEnum(MissionSchedulingType)
  schedulingType?: MissionSchedulingType;

  @ApiPropertyOptional({
    description: 'YYYY-MM-DD — début période (ou date unique ONCE)',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  scheduleStartDate?: string;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD — fin période' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  scheduleEndDate?: string;

  @ApiPropertyOptional({ description: 'HH:mm — heure de début commune' })
  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/)
  startTime?: string;

  @ApiPropertyOptional({
    description:
      'true = mêmes horaires chaque jour (SELECTED_DAYS / CONSECUTIVE). null = non applicable (ONCE).',
    nullable: true,
  })
  @IsOptional()
  @IsBoolean()
  scheduleSameHoursDaily?: boolean | null;

  @ApiPropertyOptional({
    description:
      'Legacy ISO : date+heure unique (ONCE). Priorité : scheduleStartDate+startTime.',
  })
  @IsOptional()
  @IsDateString()
  scheduledStartAt?: string;

  @ApiPropertyOptional({ enum: MissionWeekday, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(MissionWeekday, { each: true })
  selectedWeekdays?: MissionWeekday[];

  @ApiPropertyOptional({
    description: 'false = durée à déterminer sur place',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  durationKnown?: boolean;

  @ApiPropertyOptional({
    minimum: MISSION_LIMITS.MIN_DURATION_MINUTES,
    maximum: MISSION_LIMITS.MAX_DURATION_MINUTES,
  })
  @IsOptional()
  @IsInt()
  @Min(MISSION_LIMITS.MIN_DURATION_MINUTES)
  @Max(MISSION_LIMITS.MAX_DURATION_MINUTES)
  estimatedDurationMinutes?: number;

  @ApiPropertyOptional({
    type: [MissionOccurrenceDto],
    description: 'Occurrences manuelles (sinon générées depuis le type)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MISSION_LIMITS.MAX_SCHEDULE_OCCURRENCES)
  @ValidateNested({ each: true })
  @Type(() => MissionOccurrenceDto)
  occurrences?: MissionOccurrenceDto[];

  // ----- Jobbers -----

  @ApiPropertyOptional({
    description: 'Besoin en Jobbers (multi-assignment = BO05)',
    minimum: MISSION_LIMITS.MIN_WORKERS_NEEDED,
    maximum: MISSION_LIMITS.MAX_WORKERS_NEEDED,
    default: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(MISSION_LIMITS.MIN_WORKERS_NEEDED)
  @Max(MISSION_LIMITS.MAX_WORKERS_NEEDED)
  workersNeeded?: number;

  // ----- Pricing -----

  @ApiPropertyOptional({
    enum: MissionPricingType,
    default: MissionPricingType.FIXED,
  })
  @IsOptional()
  @IsEnum(MissionPricingType)
  pricingType?: MissionPricingType;

  @ApiPropertyOptional({
    enum: MissionRateScope,
    default: MissionRateScope.PER_JOBBER,
    description:
      'PER_JOBBER = montant pour une personne ; TOTAL = budget pour tous',
  })
  @IsOptional()
  @IsEnum(MissionRateScope)
  rateScope?: MissionRateScope;

  @ApiPropertyOptional({
    description: 'Montant saisi FCFA (selon rateScope)',
    minimum: MISSION_LIMITS.MIN_PRICE_XOF,
    maximum: MISSION_LIMITS.MAX_PRICE_XOF,
  })
  @IsOptional()
  @IsInt()
  @Min(MISSION_LIMITS.MIN_PRICE_XOF)
  @Max(MISSION_LIMITS.MAX_PRICE_XOF)
  rateAmount?: number;

  @ApiPropertyOptional({
    description:
      'Legacy : si rateAmount absent, traité comme FIXED PER_JOBBER rateAmount',
    minimum: MISSION_LIMITS.MIN_PRICE_XOF,
    maximum: MISSION_LIMITS.MAX_PRICE_XOF,
  })
  @IsOptional()
  @IsInt()
  @Min(MISSION_LIMITS.MIN_PRICE_XOF)
  @Max(MISSION_LIMITS.MAX_PRICE_XOF)
  clientPriceAmount?: number;

  @ApiPropertyOptional({ enum: MissionRiskFlag, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(Object.keys(MissionRiskFlag).length)
  @ArrayUnique()
  @IsEnum(MissionRiskFlag, { each: true })
  riskFlags?: MissionRiskFlag[];
}

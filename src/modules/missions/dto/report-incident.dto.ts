import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MissionIncidentType } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { MISSION_LIMITS } from '../../../common/constants/mission-limits';
import { Trim } from './transforms';

export class ReportIncidentDto {
  @ApiProperty({ enum: MissionIncidentType })
  @IsEnum(MissionIncidentType)
  type!: MissionIncidentType;

  @ApiProperty({
    minLength: 5,
    maxLength: MISSION_LIMITS.INCIDENT_DESCRIPTION_MAX,
  })
  @Trim()
  @IsString()
  @MinLength(5)
  @MaxLength(MISSION_LIMITS.INCIDENT_DESCRIPTION_MAX)
  description!: string;

  @ApiPropertyOptional({
    description: 'Si vrai, la mission passe en DISPUTED (blocage immédiat)',
  })
  @IsOptional()
  @IsBoolean()
  blocksMission?: boolean;
}

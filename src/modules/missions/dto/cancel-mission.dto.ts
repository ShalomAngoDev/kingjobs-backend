import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MissionCancellationReason } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { MISSION_LIMITS } from '../../../common/constants/mission-limits';
import { Trim } from './transforms';

export class CancelMissionDto {
  @ApiProperty({ enum: MissionCancellationReason })
  @IsEnum(MissionCancellationReason)
  reasonCode!: MissionCancellationReason;

  @ApiPropertyOptional({ maxLength: MISSION_LIMITS.CANCELLATION_REASON_MAX })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(MISSION_LIMITS.CANCELLATION_REASON_MAX)
  reasonText?: string;
}

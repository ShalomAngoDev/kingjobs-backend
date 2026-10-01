import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { MISSION_LIMITS } from '../../../common/constants/mission-limits';
import { Trim } from './transforms';

export class ApplyMissionDto {
  @ApiPropertyOptional({ maxLength: MISSION_LIMITS.APPLICATION_MESSAGE_MAX })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(MISSION_LIMITS.APPLICATION_MESSAGE_MAX)
  message?: string;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  MissionRejectionReason,
  MissionReviewChangeArea,
} from '@prisma/client';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { MISSION_LIMITS } from '../../../common/constants/mission-limits';
import { Trim } from './transforms';

export class ApproveMissionDto {
  @ApiPropertyOptional({ maxLength: MISSION_LIMITS.REVIEW_INTERNAL_NOTE_MAX })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(MISSION_LIMITS.REVIEW_INTERNAL_NOTE_MAX)
  internalNote?: string;
}

export class RequestMissionChangesDto {
  @ApiProperty({ enum: MissionReviewChangeArea, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(MissionReviewChangeArea, { each: true })
  areas!: MissionReviewChangeArea[];

  @ApiProperty({ minLength: 10, maxLength: MISSION_LIMITS.REVIEW_MESSAGE_MAX })
  @Trim()
  @IsString()
  @MinLength(10)
  @MaxLength(MISSION_LIMITS.REVIEW_MESSAGE_MAX)
  message!: string;

  @ApiPropertyOptional({ maxLength: MISSION_LIMITS.REVIEW_INTERNAL_NOTE_MAX })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(MISSION_LIMITS.REVIEW_INTERNAL_NOTE_MAX)
  internalNote?: string;
}

export class RejectMissionDto {
  @ApiProperty({ enum: MissionRejectionReason })
  @IsEnum(MissionRejectionReason)
  reasonCode!: MissionRejectionReason;

  @ApiProperty({ minLength: 10, maxLength: MISSION_LIMITS.REVIEW_MESSAGE_MAX })
  @Trim()
  @IsString()
  @MinLength(10)
  @MaxLength(MISSION_LIMITS.REVIEW_MESSAGE_MAX)
  reasonText!: string;

  @ApiPropertyOptional({ maxLength: MISSION_LIMITS.REVIEW_INTERNAL_NOTE_MAX })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(MISSION_LIMITS.REVIEW_INTERNAL_NOTE_MAX)
  internalNote?: string;
}

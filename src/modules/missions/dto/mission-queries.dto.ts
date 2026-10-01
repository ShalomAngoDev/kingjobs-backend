import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  MissionIncidentStatus,
  MissionIncidentType,
  MissionStatus,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Trim } from './transforms';

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
  clientUserId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  selectedJobberUserId?: string;
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

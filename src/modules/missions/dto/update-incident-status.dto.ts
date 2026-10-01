import { ApiProperty } from '@nestjs/swagger';
import { MissionIncidentStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateIncidentStatusDto {
  @ApiProperty({ enum: MissionIncidentStatus })
  @IsEnum(MissionIncidentStatus)
  status!: MissionIncidentStatus;
}

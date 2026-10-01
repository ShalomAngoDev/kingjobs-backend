import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { CATALOG_LIMITS } from '../../../common/constants/catalog-limits';

export class CreateJobberSkillDto {
  @ApiProperty({ maxLength: CATALOG_LIMITS.MAX_SKILL_NAME_LENGTH })
  @IsString()
  @MinLength(1)
  @MaxLength(CATALOG_LIMITS.MAX_SKILL_NAME_LENGTH)
  name!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Service lié (doit faire partie des services du Jobber)',
  })
  @IsOptional()
  @IsUUID()
  serviceId?: string;
}

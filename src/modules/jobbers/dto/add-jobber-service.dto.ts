import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CATALOG_LIMITS } from '../../../common/constants/catalog-limits';

export class AddJobberServiceDto {
  @ApiProperty({ format: 'uuid', description: 'Identifiant du service' })
  @IsUUID()
  serviceId!: string;

  @ApiPropertyOptional({
    maxLength: CATALOG_LIMITS.MAX_EXPERIENCE_DESCRIPTION_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(CATALOG_LIMITS.MAX_EXPERIENCE_DESCRIPTION_LENGTH)
  experienceDescription?: string;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: CATALOG_LIMITS.MAX_YEARS_OF_EXPERIENCE,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(CATALOG_LIMITS.MAX_YEARS_OF_EXPERIENCE)
  yearsOfExperience?: number;
}

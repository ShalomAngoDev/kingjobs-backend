import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CATALOG_LIMITS } from '../../../common/constants/catalog-limits';

/** Seuls ces champs sont modifiables ; le statut est calculé côté serveur. */
export class UpdateJobberServiceDto {
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

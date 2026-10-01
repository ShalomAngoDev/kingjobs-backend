import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ServiceRequirementType } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateRequirementDto {
  @ApiProperty({ enum: ServiceRequirementType })
  @IsEnum(ServiceRequirementType)
  type!: ServiceRequirementType;

  @ApiProperty({ maxLength: 80, example: 'MINIMUM_AGE_18' })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Matches(/^[A-Za-z0-9_.-]+$/, {
    message: 'Le code ne doit contenir que lettres, chiffres, _ . -',
  })
  code!: string;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  label!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  documentTypeId?: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  configuration?: Record<string, unknown>;
}

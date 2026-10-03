import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

const trim = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );

export class UpdateMeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @trim()
  @MinLength(1)
  @MaxLength(80)
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @trim()
  @MinLength(1)
  @MaxLength(80)
  lastName?: string;

  /** Date de naissance ISO (YYYY-MM-DD). Requis pour le parcours Jobber / KYC. */
  @ApiPropertyOptional({ example: '1998-05-12' })
  @IsOptional()
  @ValidateIf(
    (_, v) => v !== null && v !== undefined && String(v).trim() !== '',
  )
  @IsDateString()
  dateOfBirth?: string | null;
}

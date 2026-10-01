import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Exactement un des deux champs doit être fourni (vérifié côté service). */
export class ValidateVerificationDto {
  @ApiPropertyOptional({ example: '4821', description: 'Code à 4 chiffres' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}$/, { message: 'Le code doit contenir 4 chiffres' })
  code?: string;

  @ApiPropertyOptional({ description: 'Jeton opaque issu du QR' })
  @IsOptional()
  @IsString()
  @MinLength(16)
  @MaxLength(256)
  token?: string;
}

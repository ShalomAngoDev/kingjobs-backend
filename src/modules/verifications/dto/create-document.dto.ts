import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IdentityDocumentSubType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

/** Champs texte du multipart (le fichier est dans le champ `file`). */
export class CreateDocumentDto {
  @ApiProperty({ example: 'CIP' })
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z][A-Z0-9_]{1,79}$/, { message: 'documentTypeCode invalide' })
  documentTypeCode!: string;

  @ApiPropertyOptional({ enum: IdentityDocumentSubType })
  @IsOptional()
  @IsEnum(IdentityDocumentSubType)
  identitySubType?: IdentityDocumentSubType;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  originalFilename?: string;

  @ApiPropertyOptional({ description: 'Horodatage de capture (selfie live)' })
  @IsOptional()
  @IsDateString()
  capturedAt?: string;
}

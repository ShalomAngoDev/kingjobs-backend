import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  UserDocumentStatus,
  VerificationCaseKind,
  VerificationCaseStatus,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const trim = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );

const trimToUndefined = () =>
  Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  });

export const REASON_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,79}$/;

export class ApproveCaseDto {
  @ApiPropertyOptional({
    description: 'Note interne (jamais visible par l’utilisateur)',
  })
  @IsOptional()
  @IsString()
  @trim()
  @MaxLength(2000)
  internalNote?: string;
}

export class RejectCaseDto {
  @ApiProperty({ description: 'Message affiché à l’utilisateur' })
  @IsString()
  @trim()
  @IsNotEmpty()
  @MaxLength(2000)
  userMessage!: string;

  @ApiProperty({ example: 'DOCUMENT_UNREADABLE' })
  @IsString()
  @trim()
  @Matches(REASON_CODE_PATTERN, {
    message: 'reasonCode invalide (MAJUSCULES_UNDERSCORE)',
  })
  reasonCode!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @trim()
  @MaxLength(2000)
  internalNote?: string;
}

export class RequestChangesDto extends RejectCaseDto {
  @ApiPropertyOptional({
    type: [String],
    description:
      'Documents à corriger : identifiants de documents ou codes de type (ex. LIVE_SELFIE).',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  targets?: string[];
}

export class ApproveDocumentDto extends ApproveCaseDto {}

export class RejectDocumentDto {
  @ApiProperty()
  @IsString()
  @trim()
  @IsNotEmpty()
  @MaxLength(2000)
  userMessage!: string;

  @ApiProperty({ example: 'DOCUMENT_UNREADABLE' })
  @IsString()
  @trim()
  @Matches(REASON_CODE_PATTERN, {
    message: 'reasonCode invalide (MAJUSCULES_UNDERSCORE)',
  })
  reasonCode!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @trim()
  @MaxLength(2000)
  internalNote?: string;
}

export class RequestDocumentChangesDto extends RejectDocumentDto {}

class PaginationDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class AdminVerificationsQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: VerificationCaseKind })
  @IsOptional()
  @IsEnum(VerificationCaseKind)
  kind?: VerificationCaseKind;

  @ApiPropertyOptional({ enum: VerificationCaseStatus })
  @IsOptional()
  @IsEnum(VerificationCaseStatus)
  status?: VerificationCaseStatus;

  @ApiPropertyOptional({ description: 'Nom, email ou téléphone' })
  @IsOptional()
  @trimToUndefined()
  @IsString()
  @MaxLength(120)
  search?: string;
}

export class AdminDocumentsQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: UserDocumentStatus })
  @IsOptional()
  @IsEnum(UserDocumentStatus)
  status?: UserDocumentStatus;

  @ApiPropertyOptional({ example: 'LIVE_SELFIE' })
  @IsOptional()
  @trimToUndefined()
  @IsString()
  @MaxLength(80)
  documentTypeCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  userId?: string;
}

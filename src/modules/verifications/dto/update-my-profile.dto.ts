import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

const trim = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );

export const MAX_USER_LANGUAGES = 10;

export class LanguageInputDto {
  @IsString()
  @trim()
  @Matches(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/, {
    message: 'Code de langue invalide (ex. fr, en, fon)',
  })
  code!: string;

  @IsString()
  @trim()
  @MinLength(1)
  @MaxLength(80)
  label!: string;
}

export class UpdateMyProfileDto {
  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @trim()
  @MinLength(3)
  @MaxLength(255)
  addressLine?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @trim()
  @MinLength(2)
  @MaxLength(120)
  city?: string;

  @ApiPropertyOptional({ example: 'BJ' })
  @IsOptional()
  @IsString()
  @trim()
  @Matches(/^[A-Za-z]{2}$/, {
    message: 'countryCode doit être un code ISO à 2 lettres',
  })
  countryCode?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @trim()
  @MaxLength(120)
  administrativeArea?: string;

  @ApiPropertyOptional({
    type: [LanguageInputDto],
    description: 'Remplace intégralement la liste des langues.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_USER_LANGUAGES)
  @ValidateNested({ each: true })
  @Type(() => LanguageInputDto)
  languages?: LanguageInputDto[];
}

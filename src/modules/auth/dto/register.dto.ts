import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Equals,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { SUPPORTED_COUNTRY_CODES } from '../../../common/constants/supported-countries';

export class RegisterDto {
  @ApiProperty({ example: 'Aïcha' })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  firstName!: string;

  @ApiProperty({ example: 'Koffi' })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  lastName!: string;

  @ApiProperty({ example: 'BJ', enum: SUPPORTED_COUNTRY_CODES })
  @IsString()
  @IsIn([...SUPPORTED_COUNTRY_CODES], {
    message: 'Pays non supporté. Choisissez Bénin, Côte d’Ivoire ou Togo.',
  })
  countryCode!: string;

  @ApiProperty({ example: '+22990123456' })
  @IsString()
  @MinLength(6)
  @MaxLength(20)
  phone!: string;

  @ApiPropertyOptional({ example: 'aicha@example.com' })
  @IsOptional()
  @ValidateIf((_, v) => v !== undefined && v !== null && String(v).trim() !== '')
  @IsEmail({}, { message: 'Email invalide' })
  @MaxLength(320)
  email?: string | null;

  @ApiProperty({ example: 'MotDePasseSecurise1' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  /** Optionnel WEBAPP-01 : demandé plus tard en complétion profil. */
  @ApiPropertyOptional({ example: '2005-06-15' })
  @IsOptional()
  @ValidateIf((_, v) => v !== undefined && v !== null && String(v).trim() !== '')
  @IsDateString({}, { message: 'Date de naissance invalide' })
  dateOfBirth?: string | null;

  @ApiProperty({ example: true })
  @IsBoolean()
  @Equals(true, {
    message: 'Vous devez accepter les Conditions Générales d’Utilisation',
  })
  acceptTerms!: boolean;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { SUPPORTED_COUNTRY_CODES } from '../../../common/constants/supported-countries';

/**
 * Connexion User (téléphone) ou Admin (email).
 * Au moins un des deux identifiants doit être fourni (validé dans AuthService).
 */
export class LoginDto {
  @ApiPropertyOptional({ example: '+22990123456' })
  @ValidateIf((o: LoginDto) => !o.email)
  @IsString({ message: 'Indiquez votre numéro de téléphone ou votre email.' })
  @MinLength(6)
  @MaxLength(20)
  phone?: string;

  /** Région pour normaliser un numéro national (login User). */
  @ApiPropertyOptional({ example: 'BJ', enum: SUPPORTED_COUNTRY_CODES })
  @IsOptional()
  @IsString()
  @IsIn([...SUPPORTED_COUNTRY_CODES], {
    message: 'Pays non supporté.',
  })
  countryCode?: string;

  @ApiPropertyOptional({ example: 'admin@kingjobs.co' })
  @ValidateIf((o: LoginDto) => !o.phone)
  @IsEmail({}, { message: 'Email invalide' })
  email?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}

import { ApiProperty } from '@nestjs/swagger';
import {
  Equals,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'Ada' })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  firstName!: string;

  @ApiProperty({ example: 'Lovelace' })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  lastName!: string;

  @ApiProperty({ example: 'ada@example.com' })
  @IsEmail({}, { message: 'Email invalide' })
  @MaxLength(320)
  email!: string;

  @ApiProperty({ example: '+22990123456' })
  @IsString()
  @MinLength(6)
  @MaxLength(20)
  phone!: string;

  @ApiProperty({ example: 'MotDePasseSecurise1' })
  @IsString()
  @MinLength(10)
  @MaxLength(128)
  password!: string;

  @ApiProperty({ example: '2005-06-15' })
  @IsDateString({}, { message: 'Date de naissance invalide' })
  dateOfBirth!: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  @Equals(true, {
    message: 'Vous devez accepter les conditions d’utilisation',
  })
  acceptTerms!: boolean;
}

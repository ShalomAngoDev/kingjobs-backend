import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

export class ResendEmailVerificationDto {
  @ApiProperty({ example: 'ada@example.com' })
  @IsEmail({}, { message: 'Email invalide' })
  email!: string;
}

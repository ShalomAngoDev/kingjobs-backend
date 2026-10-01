import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SendPhoneCodeDto {
  @ApiPropertyOptional({
    description: 'Numéro à vérifier (défaut: téléphone du compte)',
  })
  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(20)
  phone?: string;
}

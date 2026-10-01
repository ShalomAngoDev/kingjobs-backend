import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class CloseAccountDto {
  @ApiProperty({ description: 'Mot de passe actuel (confirmation)' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}

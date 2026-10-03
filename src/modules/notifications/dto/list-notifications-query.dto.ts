import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export class ListNotificationsQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    enum: ['client', 'jobber'],
    description:
      'Filtre les notifications par espace (Client vs Jobber). Sans valeur : toutes.',
  })
  @IsOptional()
  @IsIn(['client', 'jobber'])
  space?: 'client' | 'jobber';
}

export class UnreadNotificationsQueryDto {
  @ApiPropertyOptional({
    enum: ['client', 'jobber'],
    description: 'Compte les non lues d’un espace uniquement.',
  })
  @IsOptional()
  @IsIn(['client', 'jobber'])
  space?: 'client' | 'jobber';
}

export class MarkAllReadQueryDto {
  @ApiPropertyOptional({
    enum: ['client', 'jobber'],
    description: 'Marque comme lues uniquement les notifs de l’espace.',
  })
  @IsOptional()
  @IsIn(['client', 'jobber'])
  space?: 'client' | 'jobber';
}

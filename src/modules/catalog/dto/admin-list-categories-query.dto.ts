import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

const TrimToUndefined = () =>
  Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  });

export class AdminListCategoriesQueryDto {
  @ApiPropertyOptional({
    description: 'Filtre sur le nom ou le slug (insensible à la casse)',
  })
  @IsOptional()
  @TrimToUndefined()
  @IsString()
  @MaxLength(120)
  search?: string;
}

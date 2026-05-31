import { IsOptional, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class PaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number;

  get skip(): number {
    const p = this.page ?? 1;
    const l = this.limit ?? 10;
    return (p - 1) * l;
  }
}

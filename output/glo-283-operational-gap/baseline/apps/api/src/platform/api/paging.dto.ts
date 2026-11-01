import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** Bounded offset paging for operational read APIs (GLO-239). */
export class PageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  take?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;
}

export interface Page { take: number; skip: number }
export const page = (query: { take?: number; skip?: number }, defaultTake = 20): Page =>
  ({ take: Math.min(query.take ?? defaultTake, 100), skip: query.skip ?? 0 });

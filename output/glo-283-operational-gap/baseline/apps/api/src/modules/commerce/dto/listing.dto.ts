import {
  IsUUID,
  IsBoolean,
  IsOptional,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateListingDto {
  @IsUUID()
  skuId: string;

  @IsBoolean()
  @IsOptional()
  isListed?: boolean;
}

export class UpdateListingStatusDto {
  @IsBoolean()
  isListed: boolean;
}

export class QueryListingDto {
  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
  isListed?: boolean;

  @IsInt()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  page?: number;

  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  @Type(() => Number)
  limit?: number;
}

import {
  IsUUID,
  IsNumber,
  IsPositive,
  IsString,
  IsOptional,
  IsBoolean,
  Length,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateSellingPriceDto {
  @IsUUID()
  skuId: string;

  @IsNumber()
  @IsPositive()
  amount: number;

  @IsString()
  @Length(3, 3)
  @IsOptional()
  currency?: string;

  @IsNumber()
  @IsPositive()
  @IsOptional()
  compareAtAmount?: number;

  @IsOptional()
  @Type(() => Date)
  validFrom?: Date;

  @IsOptional()
  @Type(() => Date)
  validUntil?: Date | null;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsBoolean()
  @IsOptional()
  autoClosePrevious?: boolean;
}

export class UpdateSellingPriceDto {
  @IsNumber()
  @IsPositive()
  @IsOptional()
  amount?: number;

  @IsString()
  @Length(3, 3)
  @IsOptional()
  currency?: string;

  @IsNumber()
  @IsPositive()
  @IsOptional()
  compareAtAmount?: number | null;

  @IsOptional()
  @Type(() => Date)
  validFrom?: Date;

  @IsOptional()
  @Type(() => Date)
  validUntil?: Date | null;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

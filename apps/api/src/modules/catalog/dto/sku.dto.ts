import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsPositive,
  IsInt,
  Min,
  IsBoolean,
  MinLength,
} from 'class-validator';

export class CreateSkuDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  code: string;

  @IsString()
  @IsNotEmpty()
  variantName: string;

  @IsNumber()
  @IsPositive()
  @IsOptional()
  size?: number;

  @IsString()
  @IsOptional()
  sizeUnit?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  packCount?: number;

  @IsString()
  @IsOptional()
  barcode?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  estimatedDaysOfUse?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpdateSkuDto {
  @IsString()
  @IsOptional()
  @MinLength(2)
  code?: string;

  @IsString()
  @IsOptional()
  variantName?: string;

  @IsNumber()
  @IsPositive()
  @IsOptional()
  size?: number | null;

  @IsString()
  @IsOptional()
  sizeUnit?: string | null;

  @IsInt()
  @Min(1)
  @IsOptional()
  packCount?: number | null;

  @IsString()
  @IsOptional()
  barcode?: string | null;

  @IsInt()
  @Min(1)
  @IsOptional()
  estimatedDaysOfUse?: number | null;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

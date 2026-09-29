import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsPositive,
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

  @IsString()
  @IsOptional()
  barcode?: string;

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

  @IsString()
  @IsOptional()
  barcode?: string | null;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

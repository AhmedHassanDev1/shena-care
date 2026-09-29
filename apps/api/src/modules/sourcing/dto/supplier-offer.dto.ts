import { IsString, IsNotEmpty, IsNumber, IsBoolean, IsOptional, Min } from 'class-validator';

export class CreateSupplierOfferDto {
  @IsString()
  @IsNotEmpty()
  supplierId: string;

  @IsString()
  @IsNotEmpty()
  skuId: string;

  @IsNumber()
  @Min(0)
  costPrice: number;

  @IsString()
  @IsNotEmpty()
  currency: string;

  @IsBoolean()
  @IsOptional()
  isAvailable?: boolean;
}

export class UpdateSupplierOfferDto {
  @IsNumber()
  @Min(0)
  @IsOptional()
  costPrice?: number;

  @IsString()
  @IsOptional()
  currency?: string;

  @IsBoolean()
  @IsOptional()
  isAvailable?: boolean;
}

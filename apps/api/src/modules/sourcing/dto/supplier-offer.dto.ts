import { IsString, IsNotEmpty, IsNumber, IsBoolean, IsOptional, IsInt, Min } from 'class-validator';

export class CreateSupplierOfferDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  minimumOrderUnits?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  orderMultipleUnits?: number;
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

  /** Quantity the supplier can supply now; allocation never exceeds it. */
  @IsInt()
  @Min(0)
  @IsOptional()
  availableQuantity?: number;
}

export class UpdateSupplierOfferDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  minimumOrderUnits?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  orderMultipleUnits?: number;
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

  /** Quantity the supplier can supply now; allocation never exceeds it. */
  @IsInt()
  @Min(0)
  @IsOptional()
  availableQuantity?: number;
}

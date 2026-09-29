import { IsString, IsNotEmpty, IsNumber, IsOptional, ValidateNested, IsArray, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { IngestionStatus } from '@prisma/client';

export class IngestionItemInput {
  @IsString()
  @IsNotEmpty()
  supplierSkuCode: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  brand: string;

  @IsOptional()
  @IsString()
  barcode?: string;

  @IsNumber()
  price: number;

  @IsString()
  @IsNotEmpty()
  currency: string;
}

export class CreateIngestionJobDto {
  @IsString()
  @IsNotEmpty()
  supplierId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IngestionItemInput)
  items: IngestionItemInput[];
}

export class ApproveIngestionItemDto {
  @IsString()
  @IsNotEmpty()
  matchedSkuId: string;
}

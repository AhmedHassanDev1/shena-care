import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

/** What staff paid for one Buy List purchase: the quoted list price and the discount obtained per unit. The final unit cost is derived, never typed twice. */
export class PurchaseCostDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100000)
  listUnitPrice: number;

  /** EGP off the list price per unit (0 when there was none). */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000)
  discountPerUnit?: number;
}

export class RecordPurchaseCostDto extends PurchaseCostDto {
  /** The idempotency key of the Buy List count this cost belongs to. */
  @IsUUID()
  acquireKey: string;
}

export class CorrectPurchaseCostDto extends RecordPurchaseCostDto {
  @IsInt()
  @Min(1)
  expectedVersion: number;

  @IsString()
  @MinLength(5)
  @MaxLength(300)
  reason: string;
}


export class AcquireBuyListDto {
  @IsUUID()
  skuId: string;

  /** Units actually obtained in this count; never more than what is still outstanding. */
  @IsInt()
  @Min(1)
  @Max(10000)
  quantity: number;

  /** One physical count: a retry with the same key never counts twice. */
  @IsUUID()
  idempotencyKey: string;

  /** Optional here, recordable later; a purchase without a recorded cost keeps profitability INCOMPLETE. */
  @IsOptional()
  @ValidateNested()
  @Type(() => PurchaseCostDto)
  cost?: PurchaseCostDto;
}

export class BuyListScopeDto {
  @IsUUID()
  skuId: string;

  /** Optional: only these orders (default every open line of the SKU). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  orderIds?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

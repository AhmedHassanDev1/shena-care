import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

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

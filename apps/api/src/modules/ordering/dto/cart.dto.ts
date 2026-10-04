import { IsString, IsInt, Min, Max, IsOptional, IsUUID, IsIn } from 'class-validator';

export const CART_SOURCE_TYPES = ['PDP', 'ROUTINE', 'REORDER'] as const;
export type CartSourceType = (typeof CART_SOURCE_TYPES)[number];

export class AddToCartDto {
  @IsUUID()
  skuId: string;

  @IsInt()
  @Min(1)
  @Max(20)
  quantity: number;

  /** Optimistic concurrency: reject with 409 if the cart revision moved on. */
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedRevision?: number;

  /** Provenance only; never couples cart lifecycle to the source. */
  @IsOptional()
  @IsString()
  @IsIn(CART_SOURCE_TYPES as unknown as string[])
  sourceType?: CartSourceType;
}

export class RemoveFromCartDto {
  @IsUUID()
  skuId: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  expectedRevision?: number;
}

export class UpdateCartItemQuantityDto {
  @IsUUID()
  skuId: string;

  @IsInt()
  @Min(1)
  @Max(20)
  quantity: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  expectedRevision?: number;
}

export class ClearCartDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedRevision?: number;
}

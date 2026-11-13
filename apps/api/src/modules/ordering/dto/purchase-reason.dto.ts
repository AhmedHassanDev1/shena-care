import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { GuestOrderLookupParamsDto, OrderLookupParamsDto } from './order-tracking.dto';

/** Short purpose labels the customer can pick; the storefront shows the Arabic wording. */
export const PURCHASE_REASON_CODES = [
  'DRY_SKIN', 'OILY_SKIN', 'ACNE_PRONE', 'SENSITIVE_SKIN', 'SUN_PROTECTION', 'HYDRATION', 'ANTI_AGING', 'DARK_SPOTS',
  'HAIR_FALL', 'DRY_HAIR', 'HAIR_GROWTH', 'DAILY_ROUTINE', 'GIFT', 'TRYING_NEW', 'OTHER',
] as const;
/** Where the customer was when they said it: metadata only, never proof of intent. */
export const PURCHASE_REASON_SOURCES = ['PDP', 'SEARCH', 'CHATBOT', 'ROUTINE', 'ORDER_PAGE'] as const;

export class SetPurchaseReasonDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(5) @IsIn(PURCHASE_REASON_CODES, { each: true })
  reasons: string[];

  @IsOptional() @IsString() @MaxLength(200)
  note?: string;

  @IsOptional() @IsIn(PURCHASE_REASON_SOURCES)
  source?: string;
}

/** One params DTO per route: the global whitelist pipe rejects any path key the DTO does not declare. */
export class OrderItemReasonParamsDto extends OrderLookupParamsDto {
  @IsUUID()
  orderItemId: string;
}

export class GuestOrderItemReasonParamsDto extends GuestOrderLookupParamsDto {
  @IsUUID()
  orderItemId: string;
}

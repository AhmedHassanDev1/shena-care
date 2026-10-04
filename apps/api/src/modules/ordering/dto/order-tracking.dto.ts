import { IsString, Matches, MaxLength } from 'class-validator';

export const CUSTOMER_STAGES = [
  'RECEIVED', 'CONFIRMING_PRODUCTS', 'CONFIRMED', 'PREPARING',
  'OUT_FOR_DELIVERY', 'DELIVERED', 'ACTION_REQUIRED',
  'CANCELLATION_REQUESTED', 'CANCELLED', 'DELIVERY_ISSUE',
] as const;
export type CustomerStage = typeof CUSTOMER_STAGES[number];
export type CustomerItemStatus = 'checking' | 'confirmed' | 'action-required' | 'resolved';

/** An order number or UUID is a lookup key, never authorization proof. */
export class OrderLookupParamsDto {
  @IsString()
  @MaxLength(100)
  @Matches(/^(?:[0-9a-fA-F-]{36}|ORD-[A-Z0-9-]+)$/)
  idOrOrderNumber: string;
}

export class GuestOrderLookupParamsDto {
  @IsString()
  @MaxLength(100)
  @Matches(/^ORD-[A-Z0-9-]+$/)
  orderNumber: string;
}

/** Send this secret in x-order-access-token; keep it out of URLs and logs. */
export class GuestOrderAccessHeaderDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  token: string;
}

export class CustomerTimelineEventDto {
  status: CustomerStage;
  occurredAt: Date;
}

export class CustomerOrderItemDto {
  id: string;
  skuId: string;
  productName: string | null;
  skuCode: string | null;
  variantName: string | null;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  lineTotal: number;
  currency: string;
  status: CustomerItemStatus;
}

export class CustomerResolutionDto {
  category: 'cancellation' | 'return' | 'refund' | 'replacement' | 'compensation';
  status: 'requested' | 'in_progress' | 'resolved' | 'rejected';
  affectedItemIds: string[];
  allowedActions: string[];
}

export class CustomerOrderTrackingDto {
  orderNumber: string;
  createdAt: Date;
  status: CustomerStage;
  orderReceived: boolean;
  availabilityConfirmed: boolean;
  customerName: string;
  deliveryAddress: {
    governorate: string | null;
    area: string | null;
    address: string;
    latitude: number | null;
    longitude: number | null;
    locationSource: string | null;
  };
  amounts: {
    originalCodAmount: number;
    currentCodAmount: number;
    subtotal: number;
    shippingFee: number;
    currency: string;
  };
  items: CustomerOrderItemDto[];
  timeline: CustomerTimelineEventDto[];
  delivery: {
    certainty: 'unknown' | 'estimated' | 'confirmed';
    estimatedDate: Date | null;
    deliveredAt: Date | null;
    source: string | null;
    nextUpdateBy: Date | null;
    promise: string | null;
  };
  actionRequired: { category: string; affectedItemIds: string[]; allowedActions: string[];
    issues: Array<{ orderItemId: string; category: string; unresolvedQuantity: number; occurredAt: Date }> } | null;
  resolutions: CustomerResolutionDto[];
}

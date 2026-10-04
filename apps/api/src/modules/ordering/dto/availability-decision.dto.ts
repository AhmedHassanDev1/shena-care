import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

export const AVAILABILITY_ACTIONS = ['REPLACE_WITH', 'CONTINUE_WITHOUT_ITEM', 'CANCEL_ORDER'] as const;
export type AvailabilityActionName = typeof AVAILABILITY_ACTIONS[number];
export const DECISION_CHANNELS = ['web', 'messaging_link'] as const;

export class AvailabilityDecisionParamsDto {
  @IsUUID()
  decisionId: string;
}

export class GuestAvailabilityDecisionParamsDto {
  @IsString()
  @MaxLength(100)
  @Matches(/^ORD-[A-Z0-9-]+$/)
  orderNumber: string;

  @IsUUID()
  decisionId: string;
}

export class SubmitAvailabilityDecisionDto {
  @IsIn(AVAILABILITY_ACTIONS as unknown as string[])
  action: AvailabilityActionName;

  /** Required for REPLACE_WITH; must be one of the candidates the server proposed. */
  @IsOptional()
  @IsUUID()
  candidateSkuId?: string;

  /** Version of the decision the customer saw; a mismatch is never applied silently. */
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  version: number;

  @IsString()
  @Matches(/^[A-Za-z0-9._:-]{16,100}$/)
  idempotencyKey: string;

  @IsOptional()
  @IsIn(DECISION_CHANNELS as unknown as string[])
  channel?: typeof DECISION_CHANNELS[number];
}

export interface AvailabilityCandidateDto {
  skuId: string;
  skuCode: string;
  variantName: string;
  size: number | null;
  sizeUnit: string | null;
  unitPrice: number;
  lineTotal: number;
  currency: string;
  preview: { codBefore: number; codAfter: number; priceDelta: number };
}

export interface AvailabilityDecisionDto {
  id: string;
  orderItemId: string;
  version: number;
  status: 'pending' | 'resolved' | 'review_required' | 'superseded';
  reason: 'unavailable';
  unresolvedQuantity: number;
  original: {
    productName: string | null; skuCode: string | null; variantName: string | null;
    quantity: number; unitPrice: number; lineTotal: number; currency: string;
  };
  availableActions: AvailabilityActionName[];
  candidates: AvailabilityCandidateDto[];
  previews: {
    continueWithoutItem: { codBefore: number; codAfter: number } | null;
    cancelOrder: { codBefore: number; codAfter: number };
  };
  expiresAt: Date | null;
  decision: { action: AvailabilityActionName; skuId: string | null; channel: string | null; decidedAt: Date | null } | null;
  receipt: AvailabilityReceiptDto | null;
}

export interface AvailabilityReceiptDto {
  decisionId: string;
  action: AvailabilityActionName;
  orderNumber: string;
  removedItem: { orderItemId: string; productName: string | null; variantName: string | null; quantity: number; unitPrice: number; lineTotal: number } | null;
  replacement: { orderItemId: string; skuId: string; productName: string | null; variantName: string; quantity: number; unitPrice: number; lineTotal: number; priceDelta: number } | null;
  amounts: { codBefore: number; codAfter: number; delta: number; currency: string };
  nextOrderState: 'CANCELLED' | 'CONFIRMING_PRODUCTS';
  decidedAt: string;
}

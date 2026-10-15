import { apiClient, type RequestOptions } from './api-client';
import { auth } from './auth';

export interface CheckoutData {
  customerName: string;
  customerPhone: string;
  shippingAddress: string;
  governorate: string;
  area: string;
  /** Landmark / delivery notes (optional). */
  notes?: string;
  latitude: number;
  longitude: number;
  locationSource: 'map_pin' | 'current_location';
  locationConfirmed: true;
  couponCode?: string;
  paymentMethod?: 'COD';
  idempotencyKey: string;
  quoteVersion: string;
  cartRevision: number;
}

/** The accepted order as `POST /ordering/checkout` returns it (apps/api ordering.service.ts `OrderDetail`). */
export interface PlacedOrder {
  id: string;
  orderNumber: string;
  status: string;
  totalAmount: number;
  currency: string;
  orderReceived: true;
  availabilityConfirmed: false;
  createdAt: string;
  /** Guest orders only: opaque per-order access token for tracking (never put it in a URL). */
  guestAccessToken?: string;
  guestAccessExpiresAt?: string;
}

const ORDER_ACCESS_PREFIX = 'orderAccess:';

/** Keeps a guest order's access token on this device so tracking works without signing in. */
export function rememberOrderAccess(orderNumber: string, token: string) {
  if (typeof window !== 'undefined') localStorage.setItem(ORDER_ACCESS_PREFIX + orderNumber, token);
}

export function recallOrderAccess(orderNumber: string): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return localStorage.getItem(ORDER_ACCESS_PREFIX + orderNumber) ?? undefined;
}

/**
 * Checkout quote exactly as `POST /ordering/checkout/quote` returns it
 * (apps/api ordering.service.ts: `{ quoteVersion, expiresAt, revision, ...QuoteSnapshot, invalidItems }`).
 * Amounts are numbers in `currency`; `quoteVersion` must be echoed back on checkout.
 */
export interface CheckoutQuote {
  quoteVersion: string;
  expiresAt: string;
  revision: number;
  governorate: string;
  area: string;
  cartRevision: number;
  subtotal: number;
  shippingFee: number;
  codAmount: number;
  totalAmount: number;
  currency: string;
  deliveryPromise: string;
  availabilityCertainty: string;
  items: Array<{
    skuId: string;
    productName: string;
    variantName: string | null;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    currency: string;
  }>;
  /** Lines the backend cannot sell right now. */
  invalidItems: unknown[];
}

export interface Order {
  id: string;
  orderNumber: string;
  status: string;
  customerName: string;
  customerPhone: string;
  shippingAddress: string;
  paymentMethod: string;
  totalAmount: number;
  currency: string;
  items: Array<{
    skuId: string;
    quantity: number;
    unitPrice: number;
    subtotal: number;
    sku: {
      variantName: string;
      product: {
        name: string;
      };
    };
  }>;
  createdAt: string;
}

export const orders = {
  async getQuote(data: { governorate: string; area: string; couponCode?: string }): Promise<CheckoutQuote> {
    const token = auth.getToken();
    const guestToken = typeof window !== 'undefined' ? localStorage.getItem('guestCartToken') : undefined;
    const options: RequestOptions = {};
    if (token) options.token = token;
    else if (guestToken) options.headers = { 'x-cart-token': guestToken };
    
    return apiClient.post<CheckoutQuote>('/ordering/checkout/quote', data, options);
  },

  async checkout(data: CheckoutData): Promise<PlacedOrder> {
    const token = auth.getToken();
    const guestToken = typeof window !== 'undefined' ? localStorage.getItem('guestCartToken') : undefined;
    const options: RequestOptions = {};
    if (token) options.token = token;
    else if (guestToken) options.headers = { 'x-cart-token': guestToken };
    
    const response = await apiClient.post<PlacedOrder>('/ordering/checkout', data, options);
    if (response.guestAccessToken) rememberOrderAccess(response.orderNumber, response.guestAccessToken);
    if (typeof window !== 'undefined' && guestToken) {
      localStorage.removeItem('guestCartToken'); // Order placed, cart consumed
    }
    return response;
  },

  /** Customer-safe tracking (GLO-74): signed-in owner, or the guest token stored on this device. */
  async getTracking(orderNumber: string): Promise<OrderTracking> {
    return apiClient.get<OrderTracking>(...orderPath(orderNumber, '/tracking'));
  },

  async listDecisions(orderNumber: string): Promise<AvailabilityDecision[]> {
    return apiClient.get<AvailabilityDecision[]>(...orderPath(orderNumber, '/availability-decisions'));
  },

  /** Submits a customer availability decision (GLO-190); `version` is the one the customer saw. */
  async decide(orderNumber: string, decisionId: string, body: DecisionSubmission): Promise<AvailabilityDecision> {
    const token = auth.getToken();
    const payload = { ...body, channel: 'web' as const };
    if (token) return apiClient.post<AvailabilityDecision>(`/ordering/availability-decisions/${decisionId}/decision`, payload, { token });
    const access = recallOrderAccess(orderNumber);
    return apiClient.post<AvailabilityDecision>(
      `/ordering/guest/orders/${encodeURIComponent(orderNumber)}/availability-decisions/${decisionId}/decision`,
      payload,
      access ? { headers: { 'x-order-access-token': access } } : {},
    );
  },

  /** What the customer may report on one line right now (GLO-191); reasons come from the server. */
  async getItemEligibility(orderNumber: string, itemId: string): Promise<ItemEligibility> {
    return apiClient.get<ItemEligibility>(...orderPath(orderNumber, `/items/${encodeURIComponent(itemId)}/eligibility`));
  },

  /** Reports a problem with one line; the server re-checks eligibility and quantity (GLO-215/216). */
  async reportItemProblem(orderNumber: string, itemId: string, body: ItemProblemReport): Promise<{ id: string; status: string }> {
    const [path, options] = orderPath(orderNumber, `/items/${encodeURIComponent(itemId)}/returns`);
    return apiClient.post<{ id: string; status: string }>(path, body, options);
  },
};

export type ProblemReason =
  | 'WRONG_ITEM' | 'MISSING_ITEM' | 'DAMAGED_OR_LEAKING' | 'DEFECT_OR_QUALITY_CONCERN'
  | 'CHANGE_OF_MIND' | 'DELIVERY_PROBLEM' | 'POSSIBLE_ADVERSE_EVENT' | 'OTHER';

/** Exactly the API's ReturnEligibilityProjectionDto (apps/api ordering/dto/return.dto.ts). */
export interface ItemEligibility {
  orderItemId: string;
  isEligible: boolean;
  normalWindowEndsAt: string | null;
  defectWindowEndsAt: string | null;
  allowedReasons: ProblemReason[];
  policyReviewRequired: boolean;
  conditionReviewRequired: boolean;
}

export interface ItemProblemReport {
  reasonCode: ProblemReason;
  quantity: number;
  description?: string;
  batchOrLot?: string;
}


/** Owner route when signed in; otherwise the guest route with this device's order access token. */
function orderPath(orderNumber: string, suffix: string): [string, RequestOptions] {
  const token = auth.getToken();
  if (token) return [`/ordering/orders/${encodeURIComponent(orderNumber)}${suffix}`, { token }];
  const access = recallOrderAccess(orderNumber);
  return [
    `/ordering/guest/orders/${encodeURIComponent(orderNumber)}${suffix}`,
    access ? { headers: { 'x-order-access-token': access } } : {},
  ];
}

export type CustomerStage =
  | 'RECEIVED' | 'CONFIRMING_PRODUCTS' | 'CONFIRMED' | 'PREPARING' | 'OUT_FOR_DELIVERY' | 'DELIVERED'
  | 'ACTION_REQUIRED' | 'CANCELLATION_REQUESTED' | 'CANCELLED' | 'DELIVERY_ISSUE';

/** Exactly the API's CustomerOrderTrackingDto (apps/api ordering/dto/order-tracking.dto.ts). */
export interface OrderTracking {
  orderNumber: string;
  createdAt: string;
  status: CustomerStage;
  orderReceived: boolean;
  availabilityConfirmed: boolean;
  customerName: string;
  deliveryAddress: {
    governorate: string | null;
    area: string | null;
    address: string;
    latitude?: number | null;
    longitude?: number | null;
    locationSource?: string | null;
  };
  amounts: { originalCodAmount: number; currentCodAmount: number; subtotal: number; shippingFee: number; currency: string };
  items: Array<{
    id: string;
    skuId: string;
    productName: string | null;
    variantName: string | null;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    currency: string;
    status: 'checking' | 'confirmed' | 'action-required' | 'resolved';
    lineState?: 'active' | 'removed' | 'replaced';
  }>;
  timeline: Array<{ status: CustomerStage; occurredAt: string }>;
  delivery: {
    certainty: 'unknown' | 'estimated' | 'confirmed';
    estimatedDate: string | null;
    deliveredAt: string | null;
    nextUpdateBy: string | null;
    promise: string | null;
  };
  actionRequired: { category: string; affectedItemIds: string[]; allowedActions: string[] } | null;
  resolutions: Array<{
    category: string;
    status: 'requested' | 'in_progress' | 'resolved' | 'rejected';
    refund?: { amount: number; currency: string; status: string } | null;
  }>;
}

export type AvailabilityAction = 'REPLACE_WITH' | 'CONTINUE_WITHOUT_ITEM' | 'CANCEL_ORDER';

/** Exactly the API's AvailabilityDecisionDto: every money figure is server-computed. */
export interface AvailabilityDecision {
  id: string;
  orderItemId: string;
  version: number;
  status: 'pending' | 'resolved' | 'review_required' | 'superseded';
  unresolvedQuantity: number;
  original: { productName: string | null; variantName: string | null; quantity: number; unitPrice: number; lineTotal: number; currency: string };
  availableActions: AvailabilityAction[];
  candidates: Array<{
    skuId: string;
    variantName: string;
    size: number | null;
    sizeUnit: string | null;
    unitPrice: number;
    lineTotal: number;
    currency: string;
    preview: { codBefore: number; codAfter: number; priceDelta: number };
  }>;
  previews: { continueWithoutItem: { codBefore: number; codAfter: number } | null; cancelOrder: { codBefore: number; codAfter: number } };
  receipt: { amounts: { codBefore: number; codAfter: number; delta: number; currency: string } } | null;
}

export interface DecisionSubmission {
  action: AvailabilityAction;
  candidateSkuId?: string;
  version: number;
  idempotencyKey: string;
}

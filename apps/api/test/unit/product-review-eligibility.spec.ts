import { ValidationPipe } from '@nestjs/common';
import {
  OrderItemLineState,
  OrderResolutionStatus,
  OrderResolutionType,
  OrderStatus,
  RefundStatus,
  Role,
} from '@prisma/client';
import { CreateProductReviewDto } from '../../src/application/composition/dto/create-product-review.dto';
import {
  evaluatePurchaseEligibility,
  type OrderEligibilityCandidate,
} from '../../src/modules/ordering/services/purchase-verification.service';
import {
  isAuthorizedDevReviewer,
  isDevTestReviewEnvironment,
  isDevTestReviewFlagEnabled,
} from '../../src/platform/auth/dev-test-reviews';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_PRODUCT_ID = '22222222-2222-4222-8222-222222222222';
const SKU_ID = '33333333-3333-4333-8333-333333333333';

function makeOrder(
  overrides: Partial<OrderEligibilityCandidate> & { id?: string } = {},
): OrderEligibilityCandidate {
  return {
    id: overrides.id ?? 'order-1',
    status: overrides.status ?? OrderStatus.delivered,
    items: overrides.items ?? [
      {
        id: 'item-1',
        productId: PRODUCT_ID,
        skuId: SKU_ID,
        lineState: OrderItemLineState.active,
      },
    ],
    resolutions: overrides.resolutions ?? [],
    refundTransactions: overrides.refundTransactions ?? [],
  };
}

describe('evaluatePurchaseEligibility', () => {
  it('blocks customers with no orders for the product', () => {
    expect(evaluatePurchaseEligibility([], PRODUCT_ID, [SKU_ID])).toEqual({
      eligible: false,
      reason: 'NO_PURCHASE',
      orderId: null,
    });
  });

  it('blocks orders that have not yet been delivered', () => {
    for (const status of [
      OrderStatus.placed,
      OrderStatus.confirmed,
      OrderStatus.packing,
      OrderStatus.shipped,
    ]) {
      expect(evaluatePurchaseEligibility([makeOrder({ status })], PRODUCT_ID, [SKU_ID])).toEqual({
        eligible: false,
        reason: 'NOT_YET_DELIVERED',
        orderId: null,
      });
    }
  });

  it('blocks cancelled and returned orders', () => {
    for (const status of [OrderStatus.cancelled, OrderStatus.returned]) {
      expect(evaluatePurchaseEligibility([makeOrder({ status })], PRODUCT_ID, [SKU_ID])).toEqual({
        eligible: false,
        reason: 'CANCELLED_OR_REFUNDED',
        orderId: null,
      });
    }
  });

  it('blocks delivered orders where item line is removed or replaced', () => {
    const order = makeOrder({
      items: [{ id: 'item-1', productId: PRODUCT_ID, skuId: SKU_ID, lineState: OrderItemLineState.removed }],
    });
    expect(evaluatePurchaseEligibility([order], PRODUCT_ID, [SKU_ID])).toEqual({
      eligible: false,
      reason: 'CANCELLED_OR_REFUNDED',
      orderId: null,
    });
  });

  it('blocks delivered orders covered by an active refund or return resolution', () => {
    const order = makeOrder({
      resolutions: [
        {
          id: 'res-1',
          type: OrderResolutionType.refund,
          status: OrderResolutionStatus.approved,
          items: [{ orderItemId: 'item-1' }],
          refundTransaction: { status: RefundStatus.succeeded },
        },
      ],
    });
    expect(evaluatePurchaseEligibility([order], PRODUCT_ID, [SKU_ID])).toEqual({
      eligible: false,
      reason: 'CANCELLED_OR_REFUNDED',
      orderId: null,
    });
  });

  it('blocks delivered orders with an unlinked non-failed refund transaction', () => {
    const order = makeOrder({
      refundTransactions: [{ resolutionId: null, status: RefundStatus.succeeded }],
    });
    expect(evaluatePurchaseEligibility([order], PRODUCT_ID, [SKU_ID])).toEqual({
      eligible: false,
      reason: 'CANCELLED_OR_REFUNDED',
      orderId: null,
    });
  });

  it('allows delivered orders when an unrelated sibling item was refunded', () => {
    const order = makeOrder({
      items: [
        { id: 'item-1', productId: PRODUCT_ID, skuId: SKU_ID, lineState: OrderItemLineState.active },
        { id: 'item-2', productId: OTHER_PRODUCT_ID, skuId: null, lineState: OrderItemLineState.active },
      ],
      resolutions: [
        {
          id: 'res-sibling',
          type: OrderResolutionType.return,
          status: OrderResolutionStatus.resolved,
          items: [{ orderItemId: 'item-2' }],
          refundTransaction: { status: RefundStatus.succeeded },
        },
      ],
    });
    expect(evaluatePurchaseEligibility([order], PRODUCT_ID, [SKU_ID])).toEqual({
      eligible: true,
      reason: 'DELIVERED_ELIGIBLE',
      orderId: 'order-1',
    });
  });

  it('allows a second delivered order even if an earlier order was cancelled', () => {
    const cancelled = makeOrder({ id: 'order-cancelled', status: OrderStatus.cancelled });
    const delivered = makeOrder({ id: 'order-delivered', status: OrderStatus.delivered });
    expect(evaluatePurchaseEligibility([cancelled, delivered], PRODUCT_ID, [SKU_ID])).toEqual({
      eligible: true,
      reason: 'DELIVERED_ELIGIBLE',
      orderId: 'order-delivered',
    });
  });
});

describe('dev-test-reviews isolated environment & flag guard', () => {
  const adminUser = {
    id: 'dev-admin-1',
    email: 'dev@shinacare.local',
    roles: [Role.ADMIN],
    isActive: true,
  };
  const regularCustomer = {
    id: 'cust-1',
    email: 'buyer@shinacare.local',
    phoneNumber: '+201000000001',
    roles: [Role.CUSTOMER],
    isActive: true,
  };

  it('is disabled by default even in development/test', () => {
    expect(isDevTestReviewFlagEnabled({ NODE_ENV: 'development' })).toBe(false);
    expect(isDevTestReviewFlagEnabled({ NODE_ENV: 'test' })).toBe(false);
    expect(isAuthorizedDevReviewer(adminUser, { NODE_ENV: 'development' })).toBe(false);
  });

  it('rejects bypass in production even when ENABLE_DEV_TEST_REVIEWS=true', () => {
    const prodEnv = { NODE_ENV: 'production', ENABLE_DEV_TEST_REVIEWS: 'true' };
    expect(isDevTestReviewEnvironment(prodEnv)).toBe(false);
    expect(isDevTestReviewFlagEnabled(prodEnv)).toBe(false);
    expect(isAuthorizedDevReviewer(adminUser, prodEnv)).toBe(false);
  });

  it('fails closed if NODE_ENV is missing or secondary deployment env signals production/staging', () => {
    expect(isDevTestReviewFlagEnabled({ ENABLE_DEV_TEST_REVIEWS: 'true' })).toBe(false);
    expect(
      isDevTestReviewFlagEnabled({
        NODE_ENV: 'development',
        APP_ENV: 'production',
        ENABLE_DEV_TEST_REVIEWS: 'true',
      }),
    ).toBe(false);
    expect(
      isDevTestReviewFlagEnabled({
        NODE_ENV: 'development',
        VERCEL_ENV: 'production',
        ENABLE_DEV_TEST_REVIEWS: 'true',
      }),
    ).toBe(false);
    expect(
      isDevTestReviewFlagEnabled({
        NODE_ENV: 'test',
        RAILWAY_ENVIRONMENT: 'staging',
        ENABLE_DEV_TEST_REVIEWS: 'true',
      }),
    ).toBe(false);
  });

  it('never consults TEST_BYPASS_AUTH', () => {
    const bypassEnv = { NODE_ENV: 'test', TEST_BYPASS_AUTH: 'true' };
    expect(isDevTestReviewFlagEnabled(bypassEnv)).toBe(false);
    expect(isAuthorizedDevReviewer(adminUser, bypassEnv)).toBe(false);
  });

  it('allows only active authorized developers when explicitly enabled in dev/test', () => {
    const devEnv = { NODE_ENV: 'development', ENABLE_DEV_TEST_REVIEWS: 'true' };
    expect(isAuthorizedDevReviewer(adminUser, devEnv)).toBe(true);
    expect(isAuthorizedDevReviewer({ ...adminUser, isActive: false }, devEnv)).toBe(false);
    expect(isAuthorizedDevReviewer(regularCustomer, devEnv)).toBe(false);
    expect(
      isAuthorizedDevReviewer(regularCustomer, {
        ...devEnv,
        DEV_TEST_REVIEW_EMAILS: 'buyer@shinacare.local',
      }),
    ).toBe(true);
  });
});

describe('CreateProductReviewDto validation', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const meta = { type: 'body' as const, metatype: CreateProductReviewDto };

  it('accepts a required rating with omitted or blank optional body', async () => {
    const valid = await pipe.transform({ rating: 5 }, meta);
    expect(valid.rating).toBe(5);

    const blankBody = await pipe.transform({ rating: 4, body: '   ' }, meta);
    expect(blankBody.body).toBeNull();
  });

  it('rejects out-of-range ratings and client spoofing fields', async () => {
    await expect(pipe.transform({ rating: 0 }, meta)).rejects.toThrow();
    await expect(pipe.transform({ rating: 6 }, meta)).rejects.toThrow();
    await expect(pipe.transform({ rating: 5, isVerifiedPurchase: true }, meta)).rejects.toThrow();
    await expect(pipe.transform({ rating: 5, isTest: false }, meta)).rejects.toThrow();
  });
});

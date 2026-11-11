import { Injectable } from '@nestjs/common';
import {
  OrderItemLineState,
  OrderResolutionStatus,
  OrderResolutionType,
  OrderStatus,
  RefundStatus,
} from '@prisma/client';
import { PrismaService } from '../../../platform/database/prisma.service';

export type PurchaseEligibilityReason =
  | 'DELIVERED_ELIGIBLE'
  | 'NO_PURCHASE'
  | 'NOT_YET_DELIVERED'
  | 'CANCELLED_OR_REFUNDED';

export interface PurchaseEligibilityResult {
  eligible: boolean;
  reason: PurchaseEligibilityReason;
  orderId: string | null;
}

export interface OrderEligibilityCandidate {
  id: string;
  status: OrderStatus;
  items: Array<{
    id: string;
    productId: string | null;
    skuId: string | null;
    lineState: OrderItemLineState;
  }>;
  resolutions: Array<{
    id: string;
    type: OrderResolutionType;
    status: OrderResolutionStatus;
    items: Array<{ orderItemId: string }>;
    refundTransaction: { status: RefundStatus } | null;
  }>;
  refundTransactions: Array<{
    resolutionId: string | null;
    status: RefundStatus;
  }>;
}

const DISQUALIFYING_RESOLUTION_TYPES = new Set<OrderResolutionType>([
  OrderResolutionType.cancellation,
  OrderResolutionType.return,
  OrderResolutionType.refund,
]);

const IN_PROGRESS_ORDER_STATUSES = new Set<OrderStatus>([
  OrderStatus.placed,
  OrderStatus.confirmed,
  OrderStatus.packing,
  OrderStatus.shipped,
]);

/**
 * Pure evaluator for verified-purchase review eligibility across a customer's matching orders.
 * Enforces: delivered order, active matching item line, not cancelled/returned/refunded.
 */
export function evaluatePurchaseEligibility(
  orders: readonly OrderEligibilityCandidate[],
  productId: string,
  productSkuIds: readonly string[] = [],
): PurchaseEligibilityResult {
  if (orders.length === 0) {
    return { eligible: false, reason: 'NO_PURCHASE', orderId: null };
  }

  const skuSet = new Set(productSkuIds);
  const matchesProduct = (item: OrderEligibilityCandidate['items'][number]) =>
    item.productId === productId || (item.skuId !== null && skuSet.has(item.skuId));

  let hasInProgress = false;
  let hasCancelledOrRefunded = false;

  for (const order of orders) {
    const activeMatchingItems = order.items.filter(
      (item) => item.lineState === OrderItemLineState.active && matchesProduct(item),
    );
    const anyMatchingItems = order.items.filter(matchesProduct);

    if (anyMatchingItems.length === 0) {
      continue;
    }

    if (order.status === OrderStatus.cancelled || order.status === OrderStatus.returned) {
      hasCancelledOrRefunded = true;
      continue;
    }

    if (IN_PROGRESS_ORDER_STATUSES.has(order.status)) {
      if (activeMatchingItems.length > 0) {
        hasInProgress = true;
      } else {
        hasCancelledOrRefunded = true;
      }
      continue;
    }

    if (order.status !== OrderStatus.delivered) {
      continue;
    }

    if (activeMatchingItems.length === 0) {
      hasCancelledOrRefunded = true;
      continue;
    }

    // Whole-order non-failed refund transaction without a specific resolution disqualifies all items on the order.
    const hasUnlinkedNonFailedRefund = order.refundTransactions.some(
      (tx) => tx.resolutionId === null && tx.status !== RefundStatus.failed,
    );
    if (hasUnlinkedNonFailedRefund) {
      hasCancelledOrRefunded = true;
      continue;
    }

    const eligibleItem = activeMatchingItems.find((item) => !isItemDisqualifiedByResolution(order, item.id));
    if (eligibleItem) {
      return {
        eligible: true,
        reason: 'DELIVERED_ELIGIBLE',
        orderId: order.id,
      };
    }

    hasCancelledOrRefunded = true;
  }

  if (hasInProgress) {
    return { eligible: false, reason: 'NOT_YET_DELIVERED', orderId: null };
  }
  if (hasCancelledOrRefunded) {
    return { eligible: false, reason: 'CANCELLED_OR_REFUNDED', orderId: null };
  }
  return { eligible: false, reason: 'NO_PURCHASE', orderId: null };
}

function isItemDisqualifiedByResolution(order: OrderEligibilityCandidate, orderItemId: string): boolean {
  const activeRefundResolutionIds = new Set(
    order.refundTransactions
      .filter((tx) => tx.status !== RefundStatus.failed && tx.resolutionId !== null)
      .map((tx) => tx.resolutionId as string),
  );

  for (const res of order.resolutions) {
    const targetsOrderOrItem = res.items.length === 0 || res.items.some((ri) => ri.orderItemId === orderItemId);
    if (!targetsOrderOrItem) continue;

    if (DISQUALIFYING_RESOLUTION_TYPES.has(res.type) && res.status !== OrderResolutionStatus.rejected) {
      return true;
    }

    const hasNonFailedRefund =
      (res.refundTransaction !== null && res.refundTransaction.status !== RefundStatus.failed) ||
      activeRefundResolutionIds.has(res.id);
    if (hasNonFailedRefund && res.status !== OrderResolutionStatus.rejected) {
      return true;
    }
  }

  return false;
}

@Injectable()
export class PurchaseVerificationService {
  constructor(private readonly prisma: PrismaService) {}

  async checkProductPurchaseEligibility(
    customerId: string,
    productId: string,
    productSkuIds: readonly string[] = [],
  ): Promise<PurchaseEligibilityResult> {
    const skuList = [...new Set(productSkuIds.filter(Boolean))];
    const itemMatchFilter =
      skuList.length > 0
        ? { OR: [{ productId }, { skuId: { in: skuList } }] }
        : { productId };

    const orders = await this.prisma.order.findMany({
      where: {
        customerId,
        items: { some: itemMatchFilter },
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 25,
      select: {
        id: true,
        status: true,
        items: {
          select: {
            id: true,
            productId: true,
            skuId: true,
            lineState: true,
          },
        },
        resolutions: {
          select: {
            id: true,
            type: true,
            status: true,
            items: { select: { orderItemId: true } },
            refundTransaction: { select: { status: true } },
          },
        },
        refundTransactions: {
          select: {
            resolutionId: true,
            status: true,
          },
        },
      },
    });

    return evaluatePurchaseEligibility(orders, productId, skuList);
  }
}

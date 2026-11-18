import { ConflictException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import { AcquisitionCostService, PurchaseCostService } from '../../../modules/sourcing/public';
import { FulfillmentService, PackingGate } from '../../../modules/fulfillment/public';
import { SupportService } from '../../../modules/operations/services/support.service';
import { evaluateOrderProfit, orderPurchaseCost } from './order-profitability';

const cents = (value: Prisma.Decimal | number | null | undefined) => Math.round(Number(value ?? 0) * 100);
const egp = (valueInCents: number) => (valueInCents / 100).toFixed(2);

/**
 * Per-order internal profitability from the records the platform already keeps (actual purchase cost, actual packaging, actual courier cost).
 * It only reads and flags: a loss-making order opens one deduplicated exception for an authorized human to review, it never changes the
 * customer's confirmed price, never blocks the parcel and never touches future catalog pricing.
 */
@Injectable()
export class OrderProfitabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly purchaseCosts: PurchaseCostService,
    private readonly poCosts: AcquisitionCostService,
    private readonly support: SupportService,
  ) {}

  async evaluate(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, orderNumber: true, status: true, shippingFee: true,
        items: { where: { lineState: 'active' }, select: { id: true, quantity: true, price: true, discountAmount: true, lineTotal: true } } },
    });
    if (!order) throw new NotFoundException('Order not found');
    const [buyCosts, poCosts, record] = await Promise.all([
      this.purchaseCosts.costForOrderItems(order.items.map(item => item.id)),
      this.poCosts.contributionForOrders([order.id]),
      this.prisma.orderCostRecord.findUnique({ where: { orderId } }),
    ]);
    const goods = order.items.reduce((sum, item) => sum.plus(item.lineTotal ?? item.price.mul(item.quantity).minus(item.discountAmount ?? 0)), new Prisma.Decimal(0));
    const cogs = orderPurchaseCost(order.items, buyCosts, poCosts.get(order.id));
    const profit = evaluateOrderProfit({
      goodsNet: cents(goods), customerDeliveryFee: cents(order.shippingFee), cogs: cogs === null ? null : cents(cogs),
      packaging: record?.packagingCost ? cents(record.packagingCost) : null, courier: record?.courierCost ? cents(record.courierCost) : null,
    });
    return {
      orderId: order.id, orderNumber: order.orderNumber, currency: 'EGP', state: profit.state, complete: profit.complete, missing: profit.missing,
      goodsNet: egp(cents(goods)), customerDeliveryFee: egp(cents(order.shippingFee)), marginSoFar: egp(profit.marginSoFar),
      costs: {
        purchase: profit.costs.purchase === null ? null : egp(profit.costs.purchase), packaging: profit.costs.packaging === null ? null : egp(profit.costs.packaging),
        companyFundedDelivery: profit.costs.companyFundedDelivery === null ? null : egp(profit.costs.companyFundedDelivery),
      },
    };
  }

  /** Opens (once per order) the review case when the order is already a loss. Idempotent; returns the case id or null. */
  async flagIfLoss(orderId: string): Promise<string | null> {
    const result = await this.evaluate(orderId);
    if (result.state !== 'LOSS') return null;
    const supportCase = await this.prisma.$transaction(tx => this.support.openOperationalException(tx, {
      dedupKey: `order-loss:${orderId}`, category: 'sourcing', priority: 'high', orderId,
      title: `Loss-making order — ${result.orderNumber}`,
      description: [
        `Goods sold net of discounts ${result.goodsNet} EGP; costs recorded so far exceed it by ${egp(-Math.round(Number(result.marginSoFar) * 100))} EGP.`,
        `Purchase ${result.costs.purchase ?? 'not recorded'}, packaging ${result.costs.packaging ?? 'not recorded'}, company-funded delivery ${result.costs.companyFundedDelivery ?? 'not recorded'} EGP.`,
        'The customer\'s confirmed price is unchanged. An authorized reviewer decides: accept the loss, query the supplier cost, or adjust future catalog pricing separately.',
      ].join(' '),
    }));
    return supportCase.id;
  }
}

/**
 * The composition side of "ready for handoff": the parcel can only be packed once the packaging actually used is recorded for the order, and
 * a packed order is checked for a loss. Registered with the Fulfillment module so it never reads the cost records itself.
 */
@Injectable()
export class PackingReadinessService implements PackingGate, OnModuleInit {
  private readonly logger = new Logger(PackingReadinessService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fulfillment: FulfillmentService,
    private readonly profitability: OrderProfitabilityService,
  ) {}

  onModuleInit() { this.fulfillment.registerPackingGate(this); }

  async assertPackable(orderId: string) {
    const record = await this.prisma.orderCostRecord.findUnique({ where: { orderId }, select: { packagingType: true, packagingCost: true } });
    if (!record?.packagingType || !record.packagingCost) {
      throw new ConflictException({ code: 'PACKAGING_NOT_RECORDED', message: 'Choose the packaging actually used (and record its cost) before marking the order packed' });
    }
  }

  async afterCostChanged(orderId: string) {
    // Only once the packaging cost is known is the loss figure a real one; before that the handoff re-checks it anyway.
    const record = await this.prisma.orderCostRecord.findUnique({ where: { orderId }, select: { packagingCost: true } });
    if (!record?.packagingCost) return;
    await this.profitability.flagIfLoss(orderId).catch(error => this.logger.warn(`Profit check of ${orderId} failed: ${(error as Error).message}`));
  }

  async afterPacked(orderId: string) {
    await this.profitability.flagIfLoss(orderId).catch(error => this.logger.warn(`Profit check of ${orderId} failed: ${(error as Error).message}`));
  }
}

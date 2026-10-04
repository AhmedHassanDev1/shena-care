import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHash, createHmac, randomUUID } from 'crypto';
import { OrderStatus, Prisma } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../../platform/database/prisma.service';
import { CommerceService, PromotionService } from '../../commerce/public';
import { OrderPlacedEvent } from '../../../platform/events/integration.events';
import { CheckoutDto, CheckoutQuoteRequestDto } from '../dto/order.dto';
import { OutboxService } from '../../operations/services/outbox.service';
import { CartOwner, CartService } from './cart.service';

export interface QuotedItem {
  skuId: string;
  productId: string;
  productName: string;
  skuCode: string;
  variantName: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  lineTotal: number;
  currency: string;
}

export interface QuoteSnapshot {
  governorate: string;
  area: string;
  cartRevision: number;
  subtotal: number;
  shippingFee: number;
  codAmount: number;
  totalAmount: number;
  currency: string;
  deliveryPromise: string;
  availabilityCertainty: 'not_confirmed';
  items: QuotedItem[];
  appliedPromotions: any[];
}

const REVIEW_REQUIRED = { code: 'CHECKOUT_REVIEW_REQUIRED', message: 'Checkout changed or expired. Review a new quote before submitting.' };
const DELIVERY_PROMISE = 'Delivery timing will be confirmed after sourcing.';
const SHIPPING_FEE = 50;
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
    : item,
);

export interface OrderDetail {
  id: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  shippingAddress: string;
  totalAmount: number;
  currency: string;
  status: OrderStatus;
  orderReceived: true;
  availabilityConfirmed: false;
  createdAt: Date;
  updatedAt: Date;
  items: Array<{ id: string; skuId: string; quantity: number; price: number; currency: string }>;
  guestAccessToken?: string;
  guestAccessExpiresAt?: Date;
}

@Injectable()
export class OrderingService {
  private readonly logger = new Logger(OrderingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cartService: CartService,
    private readonly commerceService: CommerceService,
    private readonly promotionService: PromotionService,
    private readonly eventEmitter: EventEmitter2,
    private readonly outbox: OutboxService,
  ) {}

  private reviewRequired(): never {
    throw new ConflictException(REVIEW_REQUIRED);
  }

  private generateOrderNumber(): string {
    return 'ORD-' + randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase();
  }

  private async currentSnapshot(owner: CartOwner, dto: CheckoutQuoteRequestDto): Promise<{ cartId: string; snapshot: QuoteSnapshot }> {
    const cart = await this.cartService.getCart(owner);
    if (!cart.id || !cart.items.length) throw new BadRequestException('Cart is empty.');
    if (cart.items.some(i => !i.canOrder || i.price === null)) this.reviewRequired();

    const items = await Promise.all(cart.items.map(async (item): Promise<QuotedItem> => {
      const [sku, terms] = await Promise.all([
        this.prisma.sku.findUnique({ where: { id: item.skuId }, include: { product: true } }),
        this.commerceService.getSellingTerms(item.skuId),
      ]);
      if (!sku || !terms?.canOrder || !terms.price || terms.price.amount !== item.price) this.reviewRequired();
      const currency = terms.price.currency;
      const unitPrice = terms.price.amount;
      const discountAmount = Math.round(Math.max((terms.price.compareAtAmount ?? unitPrice) - unitPrice, 0) * item.quantity * 100) / 100;
      return {
        skuId: item.skuId, productId: sku.productId, productName: sku.product.name,
        skuCode: sku.code, variantName: sku.variantName, quantity: item.quantity,
        unitPrice, discountAmount, lineTotal: Math.round(unitPrice * item.quantity * 100) / 100,
        currency,
      };
    }));
    const currency = items[0].currency;
    if (items.some(i => i.currency !== currency)) this.reviewRequired();
    const subtotal = Math.round(items.reduce((sum, item) => sum + item.lineTotal, 0) * 100) / 100;

    const activePromotions = await this.promotionService.getActivePromotions(dto.couponCode ? [dto.couponCode] : []);
    const evaluation = this.promotionService.evaluatePromotions(activePromotions, {
      subtotal,
      items: items.map(i => ({ skuId: i.skuId, price: i.unitPrice, quantity: i.quantity })),
      customerContext: { governorate: dto.governorate, area: dto.area }
    });

    const finalSubtotal = Math.max(0, subtotal - evaluation.orderDiscountAmount);
    const shippingFee = evaluation.freeShippingQualified ? 0 : SHIPPING_FEE;
    const totalAmount = Math.round((finalSubtotal + shippingFee) * 100) / 100;
    
    return {
      cartId: cart.id,
      snapshot: {
        governorate: dto.governorate, area: dto.area, cartRevision: cart.revision,
        subtotal, shippingFee, codAmount: totalAmount, totalAmount,
        currency, deliveryPromise: DELIVERY_PROMISE, availabilityCertainty: 'not_confirmed', items,
        appliedPromotions: evaluation.appliedPromotions,
      },
    };
  }

  async getCheckoutQuote(owner: CartOwner, dto: CheckoutQuoteRequestDto) {
    const { cartId, snapshot } = await this.currentSnapshot(owner, dto);
    const expiresAt = new Date(Date.now() + 15 * 60_000);
    const quote = await this.prisma.$transaction(async tx => {
      const cart = await tx.cart.findUnique({ where: { id: cartId } });
      if (!cart || cart.revision !== snapshot.cartRevision) this.reviewRequired();
      return tx.checkoutQuote.create({
        data: { cartId, revision: snapshot.cartRevision, snapshot: snapshot as unknown as Prisma.InputJsonValue, expiresAt },
      });
    });
    return { quoteVersion: quote.id, expiresAt, revision: snapshot.cartRevision, ...snapshot, invalidItems: [] };
  }

  private submissionHash(cartId: string, dto: CheckoutDto): string {
    const { idempotencyKey: _key, ...body } = dto;
    return createHash('sha256').update(JSON.stringify({ cartId, ...body })).digest('hex');
  }

  private async assertAcceptedCommerce(tx: Prisma.TransactionClient, accepted: QuoteSnapshot): Promise<void> {
    const now = new Date();
    for (const item of accepted.items) {
      const [sku, listing, price] = await Promise.all([
        tx.sku.findUnique({ where: { id: item.skuId }, include: { product: true } }),
        tx.listing.findUnique({ where: { skuId: item.skuId } }),
        tx.sellingPrice.findFirst({
          where: { skuId: item.skuId, isActive: true, validFrom: { lte: now },
            OR: [{ validUntil: { gte: now } }, { validUntil: null }] },
          orderBy: { validFrom: 'desc' },
        }),
      ]);
      const discountAmount = price
        ? Math.round(Math.max((price.compareAtAmount?.toNumber() ?? price.amount.toNumber()) - price.amount.toNumber(), 0) * item.quantity * 100) / 100
        : null;
      if (!sku?.isActive || !sku.product.isPublished || !listing?.isListed || !price ||
          sku.productId !== item.productId || sku.product.name !== item.productName ||
          sku.code !== item.skuCode || sku.variantName !== item.variantName ||
          price.amount.toNumber() !== item.unitPrice || price.currency !== item.currency ||
          discountAmount !== item.discountAmount) this.reviewRequired();
    }
  }

  private present(order: any): OrderDetail {
    const {
      checkoutQuote: _quote, guestAccessTokenHash: _tokenHash,
      guestAccessExpiresAt: _tokenExpiry, guestAccessRevokedAt: _tokenRevoked,
      ...publicOrder
    } = order;
    return {
      ...publicOrder,
      totalAmount: Number(order.totalAmount),
      subtotal: order.subtotal === null ? null : Number(order.subtotal),
      shippingFee: Number(order.shippingFee),
      codAmount: order.codAmount === null ? null : Number(order.codAmount),
      orderReceived: true,
      availabilityConfirmed: false,
      items: order.items.map((item: any) => ({
        ...item, price: Number(item.price),
        discountAmount: item.discountAmount === null ? null : Number(item.discountAmount),
        lineTotal: item.lineTotal === null ? null : Number(item.lineTotal),
      })),
    };
  }

  private guestTokenForOrder(guestToken: string, orderId: string): string {
    return createHmac('sha256', guestToken).update('order-access:' + orderId).digest('base64url');
  }

  private async presentSubmission(order: any, owner: CartOwner): Promise<OrderDetail> {
    const detail = this.present(order);
    if ('guestToken' in owner) {
      const token = this.guestTokenForOrder(owner.guestToken, order.id);
      if (!order.guestAccessTokenHash) {
        const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60_000);
        await this.prisma.order.updateMany({
          where: { id: order.id, guestAccessTokenHash: null },
          data: { guestAccessTokenHash: createHash('sha256').update(token).digest('hex'), guestAccessExpiresAt: expiresAt },
        });
        const updated = await this.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
        order.guestAccessExpiresAt = updated.guestAccessExpiresAt;
        order.guestAccessTokenHash = updated.guestAccessTokenHash;
      }
      if (order.guestAccessTokenHash !== createHash('sha256').update(token).digest('hex') ||
          order.guestAccessRevokedAt || order.guestAccessExpiresAt <= new Date()) {
        throw new UnauthorizedException('Order access has expired or been revoked');
      }
      detail.guestAccessToken = token;
      detail.guestAccessExpiresAt = order.guestAccessExpiresAt;
    }
    return detail;
  }

  async checkout(owner: CartOwner, dto: CheckoutDto): Promise<OrderDetail> {
    const cart = await this.cartService.getCart(owner);
    if (!cart.id) this.reviewRequired();
    const hash = this.submissionHash(cart.id, dto);
    const prior = await this.prisma.order.findUnique({ where: { idempotencyKey: dto.idempotencyKey }, include: { items: true, checkoutQuote: true } });
    if (prior) {
      if (prior.submissionHash !== hash || prior.checkoutQuote?.cartId !== cart.id) {
        throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REUSED', message: 'Idempotency key was used for another submission.' });
      }
      return this.presentSubmission(prior, owner);
    }

    try {
    const quote = await this.prisma.checkoutQuote.findUnique({ where: { id: dto.quoteVersion } });
    if (!quote || quote.cartId !== cart.id || quote.consumedAt || quote.expiresAt <= new Date() ||
        quote.revision !== dto.cartRevision || cart.revision !== dto.cartRevision) this.reviewRequired();
    const accepted = quote.snapshot as unknown as QuoteSnapshot;
    if (accepted.governorate !== dto.governorate || accepted.area !== dto.area) this.reviewRequired();
    const current = await this.currentSnapshot(owner, { governorate: dto.governorate, area: dto.area, couponCode: dto.couponCode });
    if (current.cartId !== cart.id || canonical(current.snapshot) !== canonical(accepted)) this.reviewRequired();

      const order = await this.prisma.$transaction(async tx => {
        const claimed = await tx.cart.updateMany({
          where: { id: cart.id!, revision: dto.cartRevision },
          data: { revision: { increment: 1 } },
        });
        if (claimed.count !== 1) this.reviewRequired();
        const freshQuote = await tx.checkoutQuote.findUnique({ where: { id: quote.id } });
        if (!freshQuote || freshQuote.consumedAt || freshQuote.expiresAt <= new Date()) this.reviewRequired();
        await this.assertAcceptedCommerce(tx, accepted);
        const orderId = randomUUID();
        const guestAccessToken = 'guestToken' in owner ? this.guestTokenForOrder(owner.guestToken, orderId) : null;
        const created = await tx.order.create({
          data: {
            id: orderId,
            orderNumber: this.generateOrderNumber(), idempotencyKey: dto.idempotencyKey,
            submissionHash: hash, customerId: 'customerId' in owner ? owner.customerId : null,
            guestAccessTokenHash: guestAccessToken ? createHash('sha256').update(guestAccessToken).digest('hex') : null,
            guestAccessExpiresAt: guestAccessToken ? new Date(Date.now() + 90 * 24 * 60 * 60_000) : null,
            customerName: dto.customerName, customerPhone: dto.customerPhone,
            shippingAddress: dto.shippingAddress, governorate: dto.governorate, area: dto.area,
            latitude: dto.latitude, longitude: dto.longitude, locationSource: dto.locationSource,
            notes: dto.notes, subtotal: accepted.subtotal, shippingFee: accepted.shippingFee,
            codAmount: accepted.codAmount, totalAmount: accepted.totalAmount, currency: accepted.currency,
            deliveryPromise: accepted.deliveryPromise, availabilityCertainty: accepted.availabilityCertainty,
            appliedPromotions: accepted.appliedPromotions as Prisma.InputJsonValue,
            status: OrderStatus.placed,
            statusEvents: { create: { status: OrderStatus.placed } },
            items: { create: accepted.items.map(item => ({
              skuId: item.skuId, productId: item.productId, productName: item.productName,
              skuCode: item.skuCode, variantName: item.variantName, quantity: item.quantity,
              price: item.unitPrice, discountAmount: item.discountAmount, lineTotal: item.lineTotal,
              currency: item.currency,
            })) },
          },
          include: { items: true },
        });
        await tx.checkoutQuote.update({ where: { id: quote.id }, data: { consumedAt: new Date(), orderId: created.id } });
        await tx.cartItem.deleteMany({ where: { cartId: cart.id! } });

        await this.outbox.enqueue(tx, {
          eventType: 'order.placed',
          aggregateId: created.id,
          aggregateType: 'Order',
          customerId: created.customerId || undefined,
          payload: {
            orderId: created.id,
            orderNumber: created.orderNumber,
            customerId: created.customerId,
            items: created.items.map(i => ({ skuId: i.skuId, quantity: i.quantity })),
            shippingAddress: created.shippingAddress,
          },
          channelIntent: 'whatsapp',
          templateId: 'order_received_v1',
          deduplicationKey: `order.placed:${created.id}`,
        });

        return created;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      this.logger.log('[AUDIT] Order Submitted: ' + order.orderNumber);
      this.eventEmitter.emit('order.placed', new OrderPlacedEvent(
        order.id, order.orderNumber, order.customerId || '',
        order.items.map(i => ({ skuId: i.skuId, quantity: i.quantity })), order.shippingAddress,
      ));
      return this.presentSubmission(order, owner);
    } catch (error) {
      const committed = await this.prisma.order.findUnique({ where: { idempotencyKey: dto.idempotencyKey }, include: { items: true, checkoutQuote: true } });
      if (committed && committed.submissionHash === hash && committed.checkoutQuote?.cartId === cart.id) return this.presentSubmission(committed, owner);
      throw error;
    }
  }

  async getOrder(idOrOrderNumber: string, customerId?: string): Promise<OrderDetail | null> {
    const order = await this.prisma.order.findFirst({
      where: { OR: [{ id: idOrOrderNumber }, { orderNumber: idOrOrderNumber }], ...(customerId ? { customerId } : {}) },
      include: { items: { where: { lineState: 'active' } } },
    });
    return order ? this.present(order) : null;
  }

  async updateOrderStatus(id: string, status: OrderStatus): Promise<OrderDetail> {
    const { updated, oldStatus } = await this.prisma.$transaction(async tx => {
      const order = await tx.order.findUnique({ where: { id } });
      if (!order) throw new NotFoundException('Order ' + id + ' not found.');
      const changed = await tx.order.update({ where: { id }, data: { status }, include: { items: true } });
      if (order.status !== status) await tx.orderStatusEvent.create({ data: { orderId: id, status } });
      return { updated: changed, oldStatus: order.status };
    });
    this.logger.log('[AUDIT] Order Status Changed: ' + JSON.stringify({ orderId: id, oldStatus, newStatus: status }));
    return this.present(updated);
  }
}

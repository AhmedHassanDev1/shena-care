import { CUSTOMER_PHONE_VERIFIED_EVENT, CustomerPhoneVerifiedEvent } from '../../accounts/public';
import { OnEvent } from '@nestjs/event-emitter';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHash, createHmac, randomUUID } from 'crypto';
import { OrderStatus, PaymentMethod, Prisma } from '@prisma/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import { CommerceService, PromotionService } from '../../commerce/public';
import { DomainEventsService } from '../../../platform/events/domain-events.service';
import { PaymentsService } from './payments.service';
import { AddDeliveryInstructionDto, CheckoutDto, CheckoutQuoteRequestDto, CorrectDeliveryLocationDto } from '../dto/order.dto';
import { assertDeliverablePin, navigationUrl, serviceGovernorate } from './service-area';
import { OutboxService } from '../../operations/services/outbox.service';
import { CartOwner, CartService } from './cart.service';
import { computeDeliveryFee } from './delivery-fee';
import { SourcingService, cairoDate, cairoWallTime, promisedDate } from '../../sourcing/public';

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
  /** Fee by distance before the invoice-size discount, and what ShinaCare absorbs (for the customer's breakdown). */
  deliveryFeeBase: number;
  deliveryDiscount: number;
  codAmount: number;
  totalAmount: number;
  currency: string;
  deliveryPromise: string;
  /** YYYY-MM-DD (Cairo): first day after the order on which the suppliers of every item are open. */
  promisedDate: string;
  availabilityCertainty: 'not_confirmed';
  items: QuotedItem[];
  appliedPromotions: any[];
}

const REVIEW_REQUIRED = { code: 'CHECKOUT_REVIEW_REQUIRED', message: 'Checkout changed or expired. Review a new quote before submitting.' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
    : item,
);

export interface OrderDetail {
  id: string;
  orderNumber: string;
  customerId: string | null;
  customerName: string;
  customerPhone: string;
  shippingAddress: string;
  governorate?: string | null;
  area?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  locationSource?: string | null;
  locationConfirmedAt?: Date | null;
  notes?: string | null;
  subtotal?: number | null;
  shippingFee?: number;
  totalAmount: number;
  codAmount?: number | null;
  currency: string;
  status: OrderStatus;
  orderReceived: true;
  availabilityConfirmed: false;
  createdAt: Date;
  updatedAt: Date;
  /** Active lines with the name/price snapshot taken at order time (and amendments). */
  items: Array<{
    id: string; skuId: string; quantity: number; price: number; currency: string;
    productName?: string | null; variantName?: string | null; skuCode?: string | null;
    discountAmount?: number | null; lineTotal?: number | null;
  }>;
  guestAccessToken?: string;
  guestAccessExpiresAt?: Date;
  paymentMethod?: PaymentMethod;
  payment?: { method: PaymentMethod; provider: string; reference: string; status: string; amount: number; currency: string } | null;
}

@Injectable()
export class OrderingService {
  private readonly logger = new Logger(OrderingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cartService: CartService,
    private readonly commerceService: CommerceService,
    private readonly promotionService: PromotionService,
    private readonly outbox: OutboxService,
    private readonly events: DomainEventsService,
    private readonly payments: PaymentsService,
    private readonly sourcing: SourcingService,
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
    const promised = promisedDate(new Date(), await this.sourcing.getClosedWeekdaysBySku(items.map(i => i.skuId)));
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
    // Owner policy: distance band from the hub, minus the invoice-size discount, free above the threshold; a free-shipping promotion wins.
    const delivery = computeDeliveryFee({ invoice: finalSubtotal, latitude: dto.latitude, longitude: dto.longitude });
    const shippingFee = evaluation.freeShippingQualified ? 0 : delivery.fee;
    const deliveryFeeBase = delivery.baseFee;
    const deliveryDiscount = Math.round((deliveryFeeBase - shippingFee) * 100) / 100;
    const totalAmount = Math.round((finalSubtotal + shippingFee) * 100) / 100;
    
    return {
      cartId: cart.id,
      snapshot: {
        governorate: dto.governorate, area: dto.area, cartRevision: cart.revision,
        subtotal, shippingFee, deliveryFeeBase, deliveryDiscount, codAmount: totalAmount, totalAmount,
        currency, deliveryPromise: `Delivery expected on ${promised}.`, promisedDate: promised, availabilityCertainty: 'not_confirmed', items,
        appliedPromotions: evaluation.appliedPromotions,
      },
    };
  }

  async getCheckoutQuote(owner: CartOwner, dto: CheckoutQuoteRequestDto) {
    serviceGovernorate(dto.governorate);
    if (dto.latitude !== undefined || dto.longitude !== undefined) assertDeliverablePin(dto);
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
    if (order.paymentMethod && order.paymentMethod !== 'COD') {
      const attempt = await this.prisma.paymentAttempt.findFirst({ where: { orderId: order.id }, orderBy: { createdAt: 'desc' } });
      detail.payment = attempt ? { method: attempt.method, provider: attempt.provider, reference: attempt.reference, status: attempt.status,
        amount: Number(attempt.amount), currency: attempt.currency } : null;
    }
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

    // Serviceability and a customer-confirmed pin are owner rules, enforced here (GLO-231).
    serviceGovernorate(dto.governorate);
    assertDeliverablePin(dto);
    const paymentMethod = (dto.paymentMethod ?? 'COD') as PaymentMethod;
    const paymentProvider = this.payments.resolveProvider(paymentMethod, dto.paymentProvider);
    const online = PaymentsService.isOnline(paymentMethod);

    try {
    const quote = await this.prisma.checkoutQuote.findUnique({ where: { id: dto.quoteVersion } });
    if (!quote || quote.cartId !== cart.id || quote.consumedAt || quote.expiresAt <= new Date() ||
        quote.revision !== dto.cartRevision || cart.revision !== dto.cartRevision) this.reviewRequired();
    const accepted = quote.snapshot as unknown as QuoteSnapshot;
    if (accepted.governorate !== dto.governorate || accepted.area !== dto.area) this.reviewRequired();
    const current = await this.currentSnapshot(owner, { governorate: dto.governorate, area: dto.area, couponCode: dto.couponCode, latitude: dto.latitude, longitude: dto.longitude });
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
            locationConfirmedAt: new Date(), locationConfirmedBy: 'customer',
            notes: dto.notes, subtotal: accepted.subtotal, shippingFee: accepted.shippingFee,
            // Only cash on delivery creates money the driver collects (GLO-241).
            codAmount: online ? 0 : accepted.codAmount, totalAmount: accepted.totalAmount, currency: accepted.currency,
            paymentMethod, paymentProvider,
            deliveryPromise: accepted.deliveryPromise, promisedDate: new Date(accepted.promisedDate + 'T00:00:00Z'), availabilityCertainty: accepted.availabilityCertainty,
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
        if (online) {
          // Paid online: sourcing starts only after a verified provider confirmation (PaymentsService).
          await this.payments.createAttempt(tx, { orderId: created.id, method: paymentMethod, provider: paymentProvider!,
            amount: accepted.totalAmount, currency: accepted.currency });
        } else {
          // Durable handoff to Sourcing in the same transaction as the order (GLO-236).
          await this.events.record(tx, {
            eventType: 'order.placed', aggregateType: 'Order', aggregateId: created.id,
            payload: { orderId: created.id, orderNumber: created.orderNumber },
          });
        }

        return created;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      this.logger.log('[AUDIT] Order Submitted: ' + order.orderNumber);
      this.events.dispatchSoon(order.id);
      return this.presentSubmission(order, owner);
    } catch (error) {
      const committed = await this.prisma.order.findUnique({ where: { idempotencyKey: dto.idempotencyKey }, include: { items: true, checkoutQuote: true } });
      if (committed && committed.submissionHash === hash && committed.checkoutQuote?.cartId === cart.id) return this.presentSubmission(committed, owner);
      throw error;
    }
  }

  async getOrder(idOrOrderNumber: string, customerId?: string): Promise<OrderDetail | null> {
    const order = await this.prisma.order.findFirst({
      // An order number is not a UUID; comparing it to the uuid `id` column makes PostgreSQL throw.
      where: { OR: [...(UUID.test(idOrOrderNumber) ? [{ id: idOrOrderNumber }] : []), { orderNumber: idOrOrderNumber }], ...(customerId ? { customerId } : {}) },
      include: { items: { where: { lineState: 'active' } } },
    });
    return order ? this.present(order) : null;
  }

  /**
   * Operator delivery instruction / corrected meeting point (RT08): appended, audited, and shown to
   * the assigned driver next to — never instead of — the customer's confirmed pin and address.
   */
  async addDeliveryInstruction(id: string, dto: AddDeliveryInstructionDto, actorId: string) {
    if ((dto.latitude === undefined) !== (dto.longitude === undefined)) {
      throw new BadRequestException('Give both latitude and longitude, or neither');
    }
    if (dto.latitude !== undefined) assertDeliverablePin(dto);
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('Order not found');
    if (['delivered', 'cancelled', 'returned'].includes(order.status)) {
      throw new ConflictException(`Delivery instructions cannot change in status ${order.status}`);
    }
    return this.prisma.deliveryInstruction.create({ data: {
      orderId: id, note: dto.note, reason: dto.reason, latitude: dto.latitude ?? null, longitude: dto.longitude ?? null, actorId,
    } });
  }

  async getLatestDeliveryInstructions(orderIds: string[]) {
    const rows = orderIds.length ? await this.prisma.deliveryInstruction.findMany({
      where: { orderId: { in: orderIds } }, orderBy: { createdAt: 'desc' },
    }) : [];
    const latest = new Map<string, { note: string; reason: string; at: Date; location: { latitude: number; longitude: number; navigationUrl: string } | null }>();
    for (const row of rows) {
      if (latest.has(row.orderId)) continue;
      latest.set(row.orderId, { note: row.note, reason: row.reason, at: row.createdAt,
        location: row.latitude !== null && row.longitude !== null
          ? { latitude: row.latitude, longitude: row.longitude, navigationUrl: navigationUrl(row.latitude, row.longitude) } : null });
    }
    return latest;
  }

  /** Order numbers and status only — no customer PII — for operational lists (GLO-239). */
  /** Admin order list (C0 W2): newest first, filter by status or order number / customer name / phone. */
  async listOrdersForStaff(filter: { status?: OrderStatus; q?: string; take: number; skip: number }) {
    const q = filter.q?.trim();
    const where: Prisma.OrderWhereInput = {
      ...(filter.status ? { status: filter.status } : {}),
      ...(q ? { OR: [
        { orderNumber: { contains: q, mode: 'insensitive' } },
        { customerName: { contains: q, mode: 'insensitive' } },
        { customerPhone: { contains: q } },
      ] } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where, orderBy: { createdAt: 'desc' }, take: filter.take, skip: filter.skip,
        include: { items: { where: { lineState: 'active' }, select: { quantity: true } } },
      }),
    ]);
    return { total, items: rows.map(order => ({
      id: order.id, orderNumber: order.orderNumber, status: order.status, customerName: order.customerName,
      governorate: order.governorate, area: order.area, paymentMethod: order.paymentMethod,
      totalAmount: Number(order.totalAmount), codAmount: order.codAmount === null ? null : Number(order.codAmount),
      currency: order.currency, itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
      hasPin: order.latitude !== null && order.longitude !== null, createdAt: order.createdAt,
    })) };
  }

  /**
   * Orders that have not left the hub although their promised day has arrived (after 12:00 Cairo time) or passed —
   * the owner sends the delegate or tells the customer. No customer details here.
   */
  async listLateOrders(paging: { take: number; skip: number }, now = new Date()) {
    const today = cairoDate(now);
    const day = new Date(today + 'T00:00:00Z');
    const afterNoon = now >= cairoWallTime(today, 12 * 60);
    const where: Prisma.OrderWhereInput = {
      status: { in: ['placed', 'confirmed', 'packing'] },
      OR: [{ promisedDate: { lt: day } }, ...(afterNoon ? [{ promisedDate: day }] : [])],
    };
    const [total, rows] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({ where, orderBy: [{ promisedDate: 'asc' }, { createdAt: 'asc' }], take: paging.take, skip: paging.skip }),
    ]);
    return { total, items: rows.map(order => ({
      orderId: order.id, orderNumber: order.orderNumber, status: order.status,
      promisedDate: (order.promisedDate as Date).toISOString().slice(0, 10), createdAt: order.createdAt,
      daysLate: Math.round((day.getTime() - (order.promisedDate as Date).getTime()) / 86_400_000),
    })) };
  }

  /** Order status history and operator delivery instructions, oldest first. */
  async getStaffTimeline(orderId: string) {
    const [statusEvents, instructions] = await Promise.all([
      this.prisma.orderStatusEvent.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.deliveryInstruction.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } }),
    ]);
    return {
      statusEvents: statusEvents.map(e => ({ status: e.status, at: e.createdAt })),
      deliveryInstructions: instructions.map(i => ({ id: i.id, note: i.note, reason: i.reason, latitude: i.latitude, longitude: i.longitude, actorId: i.actorId, at: i.createdAt })),
    };
  }

  /**
   * The order this customer may act on: the signed-in owner, or the bearer of the order's own guest
   * access token. An order number alone never proves ownership.
   */
  async findOwnedOrder(owner: { customerId: string } | { guestToken: string }, idOrOrderNumber: string) {
    const where: Prisma.OrderWhereInput = {
      OR: [...(UUID.test(idOrOrderNumber) ? [{ id: idOrOrderNumber }] : []), { orderNumber: idOrOrderNumber }],
      // Guest tokens act only on unowned orders, as on every other guest route: once an order belongs to
      // an account (e.g. adopted by a verified phone), the account is the way in.
      ...('customerId' in owner ? { customerId: owner.customerId } : {
        customerId: null,
        guestAccessTokenHash: createHash('sha256').update(owner.guestToken).digest('hex'),
        guestAccessExpiresAt: { gt: new Date() }, guestAccessRevokedAt: null,
      }),
    };
    const order = await this.prisma.order.findFirst({ where, select: { id: true, orderNumber: true, status: true, customerId: true } });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  /** A signed-in customer's own orders, newest first (summary only). */
  /**
   * Phone OTP proves control of the number the guest checked out with, so their guest orders join the
   * account (C0 W6 cross-device access). Only unowned orders move; from then on the account (not the
   * device's guest link) is the way to the order, like every other owned order.
   */
  @OnEvent(CUSTOMER_PHONE_VERIFIED_EVENT)
  async adoptGuestOrdersByPhone(event: CustomerPhoneVerifiedEvent) {
    const national = event.phoneNumber.replace(/\D/g, '').replace(/^20/, '').replace(/^0/, '');
    if (national.length !== 10) return;
    const variants = [`0${national}`, `+20${national}`, `20${national}`, national];
    const adopted = await this.prisma.order.updateMany({ where: { customerId: null, customerPhone: { in: variants } }, data: { customerId: event.customerId } });
    if (adopted.count) this.logger.log(`Adopted ${adopted.count} guest order(s) for customer ${event.customerId}`);
  }

  async getOrderSummaries(ids: string[]): Promise<Map<string, { id: string; orderNumber: string; status: OrderStatus; governorate: string | null; area: string | null }>> {
    if (!ids.length) return new Map();
    const rows = await this.prisma.order.findMany({ where: { id: { in: [...new Set(ids)] } },
      select: { id: true, orderNumber: true, status: true, governorate: true, area: true } });
    return new Map(rows.map(row => [row.id, row]));
  }

  /** Admin queue: availability decisions the customer has not answered yet. */
  async listPendingDecisions(paging: { take: number; skip: number }) {
    const where = { status: 'pending' as const };
    const [total, rows] = await Promise.all([
      this.prisma.availabilityDecision.count({ where }),
      this.prisma.availabilityDecision.findMany({ where, orderBy: { createdAt: 'asc' }, take: paging.take, skip: paging.skip,
        include: { order: { select: { orderNumber: true } } } }),
    ]);
    return { total, items: rows.map(d => ({
      decisionId: d.id, orderId: d.orderId, orderNumber: d.order.orderNumber, orderItemId: d.orderItemId,
      reason: d.reasonCategory, unresolvedQuantity: d.unresolvedQuantity, expiresAt: d.expiresAt, since: d.createdAt,
    })) };
  }

  /**
   * Operator pin for an order that has none (placed before pins were mandatory). A customer pin is
   * never overwritten, and a package already with a driver is not re-routed here (GLO-231).
   */
  async correctDeliveryLocation(id: string, dto: CorrectDeliveryLocationDto, actorId: string) {
    assertDeliverablePin(dto);
    const order = await this.prisma.$transaction(async tx => {
      const current = await tx.order.findUnique({ where: { id } });
      if (!current) throw new NotFoundException('Order not found');
      if (current.latitude !== null && current.longitude !== null) {
        throw new ConflictException({ code: 'LOCATION_ALREADY_CONFIRMED', message: 'This order already has a delivery pin' });
      }
      if (!['placed', 'confirmed', 'packing'].includes(current.status)) {
        throw new ConflictException(`Delivery location cannot change in status ${current.status}`);
      }
      const claimed = await tx.order.updateMany({ where: { id, latitude: null }, data: {
        latitude: dto.latitude, longitude: dto.longitude, locationSource: 'operator_corrected',
        locationConfirmedAt: new Date(), locationConfirmedBy: actorId,
      } });
      if (claimed.count !== 1) throw new ConflictException('Delivery location changed concurrently; retry');
      await this.outbox.enqueue(tx, {
        eventType: 'order.location_corrected', aggregateId: id, aggregateType: 'Order',
        payload: { orderId: id, actorId, reason: dto.reason, latitude: dto.latitude, longitude: dto.longitude },
        deduplicationKey: `order.location_corrected:${id}`,
      });
      return tx.order.findUniqueOrThrow({ where: { id }, include: { items: true } });
    });
    return this.present(order);
  }

  /**
   * Canonical order progression (GLO-206 GAP-08): forward only, `delivered` and `cancelled` are
   * terminal, cancellation only before delivery. Repeating the current status is a no-op.
   */
  private static readonly PROGRESSION: OrderStatus[] = ['placed', 'confirmed', 'packing', 'shipped', 'delivered'];

  private static assertTransition(from: OrderStatus, to: OrderStatus): void {
    if (from === to) return;
    const order = OrderingService.PROGRESSION;
    const terminal = from === 'delivered' || from === 'cancelled' || from === 'returned';
    // `returned`: the parcel left the hub and came back undelivered (GLO-240).
    const allowed = !terminal && (to === 'returned' ? from === 'shipped'
      : to === 'cancelled' || (order.includes(to) && order.indexOf(to) > order.indexOf(from)));
    if (!allowed) throw new ConflictException(`Order cannot move from ${from} to ${to}`);
  }

  /**
   * Staff cancellation inside the composed cancellation transaction (GLO-240): only before the
   * parcel is in a driver's custody, recorded as a resolved cancellation resolution with actor and
   * reason; nothing is deleted. Returns the order snapshot for the caller's follow-up effects.
   */
  async cancelInTx(tx: Prisma.TransactionClient, id: string, input: { actorId: string; reasonCode: string; notes?: string }) {
    await tx.$queryRaw`SELECT id FROM "ordering"."orders" WHERE id = ${id}::uuid FOR UPDATE`;
    const order = await tx.order.findUnique({ where: { id }, include: { items: { where: { lineState: 'active' } } } });
    if (!order) throw new NotFoundException('Order not found');
    if (!['placed', 'confirmed', 'packing'].includes(order.status)) {
      throw new ConflictException({ code: 'CANCELLATION_TOO_LATE',
        message: `An order in status ${order.status} can no longer be cancelled; use the delivery return or customer return flow` });
    }
    await this.transitionInTx(tx, id, 'cancelled');
    const resolution = await tx.orderResolution.create({ data: {
      orderId: id, type: 'cancellation', status: 'resolved', actorId: input.actorId, reasonCode: input.reasonCode,
      notes: input.notes, items: { create: order.items.map(item => ({ orderItemId: item.id, quantity: item.quantity })) },
    } });
    await tx.orderResolutionEvent.create({ data: { resolutionId: resolution.id, status: 'resolved', actorId: input.actorId, notes: input.notes ?? input.reasonCode } });
    await this.outbox.enqueue(tx, {
      eventType: 'order.cancelled', aggregateId: id, aggregateType: 'Order', customerId: order.customerId || undefined,
      payload: { orderId: id, orderNumber: order.orderNumber, reasonCode: input.reasonCode },
      channelIntent: 'whatsapp', templateId: 'order_cancelled_v1', deduplicationKey: `order.cancelled:${id}`,
    });
    return { order, resolutionId: resolution.id };
  }

  async updateOrderStatus(id: string, status: OrderStatus): Promise<OrderDetail> {
    const { updated, oldStatus } = await this.prisma.$transaction(async tx => {
      const oldStatus = await this.transitionInTx(tx, id, status);
      return { updated: await tx.order.findUniqueOrThrow({ where: { id }, include: { items: true } }), oldStatus };
    });
    this.logger.log('[AUDIT] Order Status Changed: ' + JSON.stringify({ orderId: id, oldStatus, newStatus: status }));
    return this.present(updated);
  }

  /**
   * Owner command for a transition inside the caller's transaction, so a shipment and its order move
   * together or not at all (GLO-236 D-1/D-2). Returns the previous status; same status is a no-op.
   */
  async transitionInTx(tx: Prisma.TransactionClient, id: string, status: OrderStatus): Promise<OrderStatus> {
    const order = await tx.order.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('Order ' + id + ' not found.');
    OrderingService.assertTransition(order.status, status);
    if (order.status === status) return order.status;
    // Conditional on the status just read, so a concurrent transition cannot be overwritten.
    const claimed = await tx.order.updateMany({ where: { id, status: order.status }, data: { status } });
    if (claimed.count !== 1) throw new ConflictException('Order status changed concurrently; retry');
    await tx.orderStatusEvent.create({ data: { orderId: id, status } });
    return order.status;
  }
}

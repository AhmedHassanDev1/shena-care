import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { SupplyPlanService } from '../../src/modules/sourcing/services/supply-plan.service';
import { AvailabilityResolutionService } from '../../src/modules/ordering/services/availability-resolution.service';
import { attachReviewedMedia } from '../fixtures/sellable-sku';

/** Owner rule (2026-10-25): an unanswered availability decision expires after 12 waking hours → drop the item, or cancel. */
describe('Availability decision window and expiry (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let plans: SupplyPlanService;
  let resolution: AvailabilityResolutionService;
  const later = () => new Date(Date.now() + 3 * 24 * 3600_000);

  const makeSku = async (label: string) => {
    const suffix = randomUUID();
    const brand = await prisma.brand.create({ data: { name: 'Exp ' + suffix, slug: 'exp-' + suffix } });
    const product = await prisma.product.create({ data: { brandId: brand.id, name: 'Exp ' + label, slug: 'exp-p-' + suffix, isPublished: true } });
    const sku = await prisma.sku.create({ data: { productId: product.id, code: label + suffix, variantName: label } });
    await attachReviewedMedia(prisma, sku.id);
    await prisma.listing.create({ data: { skuId: sku.id, isListed: true } });
    await prisma.sellingPrice.create({ data: { skuId: sku.id, amount: 100, currency: 'EGP', validFrom: new Date(Date.now() - 1000), isActive: true } });
    const supplier = await prisma.supplier.create({ data: { name: 'Exp Sup ' + suffix, slug: 'exp-sup-' + suffix } });
    const offer = await prisma.supplierOffer.create({ data: {
      supplierId: supplier.id, skuId: sku.id, costPrice: 50, currency: 'EGP', lastObservedAt: new Date(), lastConfirmedAt: new Date(),
    } });
    return { skuId: sku.id, productId: product.id, offerId: offer.id };
  };

  const makeOrder = async (skus: Array<{ skuId: string; productId: string }>) => {
    const order = await prisma.order.create({ data: {
      orderNumber: 'ORD-' + randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase(), customerName: 'Expiry Customer',
      customerPhone: '01012345678', shippingAddress: '1 Expiry St', currency: 'EGP', status: 'placed',
      subtotal: 100 * skus.length, shippingFee: 30, totalAmount: 100 * skus.length + 30, codAmount: 100 * skus.length + 30,
      items: { create: skus.map(s => ({ skuId: s.skuId, productId: s.productId, quantity: 1, price: 100, lineTotal: 100, currency: 'EGP', productName: 'Exp', skuCode: 'X', variantName: 'X' })) },
    }, include: { items: true } });
    await prisma.paymentCollection.create({ data: { orderId: order.id, expectedAmount: 100 * skus.length + 30, currency: 'EGP' } });
    return order;
  };

  /** Supplier says the item is not available: the plan is exhausted and an action is required. */
  const exhaust = async (orderId: string, offerId: string) => {
    const plan = await plans.initiateForOrder(orderId);
    await prisma.supplierOffer.update({ where: { id: offerId }, data: { isAvailable: false } });
    for (const line of plan.lines) {
      for (const allocation of line.allocations.filter(a => a.result === 'pending' && a.supplierOfferId === offerId)) {
        await plans.confirmAllocation(allocation.id, { result: 'rejected', confirmedQuantity: 0 });
      }
    }
  };

  beforeAll(async () => {
    process.env.TEST_BYPASS_AUTH = 'false';
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    plans = app.get(SupplyPlanService);
    resolution = app.get(AvailabilityResolutionService);
  });
  afterAll(async () => { await app.close(); });

  it('opens the decision by itself with a deadline, and leaves it alone before the window ends', async () => {
    const a = await makeSku('A'); const b = await makeSku('B');
    const order = await makeOrder([a, b]);
    await exhaust(order.id, a.offerId);
    // Nobody opened the order page, yet the sweep creates the decision the customer must answer.
    await resolution.sweep(new Date());
    const decision = await prisma.availabilityDecision.findFirstOrThrow({ where: { orderId: order.id, status: 'pending' } });
    expect(decision.expiresAt).not.toBeNull();
    expect(decision.expiresAt!.getTime()).toBeGreaterThanOrEqual(Date.now() + 12 * 3600_000);
    expect((await resolution.sweep(new Date())).expired).toBe(0);
    expect((await prisma.availabilityDecision.findUniqueOrThrow({ where: { id: decision.id } })).status).toBe('pending');
  });

  it('drops the unavailable item and continues the order, keeping the original delivery fee', async () => {
    const a = await makeSku('A'); const b = await makeSku('B');
    const order = await makeOrder([a, b]);
    await exhaust(order.id, a.offerId);
    await resolution.sweep(new Date());
    const decision = await prisma.availabilityDecision.findFirstOrThrow({ where: { orderId: order.id, status: 'pending' } });

    await resolution.expireDue(later());

    const items = await prisma.orderItem.findMany({ where: { orderId: order.id } });
    expect(items.find(i => i.skuId === a.skuId)?.lineState).toBe('removed');
    expect(items.find(i => i.skuId === b.skuId)?.lineState).toBe('active');
    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe('placed');
    expect(Number(after.shippingFee)).toBe(30); // frozen on the original order; ShinaCare absorbs the difference
    expect(Number((await prisma.paymentCollection.findUniqueOrThrow({ where: { orderId: order.id } })).expectedAmount)).toBe(130); // 100 + 30
    const resolved = await prisma.availabilityDecision.findUniqueOrThrow({ where: { id: decision.id } });
    expect(resolved).toMatchObject({ status: 'resolved', decidedAction: 'CONTINUE_WITHOUT_ITEM', decidedBy: 'system:expiry', decidedChannel: 'system_expiry' });
    expect(await prisma.notificationOutbox.count({ where: { deduplicationKey: 'availability.expired:' + decision.id } })).toBe(1);
    expect((await resolution.expireDue(later()))).toBe(0); // idempotent
  });

  it('cancels the order when the unavailable item was the only one', async () => {
    const a = await makeSku('A');
    const order = await makeOrder([a]);
    await exhaust(order.id, a.offerId);
    await resolution.sweep(new Date());
    await resolution.expireDue(later());
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('cancelled');
    expect(await prisma.orderResolution.count({ where: { orderId: order.id, type: 'cancellation', reasonCode: 'AVAILABILITY_DECISION' } })).toBe(1);
  });

  it('does not touch a decision the customer already answered', async () => {
    const a = await makeSku('A'); const b = await makeSku('B');
    const order = await makeOrder([a, b]);
    await exhaust(order.id, a.offerId);
    await resolution.sweep(new Date());
    const decision = await prisma.availabilityDecision.findFirstOrThrow({ where: { orderId: order.id, status: 'pending' } });
    await resolution.decide({ system: true }, decision.id, { action: 'CANCEL_ORDER', version: decision.version, idempotencyKey: 'answer-' + randomUUID() });
    const cancelled = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(cancelled.status).toBe('cancelled');
    expect(await resolution.expireDue(later())).toBe(0);
  });
});

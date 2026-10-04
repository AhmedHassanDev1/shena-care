import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { SupplyPlanService } from '../../src/modules/sourcing/services/supply-plan.service';
const request = require('supertest');

describe('Customer availability resolution + order amendment (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let plans: SupplyPlanService;
  const http = () => request(app.getHttpServer());

  const registerCustomer = async () => {
    const registration = await http().post('/accounts/register').send({
      name: 'Resolution Customer', email: 'resolution-' + randomUUID() + '@example.com', password: 'password123',
    }).expect(201);
    const auth = 'Bearer ' + registration.body.token;
    const me = await http().get('/accounts/me').set('Authorization', auth).expect(200);
    return { auth, id: me.body.id as string };
  };

  /** Product with two sellable variants; the first is the one that will go short. */
  const makeProduct = async (opts: { replacementSupplied?: boolean; replacementPrice?: number } = {}) => {
    const suffix = randomUUID();
    const brand = await prisma.brand.create({ data: { name: 'Res ' + suffix, slug: 'res-' + suffix } });
    const product = await prisma.product.create({ data: {
      brandId: brand.id, name: 'Res Product ' + suffix, slug: 'res-product-' + suffix, isPublished: true,
    } });
    const mk = async (code: string, variantName: string, price: number, supplied: boolean) => {
      const sku = await prisma.sku.create({ data: { productId: product.id, code: code + suffix, variantName } });
      await prisma.listing.create({ data: { skuId: sku.id, isListed: true } });
      await prisma.sellingPrice.create({ data: { skuId: sku.id, amount: price, currency: 'EGP', validFrom: new Date(Date.now() - 1000), isActive: true } });
      let offerId: string | undefined;
      if (supplied) {
        const supplier = await prisma.supplier.create({ data: { name: 'Res Sup ' + code + suffix, slug: 'res-sup-' + code + suffix } });
        offerId = (await prisma.supplierOffer.create({ data: {
          supplierId: supplier.id, skuId: sku.id, costPrice: price / 2, currency: 'EGP', lastObservedAt: new Date(), isAvailable: true,
        } })).id;
      }
      return { id: sku.id, offerId };
    };
    const original = await mk('ORIG-', 'Original 50ml', 100, true);
    const other = await mk('ALT-', 'Alternative 30ml', opts.replacementPrice ?? 80, opts.replacementSupplied ?? true);
    return { product, original, other };
  };

  const makeOrder = async (customerId: string | null, items: Array<{ skuId: string; quantity: number; productId: string }>,
    guest?: { token: string }) => {
    const orderNumber = 'ORD-' + randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase();
    const { createHash } = require('crypto');
    const order = await prisma.order.create({ data: {
      orderNumber, customerId, customerName: 'Resolution Customer', customerPhone: '01012345678',
      shippingAddress: '1 Resolution Street', totalAmount: 0, shippingFee: 50, currency: 'EGP', status: 'placed',
      codAmount: 0, subtotal: 0,
      ...(guest ? { guestAccessTokenHash: createHash('sha256').update(guest.token).digest('hex'),
        guestAccessExpiresAt: new Date(Date.now() + 3600_000) } : {}),
      items: { create: items.map(i => ({
        skuId: i.skuId, quantity: i.quantity, price: 100, productId: i.productId, productName: 'Res Product',
        skuCode: 'ORIG', variantName: 'Original 50ml', currency: 'EGP', lineTotal: 100 * i.quantity,
      })) },
    }, include: { items: true } });
    const subtotal = order.items.reduce((s, i) => s + Number(i.lineTotal), 0);
    await prisma.order.update({ where: { id: order.id }, data: { subtotal, totalAmount: subtotal + 50, codAmount: subtotal + 50 } });
    await prisma.paymentCollection.create({ data: { orderId: order.id, expectedAmount: subtotal + 50, currency: 'EGP' } });
    return order;
  };

  /** Drive Sourcing into SOURCE_EXHAUSTED for the original SKU. */
  const exhaust = async (orderId: string, offerId: string) => {
    const plan = await plans.initiateForOrder(orderId);
    await prisma.supplierOffer.update({ where: { id: offerId }, data: { isAvailable: false } });
    for (const line of plan.lines) {
      for (const allocation of line.allocations.filter(a => a.result === 'pending' && a.supplierOfferId === offerId)) {
        await plans.confirmAllocation(allocation.id, { result: 'rejected', confirmedQuantity: 0 });
      }
    }
  };

  const decisionsFor = async (auth: string, orderNumber: string) =>
    (await http().get('/ordering/orders/' + orderNumber + '/availability-decisions').set('Authorization', auth).expect(200)).body;

  beforeAll(async () => {
    process.env.TEST_BYPASS_AUTH = 'false';
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    plans = app.get(SupplyPlanService);
  });
  afterAll(async () => { await app.close(); });

  it('replaces a short item with an explicit, priced candidate; replay is idempotent; original snapshot is kept', async () => {
    const owner = await registerCustomer();
    const stranger = await registerCustomer();
    const { product, original, other } = await makeProduct();
    const order = await makeOrder(owner.id, [{ skuId: original.id, quantity: 2, productId: product.id }]);
    await exhaust(order.id, original.offerId!);

    const tracking = (await http().get('/ordering/orders/' + order.orderNumber + '/tracking').set('Authorization', owner.auth).expect(200)).body;
    expect(tracking.status).toBe('ACTION_REQUIRED');
    expect(tracking.actionRequired.allowedActions).toEqual(expect.arrayContaining(['REPLACE_WITH', 'CANCEL_ORDER']));
    expect(tracking.actionRequired.allowedActions).not.toContain('CONTINUE_WITHOUT_ITEM'); // only item

    const [decision] = (await decisionsFor(owner.auth, order.orderNumber)).filter((d: any) => d.status === 'pending');
    expect(decision.candidates).toHaveLength(1);
    expect(decision.candidates[0]).toMatchObject({ skuId: other.id, unitPrice: 80,
      preview: { codBefore: 250, codAfter: 210, priceDelta: -40 } });
    expect(JSON.stringify(decision).toLowerCase()).not.toMatch(/supplier|costprice|ranking/);

    // ownership: another customer and anonymous callers cannot read or decide
    await http().get('/ordering/orders/' + order.orderNumber + '/availability-decisions').set('Authorization', stranger.auth).expect(404);
    await http().get('/ordering/orders/' + order.orderNumber + '/availability-decisions').expect(401);
    const key = 'decision-key-' + randomUUID();
    const body = { action: 'REPLACE_WITH', candidateSkuId: other.id, version: decision.version, idempotencyKey: key };
    await http().post('/ordering/availability-decisions/' + decision.id + '/decision').set('Authorization', stranger.auth).send(body).expect(404);
    await http().post('/ordering/availability-decisions/' + decision.id + '/decision').send(body).expect(401);
    // candidate not proposed by the server is rejected
    await http().post('/ordering/availability-decisions/' + decision.id + '/decision').set('Authorization', owner.auth)
      .send({ ...body, candidateSkuId: randomUUID(), idempotencyKey: 'other-key-' + randomUUID() }).expect(400);

    const first = await http().post('/ordering/availability-decisions/' + decision.id + '/decision').set('Authorization', owner.auth).send(body).expect(201);
    expect(first.body.receipt).toMatchObject({
      action: 'REPLACE_WITH', amounts: { codBefore: 250, codAfter: 210, delta: -40, currency: 'EGP' },
      removedItem: { orderItemId: order.items[0].id }, replacement: { skuId: other.id, priceDelta: -40 },
      nextOrderState: 'CONFIRMING_PRODUCTS',
    });
    // double-submit (sequential and concurrent) does not apply twice
    const [replayA, replayB] = await Promise.all([
      http().post('/ordering/availability-decisions/' + decision.id + '/decision').set('Authorization', owner.auth).send(body),
      http().post('/ordering/availability-decisions/' + decision.id + '/decision').set('Authorization', owner.auth).send(body),
    ]);
    expect([replayA.status, replayB.status]).toEqual([201, 201]);
    expect(replayA.body.replayed).toBe(true);
    expect(await prisma.orderAmendment.count({ where: { orderId: order.id } })).toBe(1);
    expect(await prisma.orderItem.count({ where: { orderId: order.id } })).toBe(2);
    // same decision, different choice -> conflict
    await http().post('/ordering/availability-decisions/' + decision.id + '/decision').set('Authorization', owner.auth)
      .send({ action: 'CANCEL_ORDER', version: decision.version, idempotencyKey: 'x-key-' + randomUUID() }).expect(409);

    const original0 = await prisma.orderItem.findUniqueOrThrow({ where: { id: order.items[0].id } });
    expect(original0).toMatchObject({ skuId: original.id, quantity: 2, lineState: 'replaced' });
    expect(original0.price.toNumber()).toBe(100);
    const collection = await prisma.paymentCollection.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(collection.expectedAmount.toNumber()).toBe(210);
    // sourcing was re-planned for the replacement; original requirement released, not destroyed
    const plan = await plans.getPlan(order.id);
    expect(plan.lines).toHaveLength(1);
    expect(plan.lines[0].skuId).toBe(other.id);
    expect(await prisma.supplyRequirement.count({ where: { supplyRequest: { orderId: order.id }, releasedAt: { not: null } } })).toBe(1);

    const after = (await http().get('/ordering/orders/' + order.orderNumber + '/tracking').set('Authorization', owner.auth).expect(200)).body;
    expect(after.status).toBe('CONFIRMING_PRODUCTS');
    expect(after.actionRequired).toBeNull();
    expect(after.amounts).toMatchObject({ originalCodAmount: 250, currentCodAmount: 210 });
    expect(after.items.map((i: any) => i.lineState).sort()).toEqual(['active', 'replaced']);
  });

  it('continues without the item and keeps the other line; cannot continue when it is the only item', async () => {
    const owner = await registerCustomer();
    const first = await makeProduct();
    const second = await makeProduct();
    const order = await makeOrder(owner.id, [
      { skuId: first.original.id, quantity: 1, productId: first.product.id },
      { skuId: second.original.id, quantity: 1, productId: second.product.id },
    ]);
    await exhaust(order.id, first.original.offerId!);
    const [decision] = (await decisionsFor(owner.auth, order.orderNumber)).filter((d: any) => d.status === 'pending');
    expect(decision.availableActions).toContain('CONTINUE_WITHOUT_ITEM');
    expect(decision.previews.continueWithoutItem).toEqual({ codBefore: 250, codAfter: 150 });
    const result = await http().post('/ordering/availability-decisions/' + decision.id + '/decision').set('Authorization', owner.auth)
      .send({ action: 'CONTINUE_WITHOUT_ITEM', version: decision.version, idempotencyKey: 'continue-' + randomUUID() }).expect(201);
    expect(result.body.receipt.amounts).toMatchObject({ codBefore: 250, codAfter: 150, delta: -100 });
    expect(result.body.receipt.replacement).toBeNull();
    const items = await prisma.orderItem.findMany({ where: { orderId: order.id } });
    expect(items.find(i => i.skuId === first.original.id)?.lineState).toBe('removed');
    expect(items.find(i => i.skuId === second.original.id)?.lineState).toBe('active');
    expect((await prisma.paymentCollection.findUniqueOrThrow({ where: { orderId: order.id } })).expectedAmount.toNumber()).toBe(150);

    // sole item: CONTINUE_WITHOUT_ITEM is not offered and is rejected
    const single = await makeProduct({ replacementSupplied: false });
    const soloOrder = await makeOrder(owner.id, [{ skuId: single.original.id, quantity: 1, productId: single.product.id }]);
    await exhaust(soloOrder.id, single.original.offerId!);
    const [solo] = (await decisionsFor(owner.auth, soloOrder.orderNumber)).filter((d: any) => d.status === 'pending');
    expect(solo.availableActions).toEqual(['CANCEL_ORDER']); // no supplied candidate either
    await http().post('/ordering/availability-decisions/' + solo.id + '/decision').set('Authorization', owner.auth)
      .send({ action: 'CONTINUE_WITHOUT_ITEM', version: solo.version, idempotencyKey: 'solo-' + randomUUID() }).expect(400);
  });

  it('cancels the order through the canonical cancellation lifecycle (guest, token-scoped)', async () => {
    const guestToken = 'G'.repeat(43);
    const { product, original } = await makeProduct();
    const order = await makeOrder(null, [{ skuId: original.id, quantity: 1, productId: product.id }], { token: guestToken });
    await exhaust(order.id, original.offerId!);
    const base = '/ordering/guest/orders/' + order.orderNumber + '/availability-decisions';
    await http().get(base).expect(401);
    await http().get(base).set('x-order-access-token', 'H'.repeat(43)).expect(404);
    const list = await http().get(base).set('x-order-access-token', guestToken).expect(200);
    const decision = list.body.find((d: any) => d.status === 'pending');
    await http().post(base + '/' + decision.id + '/decision').set('x-order-access-token', 'H'.repeat(43))
      .send({ action: 'CANCEL_ORDER', version: decision.version, idempotencyKey: 'guest-bad-' + randomUUID() }).expect(404);
    const done = await http().post(base + '/' + decision.id + '/decision').set('x-order-access-token', guestToken)
      .send({ action: 'CANCEL_ORDER', version: decision.version, idempotencyKey: 'guest-cancel-' + randomUUID(), channel: 'messaging_link' }).expect(201);
    expect(done.body.receipt).toMatchObject({ nextOrderState: 'CANCELLED', amounts: { codAfter: 0 } });
    const cancelled = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(cancelled.status).toBe('cancelled');
    expect(await prisma.orderResolution.count({ where: { orderId: order.id, type: 'cancellation', status: 'resolved' } })).toBe(1);
    const stored = await prisma.availabilityDecision.findUniqueOrThrow({ where: { id: decision.id } });
    expect(stored).toMatchObject({ decidedChannel: 'messaging_link', decidedBy: 'guest:' + order.id });
  });

  it('never applies a stale decision: changed availability or order state demands review', async () => {
    const owner = await registerCustomer();
    const { product, original } = await makeProduct();
    const order = await makeOrder(owner.id, [{ skuId: original.id, quantity: 1, productId: product.id }]);
    await exhaust(order.id, original.offerId!);
    const [decision] = (await decisionsFor(owner.auth, order.orderNumber)).filter((d: any) => d.status === 'pending');

    // wrong version
    await http().post('/ordering/availability-decisions/' + decision.id + '/decision').set('Authorization', owner.auth)
      .send({ action: 'CANCEL_ORDER', version: decision.version + 1, idempotencyKey: 'stale-v-' + randomUUID() }).expect(409);

    // order moved on (shipment allocated) while the customer was deciding
    const location = await prisma.fulfillmentLocation.create({ data: { name: 'Res Hub ' + randomUUID(), address: '1 Hub' } });
    await prisma.shipment.create({ data: { orderId: order.id, locationId: location.id, status: 'pending' } });
    const stale = await http().post('/ordering/availability-decisions/' + decision.id + '/decision').set('Authorization', owner.auth)
      .send({ action: 'CANCEL_ORDER', version: decision.version, idempotencyKey: 'stale-s-' + randomUUID() }).expect(409);
    expect(stale.body.code).toBe('REVIEW_REQUIRED');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('placed');
    expect(await prisma.orderAmendment.count({ where: { orderId: order.id } })).toBe(0);
    expect((await prisma.availabilityDecision.findUniqueOrThrow({ where: { id: decision.id } })).status).not.toBe('resolved');
  });

  it('treats a same-SKU internal supplier fallback as no customer action, and rejects a candidate whose price changed', async () => {
    const owner = await registerCustomer();
    const { product, original } = await makeProduct();
    // a second supplier for the SAME sku: Sourcing falls back internally
    const supplier = await prisma.supplier.create({ data: { name: 'Fallback ' + randomUUID(), slug: 'fallback-' + randomUUID() } });
    await prisma.supplierOffer.create({ data: { supplierId: supplier.id, skuId: original.id, costPrice: 70, currency: 'EGP', lastObservedAt: new Date(), isAvailable: true } });
    const order = await makeOrder(owner.id, [{ skuId: original.id, quantity: 1, productId: product.id }]);
    const plan = await plans.initiateForOrder(order.id);
    const firstAllocation = plan.lines[0].allocations[0];
    await plans.confirmAllocation(firstAllocation.id, { result: 'rejected', confirmedQuantity: 0 });
    const tracking = (await http().get('/ordering/orders/' + order.orderNumber + '/tracking').set('Authorization', owner.auth).expect(200)).body;
    expect(tracking.actionRequired).toBeNull();
    expect((await decisionsFor(owner.auth, order.orderNumber)).filter((d: any) => d.status === 'pending')).toHaveLength(0);

    // price drift on a proposed replacement -> review, nothing applied
    const drift = await makeProduct();
    const driftOrder = await makeOrder(owner.id, [{ skuId: drift.original.id, quantity: 1, productId: drift.product.id }]);
    await exhaust(driftOrder.id, drift.original.offerId!);
    const [decision] = (await decisionsFor(owner.auth, driftOrder.orderNumber)).filter((d: any) => d.status === 'pending');
    await prisma.sellingPrice.updateMany({ where: { skuId: drift.other.id }, data: { amount: 95 } });
    const res = await http().post('/ordering/availability-decisions/' + decision.id + '/decision').set('Authorization', owner.auth)
      .send({ action: 'REPLACE_WITH', candidateSkuId: drift.other.id, version: decision.version, idempotencyKey: 'drift-' + randomUUID() }).expect(409);
    expect(res.body.code).toBe('REVIEW_REQUIRED');
    expect(await prisma.orderAmendment.count({ where: { orderId: driftOrder.id } })).toBe(0);
    // regenerated decision reflects the new price
    const [renewed] = (await decisionsFor(owner.auth, driftOrder.orderNumber)).filter((d: any) => d.status === 'pending');
    expect(renewed.version).toBeGreaterThan(decision.version);
    expect(renewed.candidates[0].unitPrice).toBe(95);
  });
});

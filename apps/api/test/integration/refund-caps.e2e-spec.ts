/* eslint-disable @typescript-eslint/no-explicit-any -- HTTP response bodies are asserted structurally */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { Role } from '@prisma/client';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { createActor, Actor } from '../fixtures/actors';
import { createSellableSku } from '../fixtures/sellable-sku';

/**
 * B4 — a refund can never exceed what the customer is owed for the goods being returned, what was paid for delivery, or the money actually
 * received, under partial, repeated and concurrent requests. Orders are stored delivered COD orders whose cash the courier declared; the
 * refunds stay "pending" (or "failed"), so nothing here reaches the finance reports.
 */
describe('Refund caps (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Actor;
  const http = () => request(app.getHttpServer());

  type Line = { price: number; qty: number };
  /** A delivered COD order. `coupon` is an order-level discount (never allocated to lines); `cash` is what the courier declared. */
  async function order(lines: Line[], opts: { shippingFee?: number; coupon?: number; cash?: number | null } = {}) {
    const shippingFee = opts.shippingFee ?? 35; const coupon = opts.coupon ?? 0;
    const subtotal = lines.reduce((sum, line) => sum + line.price * line.qty, 0);
    const total = subtotal - coupon + shippingFee;
    const skus = await Promise.all(lines.map(() => createSellableSku(prisma)));
    const row = await prisma.order.create({ data: {
      orderNumber: `ORD-${randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase()}`, customerName: 'Refund Customer', customerPhone: '01012345678', shippingAddress: 'x',
      subtotal, shippingFee, totalAmount: total, codAmount: total, currency: 'EGP', status: 'delivered', paymentMethod: 'COD',
      ...(coupon ? { appliedPromotions: [{ code: 'T', valueApplied: coupon }] } : {}),
      items: { create: lines.map((line, i) => ({ skuId: skus[i].id, quantity: line.qty, price: line.price, productName: 'Refund', skuCode: skus[i].code, variantName: '50 ml', currency: 'EGP', lineTotal: line.price * line.qty })) },
    }, include: { items: true } });
    if (opts.cash !== null) {
      const declared = opts.cash ?? total;
      await prisma.paymentCollection.create({ data: { orderId: row.id, expectedAmount: total, declaredAmount: declared, declaredAt: new Date(), currency: 'EGP', status: 'collected' } });
    } else {
      await prisma.paymentCollection.create({ data: { orderId: row.id, expectedAmount: total, currency: 'EGP', status: 'expected' } });
    }
    return { ...row, total };
  }
  /** An approved return of `claims` = [index of line, units]. With no claims it is a resolution without items (a fee-only refund). */
  async function resolution(o: Awaited<ReturnType<typeof order>>, claims: Array<[number, number]> = []) {
    return prisma.orderResolution.create({ data: {
      orderId: o.id, type: 'return', status: 'approved', actorId: 'test',
      items: { create: claims.map(([index, quantity]) => ({ orderItemId: o.items[index].id, quantity })) },
    } });
  }
  const refund = (resolutionId: string, amount: number, deliveryFeeAmount?: number) =>
    http().post(`/ordering/resolutions/${resolutionId}/refund`).set(admin.auth).send({ amount, currency: 'EGP', ...(deliveryFeeAmount !== undefined ? { deliveryFeeAmount } : {}) });
  const live = async (orderId: string) => (await prisma.refundTransaction.findMany({ where: { orderId, status: { not: 'failed' } } })).reduce((sum, row) => sum + Number(row.amount), 0);

  beforeAll(async () => {
    process.env.TEST_BYPASS_AUTH = 'false';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    admin = await createActor(prisma, Role.ADMIN);
  }, 120000);
  afterAll(async () => { await app.close(); });

  it('partial refunds follow the returned units: never above them, and the sum of all of them never above the goods billed', async () => {
    const o = await order([{ price: 100, qty: 4 }]); // goods 400 + fee 35
    const first = await resolution(o, [[0, 1]]);
    const tooMuch = await refund(first.id, 101).expect(400);
    expect(tooMuch.body).toMatchObject({ code: 'REFUND_EXCEEDS_GOODS', refundableGoods: '100.00' });
    await refund(first.id, 100).expect(201);
    const second = await resolution(o, [[0, 3]]);
    await refund(second.id, 300).expect(201);
    expect(await live(o.id)).toBe(400);
    // Everything was returned and refunded: there is nothing left for another claim.
    const third = await resolution(o, [[0, 1]]);
    const none = await refund(third.id, 1).expect(400);
    expect(none.body).toMatchObject({ code: 'REFUND_EXCEEDS_GOODS', refundableGoods: '0.00' });
    expect(await live(o.id)).toBe(400);
  });

  it('shares an order coupon across the lines in proportion, and refunds the whole bill exactly (no cent is lost to rounding)', async () => {
    const o = await order([{ price: 100, qty: 2 }, { price: 100, qty: 3 }], { coupon: 50 }); // lines 500, coupon 50 → goods billed 450
    const one = await resolution(o, [[0, 1]]); // 1 unit of line A: 100 × 450 / 500 = 90
    expect((await refund(one.id, 91).expect(400)).body.refundableGoods).toBe('90.00');
    await refund(one.id, 90).expect(201);
    const rest = await resolution(o, [[0, 1], [1, 3]]); // 4 more units: 4 × 100 × 0.9 = 360
    expect((await refund(rest.id, 361).expect(400)).body.refundableGoods).toBe('360.00');
    await refund(rest.id, 360).expect(201);
    expect(await live(o.id)).toBe(450);
  });

  it('refunds the delivery fee on its own: never mixed into the goods cap, never above what was paid for delivery', async () => {
    const o = await order([{ price: 100, qty: 4 }], { shippingFee: 35 });
    const bad = await resolution(o);
    expect((await refund(bad.id, 40, 50).expect(400)).body.code).toBe('INVALID_DELIVERY_FEE_REFUND'); // the fee part is larger than the refund
    expect((await refund(bad.id, 40, 40).expect(400)).body.code).toBe('REFUND_EXCEEDS_DELIVERY_FEE'); // the customer paid 35 for delivery
    await refund(bad.id, 35, 35).expect(201);
    const again = await resolution(o);
    expect((await refund(again.id, 1, 1).expect(400)).body).toMatchObject({ code: 'REFUND_EXCEEDS_DELIVERY_FEE', refundableDeliveryFee: '0.00' });
    // The goods are still fully refundable, up to what the customer paid for them.
    const goods = await resolution(o, [[0, 4]]);
    expect((await refund(goods.id, 401).expect(400)).body.code).toBe('REFUND_EXCEEDS_GOODS');
    await refund(goods.id, 400).expect(201);
    expect(await live(o.id)).toBe(435);
    const stored = await prisma.refundTransaction.findMany({ where: { orderId: o.id } });
    expect(stored.map(row => Number(row.deliveryFeeAmount)).sort((a, b) => a - b)).toEqual([0, 35]);
  });

  it('concurrent refunds queue on the order: exactly the refundable balance goes out, never more', async () => {
    const o = await order([{ price: 100, qty: 4 }]);
    const claims = await Promise.all(Array.from({ length: 6 }, () => resolution(o, [[0, 4]])));
    const results = await Promise.all(claims.map(claim => refund(claim.id, 100)));
    const accepted = results.filter(result => result.status === 201).length;
    expect(accepted).toBe(4); // 400 of goods = four refunds of 100
    expect(results.filter(result => result.status === 400)).toHaveLength(2);
    expect(await live(o.id)).toBe(400);
  });

  it('concurrent big refunds on the same order: one wins, the other is refused', async () => {
    const o = await order([{ price: 100, qty: 4 }]);
    const [a, b] = await Promise.all([resolution(o, [[0, 4]]), resolution(o, [[0, 4]])]);
    const results = await Promise.all([refund(a.id, 400), refund(b.id, 400)]);
    expect(results.map(result => result.status).sort()).toEqual([201, 400]);
    expect(await live(o.id)).toBe(400);
  });

  it('duplicate requests for one return create one refund', async () => {
    const o = await order([{ price: 100, qty: 4 }]);
    const claim = await resolution(o, [[0, 2]]);
    const results = await Promise.all([refund(claim.id, 200), refund(claim.id, 200), refund(claim.id, 200)]);
    expect(results.filter(result => result.status === 201)).toHaveLength(1);
    expect(results.filter(result => result.status === 400)).toHaveLength(2);
    expect(await prisma.refundTransaction.count({ where: { resolutionId: claim.id } })).toBe(1);
    expect(await live(o.id)).toBe(200);
  });

  it('a failed refund frees its amount again', async () => {
    const o = await order([{ price: 100, qty: 4 }]);
    const first = await resolution(o, [[0, 4]]);
    await refund(first.id, 400).expect(201);
    const second = await resolution(o, [[0, 4]]);
    await refund(second.id, 100).expect(400);
    await http().patch(`/ordering/resolutions/${first.id}/refund/status`).set(admin.auth).send({ status: 'failed', errorReason: 'bank rejected the transfer' }).expect(200);
    await refund(second.id, 400).expect(201);
    expect(await live(o.id)).toBe(400);
  });

  it('refunds only the money actually received: nothing without cash, and never more than the courier declared', async () => {
    const unpaid = await order([{ price: 100, qty: 2 }], { cash: null });
    const claim = await resolution(unpaid, [[0, 1]]);
    expect((await refund(claim.id, 50).expect(409)).body.code).toBe('NO_CASH_RECEIVED');

    // The courier declared 120 of a 235 bill: 120 is all that was ever received, so it is all that can be given back.
    const partial = await order([{ price: 100, qty: 2 }], { cash: 120 });
    const all = await resolution(partial, [[0, 2]]);
    expect((await refund(all.id, 121).expect(400)).body.message).toMatch(/refundable balance of 120\.00/);
    await refund(all.id, 120).expect(201);
  });

  it('refuses malformed refunds', async () => {
    const o = await order([{ price: 100, qty: 1 }]);
    const claim = await resolution(o, [[0, 1]]);
    await refund(claim.id, 0).expect(400);
    await refund(claim.id, -5).expect(400);
    await http().post(`/ordering/resolutions/${claim.id}/refund`).set(admin.auth).send({ amount: 10, currency: 'USD' }).expect(400);
    await refund(claim.id, 10, -1).expect(400);
    expect(await prisma.refundTransaction.count({ where: { orderId: o.id } })).toBe(0);
  });
});

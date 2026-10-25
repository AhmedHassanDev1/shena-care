import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { createActor } from '../fixtures/actors';
import request from 'supertest';

/** Owner decision 2026-10-25: month-end statement with the hub, from recorded facts only. */
describe('Monthly statement with the hub (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: { auth: Record<string, string> };
  let hub: { auth: Record<string, string> };
  // A month no other test touches: every run uses its own, so earlier runs never leak into the totals.
  const month = `${3000 + Math.floor(Math.random() * 4000)}-07`;
  const at = (day: number) => new Date(`${month}-${String(day).padStart(2, '0')}T10:00:00.000Z`);
  const http = () => request(app.getHttpServer());

  const delivered = async (opts: { total: number; fee: number; collectionExpected?: number; feeBase?: number; day: number }) => {
    const order = await prisma.order.create({ data: {
      orderNumber: 'ORD-' + randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase(), customerName: 'Stmt Customer', customerPhone: '01012345678',
      shippingAddress: '1 Stmt St', currency: 'EGP', status: 'delivered', subtotal: opts.total - opts.fee, shippingFee: opts.fee, totalAmount: opts.total, codAmount: opts.total,
      items: { create: [{ skuId: randomUUID(), quantity: 1, price: 100, lineTotal: 100, currency: 'EGP', productName: 'Stmt', skuCode: 'S', variantName: 'S' }] },
      statusEvents: { create: [{ status: 'placed', createdAt: at(opts.day - 1) }, { status: 'delivered', createdAt: at(opts.day) }] },
    }, include: { items: true } });
    if (opts.collectionExpected !== undefined) {
      await prisma.paymentCollection.create({ data: { orderId: order.id, expectedAmount: opts.collectionExpected, currency: 'EGP', status: 'settled' } });
    }
    if (opts.feeBase !== undefined) {
      const cart = await prisma.cart.create({ data: { guestTokenHash: randomUUID() } });
      await prisma.checkoutQuote.create({ data: { cartId: cart.id, revision: 1, expiresAt: at(1), orderId: order.id, snapshot: { deliveryFeeBase: opts.feeBase } } });
    }
    return order;
  };
  const statement = (who = admin, m = month) => http().get('/ordering/statements/monthly').query({ month: m }).set(who.auth);

  beforeAll(async () => {
    process.env.TEST_BYPASS_AUTH = 'false';
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    admin = await createActor(prisma, Role.ADMIN);
    hub = await createActor(prisma, Role.HUB_OPERATOR);
  });
  afterAll(async () => { delete process.env.SHINACARE_COMMISSION_PERCENT; await app.close(); });

  it('is an admin read and validates the month', async () => {
    await http().get('/ordering/statements/monthly').query({ month }).expect(401);
    await statement(hub as never).expect(403);
    await statement(admin, '2026-13').expect(400);
    await statement(admin, 'July').expect(400);
  });

  it('is empty, and says the commission is not agreed, until the owner sets the percentage', async () => {
    delete process.env.SHINACARE_COMMISSION_PERCENT;
    const body = (await statement().expect(200)).body;
    expect(body).toMatchObject({ month, ordersDelivered: 0, netSales: 0, commission: { percent: null, amount: null }, shinaCareNet: null });
    expect(body.notes.join(' ')).toContain('not set');
  });

  it('computes net sales, commission, absorbed delivery fees and return losses from recorded facts', async () => {
    process.env.SHINACARE_COMMISSION_PERCENT = '10';
    // Order 1: asked 230 at the door (goods 200), customer paid a 30 fee but the hub is owed 50 → ShinaCare absorbed 20.
    await delivered({ total: 230, fee: 30, collectionExpected: 230, feeBase: 50, day: 10 });
    // Order 2: an amendment lowered what was collected from 130 to 100 + 30 fee → goods 100; no quote, so no absorbed fee.
    await delivered({ total: 200, fee: 30, collectionExpected: 130, day: 12 });
    // Delivered the month before: not in this month.
    await prisma.order.create({ data: {
      orderNumber: 'ORD-' + randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase(), customerName: 'Old', customerPhone: '01012345678', shippingAddress: 'x', currency: 'EGP',
      status: 'delivered', subtotal: 500, shippingFee: 0, totalAmount: 500, statusEvents: { create: [{ status: 'delivered', createdAt: new Date(at(1).getTime() - 3 * 86_400_000) }] },
    } });
    // A 40 EGP refund paid in the month.
    const withRefund = await delivered({ total: 130, fee: 30, day: 14 });
    const claim = await prisma.orderResolution.create({ data: { orderId: withRefund.id, type: 'return', status: 'resolved', actorId: 'seed', reasonCode: 'DAMAGED_OR_LEAKING',
      items: { create: [{ orderItemId: withRefund.items[0].id, quantity: 1 }] } } });
    await prisma.refundTransaction.create({ data: { resolutionId: claim.id, orderId: withRefund.id, amount: 40, currency: 'EGP', status: 'succeeded', providerRef: 'PAY-1', updatedAt: at(15) } });
    // A return decided this month: 100 EGP of goods, general problem → hub 50 / ShinaCare 50.
    await prisma.orderResolution.update({ where: { id: claim.id }, data: { resolutionDetails: { responsibility: {
      party: 'GENERAL', shares: { supplier: 0, hub: 50, shinacare: 50 }, disposition: 'WRITE_OFF', note: null, decidedBy: 'seed', decidedAt: at(16).toISOString() } } } });
    // A sealed return that goes back to the supplier: no loss.
    const sealed = await prisma.orderResolution.create({ data: { orderId: withRefund.id, type: 'return', status: 'resolved', actorId: 'seed',
      resolutionDetails: { responsibility: { party: 'NONE', shares: null, disposition: 'RETURN_TO_SUPPLIER', note: null, decidedBy: 'seed', decidedAt: at(17).toISOString() } },
      items: { create: [{ orderItemId: withRefund.items[0].id, quantity: 1 }] } } });
    expect(sealed.id).toBeDefined();

    const body = (await statement().expect(200)).body;
    expect(body).toMatchObject({
      ordersDelivered: 3,
      goodsDelivered: 400,   // 200 + 100 + 100
      refundsPaid: 40,
      netSales: 360,
      delivery: { hubEntitlement: 110, paidByCustomers: 90, absorbedByShinaCare: 20 }, // 50 + 30 + 30 owed; 30 × 3 paid
      returnLosses: { returns: 2, total: 100, writtenOff: 1, returnedToSupplier: 1, bySupplier: 0, byHub: 50, byShinaCare: 50 },
      commission: { percent: 10, amount: 36 },
      shinaCareNet: -34,     // 36 − 20 absorbed delivery − 50 return loss share: ShinaCare owes the hub
    });
  });
});

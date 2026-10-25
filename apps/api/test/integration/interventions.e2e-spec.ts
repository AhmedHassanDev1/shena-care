import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { PurchaseOrderService } from '../../src/modules/sourcing/services/purchase-order.service';
import { cairoDate, cairoWallTime } from '../../src/modules/sourcing/services/supplier-schedule';
import { OrderingService } from '../../src/modules/ordering/services/ordering.service';
import { FulfillmentService } from '../../src/modules/fulfillment/services/fulfillment.service';
import { createActor } from '../fixtures/actors';
import request from 'supertest';

/** What waits on the owner (decisions 2026-10-25): silent suppliers, late orders, overdue failed deliveries, cash differences. */
describe('Admin intervention list (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: { auth: Record<string, string> };
  const http = () => request(app.getHttpServer());
  const minutes = (n: number) => new Date(Date.now() - n * 60_000);

  const supplierWith = (closedWeekdays: number[]) => prisma.supplier.create({ data: { name: 'Int Sup ' + randomUUID(), slug: 'int-' + randomUUID(), closedWeekdays } });
  const purchaseOrder = async (supplierId: string, issuedAt: Date, extra: Record<string, unknown> = {}) => (await prisma.supplierPurchaseOrder.create({ data: {
    supplierId, status: 'sent', issuedAt, ...extra,
    lines: { create: [{ skuId: randomUUID(), requestedQuantity: 2, unitCost: 50, currency: 'EGP', status: 'pending' }, { skuId: randomUUID(), requestedQuantity: 3, unitCost: 10, currency: 'EGP', status: 'pending' }] },
  } })).id;
  const order = async (data: Record<string, unknown> = {}) => (await prisma.order.create({ data: {
    orderNumber: 'ORD-' + randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase(), customerName: 'Int Customer', customerPhone: '01012345678',
    shippingAddress: '1 Int St', currency: 'EGP', status: 'placed', subtotal: 100, shippingFee: 30, totalAmount: 130, codAmount: 130, ...data,
  } })).id;

  beforeAll(async () => {
    process.env.TEST_BYPASS_AUTH = 'false';
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    admin = await createActor(prisma, Role.ADMIN);
  });
  afterAll(async () => { await app.close(); });

  it('flags purchase orders the supplier has not opened (30 min) or answered (2 h), with supplier and cost', async () => {
    const open = await supplierWith([]);
    const notOpened = await purchaseOrder(open.id, minutes(40));
    const silent = await purchaseOrder(open.id, minutes(180));
    const fresh = await purchaseOrder(open.id, minutes(10));
    const openedButSilent = await purchaseOrder(open.id, minutes(150), { openedAt: minutes(100) });
    const openedRecently = await purchaseOrder(open.id, minutes(60), { openedAt: minutes(20) });
    const { unopened, unanswered } = await app.get(PurchaseOrderService).listOverdueResponses();
    const ids = (rows: Array<{ purchaseOrderId: string }>) => rows.map(r => r.purchaseOrderId);
    expect(ids(unopened)).toContain(notOpened);
    expect(ids(unanswered)).toEqual(expect.arrayContaining([silent, openedButSilent]));
    for (const quiet of [fresh, openedRecently]) {
      expect([...ids(unopened), ...ids(unanswered)]).not.toContain(quiet);
    }
    expect(ids(unopened)).not.toContain(silent); // listed once, under the stronger alert
    expect(unopened.find(r => r.purchaseOrderId === notOpened)).toMatchObject({
      supplierName: open.name, lineCount: 2, totalCost: 130, currency: 'EGP', opened: false,
    });
    expect(unanswered.find(r => r.purchaseOrderId === openedButSilent)).toMatchObject({ opened: true });
  });

  it('starts the supplier clock at its next opening, so a Friday or night PO is not "late" yet', async () => {
    const tomorrowWeekday = (new Date(cairoDate(new Date()) + 'T00:00:00Z').getUTCDay() + 1) % 7;
    const closedUntilTomorrow = await supplierWith([0, 1, 2, 3, 4, 5, 6].filter(day => day !== tomorrowWeekday));
    const waiting = await purchaseOrder(closedUntilTomorrow.id, minutes(500));
    const { unopened, unanswered } = await app.get(PurchaseOrderService).listOverdueResponses();
    expect([...unopened, ...unanswered].map(r => r.purchaseOrderId)).not.toContain(waiting);
    // A day later the supplier has had the PO in front of it for hours.
    const later = new Date(Date.now() + 48 * 3_600_000);
    expect((await app.get(PurchaseOrderService).listOverdueResponses(later)).unanswered.map(r => r.purchaseOrderId)).toContain(waiting);
  });

  it('lists orders past their promised day (and today\'s after noon) that have not left the hub', async () => {
    const today = cairoDate(new Date());
    const day = (offset: number) => new Date(new Date(today + 'T00:00:00Z').getTime() + offset * 86_400_000);
    const yesterday = await order({ promisedDate: day(-1) });
    const dueToday = await order({ promisedDate: day(0) });
    const tomorrow = await order({ promisedDate: day(1) });
    const shipped = await order({ promisedDate: day(-2), status: 'shipped' });
    const ordering = app.get(OrderingService);
    const ids = async (now: Date) => (await ordering.listLateOrders({ take: 500, skip: 0 }, now)).items.map(o => o.orderId);

    const morning = await ids(new Date(cairoWallTime(today, 9 * 60)));
    expect(morning).toContain(yesterday);
    expect(morning).not.toContain(dueToday);
    const afternoon = await ids(new Date(cairoWallTime(today, 13 * 60)));
    expect(afternoon).toEqual(expect.arrayContaining([yesterday, dueToday]));
    for (const notLate of [tomorrow, shipped]) expect(afternoon).not.toContain(notLate);
    const late = (await ordering.listLateOrders({ take: 500, skip: 0 }, new Date(cairoWallTime(today, 13 * 60)))).items.find(o => o.orderId === yesterday);
    expect(late).toMatchObject({ daysLate: 1, status: 'placed' });
  });

  it('marks a failed delivery as due for return after 24 hours without an answer', async () => {
    const location = await prisma.fulfillmentLocation.create({ data: { name: 'Int Hub ' + randomUUID(), address: '1 Hub St' } });
    const failed = async (hoursAgo: number) => {
      const orderId = await order({ status: 'shipped' });
      const shipment = await prisma.shipment.create({ data: { orderId, locationId: location.id, status: 'failed' } });
      await prisma.shipmentEvent.create({ data: { shipmentId: shipment.id, type: 'FAILED', reasonCode: 'CUSTOMER_UNAVAILABLE', createdAt: new Date(Date.now() - hoursAgo * 3_600_000) } });
      return shipment.id;
    };
    const old = await failed(30); const recent = await failed(2);
    const items = (await app.get(FulfillmentService).listFailedDeliveries({ take: 500, skip: 0 })).items;
    expect(items.find(i => i.shipmentId === old)).toMatchObject({ returnDue: true });
    expect(items.find(i => i.shipmentId === recent)).toMatchObject({ returnDue: false });
  });

  it('serves everything in one admin read, with large cash differences marked and listed first', async () => {
    const cash = async (expected: number, counted: number, status: 'short' | 'over') => {
      const orderId = await order({ status: 'delivered' });
      await prisma.paymentCollection.create({ data: { orderId, expectedAmount: expected, collectedAmount: counted, currency: 'EGP', status } });
      return orderId;
    };
    const small = await cash(130, 125, 'short');
    const large = await cash(130, 80, 'short');
    await http().get('/operations/queues/attention').expect(401);
    const body = (await http().get('/operations/queues/attention').query({ take: 100 }).set(admin.auth).expect(200)).body;
    expect(body).toEqual(expect.objectContaining({ supplierResponses: expect.any(Object), lateOrders: expect.any(Object), failedDeliveries: expect.any(Object) }));
    const rows = body.cashVariances.short.items as Array<{ orderId: string; severity: string }>;
    expect(rows.find(r => r.orderId === small)?.severity).toBe('small');
    expect(rows.find(r => r.orderId === large)?.severity).toBe('large');
    expect(rows.findIndex(r => r.orderId === large)).toBeLessThan(rows.findIndex(r => r.orderId === small));
  });
});

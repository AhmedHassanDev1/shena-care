import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { DomainEventsService } from '../../src/platform/events/domain-events.service';
import { AiClient } from '../../src/platform/ai';
import { DeterministicAiClient } from '../fixtures/deterministic-ai';
import { createActor, Actor } from '../fixtures/actors';
import { createSellableSku } from '../fixtures/sellable-sku';
import { placeGuestOrder } from '../fixtures/checkout';

/**
 * C0 Business Workspace reads: session scope, founder order console, supplier-safe PO labels, picking
 * state and driver history — each authorised by role and object ownership, never by the UI.
 */
describe('C0 Business Workspace reads', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let events: DomainEventsService;
  const http = () => request(app.getHttpServer());
  let admin: Actor; let hub: Actor; let hubB: Actor; let supplier: Actor; let otherSupplier: Actor; let driver: Actor; let customer: Actor;
  let hubId: string;
  let sku: Awaited<ReturnType<typeof createSellableSku>>;

  const settle = async (aggregateId: string) => {
    for (let i = 0; i < 100; i++) {
      await events.dispatchPending({ aggregateId });
      if (!await prisma.domainEvent.count({ where: { aggregateId, status: { not: 'delivered' } } })) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AiClient).useValue(new DeterministicAiClient()).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useLogger(false);
    await app.init();
    prisma = app.get(PrismaService);
    events = app.get(DomainEventsService);
    sku = await createSellableSku(prisma);
    const other = await createSellableSku(prisma);
    admin = await createActor(prisma, 'ADMIN');
    hub = await createActor(prisma, 'HUB_OPERATOR');
    hubB = await createActor(prisma, 'HUB_OPERATOR');
    supplier = await createActor(prisma, 'SUPPLIER', sku.supplierId);
    otherSupplier = await createActor(prisma, 'SUPPLIER', other.supplierId);
    driver = await createActor(prisma, 'DRIVER');
    customer = await createActor(prisma, 'CUSTOMER');
    hubId = (await prisma.fulfillmentLocation.create({ data: { name: 'C0 Hub ' + randomUUID(), address: 'Maadi' } })).id;
    await prisma.fulfillmentLocationOperator.create({ data: { locationId: hubId, operatorId: hub.id } });
  });
  afterAll(async () => { if (app) await app.close(); });

  it('workspace/me returns roles with supplier and hub scope only for the signed-in account', async () => {
    const me = (await http().get('/workspace/me').set(hub.auth).expect(200)).body;
    expect(me).toMatchObject({ id: hub.id, roles: ['HUB_OPERATOR'], supplierId: null });
    expect(me.hubLocations.map((h: { id: string }) => h.id)).toEqual([hubId]);
    expect((await http().get('/workspace/me').set(hubB.auth).expect(200)).body.hubLocations).toEqual([]);
    expect((await http().get('/workspace/me').set(supplier.auth).expect(200)).body).toMatchObject({ supplierId: sku.supplierId, hubLocations: [] });
    await http().get('/workspace/me').expect(401);
  });

  it('driver directory is for planners only and exposes id and name, nothing else', async () => {
    const list = (await http().get('/workspace/drivers').set(hub.auth).expect(200)).body as Array<Record<string, unknown>>;
    const mine = list.find(d => d.id === driver.id)!;
    expect(Object.keys(mine).sort()).toEqual(['id', 'name']);
    for (const actor of [supplier, driver, customer]) await http().get('/workspace/drivers').set(actor.auth).expect(403);
  });

  it('founder order console: list, detail by id or order number, and admin-only', async () => {
    const order = await placeGuestOrder(app.getHttpServer(), [{ skuId: sku.id, quantity: 2 }], { customerName: 'Console Customer ' + randomUUID().slice(0, 6) });
    await settle(order.id);
    const list = (await http().get(`/admin/orders?q=${order.orderNumber}`).set(admin.auth).expect(200)).body;
    expect(list.items).toEqual([expect.objectContaining({ id: order.id, status: 'placed', hasPin: true, itemCount: 2 })]);
    const byNumber = (await http().get(`/admin/orders/${order.orderNumber}`).set(admin.auth).expect(200)).body;
    const byId = (await http().get(`/admin/orders/${order.id}`).set(admin.auth).expect(200)).body;
    expect(byNumber.order.id).toBe(order.id);
    expect(byId.order.items[0].sku).toMatchObject({ skuCode: sku.code });
    expect(byId.supplyPlan).toMatchObject({ status: expect.any(String) });
    expect(byId.events.map((e: { eventType: string }) => e.eventType)).toContain('order.placed');
    await http().get('/admin/orders/ORD-DOES-NOT-EXIST').set(admin.auth).expect(404);
    for (const actor of [hub, supplier, driver, customer]) {
      await http().get('/admin/orders').set(actor.auth).expect(403);
      await http().get(`/admin/orders/${order.id}`).set(actor.auth).expect(403);
    }

    // Aggregated PO: catalog labels for people, but the supplier view still carries no customer lineage.
    const flushed = (await http().post('/purchase-orders/batches').set(admin.auth).send({ supplierId: sku.supplierId }).expect(201)).body;
    const poId = flushed.purchaseOrders[0].id;
    const seen = (await http().get(`/purchase-orders/${poId}`).set(supplier.auth).expect(200)).body;
    expect(seen.lines[0].sku).toMatchObject({ skuCode: sku.code, productName: expect.any(String) });
    expect(seen.lines[0]).not.toHaveProperty('allocations');
    expect(JSON.stringify(seen)).not.toMatch(/Console Customer|01012345678|Road 9|orderId/);
    await http().get(`/purchase-orders/${poId}`).set(otherSupplier.auth).expect(403);
    const staff = (await http().get(`/purchase-orders/${poId}`).set(admin.auth).expect(200)).body;
    expect(staff.lines[0].allocations[0]).toMatchObject({ orderId: order.id });
    const detail = (await http().get(`/admin/orders/${order.id}`).set(admin.auth).expect(200)).body;
    expect(detail.purchaseOrderLines).toEqual([expect.objectContaining({ purchaseOrderId: poId, quantity: 2, lineStatus: 'pending' })]);
  });

  it('payables ledger is admin only', async () => {
    await http().get('/sourcing/payables').set(admin.auth).expect(200);
    for (const actor of [hub, supplier, driver]) await http().get('/sourcing/payables').set(actor.auth).expect(403);
  });

  it('driver history is the driver\'s own and empty for a new driver; staff cannot call it', async () => {
    expect((await http().get('/fulfillment/driver/history').set(driver.auth).expect(200)).body).toEqual({ total: 0, items: [] });
    await http().get('/fulfillment/driver/history').set(hub.auth).expect(403);
  });

  it('run detail is visible to its hub, its driver and admin only', async () => {
    const run = (await http().post('/fulfillment/delivery-batches').set(hub.auth).send({ hubId, name: 'C0 run', driverId: driver.id }).expect(201)).body;
    expect((await http().get(`/fulfillment/delivery-batches/${run.id}`).set(hub.auth).expect(200)).body).toMatchObject({ id: run.id, driverId: driver.id, stops: [] });
    await http().get(`/fulfillment/delivery-batches/${run.id}`).set(driver.auth).expect(200);
    await http().get(`/fulfillment/delivery-batches/${run.id}`).set(admin.auth).expect(200);
    const otherDriver = await createActor(prisma, 'DRIVER');
    await http().get(`/fulfillment/delivery-batches/${run.id}`).set(hubB.auth).expect(404);
    await http().get(`/fulfillment/delivery-batches/${run.id}`).set(otherDriver.auth).expect(404);
    await http().get(`/fulfillment/delivery-batches/${run.id}`).set(supplier.auth).expect(403);
  });

  it('picking state is hub-scoped', async () => {
    await http().get(`/fulfillment/shipments/${randomUUID()}/preparation`).set(hub.auth).expect(404);
    await http().get(`/fulfillment/shipments/${randomUUID()}/preparation`).set(driver.auth).expect(403);
  });

  it('operations dashboard KPIs: aggregates pipeline, Cairo hourly inflow, and enforces server-side financial RBAC', async () => {
    // 1. Admin gets 200, operational stats + financial amounts (numbers)
    const adminRes = await http().get('/operations/dashboard/kpis').set(admin.auth).expect(200);
    expect(adminRes.body).toMatchObject({
      ordersToday: expect.any(Number),
      totalOrders: expect.any(Number),
      activeFulfillment: expect.any(Number),
      activeOrders: expect.any(Number),
      pipeline: {
        placed: expect.any(Number),
        confirmed: expect.any(Number),
        packing: expect.any(Number),
        shipped: expect.any(Number),
        delivered: expect.any(Number),
        terminal: expect.any(Number),
        total: expect.any(Number),
      },
      hourlyInflow: expect.arrayContaining([
        expect.objectContaining({
          hour: expect.any(Number),
          label: expect.any(String),
          count: expect.any(Number),
        }),
      ]),
      attentionCenter: {
        openSupportCases: expect.any(Number),
        unconfirmedPOs: expect.any(Number),
        pendingIngestions: expect.any(Number),
      },
    });
    expect(adminRes.body.hourlyInflow).toHaveLength(24);
    expect(typeof adminRes.body.revenueToday).toBe('number');
    expect(typeof adminRes.body.totalRevenue).toBe('number');
    expect(typeof adminRes.body.averageOrderValue).toBe('number');

    // 2. Hub operator gets 200, operational stats, BUT financial fields are strictly null server-side
    const hubRes = await http().get('/operations/dashboard/kpis').set(hub.auth).expect(200);
    expect(hubRes.body).toMatchObject({
      ordersToday: expect.any(Number),
      totalOrders: expect.any(Number),
      activeFulfillment: expect.any(Number),
      activeOrders: expect.any(Number),
      pipeline: expect.any(Object),
      hourlyInflow: expect.any(Array),
      attentionCenter: expect.any(Object),
      revenueToday: null,
      totalRevenue: null,
      averageOrderValue: null,
    });
    expect(hubRes.body.revenueToday).toBeNull();
    expect(hubRes.body.totalRevenue).toBeNull();
    expect(hubRes.body.averageOrderValue).toBeNull();

    // 3. Driver, supplier, customer are forbidden (403)
    for (const actor of [driver, supplier, customer]) {
      await http().get('/operations/dashboard/kpis').set(actor.auth).expect(403);
    }

    // 4. Unauthenticated is unauthorized (401)
    await http().get('/operations/dashboard/kpis').expect(401);
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any -- HTTP response bodies are asserted structurally */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { createActor, Actor } from '../fixtures/actors';
import { createSellableSku } from '../fixtures/sellable-sku';
import { attachPurchaseOrderLineage } from '../fixtures/purchase-order-lineage';

/**
 * Admin Finance (الماليات): every figure is derived from stored records. The period is a day far from any other suite's data, so the
 * assertions are exact. A delivered order carries 2 x 1,000 EGP of goods and a 30 EGP delivery fee; product cost comes from captured
 * invoice lots (purchase-order mode), delivery and packaging from the order's own cost record. The result is the distributable profit:
 * net sales + shipping revenue - product cost - delivery - packaging - confirmed damages - APPROVED direct costs. Platform expenses are listed
 * but never deducted from the shared profit.
 */
describe('Admin finance (e2e)', () => {
  const DAY = '2031-03-15';
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Actor;
  let hub: Actor;
  let customer: Actor;
  let supplierId: string;
  const cleanups: Array<() => Promise<void>> = [];
  const lotIds: string[] = [];
  const expenseIds: string[] = [];
  const api = () => request(app.getHttpServer());
  const query = `from=${DAY}&to=${DAY}`;

  /** A delivered COD order (2 x 1,000 + 30 fee) whose goods came through a purchase order line; cost is captured only on request. */
  async function deliveredOrder(unitCost?: number) {
    const sku = await createSellableSku(prisma);
    const po = await prisma.supplierPurchaseOrder.create({
      data: { supplierId, status: 'received_at_hub', lines: { create: [{ skuId: sku.id, requestedQuantity: 2, confirmedQuantity: 2 }] } },
      include: { lines: true },
    });
    cleanups.push(await attachPurchaseOrderLineage(prisma, po.id));
    const line = po.lines[0];
    const link = await prisma.purchaseOrderLineAllocation.findFirstOrThrow({ where: { purchaseOrderLineId: line.id } });
    await prisma.purchaseOrderLineAllocation.update({ where: { id: link.id }, data: { receivedQuantity: 2 } });
    const order = await prisma.order.update({ where: { id: link.orderId }, data: { status: 'delivered' } });
    await prisma.orderStatusEvent.create({ data: { orderId: order.id, status: 'delivered', createdAt: new Date(`${DAY}T10:00:00Z`) } });
    const batch = await prisma.courierSettlementBatch.create({
      data: { reference: `FIN-${randomUUID()}`, courierId: randomUUID(), totalExpected: 2030, totalCollected: 2030, fees: 10, netSettled: 2020, currency: 'EGP', actorId: admin.id, settledAt: new Date(`${DAY}T15:00:00Z`) },
    });
    await prisma.paymentCollection.create({
      data: { orderId: order.id, expectedAmount: 2030, collectedAmount: 2030, currency: 'EGP', status: 'settled', settlementBatchId: batch.id },
    });
    cleanups.push(async () => {
      await prisma.paymentCollection.deleteMany({ where: { orderId: order.id } });
      await prisma.courierSettlementBatch.delete({ where: { id: batch.id } });
      await prisma.orderStatusEvent.deleteMany({ where: { orderId: order.id } });
    });
    const addCost = async (cost: number) => {
      const lot = await prisma.acquisitionCostLot.create({
        data: {
          purchaseOrderId: po.id, purchaseOrderLineId: line.id, supplierId, skuId: sku.id, invoiceRef: `INV-${randomUUID().slice(0, 8)}`,
          quantity: 2, unitCost: cost, idempotencyKey: randomUUID(), capturedBy: admin.id, capturedAt: new Date(`${DAY}T11:00:00Z`),
        },
      });
      lotIds.push(lot.id);
    };
    const recordCosts = async (courierCost: number, packagingCost: number) => {
      await prisma.orderCostRecord.create({ data: { orderId: order.id, courierCost, courierRecordedBy: 'test', courierRecordedAt: new Date(), packagingType: 'BAG', packagingCost, packagingRecordedBy: 'test', packagingRecordedAt: new Date() } });
      cleanups.push(async () => { await prisma.orderCostRecord.deleteMany({ where: { orderId: order.id } }); });
    };
    if (unitCost !== undefined) await addCost(unitCost);
    return { order, addCost, recordCosts };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    admin = await createActor(prisma, 'ADMIN');
    hub = await createActor(prisma, 'HUB_OPERATOR');
    customer = await createActor(prisma, 'CUSTOMER');
    supplierId = (await prisma.supplier.create({ data: { name: `Finance ${randomUUID()}`, slug: `finance-${randomUUID()}` } })).id;
  }, 120000);

  afterAll(async () => {
    await prisma.financeExpense.deleteMany({ where: { id: { in: expenseIds } } });
    await prisma.acquisitionCostLot.deleteMany({ where: { id: { in: lotIds } } });
    for (const cleanup of cleanups.reverse()) await cleanup().catch(() => undefined);
    await app.close();
  });

  it('is Admin-only: signed-out, customers and hub operators are refused for reads and writes alike', async () => {
    for (const path of ['summary', 'series', 'orders', 'transactions', 'expenses']) {
      await api().get(`/operations/finance/${path}?${query}`).expect(401);
      await api().get(`/operations/finance/${path}?${query}`).set(customer.auth).expect(403);
      await api().get(`/operations/finance/${path}?${query}`).set(hub.auth).expect(403);
    }
    const body = { category: 'RENT', description: 'Warehouse rent', amount: 500, incurredOn: DAY };
    await api().post('/operations/finance/expenses').set(hub.auth).send(body).expect(403);
    await api().post('/operations/finance/expenses').set(customer.auth).send(body).expect(403);
  });

  it('rejects an impossible, reversed or oversized date range', async () => {
    await api().get('/operations/finance/summary?from=2031-02-30&to=2031-03-01').set(admin.auth).expect(400);
    await api().get('/operations/finance/summary?from=2031-03-16&to=2031-03-15').set(admin.auth).expect(400);
    await api().get('/operations/finance/summary?from=2029-01-01&to=2031-03-15').set(admin.auth).expect(400);
  });

  it('an empty period reports zeros and no profit, instead of inventing one', async () => {
    const { body } = await api().get('/operations/finance/summary?from=2031-03-01&to=2031-03-01').set(admin.auth).expect(200);
    expect(body.sales).toMatchObject({ deliveredOrders: 0, netSales: 0, billedTotal: 0, averageOrderValue: null });
    expect(body.revenue).toMatchObject({ netSales: 0, shippingRevenue: 0, total: 0 });
    expect(body.costs).toMatchObject({ products: 0, delivery: 0, packaging: 0, damages: 0, directCosts: 0 });
    expect(body.operatingResult).toMatchObject({ value: 0, status: 'RECORDED', missing: [] });
  });

  it('reports sales, cash and cost from records, and does not call incomplete costs a profit', async () => {
    const costed = await deliveredOrder(600);
    const pending = await deliveredOrder();
    const { body } = await api().get(`/operations/finance/summary?${query}`).set(admin.auth).expect(200);

    expect(body.sales).toMatchObject({ deliveredOrders: 2, netSales: 4000, shippingRevenue: 60, billedTotal: 4060, averageOrderValue: 2030 });
    expect(body.revenue).toMatchObject({ grossSales: 4000, discounts: 0, netSales: 4000, shippingRevenueNet: 60, total: 4060 });
    // Cash the hub counted that day is reported at settlement level, with the declared amount and variance kept apart.
    expect(body.cash.settlements).toMatchObject({ count: 2, counted: 4060, declared: 4060, variance: 0, fees: 20 });
    expect(body.supplierCosts).toMatchObject({ invoicedInPeriod: 1200, invoiceLines: 1, invoices: 1 });
    // Only the order whose invoice cost is captured carries a product cost; nothing is called a profit while any cost is still unknown.
    expect(body.costs).toMatchObject({ products: 1200, delivery: 0, packaging: 0 });
    expect(body.missing).toEqual(expect.arrayContaining([{ code: 'PURCHASE_COST', orders: 1 }, { code: 'COURIER_COST', orders: 2 }, { code: 'PACKAGING_COST', orders: 2 }]));
    expect(body.grossProfit).toBeNull();
    expect(body.distributableProfit).toBeNull();
    expect(body.operatingResult).toMatchObject({ value: null, status: 'INCOMPLETE' });
    expect(body.operatingResult.missing).toEqual(expect.arrayContaining(['PURCHASE_COST', 'COURIER_COST', 'PACKAGING_COST']));

    const orders = (await api().get(`/operations/finance/orders?${query}`).set(admin.auth).expect(200)).body;
    expect(orders.total).toBe(2);
    const byId = new Map<string, any>(orders.items.map((item: any) => [item.orderId, item]));
    expect(byId.get(costed.order.id)).toMatchObject({ goods: 2000, discounts: 0, deliveryFee: 30, total: 2030, cod: { status: 'settled', collected: 2030, settled: true } });

    // Once every cost is recorded the period is complete and a recorded result appears: goods + fee - product cost - delivery - packaging.
    await pending.addCost(700);
    await costed.recordCosts(80, 10);
    await pending.recordCosts(80, 10);
    const complete = (await api().get(`/operations/finance/summary?${query}`).set(admin.auth).expect(200)).body;
    expect(complete.costs).toMatchObject({ products: 2600, delivery: 160, packaging: 20, total: 2780 });
    expect(complete.delivery).toMatchObject({ revenue: 60, cost: 160, margin: -100, estimatedOrders: 0 });
    expect(complete.grossProfit).toBe(1400);
    expect(complete.distributableProfit).toBe(4000 + 60 - 2600 - 160 - 20);
    expect(complete.operatingResult).toMatchObject({ value: 1280, status: 'RECORDED', missing: [] });
    // Both orders' cash is counted, so the whole result is realised and 40% / 60% is payable now.
    expect(complete.realisedProfit).toBe(1280);
    expect(complete.pendingCollection.orders).toBe(0);
    expect(complete.split).toMatchObject({ platformPercent: 40, platformShare: 512, partnerShare: 768, platformShareNow: 512, partnerShareNow: 768 });
    expect(complete.capital.recovered).toBe(2780);
  });

  it('records expenses, deducts only APPROVED direct costs from the shared profit, and voids instead of deleting', async () => {
    const oneOff = (await api().post('/operations/finance/expenses').set(admin.auth)
      .send({ category: 'MARKETING', description: 'Social ads', amount: 100, incurredOn: DAY }).expect(201)).body;
    const rent = (await api().post('/operations/finance/expenses').set(admin.auth)
      .send({ category: 'RENT', description: 'Warehouse rent', amount: 500, incurredOn: '2031-01-15', recurrence: 'MONTHLY' }).expect(201)).body;
    expenseIds.push(oneOff.id, rent.id);
    expect(oneOff.kind).toBe('PLATFORM');

    // The platform's own expenses are shown, never deducted from the profit shared with the capital partner.
    let summary = (await api().get(`/operations/finance/summary?${query}`).set(admin.auth).expect(200)).body;
    expect(summary.platformExpenses).toBe(600);
    expect(summary.costs.directCosts).toBe(0);
    expect(summary.distributableProfit).toBe(1280);

    // A direct cost is counted only after an Admin approves it; until then the period is incomplete rather than silently wrong.
    const direct = (await api().post('/operations/finance/expenses').set(admin.auth)
      .send({ category: 'SUPPLIES', description: 'Sample kits for the order', amount: 50, incurredOn: DAY, kind: 'DIRECT' }).expect(201)).body;
    expenseIds.push(direct.id);
    summary = (await api().get(`/operations/finance/summary?${query}`).set(admin.auth).expect(200)).body;
    expect(summary.status).toBe('INCOMPLETE');
    expect(summary.missing).toEqual(expect.arrayContaining([{ code: 'DIRECT_COST_APPROVAL', orders: 1 }]));
    expect(summary.distributableProfit).toBeNull();
    await api().post(`/operations/finance/expenses/${direct.id}/approve`).set(hub.auth).expect(403);
    await api().post(`/operations/finance/expenses/${oneOff.id}/approve`).set(admin.auth).expect(400);
    await api().post(`/operations/finance/expenses/${direct.id}/approve`).set(admin.auth).expect(201);
    await api().post(`/operations/finance/expenses/${direct.id}/approve`).set(admin.auth).expect(201);
    summary = (await api().get(`/operations/finance/summary?${query}`).set(admin.auth).expect(200)).body;
    expect(summary.costs.directCosts).toBe(50);
    expect(summary.distributableProfit).toBe(1280 - 50);
    expect(summary.split).toMatchObject({ platformShare: 492, partnerShare: 738 });

    // The monthly rent falls on the 15th: not on the 14th.
    const other = (await api().get('/operations/finance/summary?from=2031-03-14&to=2031-03-14').set(admin.auth).expect(200)).body;
    expect(other.platformExpenses).toBe(0);

    await api().post(`/operations/finance/expenses/${rent.id}/void`).set(admin.auth).send({ reason: 'x' }).expect(400);
    await api().post(`/operations/finance/expenses/${rent.id}/void`).set(admin.auth).send({ reason: 'Lease ended' }).expect(201);
    await api().post(`/operations/finance/expenses/${rent.id}/void`).set(admin.auth).send({ reason: 'Lease ended' }).expect(400);
    summary = (await api().get(`/operations/finance/summary?${query}`).set(admin.auth).expect(200)).body;
    expect(summary.platformExpenses).toBe(100);
    const listed = (await api().get('/operations/finance/expenses?includeVoided=true').set(admin.auth).expect(200)).body;
    expect(listed.find((row: any) => row.id === rent.id)).toMatchObject({ voided: true, voidReason: 'Lease ended' });
    expect((await api().get('/operations/finance/expenses').set(admin.auth).expect(200)).body.some((row: any) => row.id === rent.id)).toBe(false);
  });

  it('validates expense input, and refuses packaging / delivery as a general expense (they are costed per order)', async () => {
    const valid = { category: 'RENT', description: 'Rent', amount: 10, incurredOn: DAY };
    for (const bad of [
      { ...valid, category: 'PAYROLL' }, { ...valid, amount: 0 }, { ...valid, amount: 10.123 }, { ...valid, incurredOn: '2031-02-30' },
      { ...valid, description: 'x' }, { ...valid, endsOn: '2031-04-01' }, { ...valid, recurrence: 'MONTHLY', endsOn: '2031-03-01' }, { ...valid, kind: 'SHARED' },
    ]) {
      await api().post('/operations/finance/expenses').set(admin.auth).send(bad).expect(400);
    }
    for (const category of ['PACKAGING', 'DELIVERY']) {
      const res = await api().post('/operations/finance/expenses').set(admin.auth).send({ ...valid, category }).expect(400);
      expect(res.body.code ?? res.body.message?.code).toBe('DUPLICATES_ORDER_COST');
    }
  });

  it('does not let settings or estimates change the recorded figures', async () => {
    const before = (await api().get(`/operations/finance/summary?${query}`).set(admin.auth).expect(200)).body;
    const keys = ['commerce.delivery.internal_cost', 'commerce.packaging.carton_cost', 'commerce.packaging.label_cost'];
    await api().patch('/operations/settings').set(admin.auth).send({ changes: { [keys[0]]: 25, [keys[1]]: 4, [keys[2]]: 1 } }).expect(200);
    try {
      const after = (await api().get(`/operations/finance/summary?${query}`).set(admin.auth).expect(200)).body;
      expect(after.distributableProfit).toBe(before.distributableProfit);
      expect(after.costs).toEqual(before.costs);
      expect(after.delivery.estimatedOrders).toBe(0);
    } finally {
      for (const key of keys) await api().post(`/operations/settings/${key}/reset`).set(admin.auth).expect(201);
    }
  });

  it('serves chart series and a signed, labelled transaction list for the period', async () => {
    const series = (await api().get(`/operations/finance/series?${query}`).set(admin.auth).expect(200)).body;
    expect(series.granularity).toBe('day');
    expect(series.points).toHaveLength(1);
    // Only the approved DIRECT cost (50) is charted as a cost; platform expenses are not shared costs.
    expect(series.points[0]).toMatchObject({ date: DAY, orders: 2, revenue: 4060, expenses: 50, codSettled: 4060 });

    const weekly = (await api().get('/operations/finance/series?from=2031-01-01&to=2031-03-31').set(admin.auth).expect(200)).body;
    expect(weekly.granularity).toBe('week');
    expect(weekly.points.reduce((sum: number, point: any) => sum + point.orders, 0)).toBe(2);

    const all = (await api().get(`/operations/finance/transactions?${query}`).set(admin.auth).expect(200)).body;
    const types = all.items.map((item: any) => item.type).sort();
    expect(types).toEqual(['COD_SETTLEMENT', 'COD_SETTLEMENT', 'EXPENSE', 'EXPENSE', 'SALE', 'SALE', 'SUPPLIER_INVOICE', 'SUPPLIER_INVOICE']);
    expect(all.items.filter((item: any) => item.type === 'SALE').every((item: any) => item.amount === 2030 && item.basis === 'RECORDED')).toBe(true);
    expect(all.items.filter((item: any) => item.type === 'COD_SETTLEMENT').every((item: any) => item.basis === 'RECONCILED')).toBe(true);
    expect(all.items.filter((item: any) => item.type === 'SUPPLIER_INVOICE').map((item: any) => item.amount).sort((a: number, b: number) => a - b)).toEqual([-1400, -1200]);
    expect(all.items.filter((item: any) => item.type === 'EXPENSE').map((item: any) => item.amount).sort((a: number, b: number) => a - b)).toEqual([-100, -50]);

    const sales = (await api().get(`/operations/finance/transactions?${query}&type=SALE`).set(admin.auth).expect(200)).body;
    expect(sales.items).toHaveLength(2);
    await api().get(`/operations/finance/transactions?${query}&type=BONUS`).set(admin.auth).expect(400);
  });
});

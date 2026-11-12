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
 * assertions are exact. A delivered order carries 2 x 1,000 EGP of goods and a 30 EGP delivery fee; supplier cost comes only from
 * captured invoice lots.
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
    if (unitCost !== undefined) await addCost(unitCost);
    return { order, addCost };
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

  it('an empty period reports zeros and withholds the result instead of inventing one', async () => {
    const { body } = await api().get('/operations/finance/summary?from=2031-03-01&to=2031-03-01').set(admin.auth).expect(200);
    expect(body.sales).toMatchObject({ deliveredOrders: 0, goodsRevenue: 0, billedTotal: 0, averageOrderValue: null });
    expect(body.operatingResult).toMatchObject({ value: null, status: 'INCOMPLETE', missing: ['NO_DELIVERED_ORDERS'] });
    expect(body.profitability).toMatchObject({ costCoveragePercent: null, grossProfitRecorded: null });
  });

  it('reports sales, cash and supplier cost from records, and does not call incomplete costs a profit', async () => {
    const costed = await deliveredOrder(600);
    const pending = await deliveredOrder();
    const { body } = await api().get(`/operations/finance/summary?${query}`).set(admin.auth).expect(200);

    expect(body.sales).toMatchObject({ deliveredOrders: 2, goodsRevenue: 4000, deliveryFeeRevenue: 60, billedTotal: 4060, averageOrderValue: 2030 });
    expect(body.cod).toMatchObject({ orders: 2, expected: 4060, reconciled: 4060, outstanding: 0, variance: 0, reconciledOrders: 2 });
    expect(body.supplierCosts).toMatchObject({ invoicedInPeriod: 1200, invoiceLines: 1, invoices: 1 });
    // Only the order whose invoice cost is captured carries a cost and a profit; the other is reported as pending.
    expect(body.profitability).toMatchObject({
      ordersWithCost: 1, ordersCostPending: 1, costCoveragePercent: 50, revenueOfCostedOrders: 2000,
      supplierCostOfCostedOrders: 1200, grossProfitRecorded: 800, grossMarginPercent: 40,
    });
    expect(body.operatingResult).toMatchObject({ value: null, status: 'INCOMPLETE', missing: ['SUPPLIER_COST_PENDING'] });
    expect(body.costs.courierSettlementFees).toBe(20);

    const orders = (await api().get(`/operations/finance/orders?${query}`).set(admin.auth).expect(200)).body;
    expect(orders.total).toBe(2);
    const byId = new Map<string, any>(orders.items.map((item: any) => [item.orderId, item]));
    expect(byId.get(costed.order.id)).toMatchObject({ goods: 2000, deliveryFee: 30, total: 2030, cod: { status: 'settled', collected: 2030 }, cost: { status: 'CAPTURED', supplierCost: 1200, contribution: 800, marginPercent: 40 } });
    expect(byId.get(pending.order.id).cost).toMatchObject({ status: 'PENDING', supplierCost: null, contribution: null, marginPercent: null });

    // Once the missing invoice cost is captured the period is complete and a recorded result appears.
    await pending.addCost(700);
    const complete = (await api().get(`/operations/finance/summary?${query}`).set(admin.auth).expect(200)).body;
    expect(complete.profitability).toMatchObject({ ordersWithCost: 2, costCoveragePercent: 100, grossProfitRecorded: 1400 });
    expect(complete.operatingResult).toMatchObject({ value: 1400 + 60 - 20, status: 'RECORDED', missing: [] });
  });

  it('records expenses (one-off and recurring), counts them in the period and voids instead of deleting', async () => {
    const oneOff = (await api().post('/operations/finance/expenses').set(admin.auth)
      .send({ category: 'MARKETING', description: 'Social ads', amount: 100, incurredOn: DAY }).expect(201)).body;
    const rent = (await api().post('/operations/finance/expenses').set(admin.auth)
      .send({ category: 'RENT', description: 'Warehouse rent', amount: 500, incurredOn: '2031-01-15', recurrence: 'MONTHLY' }).expect(201)).body;
    expenseIds.push(oneOff.id, rent.id);

    let summary = (await api().get(`/operations/finance/summary?${query}`).set(admin.auth).expect(200)).body;
    expect(summary.costs.operatingExpenses).toBe(600);
    expect(summary.costs.expensesByCategory).toEqual([{ category: 'RENT', total: 500 }, { category: 'MARKETING', total: 100 }]);
    expect(summary.operatingResult.value).toBe(1400 + 60 - 20 - 600);

    // The monthly rent falls on the 15th: not on the 14th.
    const other = (await api().get('/operations/finance/summary?from=2031-03-14&to=2031-03-14').set(admin.auth).expect(200)).body;
    expect(other.costs.operatingExpenses).toBe(0);

    await api().post(`/operations/finance/expenses/${rent.id}/void`).set(admin.auth).send({ reason: 'x' }).expect(400);
    await api().post(`/operations/finance/expenses/${rent.id}/void`).set(admin.auth).send({ reason: 'Lease ended' }).expect(201);
    await api().post(`/operations/finance/expenses/${rent.id}/void`).set(admin.auth).send({ reason: 'Lease ended' }).expect(400);
    summary = (await api().get(`/operations/finance/summary?${query}`).set(admin.auth).expect(200)).body;
    expect(summary.costs.operatingExpenses).toBe(100);
    const listed = (await api().get('/operations/finance/expenses?includeVoided=true').set(admin.auth).expect(200)).body;
    expect(listed.find((row: any) => row.id === rent.id)).toMatchObject({ voided: true, voidReason: 'Lease ended' });
    expect((await api().get('/operations/finance/expenses').set(admin.auth).expect(200)).body.some((row: any) => row.id === rent.id)).toBe(false);
  });

  it('validates expense input', async () => {
    const valid = { category: 'RENT', description: 'Rent', amount: 10, incurredOn: DAY };
    for (const bad of [
      { ...valid, category: 'PAYROLL' }, { ...valid, amount: 0 }, { ...valid, amount: 10.123 }, { ...valid, incurredOn: '2031-02-30' },
      { ...valid, description: 'x' }, { ...valid, endsOn: '2031-04-01' }, { ...valid, recurrence: 'MONTHLY', endsOn: '2031-03-01' },
    ]) {
      await api().post('/operations/finance/expenses').set(admin.auth).send(bad).expect(400);
    }
  });

  it('keeps estimates apart from recorded totals and never nets them into the result', async () => {
    const before = (await api().get(`/operations/finance/summary?${query}`).set(admin.auth).expect(200)).body;
    expect(before.estimates).toMatchObject({ deliveryCost: null, packagingCost: null });
    const keys = ['commerce.delivery.internal_cost', 'commerce.packaging.carton_cost', 'commerce.packaging.label_cost'];
    await api().patch('/operations/settings').set(admin.auth).send({ changes: { [keys[0]]: 25, [keys[1]]: 4, [keys[2]]: 1 } }).expect(200);
    try {
      const after = (await api().get(`/operations/finance/summary?${query}`).set(admin.auth).expect(200)).body;
      expect(after.estimates).toMatchObject({ deliveryCost: 50, packagingCost: 10, perOrder: { delivery: 25, carton: 4, label: 1 } });
      expect(after.operatingResult.value).toBe(before.operatingResult.value);
      expect(after.costs.operatingExpenses).toBe(before.costs.operatingExpenses);
    } finally {
      for (const key of keys) await api().post(`/operations/settings/${key}/reset`).set(admin.auth).expect(201);
    }
  });

  it('serves chart series and a signed, labelled transaction list for the period', async () => {
    const series = (await api().get(`/operations/finance/series?${query}`).set(admin.auth).expect(200)).body;
    expect(series.granularity).toBe('day');
    expect(series.points).toHaveLength(1);
    expect(series.points[0]).toMatchObject({ date: DAY, orders: 2, revenue: 4060, expenses: 100, codSettled: 4060, grossProfit: 1400, costedOrders: 2 });

    const weekly = (await api().get('/operations/finance/series?from=2031-01-01&to=2031-03-31').set(admin.auth).expect(200)).body;
    expect(weekly.granularity).toBe('week');
    expect(weekly.points.reduce((sum: number, point: any) => sum + point.orders, 0)).toBe(2);

    const all = (await api().get(`/operations/finance/transactions?${query}`).set(admin.auth).expect(200)).body;
    const types = all.items.map((item: any) => item.type).sort();
    expect(types).toEqual(['COD_SETTLEMENT', 'COD_SETTLEMENT', 'EXPENSE', 'SALE', 'SALE', 'SUPPLIER_INVOICE', 'SUPPLIER_INVOICE']);
    expect(all.items.filter((item: any) => item.type === 'SALE').every((item: any) => item.amount === 2030 && item.basis === 'RECORDED')).toBe(true);
    expect(all.items.filter((item: any) => item.type === 'COD_SETTLEMENT').every((item: any) => item.basis === 'RECONCILED')).toBe(true);
    expect(all.items.filter((item: any) => item.type === 'SUPPLIER_INVOICE').map((item: any) => item.amount).sort((a: number, b: number) => a - b)).toEqual([-1400, -1200]);
    expect(all.items.find((item: any) => item.type === 'EXPENSE').amount).toBe(-100);

    const sales = (await api().get(`/operations/finance/transactions?${query}&type=SALE`).set(admin.auth).expect(200)).body;
    expect(sales.items).toHaveLength(2);
    await api().get(`/operations/finance/transactions?${query}&type=BONUS`).set(admin.auth).expect(400);
  });
});

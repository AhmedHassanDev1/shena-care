/* eslint-disable @typescript-eslint/no-explicit-any -- HTTP response bodies are asserted structurally */
// Flat 35 EGP customer delivery fee, no tiers, never free: the audit's reference numbers.
process.env.DELIVERY_FEE_POLICY = JSON.stringify({ bands: [{ maxKm: null, fee: 35 }], discountTiers: [], freeFrom: 100000 });
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { Role } from '@prisma/client';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { DomainEventsService } from '../../src/platform/events/domain-events.service';
import { setRuntimeSetting, SETTING_KEYS } from '../../src/platform/settings/runtime-settings';
import { signShipmentBarcode } from '../../src/modules/fulfillment/services/shipment-label';
import { cairoYmd } from '../../src/application/composition/services/finance-dates';
import { createActor, Actor } from '../fixtures/actors';
import { signInCustomer } from '../fixtures/checkout';
import { createSellableSku } from '../fixtures/sellable-sku';

/**
 * FINANCIAL AUDIT SCENARIOS. Real HTTP, real database (disposable `*_test`), the MVP's INTERNAL_BUY_LIST sourcing, from checkout to
 * Admin report. Reference numbers: goods 1,000, customer discount 100, purchase cost 700 (list 80 − supplier discount 10, 10 units),
 * customer delivery fee 35, actual delivery cost 25, packaging 10. The "ideal" figure of every row is worked out by hand first
 * (comments) from the APPROVED profit model:
 *   distributable profit = net sales + shipping revenue − actual product cost − delivery − packaging − confirmed damages − approved direct costs;
 * the "actual" one is what the three Admin sources return (Finance profit page, Finance summary, Overview). Rows are written to a ledger
 * (FIN_LEDGER_PATH or the temp dir) that feeds docs/qa/financial-scenarios.md. A mismatch is NOT hidden: it is recorded as FAIL.
 * The first run of this suite (before the closure fixes) is kept in the report as the "before" column. Reports are compared as deltas, so
 * other data in the database never matters.
 */
type Row = { id: string; scenario: string; metric: string; ideal: number | string | null; actual: number | string | null; verdict: 'PASS' | 'FAIL' | 'INFO'; note?: string };
const ledger: Row[] = [];
const r2 = (value: unknown) => (value === null || value === undefined ? null : Math.round(Number(value) * 100) / 100);
const log = (id: string, scenario: string, metric: string, ideal: number | string | null, actual: unknown, note?: string) => {
  const a = r2(actual);
  ledger.push({ id, scenario, metric, ideal, actual: a, verdict: ideal === null ? 'INFO' : ideal === a ? 'PASS' : 'FAIL', note });
  return a;
};

describe('Financial audit scenarios (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let events: DomainEventsService;
  let admin: Actor; let hub: Actor; let driver: Actor;
  let locationId: string;
  const previousMode = process.env.SOURCING_MODE;
  const http = () => request(app.getHttpServer());
  const today = cairoYmd(new Date());
  const month = today.slice(0, 7);

  const snap = async () => {
    const profit = (await http().get(`/operations/finance/profit?month=${month}`).set(admin.auth).expect(200)).body;
    const summary = (await http().get(`/operations/finance/summary?from=${today}&to=${today}`).set(admin.auth).expect(200)).body;
    const overview = (await http().get('/operations/dashboard/overview?days=1').set(admin.auth).expect(200)).body;
    return { profit, summary, overview };
  };
  const num = (value: unknown) => Number(value ?? 0);
  /** after − before for every figure the reports expose, so leftovers in the database never matter. Net figures come from the components. */
  const delta = (a: any, b: any) => {
    const net = (x: any) => num(x.profit.revenue.total) - num(x.profit.costs.total);
    const gross = (x: any) => num(x.summary.revenue.netSalesAfterRefunds) - num(x.summary.costs.products);
    return {
      p: {
        sales: r2(num(b.profit.revenue.netSales) - num(a.profit.revenue.netSales)), shipping: r2(num(b.profit.revenue.shippingRevenueNet) - num(a.profit.revenue.shippingRevenueNet)),
        refunds: r2(num(b.profit.revenue.productRefunds) - num(a.profit.revenue.productRefunds)),
        purchase: r2(num(b.profit.costs.products) - num(a.profit.costs.products)), delivery: r2(num(b.profit.costs.delivery) - num(a.profit.costs.delivery)),
        packaging: r2(num(b.profit.costs.packaging) - num(a.profit.costs.packaging)), damages: r2(num(b.profit.costs.damages) - num(a.profit.costs.damages)),
        net: r2(net(b) - net(a)),
        deliveryMargin: r2(num(b.profit.delivery.margin) - num(a.profit.delivery.margin)),
        estimatedOrders: num(b.profit.delivery.estimatedOrders) - num(a.profit.delivery.estimatedOrders), estimatedAmount: r2(num(b.profit.delivery.estimatedAmount) - num(a.profit.delivery.estimatedAmount)),
        recoverable: r2(num(b.profit.capital.tiedUpInRecoverableGoods) - num(a.profit.capital.tiedUpInRecoverableGoods)),
        tiedUp: r2(num(b.profit.capital.tiedUpInUnsettledOrders) - num(a.profit.capital.tiedUpInUnsettledOrders)),
        pending: num(b.profit.pendingCollection.orders) - num(a.profit.pendingCollection.orders),
        eligible: b.profit.eligibleOrders - a.profit.eligibleOrders,
      },
      s: {
        orders: b.summary.sales.deliveredOrders - a.summary.sales.deliveredOrders, goods: r2(num(b.summary.sales.netSales) - num(a.summary.sales.netSales)),
        discounts: r2(num(b.summary.sales.discounts) - num(a.summary.sales.discounts)), fees: r2(num(b.summary.sales.shippingRevenue) - num(a.summary.sales.shippingRevenue)),
        billed: r2(num(b.summary.sales.billedTotal) - num(a.summary.sales.billedTotal)), refunds: r2(num(b.summary.sales.productRefunds) - num(a.summary.sales.productRefunds)),
        grossProfit: r2(gross(b) - gross(a)),
        counted: r2(num(b.summary.cash.settlements.counted) - num(a.summary.cash.settlements.counted)), declared: r2(num(b.summary.cash.settlements.declared) - num(a.summary.cash.settlements.declared)),
        variance: r2(num(b.summary.cash.settlements.variance) - num(a.summary.cash.settlements.variance)),
        custody: r2(num(b.summary.cash.inCourierCustody.amount) - num(a.summary.cash.inCourierCustody.amount)),
        onRoad: r2(num(b.summary.cash.expectedOnRoad.amount) - num(a.summary.cash.expectedOnRoad.amount)),
      },
      c: {
        counted: r2(num(b.profit.cash.settlements.counted) - num(a.profit.cash.settlements.counted)),
        custody: r2(num(b.profit.cash.inCourierCustody.amount) - num(a.profit.cash.inCourierCustody.amount)),
      },
      d: {
        netSales: r2(num(b.overview.kpis.netRealizedSales?.amount) - num(a.overview.kpis.netRealizedSales?.amount)),
        custody: r2(num(b.overview.financialSummary?.cash.inCourierCustody.amount) - num(a.overview.financialSummary?.cash.inCourierCustody.amount)),
        onRoad: r2(num(b.overview.financialSummary?.cash.expectedOnRoad.amount) - num(a.overview.financialSummary?.cash.expectedOnRoad.amount)),
      },
    };
  };

  const settle = async () => { for (let i = 0; i < 100; i++) { await events.dispatchPending(); if (!await prisma.domainEvent.count({ where: { status: { not: 'delivered' } } })) return; await new Promise(res => setTimeout(res, 50)); } };

  /** A real checkout. Returns the order as stored. */
  const place = async (lines: Array<{ sku: { id: string }; qty: number }>, coupon?: string) => {
    const customer = await signInCustomer(app);
    const address = { governorate: 'Cairo', area: 'Maadi' };
    for (const line of lines) await http().post('/ordering/cart/add').set(customer.auth).send({ skuId: line.sku.id, quantity: line.qty }).expect(201);
    const quote = (await http().post('/ordering/checkout/quote').set(customer.auth).send({ ...address, ...(coupon ? { couponCode: coupon } : {}) }).expect(201)).body;
    const placed = await http().post('/ordering/checkout').set(customer.auth).send({
      ...address, ...(coupon ? { couponCode: coupon } : {}), customerName: 'Fin Customer', customerPhone: '01012345678', shippingAddress: '12 Road 9, Maadi',
      latitude: 29.9602, longitude: 31.2569, locationSource: 'map_pin', locationConfirmed: true, quoteVersion: quote.quoteVersion, cartRevision: quote.revision, idempotencyKey: randomUUID(),
    }).expect(201);
    await settle();
    return { customer, id: placed.body.id as string, orderNumber: placed.body.orderNumber as string, items: placed.body.items as Array<{ id: string; skuId: string; quantity: number }> };
  };
  /** Buy List purchase of every unit of an order's SKUs at list − discount per unit. */
  const buy = async (lines: Array<{ sku: { id: string }; qty: number }>, listUnitPrice: number, discountPerUnit: number) => {
    for (const line of lines) await http().post('/buy-list/acquire').set(hub.auth).send({ skuId: line.sku.id, quantity: line.qty, idempotencyKey: randomUUID(), cost: { listUnitPrice, discountPerUnit } }).expect(200);
  };
  /** Hub receipt → scan-verified preparation → documents → bag packaging (cost from Settings) → PACKED. Returns the shipment. */
  const receiveAndPack = async (order: Awaited<ReturnType<typeof place>>, lines: Array<{ sku: any; qty: number }>, courierCost?: number) => {
    const receivables = (await http().get(`/fulfillment/locations/${locationId}/receivables`).set(hub.auth).expect(200)).body as Array<{ allocationId: string; orderId: string; orderItemId: string; skuId: string; remainingQuantity: number }>;
    for (const row of receivables.filter(x => x.orderId === order.id)) {
      const line = lines.find(l => l.sku.id === row.skuId)!;
      await http().post('/fulfillment/receipts').set(hub.auth).send({ locationId, allocationId: row.allocationId, orderId: order.id, orderItemId: row.orderItemId, skuId: row.skuId, variantName: line.sku.variantName, quantity: row.remainingQuantity, condition: 'ACCEPTABLE', expiryDate: '2031-12-31', idempotencyKey: randomUUID(), barcodeScanned: line.sku.barcode }).expect(201);
    }
    const shipment = await prisma.shipment.findUniqueOrThrow({ where: { orderId: order.id } });
    const session = (await http().post(`/fulfillment/shipments/${shipment.id}/preparation`).set(hub.auth).send({}).expect(201)).body;
    for (const line of lines) for (let unit = 0; unit < line.qty; unit++) await http().post(`/fulfillment/preparation-sessions/${session.id}/scan`).set(hub.auth).send({ barcodeScanned: line.sku.barcode, clientScanId: randomUUID() }).expect(201);
    await http().post(`/fulfillment/preparation-sessions/${session.id}/complete`).set(hub.auth).expect(201);
    await http().post(`/fulfillment/shipments/${shipment.id}/label`).set(hub.auth).expect(201);
    await http().post(`/fulfillment/shipments/${shipment.id}/events`).set(hub.auth).send({ type: 'RECEIPT_PRINTED' }).expect(201);
    await http().post(`/fulfillment/shipments/${shipment.id}/events`).set(hub.auth).send({ type: 'LABEL_PRINTED' }).expect(201);
    setRuntimeSetting(SETTING_KEYS.bagCost, 10);
    await http().put(`/order-costs/${order.id}`).set(hub.auth).send({ packagingType: 'BAG', ...(courierCost !== undefined ? { courierCost } : {}) }).expect(200);
    await http().post(`/fulfillment/shipments/${shipment.id}/events`).set(hub.auth).send({ type: 'PACKED' }).expect(201);
    return shipment.id;
  };
  /** One-parcel run; the courier's scan releases it. */
  const sendOut = async (shipmentId: string) => {
    const run = (await http().post('/fulfillment/delivery-batches').set(hub.auth).send({ hubId: locationId, name: 'Fin run', driverId: driver.id }).expect(201)).body.id as string;
    await http().post(`/fulfillment/delivery-batches/${run}/stops`).set(hub.auth).send({ stops: [{ shipmentId }] }).expect(201);
    await http().post(`/fulfillment/delivery-batches/${run}/handoff-scan`).set(driver.auth).send({ barcode: signShipmentBarcode(shipmentId) }).expect(201);
    return run;
  };
  const deliver = (shipmentId: string, cash: number) => http().post(`/fulfillment/shipments/${shipmentId}/events`).set(driver.auth).send({ type: 'DELIVERED', collectedAmount: cash });
  const countCash = (orderId: string, cod: number) => http().post('/ordering/settlements/batch').set(admin.auth).send({ courierId: driver.id, locationId, reference: 'FIN-' + randomUUID(), currency: 'EGP', totalCollected: cod, collections: [{ orderId, collectedAmount: cod }] });
  const costRecord = (orderId: string) => prisma.orderCostRecord.findUnique({ where: { orderId } });
  const newSku = async (price?: number, compareAt?: number) => {
    const sku = await createSellableSku(prisma);
    if (price !== undefined) await prisma.sellingPrice.updateMany({ where: { skuId: sku.id }, data: { amount: price, ...(compareAt !== undefined ? { compareAtAmount: compareAt } : {}) } });
    return sku;
  };

  beforeAll(async () => {
    process.env.TEST_BYPASS_AUTH = 'false';
    process.env.SOURCING_MODE = 'INTERNAL_BUY_LIST';
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    events = app.get(DomainEventsService);
    admin = await createActor(prisma, Role.ADMIN);
    hub = await createActor(prisma, Role.HUB_OPERATOR);
    driver = await createActor(prisma, Role.DRIVER);
    locationId = (await prisma.fulfillmentLocation.create({ data: { name: 'Fin Hub ' + randomUUID(), address: '1 Hub Street' } })).id;
    await prisma.fulfillmentLocationOperator.create({ data: { locationId, operatorId: hub.id } });
    await prisma.promotion.deleteMany({ where: { code: { in: ['FIN100', 'FINFREESHIP'] } } }); // leftovers of an interrupted run
    await prisma.promotion.create({ data: { campaignName: 'FIN 100 off', code: 'FIN100', benefitType: 'order_discount', discountType: 'fixed_amount', discountValue: 100, isActive: true, validFrom: new Date(Date.now() - 60_000) } });
    await prisma.promotion.create({ data: { campaignName: 'FIN free shipping', code: 'FINFREESHIP', benefitType: 'free_shipping', minBasketValue: 0, isActive: true, validFrom: new Date(Date.now() - 60_000) } });
  });
  afterAll(async () => {
    writeFileSync(process.env.FIN_LEDGER_PATH ?? join(tmpdir(), 'fin-ledger.json'), JSON.stringify(ledger, null, 2));
    await prisma.promotion.deleteMany({ where: { code: { in: ['FIN100', 'FINFREESHIP'] } } });
    if (previousMode === undefined) delete process.env.SOURCING_MODE; else process.env.SOURCING_MODE = previousMode;
    await app.close();
  });

  // ---------------------------------------------------------------------------------------------------------------------------
  it('FIN-01 delivered order: 2 products 1,000, order discount 100, fee 35, cost 700, courier 25 (manual), bag 10, cash counted', async () => {
    const A = await newSku(); const B = await newSku();
    const lines = [{ sku: A, qty: 4 }, { sku: B, qty: 6 }]; // 4×100 + 6×100 = 1,000
    const before = await snap();
    const order = await place(lines, 'FIN100');
    const row = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
    // What checkout stores. Ideal (hand): subtotal 1000, shipping 35, total 935, COD 935.
    log('FIN-01a', 'FIN-01', 'order.subtotal (goods before order discount)', 1000, row.subtotal);
    log('FIN-01b', 'FIN-01', 'order.shippingFee', 35, row.shippingFee);
    log('FIN-01c', 'FIN-01', 'order.totalAmount = 1000 − 100 + 35', 935, row.totalAmount);
    log('FIN-01d', 'FIN-01', 'order.codAmount', 935, row.codAmount);
    const coupon = ((row.appliedPromotions as any[]) ?? []).reduce((s, p) => s + Number(p.valueApplied ?? 0), 0);
    log('FIN-01e', 'FIN-01', 'Σ orderItem.lineTotal − coupon (the order discount is order-level, never allocated to lines; reports deduct it)', 900, row.items.reduce((s, i) => s + Number(i.lineTotal), 0) - coupon, 'lines keep the pre-coupon price by design; the 100 lives in order.appliedPromotions and every report subtracts it');
    expect(Number(row.totalAmount)).toBe(935);
    expect(((row.appliedPromotions as any[])[0]).valueApplied).toBe(100);

    await buy(lines, 80, 10); // list 80 − supplier discount 10 = 70 × 10 units = 700
    const shipmentId = await receiveAndPack(order, lines, 25);
    await sendOut(shipmentId);
    await deliver(shipmentId, 935).expect(201);
    await new Promise(res => setTimeout(res, 300)); // make sure no asynchronous listener changes the cost record
    const mid = await snap();
    await countCash(order.id, 935).expect(201);
    const after = await snap();

    // Manual cost recorded at 25 must stay exactly as recorded (nothing overwrites it with the quote's 35).
    log('FIN-01f', 'FIN-01', 'courierCost kept as recorded by hand (nothing overwrites it)', 25, (await costRecord(order.id))?.courierCost);

    const d = delta(before, after); const dMid = delta(before, mid);
    // Hand calculation. Net sales 900. Shipping revenue 35. COGS 700. Delivery cost 25. Packaging 10.
    // Ideal gross profit = 900 − 700 = 200; ideal distributable profit = 900 + 35 − 700 − 25 − 10 = 200.
    log('FIN-01g', 'FIN-01', 'profit.revenue.netSales (net sales after the order discount)', 900, d.p.sales);
    log('FIN-01h', 'FIN-01', 'profit.costs.products (COGS)', 700, d.p.purchase);
    log('FIN-01i', 'FIN-01', 'profit.costs.packaging', 10, d.p.packaging);
    log('FIN-01j', 'FIN-01', 'profit.costs.delivery (actual cost 25 is shown; the 35 fee is revenue, not netted)', 25, d.p.delivery);
    log('FIN-01k', 'FIN-01', 'distributable profit (900 + 35 − 700 − 25 − 10)', 200, d.p.net);
    log('FIN-01l', 'FIN-01', 'summary.sales.netSales (net sales after the coupon)', 900, d.s.goods);
    log('FIN-01m', 'FIN-01', 'summary.sales.discounts (order-level 100)', 100, d.s.discounts);
    log('FIN-01n', 'FIN-01', 'summary.sales.shippingRevenue', 35, d.s.fees);
    log('FIN-01o', 'FIN-01', 'summary.sales.billedTotal', 935, d.s.billed);
    log('FIN-01p', 'FIN-01', 'summary gross profit in INTERNAL_BUY_LIST (net sales − product cost)', 200, d.s.grossProfit);
    log('FIN-01q', 'FIN-01', 'overview.netRealizedSales (goods net of discount, fee excluded)', 900, d.d.netSales);
    log('FIN-01r', 'FIN-01', 'cash the hub counted (summary.cash.settlements.counted)', 935, d.s.counted);
    log('FIN-01s', 'FIN-01', 'cash still in the courier custody after the count', 0, d.s.custody);
    log('FIN-01t', 'FIN-01', 'overview cash card: in courier custody while declared but not counted', 935, dMid.d.custody, 'the Admin Overview card now reads the shared cash position');
    log('FIN-01u', 'FIN-01', 'summary cash in custody while declared, not counted', 935, dMid.s.custody);
    const notEnded = await http().put(`/order-costs/${order.id}/damage`).set(admin.auth).send({ amount: 10, reason: 'Trying to write off a sold order' });
    log('FIN-01w', 'FIN-01', 'a delivered order keeps its cost: a damage cannot be confirmed on it', 409, notEnded.status);
    log('FIN-01v', 'FIN-01', 'declared cash is not also counted as expected-on-road (no double counting)', 0, dMid.d.onRoad);
    // Pin the figures the model guarantees.
    expect(d.p.purchase).toBe(700); expect(d.p.packaging).toBe(10); expect(d.p.eligible).toBe(1);
  });

  it('FIN-02 item-level discount (compare-at): the price already includes it, so goods = what the customer pays', async () => {
    const C = await newSku(100, 120); // list 120, price 100
    const lines = [{ sku: C, qty: 5 }];
    const before = await snap();
    const order = await place(lines);
    const row = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
    log('FIN-02a', 'FIN-02', 'order.subtotal (5 × 100)', 500, row.subtotal);
    log('FIN-02b', 'FIN-02', 'Σ orderItem.discountAmount (5 × (120 − 100), informational)', 100, row.items.reduce((s, i) => s + Number(i.discountAmount), 0));
    await buy(lines, 70, 0); // 350
    const shipmentId = await receiveAndPack(order, lines, 25);
    await sendOut(shipmentId); await deliver(shipmentId, 535).expect(201); await new Promise(res => setTimeout(res, 300)); await countCash(order.id, 535).expect(201);
    const d = delta(before, await snap());
    // Hand: net sales 500, COGS 350, fee 35 − cost 25 = +10, packaging 10 → distributable = 500 − 350 + 35 − 25 − 10 = 150.
    log('FIN-02c', 'FIN-02', 'profit.revenue.netSales', 500, d.p.sales);
    log('FIN-02d', 'FIN-02', 'summary.sales.netSales', 500, d.s.goods);
    log('FIN-02e', 'FIN-02', 'summary.sales.discounts (coupons only: the compare-at saving is already inside the price, so it is never deducted again)', 0, d.s.discounts);
    log('FIN-02f', 'FIN-02', 'distributable profit', 150, d.p.net);
    const listing = (await http().get(`/operations/finance/orders?from=${today}&to=${today}&limit=100`).set(admin.auth).expect(200)).body;
    log('FIN-02g', 'FIN-02', 'orders list shows the compare-at saving as information only (listPriceSaving)', 100, listing.items.find((x: any) => x.orderId === order.id)?.listPriceSaving);
    expect(d.p.sales).toBe(500);
  });

  it('FIN-03 free shipping: customer pays 0, the company carries the whole delivery cost', async () => {
    const A = await newSku(); const lines = [{ sku: A, qty: 3 }]; // 300
    const before = await snap();
    const order = await place(lines, 'FINFREESHIP');
    const row = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    log('FIN-03a', 'FIN-03', 'order.shippingFee with a free-shipping promotion', 0, row.shippingFee);
    await buy(lines, 50, 0); // 150
    const shipmentId = await receiveAndPack(order, lines, 25);
    await sendOut(shipmentId); await deliver(shipmentId, 300).expect(201); await new Promise(res => setTimeout(res, 300)); await countCash(order.id, 300).expect(201);
    const d = delta(before, await snap());
    // Hand: 300 − 150 − 25 − 10 = 115. Delivery margin = 0 revenue − 25 cost.
    log('FIN-03b', 'FIN-03', 'profit.costs.delivery', 25, d.p.delivery);
    log('FIN-03c', 'FIN-03', 'distributable profit', 115, d.p.net);
    log('FIN-03d', 'FIN-03', 'delivery margin (shipping revenue 0 − delivery cost 25)', -25, d.p.deliveryMargin);
    expect(d.p.net).toBe(115);
  });

  it('FIN-04 automatic delivery cost (nobody typed it): the quote base fee 35 is an ESTIMATE until the actual cost is recorded', async () => {
    const A = await newSku(); const lines = [{ sku: A, qty: 4 }]; // 400
    const before = await snap();
    const order = await place(lines);
    await buy(lines, 60, 0); // 240
    const shipmentId = await receiveAndPack(order, lines); // no manual courier cost
    await sendOut(shipmentId); await deliver(shipmentId, 435).expect(201); await new Promise(res => setTimeout(res, 400)); await countCash(order.id, 435).expect(201);
    const record = await costRecord(order.id);
    log('FIN-04a', 'FIN-04', 'the quote is never written into the cost record as if it were actual (courierCost stays empty)', 0, record?.courierCost ?? 0, 'the estimate is read from the checkout quote and labelled');
    const d = delta(before, await snap());
    // Hand with the estimated 35: 400 − 240 + (35 fee − 35 estimated cost) − 10 packaging = 150.
    log('FIN-04b', 'FIN-04', 'distributable profit (delivery counted at the quote estimate)', 150, d.p.net);
    log('FIN-04c', 'FIN-04', 'profit.delivery.estimatedOrders (the delivery cost is marked estimated)', 1, d.p.estimatedOrders);
    log('FIN-04d', 'FIN-04', 'profit.delivery.estimatedAmount', 35, d.p.estimatedAmount);
    // Recording the actual cost replaces the estimate.
    await http().put(`/order-costs/${order.id}`).set(hub.auth).send({ courierCost: 20 }).expect(200);
    const e = delta(before, await snap());
    log('FIN-04e', 'FIN-04', 'once the actual cost 20 is recorded it replaces the estimate (400 − 240 + 35 − 20 − 10)', 165, e.p.net);
    log('FIN-04f', 'FIN-04', 'no estimated order is left', 0, e.p.estimatedOrders);
    expect(d.p.net).toBe(150);
  });

  it('FIN-05 cancelled after the goods were bought: reusable goods are not a loss; a confirmed damage is', async () => {
    const A = await newSku(); const lines = [{ sku: A, qty: 4 }];
    const before = await snap();
    const order = await place(lines);
    await buy(lines, 70, 0); // 280 spent
    await http().post(`/ordering/orders/${order.id}/cancel`).set(admin.auth).send({ reasonCode: 'CUSTOMER_REQUEST' }).expect(201);
    const d = delta(before, await snap());
    // Hand: 280 of goods bought for an order nobody takes. They are still sellable: capital tied up, NOT a loss, and no profit effect.
    log('FIN-05a', 'FIN-05', 'profit.costs.damages (goods bought for a cancelled order are not an automatic loss)', 0, d.p.damages);
    log('FIN-05b', 'FIN-05', 'effect on the distributable profit', 0, d.p.net);
    log('FIN-05c', 'FIN-05', 'capital tied up in recoverable goods (shown, not deducted)', 280, d.p.recoverable);
    // An Admin confirms the goods are damaged: only then is the cost a loss, once, in the month it is confirmed.
    const over = await http().put(`/order-costs/${order.id}/damage`).set(admin.auth).send({ amount: 280.01, reason: 'Sealed goods damaged in storage' });
    log('FIN-05i', 'FIN-05', 'a damage above what was paid for the goods (280) is refused', 400, over.status);
    const byHub = await http().put(`/order-costs/${order.id}/damage`).set(hub.auth).send({ amount: 280, reason: 'Sealed goods damaged in storage' });
    log('FIN-05j', 'FIN-05', 'only an Admin confirms a damage', 403, byHub.status);
    const confirm = await http().put(`/order-costs/${order.id}/damage`).set(admin.auth).send({ amount: 280, reason: 'Sealed goods damaged in storage' });
    log('FIN-05d', 'FIN-05', 'confirm damage → accepted', 200, confirm.status);
    const e = delta(before, await snap());
    log('FIN-05e', 'FIN-05', 'profit.costs.damages after the confirmation', 280, e.p.damages);
    log('FIN-05f', 'FIN-05', 'distributable profit after the confirmation', -280, e.p.net);
    log('FIN-05g', 'FIN-05', 'recoverable goods after the confirmation', 0, e.p.recoverable);
    const again = await http().put(`/order-costs/${order.id}/damage`).set(admin.auth).send({ amount: 100, reason: 'A different amount' });
    const replay = await http().put(`/order-costs/${order.id}/damage`).set(admin.auth).send({ amount: 280, reason: 'Sealed goods damaged in storage' });
    log('FIN-05k', 'FIN-05', 'the same confirmation sent again is a harmless replay', 200, replay.status);
    const unchanged = delta(before, await snap());
    log('FIN-05l', 'FIN-05', 'the replay does not count the damage twice', 280, unchanged.p.damages);
    log('FIN-05h', 'FIN-05', 'a second, different confirmation is refused (counted at most once)', 409, again.status);
    expect(d.p.damages).toBe(0);
  });

  it('FIN-06 failed delivery → returned to the hub → closed as returned: cash, cost and loss', async () => {
    const A = await newSku(); const lines = [{ sku: A, qty: 2 }];
    const before = await snap();
    const order = await place(lines);
    await buy(lines, 50, 0); // 100
    const shipmentId = await receiveAndPack(order, lines, 25);
    await sendOut(shipmentId);
    await http().post(`/fulfillment/shipments/${shipmentId}/events`).set(driver.auth).send({ type: 'FAILED', reasonCode: 'CUSTOMER_REFUSED' }).expect(201);
    await http().post(`/fulfillment/shipments/${shipmentId}/events`).set(hub.auth).send({ type: 'RETURNED', barcode: signShipmentBarcode(shipmentId) }).expect(201);
    const collection = await prisma.paymentCollection.findUnique({ where: { orderId: order.id } });
    log('FIN-06a', 'FIN-06', 'COD collection after the order is returned', 0, collection?.status === 'voided' ? 0 : 1, `status ${collection?.status}`);
    const d = delta(before, await snap());
    // Hand: the failed trip cost 25 and the bag 10 are spent for good (no sale): −35. The 100 of goods are back in stock: not a loss.
    log('FIN-06b', 'FIN-06', 'effect on the distributable profit (courier 25 + packaging 10; goods are recoverable)', -35, d.p.net);
    log('FIN-06c', 'FIN-06', 'orders counted as sales', 0, d.p.eligible);
    log('FIN-06d', 'FIN-06', 'capital tied up in the recoverable goods', 100, d.p.recoverable);
    log('FIN-06e', 'FIN-06', 'profit.costs.damages', 0, d.p.damages);
    expect(d.p.eligible).toBe(0);
  });

  it('FIN-07 delivered, then a partial return: the refund is capped at the returned goods, duplicates are refused, the sealed unit re-enters stock', async () => {
    const A = await newSku(); const lines = [{ sku: A, qty: 4 }]; // 400
    const before = await snap();
    const order = await place(lines);
    await buy(lines, 60, 0); // 240 (60 per unit)
    const shipmentId = await receiveAndPack(order, lines, 25);
    await sendOut(shipmentId); await deliver(shipmentId, 435).expect(201); await new Promise(res => setTimeout(res, 300)); await countCash(order.id, 435).expect(201);
    const item = (await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } }));
    const resolution = (await http().post('/ordering/resolutions').set(admin.auth).send({ orderId: order.id, type: 'return', actorId: 'ignored', items: [{ orderItemId: item.id, quantity: 1 }] }).expect(201)).body;
    await http().patch(`/ordering/resolutions/${resolution.id}/status`).set(admin.auth).send({ status: 'approved', actorId: 'ignored' }).expect(200);
    // 1 unit costs the customer 100: a 250 refund is above what these goods allow.
    const tooMuch = await http().post(`/ordering/resolutions/${resolution.id}/refund`).set(admin.auth).send({ amount: 250, currency: 'EGP' });
    log('FIN-07a', 'FIN-07', 'refund above the value of the returned item (1 unit = 100) is refused', 400, tooMuch.status, `code ${tooMuch.body?.code ?? tooMuch.body?.message}`);
    const exact = await http().post(`/ordering/resolutions/${resolution.id}/refund`).set(admin.auth).send({ amount: 100, currency: 'EGP' });
    log('FIN-07f', 'FIN-07', 'the exact refund of 100 is accepted', 201, exact.status);
    const repeat = await http().post(`/ordering/resolutions/${resolution.id}/refund`).set(admin.auth).send({ amount: 100, currency: 'EGP' });
    log('FIN-07g', 'FIN-07', 'a duplicate refund request for the same return is refused', 400, repeat.status);
    await http().patch(`/ordering/resolutions/${resolution.id}/refund/status`).set(admin.auth).send({ status: 'succeeded', providerRef: 'FIN-PROOF-1' }).expect(200);
    // The hub inspected the returned unit: sealed and intact, so it goes back to stock and is not a cost of this sale.
    await prisma.returnReceipt.create({ data: { locationId, resolutionId: resolution.id, orderId: order.id, orderItemId: item.id, skuId: A.id, quantity: 1, identityMethod: 'manual', inspectionResult: 'SEALED_INTACT', disposition: 'RETURN_TO_SUPPLIER', idempotencyKey: randomUUID(), actorId: hub.id } });
    const d = delta(before, await snap());
    // Hand with a correct 100 refund: sales 400 − 100 = 300; COGS 240 − 60 (the sealed unit is back in stock) = 180.
    log('FIN-07b', 'FIN-07', 'profit.revenue.productRefunds', 100, d.p.refunds);
    log('FIN-07c', 'FIN-07', 'summary.sales.productRefunds', 100, d.s.refunds);
    log('FIN-07d', 'FIN-07', 'overview.netRealizedSales (400 − refund)', 300, d.d.netSales);
    log('FIN-07e', 'FIN-07', 'returned sealed unit re-enters stock (COGS adjusted)', 180, d.p.purchase);
    log('FIN-07h', 'FIN-07', 'distributable profit (300 + 35 − 180 − 25 − 10)', 120, d.p.net);
    expect(d.p.refunds).toBe(100);
  });

  it('FIN-08 delivered, cash declared by the courier but not counted yet: it is visible as cash in the courier custody', async () => {
    const A = await newSku(); const lines = [{ sku: A, qty: 2 }];
    const before = await snap();
    const order = await place(lines);
    await buy(lines, 50, 0);
    const shipmentId = await receiveAndPack(order, lines, 25);
    await sendOut(shipmentId); await deliver(shipmentId, 235).expect(201); await new Promise(res => setTimeout(res, 300));
    const d = delta(before, await snap());
    const collection = await prisma.paymentCollection.findUniqueOrThrow({ where: { orderId: order.id } });
    log('FIN-08a', 'FIN-08', 'collection after DELIVERED is "collected" (declared, not counted)', 0, collection.status === 'collected' ? 0 : 1);
    log('FIN-08b', 'FIN-08', 'profit page cash.inCourierCustody', 235, d.c.custody);
    log('FIN-08c', 'FIN-08', 'Admin Overview «تحصيل لم يُسوَّ» (cash in courier custody)', 235, d.d.custody);
    log('FIN-08d', 'FIN-08', 'summary cash.inCourierCustody', 235, d.s.custody);
    log('FIN-08e', 'FIN-08', 'cash counted so far', 0, d.s.counted);
    log('FIN-08f', 'FIN-08', 'the same cash is not also "expected on the road"', 0, d.s.onRoad);
    log('FIN-08g', 'FIN-08', 'profit not yet payable (the order awaits its cash count)', 1, d.p.pending);
    expect(d.s.custody).toBe(235); expect(d.s.counted).toBe(0);
  });

  it('FIN-09 settlement variance: courier declared 235, the hub counts 200 — what the order and the settlement show', async () => {
    const A = await newSku(); const lines = [{ sku: A, qty: 2 }];
    const order = await place(lines);
    await buy(lines, 50, 0);
    const shipmentId = await receiveAndPack(order, lines, 25);
    await sendOut(shipmentId); await deliver(shipmentId, 235).expect(201);
    const res = await http().post('/ordering/settlements/batch').set(admin.auth).send({ courierId: driver.id, locationId, reference: 'FIN-VAR-' + randomUUID(), currency: 'EGP', totalCollected: 200, collections: [{ orderId: order.id, collectedAmount: 200 }] });
    const collection = await prisma.paymentCollection.findUniqueOrThrow({ where: { orderId: order.id } });
    log('FIN-09a', 'FIN-09', 'collection.collectedAmount equals what the hub counted (200)', 200, collection.collectedAmount, `HTTP ${res.status}; status ${collection.status}; declared ${collection.declaredAmount}`);
    const batch = collection.settlementBatchId ? await prisma.courierSettlementBatch.findUnique({ where: { id: collection.settlementBatchId } }) : null;
    log('FIN-09c', 'FIN-09', 'settlement.totalDeclared keeps what the courier declared (235)', 235, batch?.totalDeclared);
    log('FIN-09d', 'FIN-09', 'settlement.variance = counted − declared (the shortage is recorded at settlement level)', -35, batch?.variance);
  });

  it('FIN-09b the hub desk\'s own settlement path (rounds): declared 235, physically counted 200 — the shortage stays on the settlement', async () => {
    const A = await newSku(); const lines = [{ sku: A, qty: 2 }];
    const before = await snap();
    const order = await place(lines);
    await buy(lines, 50, 0);
    const shipmentId = await receiveAndPack(order, lines, 25);
    await sendOut(shipmentId); await deliver(shipmentId, 235).expect(201); await new Promise(res => setTimeout(res, 300));
    await http().post('/ordering/settlements/rounds').set(hub.auth).send({ courierId: driver.id, locationId, reference: 'FIN-RND-' + randomUUID(), countedTotal: 200, orderIds: [order.id] }).expect(201);
    const collection = await prisma.paymentCollection.findUniqueOrThrow({ where: { orderId: order.id } });
    const batch = await prisma.courierSettlementBatch.findUniqueOrThrow({ where: { id: collection.settlementBatchId! } });
    // Nothing says WHICH order the 35 is missing from, so no order is charged with it and the customer's paid amount is untouched.
    log('FIN-09b-a', 'FIN-09b', 'the order keeps the amount the customer paid / the courier declared (235); no shortage is pushed onto it', 235, collection.collectedAmount, `status ${collection.status}; declared ${collection.declaredAmount}`);
    log('FIN-09b-b', 'FIN-09b', 'the order is not marked "short" without order-level evidence', 0, collection.status === 'short' ? 1 : 0);
    const d = delta(before, await snap());
    log('FIN-09b-c', 'FIN-09b', 'summary cash counted (what the hub physically counted)', 200, d.s.counted);
    log('FIN-09b-d', 'FIN-09b', 'summary cash declared by the courier', 235, d.s.declared);
    log('FIN-09b-e', 'FIN-09b', 'settlement variance (counted − declared)', -35, d.s.variance);
    log('FIN-09b-f', 'FIN-09b', 'the batch stores the counted amount (200)', 200, batch.totalCollected);
    log('FIN-09b-i', 'FIN-09b', 'the batch stores the declared amount (235)', 235, batch.totalDeclared);
    const stored = (await http().get(`/ordering/settlements/batches/${batch.id}`).set(hub.auth).expect(200)).body;
    log('FIN-09b-g', 'FIN-09b', 'the shortage (counted 200 vs declared 235) is on the settlement batch', -35, Number(stored.totalCollected) - Number(stored.totalDeclared), 'recorded at settlement level only');
    log('FIN-09b-h', 'FIN-09b', 'cash left in the courier custody after the round', 0, d.s.custody);
  });

  it('FIN-10 duplicate and concurrent events change nothing twice', async () => {
    const A = await newSku(); const lines = [{ sku: A, qty: 2 }];
    const before = await snap();
    const order = await place(lines);
    await buy(lines, 50, 0);
    const shipmentId = await receiveAndPack(order, lines, 25);
    await sendOut(shipmentId);
    const both = await Promise.all([deliver(shipmentId, 235), deliver(shipmentId, 235), deliver(shipmentId, 235)]);
    log('FIN-10a', 'FIN-10', 'three concurrent DELIVERED events → one delivery event', 1, await prisma.shipmentEvent.count({ where: { shipmentId, type: 'DELIVERED' } }), `statuses ${both.map(x => x.status).join(',')}`);
    await new Promise(res => setTimeout(res, 300));
    log('FIN-10b', 'FIN-10', 'one cost record, courier cost recorded once', 25, (await costRecord(order.id))?.courierCost);
    const counts = await Promise.all([countCash(order.id, 235), countCash(order.id, 235)]);
    log('FIN-10c', 'FIN-10', 'two concurrent counts with different references settle once', 1, await prisma.courierSettlementBatch.count({ where: { id: { in: (await prisma.paymentCollection.findMany({ where: { orderId: order.id }, select: { settlementBatchId: true } })).map(x => x.settlementBatchId!).filter(Boolean) } } }), `statuses ${counts.map(x => x.status).join(',')}`);
    const d = delta(before, await snap());
    log('FIN-10d', 'FIN-10', 'COGS counted once', 100, d.p.purchase);
    log('FIN-10e', 'FIN-10', 'cash counted once (summary.cash.settlements.counted)', 235, d.s.counted);
    log('FIN-10f', 'FIN-10', 'the cash in custody is not counted twice either', 0, d.s.custody);
    expect(d.p.purchase).toBe(100);
  });

  it('FIN-12 the same product bought in two batches at different prices for one order: cost is the exact sum', async () => {
    const A = await newSku(); const lines = [{ sku: A, qty: 4 }]; // 400
    const before = await snap();
    const order = await place(lines);
    await http().post('/buy-list/acquire').set(hub.auth).send({ skuId: A.id, quantity: 2, idempotencyKey: randomUUID(), cost: { listUnitPrice: 60, discountPerUnit: 0 } }).expect(200);
    await http().post('/buy-list/acquire').set(hub.auth).send({ skuId: A.id, quantity: 2, idempotencyKey: randomUUID(), cost: { listUnitPrice: 80, discountPerUnit: 0 } }).expect(200);
    const shipmentId = await receiveAndPack(order, lines, 25);
    await sendOut(shipmentId); await deliver(shipmentId, 435).expect(201); await new Promise(res => setTimeout(res, 300)); await countCash(order.id, 435).expect(201);
    const d = delta(before, await snap());
    log('FIN-12a', 'FIN-12', 'COGS = 2 × 60 + 2 × 80', 280, d.p.purchase);
    // Hand, full accounting: 400 − 280 − 10 packaging + (35 fee − 25 cost) = 120.
    log('FIN-12b', 'FIN-12', 'distributable profit (400 + 35 − 280 − 25 − 10)', 120, d.p.net);
    expect(d.p.purchase).toBe(280);
  });

  it('FIN-11 report date boundaries and rounding on synthetic delivered orders (Cairo midnight, 3 × 33.33)', async () => {
    const mk = async (deliveredAt: string, price: number, qty: number) => {
      const sku = await newSku();
      const total = Math.round(price * qty * 100) / 100;
      const order = await prisma.order.create({ data: { orderNumber: 'ORD-' + randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase(), customerName: 'Boundary', customerPhone: '01012345678', shippingAddress: 'x', subtotal: total, shippingFee: 0, totalAmount: total, codAmount: total, currency: 'EGP', status: 'delivered', paymentMethod: 'COD',
        items: { create: [{ skuId: sku.id, quantity: qty, price, productName: 'Boundary', skuCode: sku.code, variantName: '50 ml', currency: 'EGP', lineTotal: total }] } } });
      await prisma.orderStatusEvent.create({ data: { orderId: order.id, status: 'delivered', createdAt: new Date(deliveredAt) } });
      return order;
    };
    // Cairo is UTC+2 in January: 2032-01-31T21:59:59.999Z is still January 31 (Cairo), 22:00:00.000Z is February 1.
    await prisma.orderStatusEvent.deleteMany({ where: { createdAt: { gte: new Date('2032-01-01T00:00:00Z'), lt: new Date('2032-03-01T00:00:00Z') } } });
    await mk('2032-01-31T21:59:59.999Z', 33.33, 3);
    await mk('2032-01-31T22:00:00.000Z', 10, 1);
    const jan = (await http().get('/operations/finance/summary?from=2032-01-01&to=2032-01-31').set(admin.auth).expect(200)).body;
    const feb = (await http().get('/operations/finance/summary?from=2032-02-01&to=2032-02-28').set(admin.auth).expect(200)).body;
    const pJan = (await http().get('/operations/finance/profit?month=2032-01').set(admin.auth).expect(200)).body;
    const pFeb = (await http().get('/operations/finance/profit?month=2032-02').set(admin.auth).expect(200)).body;
    log('FIN-11a', 'FIN-11', 'summary: order at 23:59:59.999 Cairo on Jan 31 belongs to January', 1, jan.sales.deliveredOrders);
    log('FIN-11b', 'FIN-11', 'summary: order at 00:00:00.000 Cairo on Feb 1 belongs to February', 1, feb.sales.deliveredOrders);
    log('FIN-11c', 'FIN-11', 'profit: January has the first order only', 1, pJan.eligibleOrders);
    log('FIN-11d', 'FIN-11', 'profit: February has the second order only', 1, pFeb.eligibleOrders);
    log('FIN-11e', 'FIN-11', 'rounding: 3 × 33.33 = 99.99 in summary net sales', 99.99, jan.sales.netSales);
    log('FIN-11f', 'FIN-11', 'rounding: 3 × 33.33 = 99.99 in profit net sales', 99.99, pJan.revenue.netSales);
    expect(jan.sales.deliveredOrders).toBe(1); expect(feb.sales.deliveredOrders).toBe(1);
  });
});

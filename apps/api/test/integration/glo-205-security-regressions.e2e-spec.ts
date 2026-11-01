import { attachPurchaseOrderLineage } from '../fixtures/purchase-order-lineage';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { AiClient } from '../../src/platform/ai';
import { DeterministicAiClient } from '../fixtures/deterministic-ai';
import { createActor, Actor } from '../fixtures/actors';
import { createSellableSku } from '../fixtures/sellable-sku';

/**
 * GLO-205: authorization boundaries for back-office APIs. Every request goes through the
 * real guards with persisted sessions; nothing here bypasses authentication.
 */
describe('GLO-205 security regressions (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let customer: Actor; let hub: Actor; let supplierA: Actor; let supplierB: Actor;
  let supplierAId: string; let supplierBId: string;
  let offerA: string; let offerB: string;
  let poA: string; let poB: string;
  let skuId: string; let brandId: string; let lineId: string;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AiClient).useValue(new DeterministicAiClient()).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useLogger(false);
    await app.init();
    prisma = app.get(PrismaService);

    const sku = await createSellableSku(prisma); // its supplier becomes supplier B
    skuId = sku.id; brandId = (await prisma.product.findUniqueOrThrow({ where: { id: sku.productId } })).brandId;
    supplierBId = sku.supplierId;
    offerB = (await prisma.supplierOffer.findFirstOrThrow({ where: { supplierId: supplierBId, skuId } })).id;
    supplierAId = (await prisma.supplier.create({ data: { name: 'Sec A ' + randomUUID(), slug: 'sec-a-' + randomUUID() } })).id;
    offerA = (await prisma.supplierOffer.create({ data: { supplierId: supplierAId, skuId, costPrice: 40, currency: 'EGP' } })).id;
    lineId = (await prisma.productLine.create({ data: { brandId, name: 'Sec Line', slug: 'sec-line-' + randomUUID() } })).id;

    customer = await createActor(prisma, 'CUSTOMER');
    hub = await createActor(prisma, 'HUB_OPERATOR');
    supplierA = await createActor(prisma, 'SUPPLIER', supplierAId);
    supplierB = await createActor(prisma, 'SUPPLIER', supplierBId);

    const po = async (supplierId: string) => {
      const created = await prisma.supplierPurchaseOrder.create({ data: { supplierId,
        lines: { create: [{ skuId, requestedQuantity: 5 }] } } });
      await attachPurchaseOrderLineage(prisma, created.id);
      return created;
    };
    poA = (await po(supplierAId)).id;
    poB = (await po(supplierBId)).id;
  });

  afterAll(async () => { if (app) await app.close(); });

  /** Sends every request and returns those that did not get the expected status. */
  const violations = async (routes: Array<[string, string, object?]>, expected: number, auth?: { Authorization: string }) => {
    const wrong: Array<{ method: string; path: string; status: number }> = [];
    for (const [method, path, body] of routes) {
      const req = (http() as unknown as Record<string, (url: string) => request.Test>)[method](path);
      if (auth) req.set(auth);
      const res = await req.send(body ?? {});
      if (res.status !== expected) wrong.push({ method, path, status: res.status });
    }
    return wrong;
  };

  const backOffice = (): Array<[string, string, object?]> => [
    ['post', '/sourcing/suppliers', { name: 'Intruder Supplier ' + randomUUID() }],
    ['get', '/sourcing/suppliers'],
    ['get', `/sourcing/offers?skuId=${skuId}`],
    ['patch', `/sourcing/offers/${offerB}`, { costPrice: 1 }],
    ['post', `/sourcing/offers/${offerB}/confirm-availability`, { isAvailable: false }],
    ['post', '/purchase-orders', { supplierId: supplierBId, lines: [{ skuId, requestedQuantity: 1 }] }],
    ['get', `/purchase-orders/${poB}`],
    ['post', `/purchase-orders/${poB}/confirm`, { lines: [] }],
    ['post', '/brands', { name: 'Intruder Brand ' + randomUUID() }],
    ['patch', `/brands/${brandId}`, { name: 'Defaced' }],
    ['post', `/brands/${brandId}/product-lines`, { name: 'Intruder Line ' + randomUUID() }],
    ['patch', `/brands/product-lines/${lineId}`, { name: 'Defaced' }],
  ];

  it('rejects anonymous access to supplier, offer, purchase-order and brand administration', async () => {
    expect(await violations(backOffice(), 401)).toEqual([]);
  });

  it('rejects customers from the same administration endpoints', async () => {
    expect(await violations(backOffice(), 403, customer.auth)).toEqual([]);
    // Nothing was changed by the refused requests.
    const offer = await prisma.supplierOffer.findUniqueOrThrow({ where: { id: offerB } });
    expect(offer.costPrice.toNumber()).toBe(50);
    expect(offer.isAvailable).toBe(true);
    expect((await prisma.brand.findUniqueOrThrow({ where: { id: brandId } })).name).not.toBe('Defaced');
  });

  it('isolates suppliers: A cannot read or change B offers or purchase orders', async () => {
    const refused: Array<[string, string, object?]> = [
      ['get', `/sourcing/offers/${offerB}`],
      ['patch', `/sourcing/offers/${offerB}`, { costPrice: 1 }],
      ['post', `/sourcing/offers/${offerB}/confirm-availability`, { isAvailable: false }],
      ['get', `/sourcing/offers?supplierId=${supplierBId}`],
      ['post', '/sourcing/offers', { supplierId: supplierBId, skuId, costPrice: 1, currency: 'EGP' }],
      ['get', `/sourcing/suppliers/${supplierBId}`],
      ['get', `/purchase-orders/${poB}`],
      ['post', `/purchase-orders/${poB}/confirm`, { lines: [] }],
      ['post', '/purchase-orders', { supplierId: supplierAId, lines: [{ skuId, requestedQuantity: 1 }] }],
    ];
    expect(await violations(refused, 403, supplierA.auth)).toEqual([]);
    const offer = await prisma.supplierOffer.findUniqueOrThrow({ where: { id: offerB } });
    expect(offer.costPrice.toNumber()).toBe(50);
    expect(offer.isAvailable).toBe(true);

    // Each supplier still manages its own records.
    await http().get(`/sourcing/offers/${offerA}`).set(supplierA.auth).expect(200);
    await http().get(`/sourcing/offers?supplierId=${supplierAId}`).set(supplierA.auth).expect(200);
    await http().post(`/sourcing/offers/${offerA}/confirm-availability`).set(supplierA.auth).send({ isAvailable: true }).expect(201);
    await http().get(`/purchase-orders/${poA}`).set(supplierA.auth).expect(200);
    await http().get(`/purchase-orders/${poB}`).set(supplierB.auth).expect(200);
  });

  it('GLO-206: A cannot rewrite B lines by smuggling them into its own confirmation', async () => {
    const own = await prisma.purchaseOrderLine.findFirstOrThrow({ where: { purchaseOrderId: poA } });
    const foreign = await prisma.purchaseOrderLine.findFirstOrThrow({ where: { purchaseOrderId: poB } });
    await http().post(`/purchase-orders/${poA}/confirm`).set(supplierA.auth).send({ lines: [
      { id: own.id, status: 'confirmed_full' },
      { id: foreign.id, status: 'unavailable' },
    ] }).expect(400);
    await http().post(`/purchase-orders/${poA}/confirm`).set(supplierA.auth)
      .send({ lines: [{ id: own.id, status: 'confirmed_partial', confirmedQuantity: 50 }] }).expect(400);
    expect((await prisma.purchaseOrderLine.findUniqueOrThrow({ where: { id: foreign.id } })).status).toBe('pending');
    expect((await prisma.purchaseOrderLine.findUniqueOrThrow({ where: { id: own.id } })).status).toBe('pending');

    const confirmed = await http().post(`/purchase-orders/${poA}/confirm`).set(supplierA.auth)
      .send({ lines: [{ id: own.id, status: 'confirmed_full' }] }).expect(201);
    expect(confirmed.body.lines[0].confirmedQuantity).toBe(own.requestedQuantity);
    await http().post(`/purchase-orders/${poA}/confirm`).set(supplierA.auth)
      .send({ lines: [{ id: own.id, status: 'unavailable' }] }).expect(409); // already confirmed: a different late answer conflicts
    expect((await prisma.purchaseOrderLine.findUniqueOrThrow({ where: { id: own.id } })).status).toBe('confirmed_full');
  });

  it('keeps admin-only actions away from hub operators', async () => {
    await http().patch(`/sourcing/payables/${randomUUID()}/mark-paid`).set(hub.auth).send({}).expect(403);
    await http().post('/commerce/prices').set(hub.auth).send({ skuId, amount: 1, currency: 'EGP' }).expect(403);
    await http().post('/care/concerns').set(hub.auth).send({ name: 'Hub Concern', careArea: 'skin' }).expect(403);
    // Operational sourcing remains available to the hub.
    await http().get(`/purchase-orders/${poB}`).set(hub.auth).expect(200);
  });

  it('refuses evidence, media and candidate approval by suppliers and customers', async () => {
    const id = randomUUID();
    await http().patch(`/ingestion/candidates/${id}/approve`).set(supplierA.auth).send({}).expect(403);
    await http().patch(`/ingestion/candidates/${id}/evidence`).set(customer.auth).send({ fields: [] }).expect(403);
    await http().post(`/ingestion/candidates/${id}/publish`).set(supplierA.auth).expect(403);
    await http().patch(`/products/media/${id}`).set(customer.auth).send({ altText: 'x' }).expect(403);
    await http().patch(`/products/media/${id}`).send({ altText: 'x' }).expect(401);
  });
});

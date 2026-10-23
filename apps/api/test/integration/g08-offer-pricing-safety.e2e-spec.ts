// GLO-280 Gate 08 — supplier offer comparison and pricing safety: supplier direct edits and the candidate offer path
// obey the same freshness/anomaly/FINANCIAL_HOLD policy as file commits, suppliers never see competitor costs or touch
// retail price/review/publication, the existing RankingService compares suppliers, and cost changes never reprice.
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { IngestionPriceType, IngestionStatus } from '@prisma/client';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { AiClient } from '../../src/platform/ai';
import { OfferBatchCommitService } from '../../src/modules/ingestion/services/offer-batch-commit.service';
import { RankingService } from '../../src/modules/sourcing/services/ranking.service';
import { SourcingService } from '../../src/modules/sourcing/services/sourcing.service';
import { createActor, Actor } from '../fixtures/actors';

describe('GLO-280 Gate 08: offer comparison and pricing safety (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let commitService: OfferBatchCommitService;
  let admin: Actor, supA: Actor, supB: Actor;
  const run = randomUUID().slice(0, 8);
  const [sA, sB, sC, sD] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const suppliers = [sA, sB, sC, sD];
  let brandId: string, productId: string;
  /** X: sell 300 EGP. Z: sell 200 EGP. W: ranking SKU. Y: no offers, no price. */
  let skuX: string, skuZ: string, skuW: string, skuY: string;
  let priceX: string, priceZ: string;
  let offerAZ: string, offerBZ: string;
  const server = () => app.getHttpServer();
  const offer = (supplierId: string, skuId: string) =>
    prisma.supplierOffer.findUnique({ where: { supplierId_skuId: { supplierId, skuId } } });
  const patch = (actor: Actor, id: string, body: object) =>
    request(server()).patch(`/sourcing/offers/${id}`).set(actor.auth).send(body);

  /** An approved candidate row of supplier D, as admission leaves it, received `receivedAt` with an optional source time. */
  const approvedItem = async (cost: number, receivedAt: string, sourceObservedAt: string | null) => {
    const job = await prisma.ingestionJob.create({ data: { supplierId: sD, status: IngestionStatus.approved,
      sourceMetadata: { receivedAt, workbookModifiedAt: null, documentKind: 'PRICE_LIST' } } });
    return prisma.ingestionItem.create({ data: { jobId: job.id, supplierSkuCode: `D-${run}`, name: 'G08 Serum 30ml',
      brand: `G08 Brand ${run}`, price: cost, priceType: IngestionPriceType.PURCHASE_COST, reportedQuantity: 4,
      currency: 'EGP', status: IngestionStatus.approved, enrichment: { source: { input: { sourceObservedAt } } } } });
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    commitService = app.get(OfferBatchCommitService);
    for (const method of ['enrichProduct', 'generateContent', 'recommendRoutine'] as const) {
      jest.spyOn(app.get(AiClient), method).mockRejectedValue(new Error('AI disabled'));
    }
    for (const [i, id] of suppliers.entries()) {
      await prisma.supplier.create({ data: { id, name: `G08 Supplier ${i} ${run}`, slug: `g08-s${i}-${run}` } });
    }
    brandId = (await prisma.brand.create({ data: { name: `G08 Brand ${run}`, slug: `g08-brand-${run}` } })).id;
    productId = (await prisma.product.create({ data: { brandId, name: 'G08 Serum', slug: `g08-serum-${run}` } })).id;
    const sku = async (tag: string, size: number) => (await prisma.sku.create({ data: {
      productId, code: `G08-${tag}-${run}`, variantName: 'Default', size, sizeUnit: 'ml' } })).id;
    [skuX, skuZ, skuW, skuY] = [await sku('X', 30), await sku('Z', 50), await sku('W', 100), await sku('Y', 200)];
    priceX = (await prisma.sellingPrice.create({ data: { skuId: skuX, amount: 300, currency: 'EGP', validFrom: new Date('2026-01-01') } })).id;
    priceZ = (await prisma.sellingPrice.create({ data: { skuId: skuZ, amount: 200, currency: 'EGP', validFrom: new Date('2026-01-01') } })).id;
    offerAZ = (await prisma.supplierOffer.create({ data: { supplierId: sA, skuId: skuZ, costPrice: 150, currency: 'EGP' } })).id;
    offerBZ = (await prisma.supplierOffer.create({ data: { supplierId: sB, skuId: skuZ, costPrice: 140, currency: 'EGP' } })).id;
    const tenDaysAgo = new Date(Date.now() - 10 * 86400000);
    await prisma.supplierOffer.createMany({ data: [
      { supplierId: sA, skuId: skuW, costPrice: 180, currency: 'EGP' },
      { supplierId: sB, skuId: skuW, costPrice: 165, currency: 'EGP' },
      { supplierId: sC, skuId: skuW, costPrice: 150, currency: 'EGP', lastObservedAt: tenDaysAgo },
    ] });
    admin = await createActor(prisma, 'ADMIN');
    supA = await createActor(prisma, 'SUPPLIER', sA);
    supB = await createActor(prisma, 'SUPPLIER', sB);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await prisma.supplierPurchaseOrder.deleteMany({ where: { supplierId: { in: suppliers } } });
    await prisma.supplierOffer.deleteMany({ where: { supplierId: { in: suppliers } } });
    await prisma.ingestionItem.deleteMany({ where: { job: { supplierId: { in: suppliers } } } });
    await prisma.ingestionJob.deleteMany({ where: { supplierId: { in: suppliers } } });
    await prisma.sellingPrice.deleteMany({ where: { skuId: { in: [skuX, skuZ, skuW, skuY] } } });
    await prisma.sku.deleteMany({ where: { productId } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.brand.deleteMany({ where: { id: brandId } });
    const actors = [admin, supA, supB].map(a => a.id);
    await prisma.session.deleteMany({ where: { customerId: { in: actors } } });
    await prisma.customer.deleteMany({ where: { id: { in: actors } } });
    await prisma.supplier.deleteMany({ where: { id: { in: suppliers } } });
    await app.close();
  });

  it('ranks two fresh suppliers on the same SKU by cost with the existing RankingService and drops a stale cheaper one', async () => {
    const ranking = await app.get(RankingService).rankOffersForSku(skuW, 1);
    expect(ranking.rankedOffers.map(o => o.supplierId)).toEqual([sB, sA]);
    expect(ranking.rankedOffers.map(o => o.costPrice)).toEqual([165, 180]);
  });

  it('lets a supplier edit its own availability and a normal cost change directly', async () => {
    expect((await patch(supA, offerAZ, { isAvailable: false })).status).toBe(200);
    const res = await patch(supA, offerAZ, { costPrice: 160, isAvailable: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ costPrice: 160, isAvailable: true });
  });

  it('holds a supplier direct edit that jumps >30%, changes currency, is not positive or exceeds the selling price', async () => {
    const jump = await patch(supA, offerAZ, { costPrice: 105 });
    expect(jump.status).toBe(409);
    expect(jump.body.message).toMatch(/large_price_jump/);
    const currency = await patch(supA, offerAZ, { currency: 'USD' });
    expect(currency.status).toBe(409);
    expect(currency.body.message).toMatch(/currency_change_requires_review/);
    expect((await patch(supA, offerAZ, { costPrice: 0 })).status).toBe(400);
    const loss = await patch(supA, offerAZ, { costPrice: 205 });
    expect(loss.status).toBe(409);
    expect(loss.body.message).toMatch(/financial_hold/);
    const after = await prisma.supplierOffer.findUniqueOrThrow({ where: { id: offerAZ } });
    expect(after.costPrice.toNumber()).toBe(160);
    expect(after.currency).toBe('EGP');
    expect((await prisma.sellingPrice.findUniqueOrThrow({ where: { id: priceZ } })).amount.toNumber()).toBe(200);
  });

  it('keeps supplier cost data tenant-isolated: no competitor offers by id, by supplier or by SKU', async () => {
    expect((await request(server()).get(`/sourcing/offers/${offerBZ}`).set(supA.auth)).status).toBe(403);
    expect((await patch(supA, offerBZ, { isAvailable: false })).status).toBe(403);
    expect((await request(server()).get(`/sourcing/offers?supplierId=${sB}`).set(supA.auth)).status).toBe(403);
    expect((await request(server()).get(`/sourcing/offers?skuId=${skuZ}`).set(supA.auth)).status).toBe(403);
    expect((await request(server()).get('/sourcing/offers').set(supA.auth)).status).toBe(403);
    const own = await request(server()).get(`/sourcing/offers?supplierId=${sA}`).set(supA.auth);
    expect(own.status).toBe(200);
    expect(new Set(own.body.map((o: { supplierId: string }) => o.supplierId))).toEqual(new Set([sA]));
    expect((await prisma.supplierOffer.findUniqueOrThrow({ where: { id: offerBZ } })).isAvailable).toBe(true);
  });

  it('refuses supplier attempts to self-link offers, set retail prices, approve or publish', async () => {
    const id = randomUUID();
    const attempts = [
      request(server()).post('/sourcing/offers').set(supA.auth).send({ supplierId: sA, skuId: skuY, costPrice: 10, currency: 'EGP' }),
      request(server()).post('/commerce/prices').set(supA.auth).send({ skuId: skuY, amount: 999, currency: 'EGP' }),
      request(server()).patch(`/commerce/prices/${priceX}`).set(supA.auth).send({ amount: 1 }),
      request(server()).patch(`/commerce/prices/${priceX}/deactivate`).set(supA.auth).send({}),
      request(server()).patch(`/ingestion/candidates/${id}/approve`).set(supA.auth).send({}),
      request(server()).post(`/ingestion/candidates/${id}/publish`).set(supA.auth).send({}),
      request(server()).post(`/ingestion/jobs/${id}/publish`).set(supA.auth).send({}),
      request(server()).post(`/ingestion/jobs/${id}/approve-deactivations`).set(supA.auth).send({}),
    ];
    expect((await Promise.all(attempts)).map(r => r.status)).toEqual(Array(attempts.length).fill(403));
    expect(await offer(sA, skuY)).toBeNull();
    expect(await prisma.sellingPrice.count({ where: { skuId: skuY } })).toBe(0);
    const price = await prisma.sellingPrice.findUniqueOrThrow({ where: { id: priceX } });
    expect(price).toMatchObject({ isActive: true });
    expect(price.amount.toNumber()).toBe(300);
    const staff = await request(server()).post('/sourcing/offers').set(admin.auth).send({ supplierId: sA, skuId: skuY, costPrice: 10, currency: 'EGP' });
    expect(staff.status).toBe(201);
  });

  it('applies source-time freshness, anomaly and FINANCIAL_HOLD on the candidate offer path; replay is a no-op', async () => {
    const first = await approvedItem(200, '2026-10-21T10:00:00.000Z', '2026-10-21T09:00:00.000Z');
    await commitService.commitCandidateOffer(first.id, skuX);
    expect((await offer(sD, skuX))!.costPrice.toNumber()).toBe(200);
    const before = await offer(sD, skuX);
    await commitService.commitCandidateOffer(first.id, skuX);
    expect((await offer(sD, skuX))!.updatedAt).toEqual(before!.updatedAt);

    const olderExportUploadedLater = await approvedItem(190, '2026-10-22T10:00:00.000Z', '2026-10-20T09:00:00.000Z');
    await expect(commitService.assertCandidateOfferSafe(olderExportUploadedLater.id, skuX)).rejects.toThrow(/source_time_older/);
    await expect(commitService.commitCandidateOffer(olderExportUploadedLater.id, skuX)).rejects.toThrow(/source_time_older/);
    const undated = await approvedItem(195, '2026-10-22T11:00:00.000Z', null);
    await expect(commitService.commitCandidateOffer(undated.id, skuX)).rejects.toThrow(/no_source_time/);
    const aboveRetail = await approvedItem(320, '2026-10-22T12:00:00.000Z', '2026-10-22T12:00:00.000Z');
    await expect(commitService.assertCandidateOfferSafe(aboveRetail.id, skuX)).rejects.toThrow(/financial_hold/);
    await expect(commitService.commitCandidateOffer(aboveRetail.id, skuX)).rejects.toThrow(/financial_hold/);
    const newer = await approvedItem(240, '2026-10-22T13:00:00.000Z', '2026-10-22T13:00:00.000Z');
    await commitService.commitCandidateOffer(newer.id, skuX);
    const final = (await offer(sD, skuX))!;
    expect(final.costPrice.toNumber()).toBe(240);
    expect(final.lastIngestionItemId).toBe(newer.id);
    expect((await prisma.sellingPrice.findUniqueOrThrow({ where: { id: priceX } })).amount.toNumber()).toBe(300);
  });

  it('treats a supplier feed as a provisional signal: never a confirmation or public availability, and it expires', async () => {
    const sourcing = app.get(SourcingService);
    const feed = (await offer(sD, skuX))!;
    expect(feed).toMatchObject({ isAvailable: true, lastConfirmedAt: null });
    expect(await sourcing.checkAvailability(skuX)).toBe(true);
    expect(await sourcing.checkAvailability(skuX, true)).toBe(false);
    expect(await sourcing.getPublicAvailability(skuX)).toMatchObject({ isAvailable: false, confirmedAt: null });
    await prisma.supplierOffer.update({ where: { id: feed.id }, data: { lastObservedAt: new Date(Date.now() - 48 * 3600000) } });
    expect(await sourcing.checkAvailability(skuX)).toBe(false);
  });

  it('never reprices: a later cost change leaves the approved selling price and the PO unit-cost snapshot intact', async () => {
    const offerAW = (await offer(sA, skuW))!;
    const po = await prisma.supplierPurchaseOrder.create({ data: { supplierId: sA, notes: `G08 ${run}`, lines: { create: [
      { skuId: skuW, requestedQuantity: 2, unitCost: 180, currency: 'EGP', supplierOfferId: offerAW.id },
    ] } }, include: { lines: true } });
    expect((await patch(supA, offerAW.id, { costPrice: 190 })).status).toBe(200);
    const line = await prisma.purchaseOrderLine.findUniqueOrThrow({ where: { id: po.lines[0].id } });
    expect(line.unitCost!.toNumber()).toBe(180);
    const current = await request(server()).get(`/commerce/prices/skus/${skuZ}/current`).set(admin.auth);
    expect(current.body).toMatchObject({ id: priceZ, amount: 200 });
  });
});

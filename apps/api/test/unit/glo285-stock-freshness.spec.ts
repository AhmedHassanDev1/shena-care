import { IngestionImportMode, Prisma } from '@prisma/client';
import { OfferBatchCommitService } from '../../src/modules/ingestion/services/offer-batch-commit.service';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { CatalogService } from '../../src/modules/catalog/public';
import { SourcingService } from '../../src/modules/sourcing/public';
import { RankingService } from '../../src/modules/sourcing/services/ranking.service';

const NOW = new Date('2026-11-02T12:00:00Z');
const OLD = new Date('2026-10-22T12:00:00Z');
const SKU = '11111111-1111-4111-8111-111111111111';
const ITEM = '22222222-2222-4222-8222-222222222222';
const JOB = '33333333-3333-4333-8333-333333333333';
const SUPPLIER = '44444444-4444-4444-8444-444444444444';
const OFFER = '55555555-5555-4555-8555-555555555555';

// Persistence is the only test double: these tests never instantiate a database client.
function fixture(quantity: number | null, mode: IngestionImportMode = IngestionImportMode.PARTIAL_UPDATE) {
  const offer = {
    id: OFFER, supplierId: SUPPLIER, skuId: SKU, costPrice: new Prisma.Decimal(100), currency: 'EGP',
    isAvailable: true, availableQuantity: 7, quantityUpdatedAt: OLD, lastObservedAt: OLD,
    lastConfirmedAt: OLD, lastIngestionItemId: null as string | null, shortageObservedAt: null,
    minimumOrderUnits: 1, orderMultipleUnits: 1, createdAt: OLD, updatedAt: OLD,
    supplier: { isActive: true },
  };
  const item = {
    id: ITEM, jobId: JOB, supplierSkuCode: 'SUP-1', matchedSkuId: SKU, name: 'Serum 30ml',
    price: new Prisma.Decimal(110), currency: 'EGP', priceType: 'PURCHASE_COST', reportedQuantity: quantity,
    status: 'approved', enrichment: {}, createdAt: NOW, updatedAt: NOW,
  };
  const job = { id: JOB, supplierId: SUPPLIER, status: 'approved', mode, createdAt: NOW,
    sourceMetadata: null, rowOutcomes: null, items: [item] };
  const queries: Prisma.Sql[] = [];
  const db = {
    ingestionJob: {
      findUnique: jest.fn(async () => job), findUniqueOrThrow: jest.fn(async () => job),
      update: jest.fn(async ({ data }: { data: { status: string } }) => Object.assign(job, data)),
    },
    ingestionItem: {
      findUnique: jest.fn(async () => ({ ...item, job })), findMany: jest.fn(async () => []),
    },
    supplierOffer: {
      findUnique: jest.fn(async () => offer), findMany: jest.fn(async () => [offer]),
      count: jest.fn(async () => 1),
      upsert: jest.fn(async ({ update }: { update: Partial<typeof offer> }) =>
        Object.assign(offer, update, { costPrice: new Prisma.Decimal(update.costPrice!) })),
      createMany: jest.fn(),
    },
    sellingPrice: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null) },
    purchaseOrderLine: { count: jest.fn(async () => 0) },
    sourcingDecision: { create: jest.fn(async () => ({ id: 'decision' })) },
    $executeRaw: jest.fn(async (strings: TemplateStringsArray, ...values: Prisma.RawValue[]) => {
      queries.push(Prisma.sql(strings, ...values));
      return 1;
    }),
    $transaction: async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => work(db),
  };
  const prisma = db as unknown as PrismaService;
  const sourcing = new SourcingService(prisma, {} as CatalogService, undefined!);
  return { db, offer, item, job, queries, sourcing, ranking: new RankingService(prisma),
    service: new OfferBatchCommitService(prisma, {} as CatalogService, sourcing) };
}

describe('GLO-285 F1: price-only imports preserve stock freshness', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    jest.replaceProperty(process, 'env', { ...process.env,
      SUPPLIER_PROVISIONAL_ORDERABLE: 'true', SUPPLIER_AVAILABILITY_MAX_AGE_HOURS: '24' });
  });
  afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

  it('candidate cost updates leave stale stock non-orderable and excluded from sourcing, including replay', async () => {
    const f = fixture(null);
    await f.service.commitCandidateOffer(ITEM, SKU);
    expect(f.offer.costPrice.toNumber()).toBe(110);
    expect(f.offer).toMatchObject({ lastObservedAt: OLD, lastConfirmedAt: OLD,
      quantityUpdatedAt: OLD, availableQuantity: 7, isAvailable: true, lastIngestionItemId: ITEM });
    expect(await f.sourcing.getPurchaseAvailability(SKU)).toMatchObject({ state: 'UNAVAILABLE', orderable: false });
    expect(await f.sourcing.checkAvailability(SKU)).toBe(false);
    const ranked = await f.ranking.rankOffersForSku(SKU, 1);
    expect(ranked.rankedOffers).toHaveLength(0);
    expect(ranked.excludedOffers).toEqual([{ offerId: OFFER, supplierId: SUPPLIER, reasonCodes: ['STALE_OFFER'] }]);
    await f.service.commitCandidateOffer(ITEM, SKU);
    expect(f.db.supplierOffer.upsert).toHaveBeenCalledTimes(1);
    expect(f.offer.lastObservedAt).toEqual(OLD);
  });

  it.each([0, 4])('candidate quantity %i updates the stock signal without inventing confirmation', async quantity => {
    const f = fixture(quantity);
    await f.service.commitCandidateOffer(ITEM, SKU);
    expect(f.offer).toMatchObject({ lastObservedAt: NOW, quantityUpdatedAt: NOW,
      availableQuantity: quantity, isAvailable: quantity > 0, lastConfirmedAt: OLD });
    // The service query filters unavailable offers in PostgreSQL; reflect that boundary for zero stock.
    f.db.supplierOffer.findMany.mockResolvedValue(quantity > 0 ? [f.offer] : []);
    expect(await f.sourcing.checkAvailability(SKU)).toBe(quantity > 0);
  });

  it('candidate price-only updates preserve the expiry of an already-fresh signal', async () => {
    const f = fixture(null);
    const recent = new Date('2026-11-02T10:00:00Z');
    f.offer.lastObservedAt = recent;
    await f.service.commitCandidateOffer(ITEM, SKU);
    expect(await f.sourcing.getPurchaseAvailability(SKU)).toMatchObject({ state: 'PROVISIONAL',
      orderable: true, validUntil: new Date('2026-11-03T10:00:00Z') });
  });

  it.each(['large price jump', 'currency change', 'financial hold'])(
    'price-only candidate still rejects a %s', async reason => {
      const f = fixture(null);
      if (reason === 'large price jump') f.item.price = new Prisma.Decimal(140);
      if (reason === 'currency change') f.item.currency = 'USD';
      if (reason === 'financial hold') f.db.sellingPrice.findFirst.mockResolvedValue({
        currency: 'EGP', amount: new Prisma.Decimal(105),
      } as never);
      await expect(f.service.commitCandidateOffer(ITEM, SKU)).rejects.toThrow('Supplier offer requires review');
      expect(f.db.supplierOffer.upsert).not.toHaveBeenCalled();
      expect(f.offer.costPrice.toNumber()).toBe(100);
      expect(f.offer.lastObservedAt).toEqual(OLD);
    },
  );

  it.each([IngestionImportMode.PARTIAL_UPDATE, IngestionImportMode.FULL_SNAPSHOT])(
    'batch %s emits a guarded stock timestamp update and remains idempotent', async mode => {
      const f = fixture(null, mode);
      const result = await f.service.commitJobOffers(JOB);
      expect(result).toMatchObject({ committedCount: 1, deactivatedCount: 0, status: 'published' });
      const writes = f.queries.filter(q => q.sql.includes('UPDATE "sourcing"."supplier_offers"'));
      expect(writes).toHaveLength(1);
      // Assert the emitted database contract, not an imitation of PostgreSQL UPDATE execution.
      expect(writes[0].sql).toMatch(/"last_observed_at"\s*=\s*CASE WHEN v\.price_only THEN o\."last_observed_at" ELSE .*? END/);
      expect(writes[0].values).toEqual(expect.arrayContaining([OFFER, 110, 'EGP', true, ITEM, null]));
      expect(writes[0].sql).toContain('"quantity_updated_at" = CASE WHEN v.price_only THEN o."quantity_updated_at"');
      expect(writes[0].sql).toContain('"last_ingestion_item_id" = v.item_id');
      expect(writes[0].sql).not.toContain('"last_confirmed_at" =');
      expect(await f.service.commitJobOffers(JOB)).toMatchObject({ status: 'ALREADY_PUBLISHED', committedCount: 0 });
      expect(f.queries.filter(q => q.sql.includes('UPDATE "sourcing"."supplier_offers"'))).toHaveLength(1);
    },
  );

  it.each([0, 4])('batch quantity %i takes the stock-update branch', async quantity => {
    const f = fixture(quantity);
    await f.service.commitJobOffers(JOB);
    const write = f.queries.find(q => q.sql.includes('UPDATE "sourcing"."supplier_offers"'))!;
    expect(write.sql).toMatch(/"last_observed_at"\s*=\s*CASE WHEN v\.price_only THEN o\."last_observed_at" ELSE .*? END/);
    expect(write.values.slice(-7)).toEqual([OFFER, 110, 'EGP', quantity > 0, false, ITEM, quantity]);
    expect(write.values).toContain(NOW.toISOString());
  });
});

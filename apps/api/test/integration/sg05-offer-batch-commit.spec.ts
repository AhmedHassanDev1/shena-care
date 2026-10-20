import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { OfferBatchCommitService } from '../../src/modules/ingestion/services/offer-batch-commit.service';
import { IngestionService } from '../../src/modules/ingestion/services/ingestion.service';
import { createActor, Actor } from '../fixtures/actors';
import { reviewCandidateMedia } from '../fixtures/candidate-review';
import { RowDiffAction } from '../../src/modules/ingestion/contracts/offer-batch-commit.contract';
import { IngestionImportMode, IngestionPriceType, IngestionStatus } from '@prisma/client';

describe('SG-05: Stage, Diff & Atomic Safe-Commit Supplier Offer Price/Qty Updates (e2e)', () => {
  jest.setTimeout(60000);

  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Actor;
  let offerCommitService: OfferBatchCommitService;
  let ingestionService: IngestionService;
  let supplierId: string;
  let brandId: string;
  let sku1Id: string;
  let sku2Id: string;
  let sku3Id: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();

    prisma = app.get(PrismaService);
    offerCommitService = app.get(OfferBatchCommitService);
    ingestionService = app.get(IngestionService);
    admin = await createActor(prisma, 'ADMIN');
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  async function cleanFixture() {
    const suppliers = await prisma.supplier.findMany({
      where: { slug: { startsWith: 'sg05-supplier' } },
    });
    for (const s of suppliers) {
      await prisma.supplierSkuAlias.deleteMany({ where: { supplierId: s.id } });
      await prisma.ingestionItem.deleteMany({ where: { job: { supplierId: s.id } } });
      await prisma.ingestionJob.deleteMany({ where: { supplierId: s.id } });
      await prisma.supplierOffer.deleteMany({ where: { supplierId: s.id } });
      const pos = await prisma.supplierPurchaseOrder.findMany({ where: { supplierId: s.id } });
      const poIds = pos.map((p) => p.id);
      await prisma.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: { in: poIds } } });
      await prisma.supplierPurchaseOrder.deleteMany({ where: { supplierId: s.id } });
      await prisma.supplier.delete({ where: { id: s.id } });
    }

    const brands = await prisma.brand.findMany({
      where: { slug: { startsWith: 'sg05-brand' } },
    });
    for (const b of brands) {
      const products = await prisma.product.findMany({ where: { brandId: b.id } });
      for (const p of products) {
        const skus = await prisma.sku.findMany({ where: { productId: p.id } });
        const skuIds = skus.map((s) => s.id);
        await prisma.purchaseOrderLine.deleteMany({ where: { skuId: { in: skuIds } } });
        await prisma.sellingPrice.deleteMany({ where: { skuId: { in: skuIds } } });
        await prisma.skuBarcodeAlias.deleteMany({ where: { skuId: { in: skuIds } } });
        await prisma.supplierOffer.deleteMany({ where: { skuId: { in: skuIds } } });
        await prisma.productMedia.deleteMany({ where: { productId: p.id } });
        await prisma.sku.deleteMany({ where: { id: { in: skuIds } } });
        await prisma.product.delete({ where: { id: p.id } });
      }
      await prisma.brand.delete({ where: { id: b.id } });
    }
  }

  beforeEach(async () => {
    await cleanFixture();

    const supplier = await prisma.supplier.create({
      data: { name: `SG05 Supplier ${Date.now()}`, slug: `sg05-supplier-${Date.now()}` },
    });
    supplierId = supplier.id;

    const brand = await prisma.brand.create({
      data: { name: `SG05 Brand ${Date.now()}`, slug: `sg05-brand-${Date.now()}` },
    });
    brandId = brand.id;

    const product = await prisma.product.create({
      data: { name: 'Moisturizing Cream', slug: `sg05-cream-${Date.now()}`, brandId: brand.id, isPublished: true },
    });

    const s1 = await prisma.sku.create({
      data: { productId: product.id, code: `SG05-SKU-1-${Date.now()}`, variantName: '50 ml', size: 50, sizeUnit: 'ml', barcode: `622500000001${Date.now().toString().slice(-3)}`, isActive: true },
    });
    sku1Id = s1.id;

    const s2 = await prisma.sku.create({
      data: { productId: product.id, code: `SG05-SKU-2-${Date.now()}`, variantName: '100ml', size: 100, sizeUnit: 'ml', barcode: `622500000002${Date.now().toString().slice(-3)}`, isActive: true },
    });
    sku2Id = s2.id;

    const s3 = await prisma.sku.create({
      data: { productId: product.id, code: `SG05-SKU-3-${Date.now()}`, variantName: '200ml', size: 200, sizeUnit: 'ml', barcode: `622500000003${Date.now().toString().slice(-3)}`, isActive: true },
    });
    sku3Id = s3.id;
  });

  afterEach(cleanFixture);

  describe('1. Acceptance 1: Live DB snapshots before/after diff', () => {
    it('captures live DB state before and computes accurate price & availability proposed after state', async () => {
      // 1. Initial live offer in DB: cost = 100, isAvailable = true
      await prisma.supplierOffer.create({
        data: {
          supplierId,
          skuId: sku1Id,
          costPrice: 100,
          currency: 'SAR',
          isAvailable: true,
        },
      });

      // 2. Ingestion job with new price = 110 (+10%), reportedQuantity = 25
      const job = await prisma.ingestionJob.create({
        data: { supplierId, status: IngestionStatus.review_required, mode: IngestionImportMode.PARTIAL_UPDATE },
      });
      await prisma.ingestionItem.create({
        data: {
          jobId: job.id,
          supplierSkuCode: 'SUP-SKU-1',
          name: 'Moisturizing Cream 50ml',
          brand: 'SG05 Brand',
          price: 110,
          priceType: IngestionPriceType.PURCHASE_COST,
          currency: 'SAR',
          reportedQuantity: 25,
          matchedSkuId: sku1Id,
          status: IngestionStatus.approved,
        },
      });

      // 3. Compute diff via service
      const diff = await offerCommitService.computeJobDiff(job.id);

      expect(diff.totalRows).toBe(1);
      expect(diff.counters.updated).toBe(1);
      expect(diff.rows[0].action).toBe(RowDiffAction.UPDATE);

      // Verify before snapshot
      expect(diff.rows[0].before).toBeDefined();
      expect(diff.rows[0].before!.costPrice).toBe(100);
      expect(diff.rows[0].before!.isAvailable).toBe(true);

      // Verify after snapshot
      expect(diff.rows[0].after.costPrice).toBe(110);
      expect(diff.rows[0].after.isAvailable).toBe(true);
      expect(diff.rows[0].priceChangePercent).toBeCloseTo(10, 1);
      expect(diff.rows[0].isLargePriceJump).toBe(false);
    });
  });

  describe('2. Acceptance 2: Valid retail-only file does not mutate wholesale cost', () => {
    it('leaves existing wholesale cost price unchanged when priceType is RETAIL_REFERENCE', async () => {
      // Existing offer: wholesale cost = 150 SAR
      await prisma.supplierOffer.create({
        data: {
          supplierId,
          skuId: sku1Id,
          costPrice: 150,
          currency: 'SAR',
          isAvailable: true,
        },
      });

      // Ingestion job containing retail reference (MSRP = 250 SAR)
      const job = await prisma.ingestionJob.create({
        data: { supplierId, status: IngestionStatus.review_required },
      });
      await prisma.ingestionItem.create({
        data: {
          jobId: job.id,
          supplierSkuCode: 'SUP-SKU-1',
          name: 'Moisturizing Cream 50ml',
          brand: 'SG05 Brand',
          price: 250,
          priceType: IngestionPriceType.RETAIL_REFERENCE, // Retail price list!
          currency: 'SAR',
          matchedSkuId: sku1Id,
          status: IngestionStatus.approved,
        },
      });

      // 1. Check diff: must mark as SKIP for cost mutation
      const diff = await offerCommitService.computeJobDiff(job.id);
      expect(diff.rows[0].isRetailOnly).toBe(true);
      expect(diff.rows[0].after.costPrice).toBe(150); // Kept existing cost!

      // 2. Commit offers
      const commitRes = await offerCommitService.commitJobOffers(job.id);
      expect(commitRes.skippedCount).toBe(1);

      // 3. Assert live DB: costPrice in SupplierOffer remains 150, NOT 250!
      const offerInDb = await prisma.supplierOffer.findUniqueOrThrow({
        where: { supplierId_skuId: { supplierId, skuId: sku1Id } },
      });
      expect(offerInDb.costPrice.toNumber()).toBe(150);
    });
  });

  describe('3. Acceptance 3: Price-only leaves stock/availability intact', () => {
    it('updates cost price but does not alter existing availability when quantity is omitted', async () => {
      // Existing offer is out of stock (isAvailable = false)
      await prisma.supplierOffer.create({
        data: {
          supplierId,
          skuId: sku1Id,
          costPrice: 80,
          currency: 'SAR',
          isAvailable: false, // Currently out of stock
        },
      });

      // Price-only update: cost updated to 85, no quantity reported
      const job = await prisma.ingestionJob.create({
        data: { supplierId, status: IngestionStatus.review_required },
      });
      await prisma.ingestionItem.create({
        data: {
          jobId: job.id,
          supplierSkuCode: 'SUP-SKU-1',
          name: 'Moisturizing Cream 50ml',
          brand: 'SG05 Brand',
          price: 85,
          priceType: IngestionPriceType.PURCHASE_COST,
          currency: 'SAR',
          reportedQuantity: null, // Price-only!
          matchedSkuId: sku1Id,
          status: IngestionStatus.approved,
        },
      });

      const commitRes = await offerCommitService.commitJobOffers(job.id);
      expect(commitRes.committedCount).toBe(1);

      // Assert live DB: costPrice updated to 85, but isAvailable remains FALSE!
      const offerInDb = await prisma.supplierOffer.findUniqueOrThrow({
        where: { supplierId_skuId: { supplierId, skuId: sku1Id } },
      });
      expect(offerInDb.costPrice.toNumber()).toBe(85);
      expect(offerInDb.isAvailable).toBe(false);
    });
  });

  describe('4. Acceptance 4: Zeros apply correctly to availability', () => {
    it('sets isAvailable = false when reportedQuantity is explicitly 0', async () => {
      // Existing offer is available
      await prisma.supplierOffer.create({
        data: {
          supplierId,
          skuId: sku1Id,
          costPrice: 120,
          currency: 'SAR',
          isAvailable: true,
        },
      });

      // Feed reports quantity = 0
      const job = await prisma.ingestionJob.create({
        data: { supplierId, status: IngestionStatus.review_required },
      });
      await prisma.ingestionItem.create({
        data: {
          jobId: job.id,
          supplierSkuCode: 'SUP-SKU-1',
          name: 'Moisturizing Cream 50ml',
          brand: 'SG05 Brand',
          price: 120,
          priceType: IngestionPriceType.PURCHASE_COST,
          currency: 'SAR',
          reportedQuantity: 0, // Explicit zero!
          matchedSkuId: sku1Id,
          status: IngestionStatus.approved,
        },
      });

      await offerCommitService.commitJobOffers(job.id);

      const offerInDb = await prisma.supplierOffer.findUniqueOrThrow({
        where: { supplierId_skuId: { supplierId, skuId: sku1Id } },
      });
      expect(offerInDb.isAvailable).toBe(false);
    });
  });

  describe('5. Acceptance 5: Anomaly threshold hold on large price jumps (> 30%)', () => {
    it('flags >30% price change for review and holds live DB mutation', async () => {
      // Existing offer: cost = 100 SAR
      await prisma.supplierOffer.create({
        data: {
          supplierId,
          skuId: sku1Id,
          costPrice: 100,
          currency: 'SAR',
          isAvailable: true,
        },
      });

      // Feed reports price = 150 SAR (+50% jump!)
      const job = await prisma.ingestionJob.create({
        data: { supplierId, status: IngestionStatus.review_required },
      });
      await prisma.ingestionItem.create({
        data: {
          jobId: job.id,
          supplierSkuCode: 'SUP-SKU-1',
          name: 'Moisturizing Cream 50ml',
          brand: 'SG05 Brand',
          price: 150,
          priceType: IngestionPriceType.PURCHASE_COST,
          currency: 'SAR',
          matchedSkuId: sku1Id,
          status: IngestionStatus.approved,
        },
      });

      // Check diff
      const diff = await offerCommitService.computeJobDiff(job.id);
      expect(diff.rows[0].action).toBe(RowDiffAction.REVIEW);
      expect(diff.rows[0].isLargePriceJump).toBe(true);
      expect(diff.counters.review).toBe(1);

      // Commit
      const commitRes = await offerCommitService.commitJobOffers(job.id);
      expect(commitRes.heldForReviewCount).toBe(1);
      expect(commitRes.committedCount).toBe(0);

      // Assert live DB offer is NOT mutated automatically
      const offerInDb = await prisma.supplierOffer.findUniqueOrThrow({
        where: { supplierId_skuId: { supplierId, skuId: sku1Id } },
      });
      expect(offerInDb.costPrice.toNumber()).toBe(100);
    });
  });

  describe('6. Acceptance 6: FULL_SNAPSHOT vs PARTIAL_UPDATE deactivation safety', () => {
    it('never deactivates unmentioned offers in PARTIAL_UPDATE mode', async () => {
      // Supplier currently has 3 active offers (SKU 1, SKU 2, SKU 3)
      await prisma.supplierOffer.createMany({
        data: [
          { supplierId, skuId: sku1Id, costPrice: 100, currency: 'SAR', isAvailable: true },
          { supplierId, skuId: sku2Id, costPrice: 200, currency: 'SAR', isAvailable: true },
          { supplierId, skuId: sku3Id, costPrice: 300, currency: 'SAR', isAvailable: true },
        ],
      });

      // PARTIAL_UPDATE feed only contains SKU 1
      const job = await prisma.ingestionJob.create({
        data: { supplierId, status: IngestionStatus.review_required, mode: IngestionImportMode.PARTIAL_UPDATE },
      });
      await prisma.ingestionItem.create({
        data: {
          jobId: job.id,
          supplierSkuCode: 'SUP-SKU-1',
          name: 'Moisturizing Cream 50ml',
          brand: 'SG05 Brand',
          price: 105,
          priceType: IngestionPriceType.PURCHASE_COST,
          currency: 'SAR',
          matchedSkuId: sku1Id,
          status: IngestionStatus.approved,
        },
      });

      await offerCommitService.commitJobOffers(job.id);

      // In PARTIAL_UPDATE: SKU 2 and SKU 3 MUST remain active!
      const activeOffers = await prisma.supplierOffer.findMany({
        where: { supplierId, isAvailable: true },
      });
      expect(activeOffers.length).toBe(3);
    });

    it('holds FULL_SNAPSHOT mass deactivations pending explicit authorization', async () => {
      // Supplier has active offers for SKU 1, SKU 2, SKU 3
      await prisma.supplierOffer.createMany({
        data: [
          { supplierId, skuId: sku1Id, costPrice: 100, currency: 'SAR', isAvailable: true },
          { supplierId, skuId: sku2Id, costPrice: 200, currency: 'SAR', isAvailable: true },
          { supplierId, skuId: sku3Id, costPrice: 300, currency: 'SAR', isAvailable: true },
        ],
      });

      // FULL_SNAPSHOT feed only contains SKU 1 (missing SKU 2 and 3: 66% drop exceeds 20% anomaly threshold)
      const job = await prisma.ingestionJob.create({
        data: { supplierId, status: IngestionStatus.review_required, mode: IngestionImportMode.FULL_SNAPSHOT },
      });
      await prisma.ingestionItem.create({
        data: {
          jobId: job.id,
          supplierSkuCode: 'SUP-SKU-1',
          name: 'Moisturizing Cream 50ml',
          brand: 'SG05 Brand',
          price: 105,
          priceType: IngestionPriceType.PURCHASE_COST,
          currency: 'SAR',
          reportedQuantity: 25,
          matchedSkuId: sku1Id,
          status: IngestionStatus.approved,
        },
      });

      const diff = await offerCommitService.computeJobDiff(job.id);
      expect(diff.requiresDeactivationApproval).toBe(true);
      expect(diff.counters.deactivationsPending).toBe(2);

      // Commit without explicit deactivation approval -> stock is NOT deactivated!
      await offerCommitService.commitJobOffers(job.id);

      const activeOffersBeforeApproval = await prisma.supplierOffer.findMany({
        where: { supplierId, isAvailable: true },
      });
      expect(activeOffersBeforeApproval.length).toBe(3);

      // Now explicit admin approval is granted
      const approveRes = await offerCommitService.approveDeactivations(job.id, admin.id);
      expect(approveRes.deactivatedCount).toBe(2);

      const activeOffersAfterApproval = await prisma.supplierOffer.findMany({
        where: { supplierId, isAvailable: true },
      });
      expect(activeOffersAfterApproval.length).toBe(1);
      expect(activeOffersAfterApproval[0].skuId).toBe(sku1Id);
    });
  });

  describe('7. Acceptance 7: Idempotency & Replay Protection', () => {
    it('returns safe ALREADY_PUBLISHED status without modifying database on repeated commit', async () => {
      const job = await prisma.ingestionJob.create({
        data: { supplierId, status: IngestionStatus.review_required },
      });
      await prisma.ingestionItem.create({
        data: {
          jobId: job.id,
          supplierSkuCode: 'SUP-SKU-1',
          name: 'Moisturizing Cream 50ml',
          brand: 'SG05 Brand',
          price: 130,
          priceType: IngestionPriceType.PURCHASE_COST,
          currency: 'SAR',
          matchedSkuId: sku1Id,
          status: IngestionStatus.approved,
        },
      });

      // First commit
      const res1 = await offerCommitService.commitJobOffers(job.id);
      expect(res1.committedCount).toBe(1);

      // Second commit of the same job (replay/duplicate request)
      const res2 = await offerCommitService.commitJobOffers(job.id);
      expect(res2.status).toBe('ALREADY_PUBLISHED');
      expect(res2.committedCount).toBe(0);

      // Exactly 1 offer exists
      const offers = await prisma.supplierOffer.findMany({ where: { supplierId, skuId: sku1Id } });
      expect(offers.length).toBe(1);
      expect(offers[0].costPrice.toNumber()).toBe(130);
    });
  });

  describe('8. Acceptance 8: Direct regression for existing dangerous publishJob behavior', () => {
    it('correctly updates existing offer price on re-import instead of swallowing it', async () => {
      // 1. Initial offer established at 100 SAR
      await prisma.supplierOffer.create({
        data: {
          supplierId,
          skuId: sku1Id,
          costPrice: 100,
          currency: 'SAR',
          isAvailable: true,
        },
      });

      // 2. Batch commit through OfferBatchCommitService with updated price 115 SAR
      const job = await prisma.ingestionJob.create({
        data: { supplierId, status: IngestionStatus.review_required },
      });
      const item = await prisma.ingestionItem.create({
        data: {
          jobId: job.id,
          supplierSkuCode: 'SUP-SKU-1',
          name: 'Moisturizing Cream 50ml',
          brand: 'SG05 Brand',
          price: 115, // Price increase!
          priceType: IngestionPriceType.PURCHASE_COST,
          currency: 'SAR',
          matchedSkuId: sku1Id,
          status: IngestionStatus.approved,
        },
      });

      // Commit offer updates
      const commitRes = await offerCommitService.commitJobOffers(job.id);
      expect(commitRes.committedCount).toBe(1);

      // Assert price update was NOT swallowed: live offer cost is 115 SAR!
      const updatedOffer = await prisma.supplierOffer.findUniqueOrThrow({
        where: { supplierId_skuId: { supplierId, skuId: sku1Id } },
      });
      expect(updatedOffer.costPrice.toNumber()).toBe(115);

      // 3. Re-import price update to 125 SAR through publishCandidate with media review
      const job2 = await prisma.ingestionJob.create({
        data: { supplierId, status: IngestionStatus.review_required },
      });
      const sku1 = await prisma.sku.findUniqueOrThrow({ where: { id: sku1Id } });
      const item2 = await prisma.ingestionItem.create({
        data: {
          jobId: job2.id,
          supplierSkuCode: 'SUP-SKU-1-V2',
          name: 'Moisturizing Cream 50ml',
          brand: 'SG05 Brand',
          barcode: sku1.barcode,
          price: 125, // Another price change!
          priceType: IngestionPriceType.PURCHASE_COST,
          currency: 'SAR',
          matchedSkuId: sku1Id,
          status: IngestionStatus.approved,
        },
      });

      const media = await reviewCandidateMedia(app, admin.auth, item2.id, sku1.barcode!, 50, 'ml');
      await request(app.getHttpServer())
        .patch(`/ingestion/candidates/${item2.id}/approve`)
        .set(admin.auth)
        .send({ mediaReviews: media })
        .expect(200);

      await ingestionService.publishCandidate(item2.id);

      const offerAfterPublish = await prisma.supplierOffer.findUniqueOrThrow({
        where: { supplierId_skuId: { supplierId, skuId: sku1Id } },
      });
      expect(offerAfterPublish.costPrice.toNumber()).toBe(125);
    });
  });

  describe('9. HTTP Controller Endpoints', () => {
    it('exposes GET /ingestion/jobs/:id/diff and POST /ingestion/jobs/:id/commit-offers', async () => {
      const job = await prisma.ingestionJob.create({
        data: { supplierId, status: IngestionStatus.review_required },
      });
      await prisma.ingestionItem.create({
        data: {
          jobId: job.id,
          supplierSkuCode: 'SUP-SKU-1',
          name: 'Moisturizing Cream 50ml',
          brand: 'SG05 Brand',
          price: 95,
          priceType: IngestionPriceType.PURCHASE_COST,
          currency: 'SAR',
          matchedSkuId: sku1Id,
          status: IngestionStatus.approved,
        },
      });

      // GET diff
      const diffRes = await request(app.getHttpServer())
        .get(`/ingestion/jobs/${job.id}/diff`)
        .set(admin.auth)
        .expect(200);

      expect(diffRes.body.jobId).toBe(job.id);
      expect(diffRes.body.counters).toBeDefined();

      // POST commit-offers
      const commitRes = await request(app.getHttpServer())
        .post(`/ingestion/jobs/${job.id}/commit-offers`)
        .set(admin.auth)
        .send({ autoApplyLowRisk: true })
        .expect(201);

      expect(commitRes.body.committedCount).toBe(1);
    });
  });

  describe('10. Comprehensive Safety Invariants Verification (Strike Mode Pre-M3 Gate)', () => {
    it('Invariant 1 & 2: 1-19% disappearance in snapshot never causes automatic deactivation during commit', async () => {
      // Setup 5 active offers (disappearance of 1 offer = 20%, 4 active remaining)
      // Here: 4 active offers, feed contains 3 (1 missing = 25% drop, or 10 offers where 1 missing = 10% drop)
      const offersData = [];
      const extraSkus = [];
      const product = await prisma.product.findFirstOrThrow({ where: { brandId } });
      for (let i = 0; i < 5; i++) {
        const sku = await prisma.sku.create({
          data: {
            productId: product.id,
            code: `SG05-INV-SKU-${i}-${Date.now()}`,
            variantName: `${i * 10 + 10}ml`,
            barcode: `62250000010${i}${Date.now().toString().slice(-2)}`,
            isActive: true,
          },
        });
        extraSkus.push(sku);
        offersData.push({
          supplierId,
          skuId: sku.id,
          costPrice: 50 + i * 10,
          currency: 'SAR',
          isAvailable: true,
        });
      }
      await prisma.supplierOffer.createMany({ data: offersData });

      // Feed only provides 4 of the 5 SKUs (1 missing = 20% disappearance)
      const job = await prisma.ingestionJob.create({
        data: { supplierId, status: IngestionStatus.review_required, mode: IngestionImportMode.FULL_SNAPSHOT },
      });
      for (let i = 0; i < 4; i++) {
        await prisma.ingestionItem.create({
          data: {
            jobId: job.id,
            supplierSkuCode: `SUP-INV-${i}`,
            name: `Item ${i}`,
            brand: 'SG05 Brand',
            price: 55 + i * 10,
            priceType: IngestionPriceType.PURCHASE_COST,
            currency: 'SAR',
            reportedQuantity: 10,
            matchedSkuId: extraSkus[i].id,
            status: IngestionStatus.approved,
          },
        });
      }

      // Even if declaredCompleteAssortment is passed, batch commit MUST NOT auto-deactivate missing offer!
      const commitRes = await offerCommitService.commitJobOffers(job.id, {
        declaredCompleteAssortment: true,
        actorId: admin.id,
      });

      expect(commitRes.deactivatedCount).toBe(0);
      const heldDeactivations = commitRes.itemOutcomes.filter((o) => o.action === RowDiffAction.DEACTIVATE);
      expect(heldDeactivations.length).toBe(1);
      expect(heldDeactivations[0].status).toBe('HELD_FOR_REVIEW');

      // The 5th offer must STILL be available in DB
      const fifthOffer = await prisma.supplierOffer.findUniqueOrThrow({
        where: { supplierId_skuId: { supplierId, skuId: extraSkus[4].id } },
      });
      expect(fifthOffer.isAvailable).toBe(true);

      // approveDeactivations without positive assortment coverage throws
      await expect(
        offerCommitService.approveDeactivations(job.id, admin.id, {
          confirmedAssortmentCoverage: false,
        }),
      ).rejects.toThrow('Positive confirmation of complete supplier assortment coverage is required');
    });

    it('Invariant 3: Price-only files never deactivate offers or modify quantity/availability', async () => {
      await prisma.supplierOffer.createMany({
        data: [
          { supplierId, skuId: sku1Id, costPrice: 100, currency: 'SAR', isAvailable: true },
          { supplierId, skuId: sku2Id, costPrice: 200, currency: 'SAR', isAvailable: true },
        ],
      });

      // Price-only file in FULL_SNAPSHOT mode (all items have reportedQuantity === null)
      const job = await prisma.ingestionJob.create({
        data: { supplierId, status: IngestionStatus.review_required, mode: IngestionImportMode.FULL_SNAPSHOT },
      });
      await prisma.ingestionItem.create({
        data: {
          jobId: job.id,
          supplierSkuCode: 'SUP-SKU-1',
          name: 'Moisturizing Cream 50ml',
          brand: 'SG05 Brand',
          price: 110,
          priceType: IngestionPriceType.PURCHASE_COST,
          currency: 'SAR',
          reportedQuantity: null, // Price-only!
          matchedSkuId: sku1Id,
          status: IngestionStatus.approved,
        },
      });

      const diff = await offerCommitService.computeJobDiff(job.id);
      expect(diff.deactivationCandidates.length).toBe(0);
      expect(diff.requiresDeactivationApproval).toBe(false);

      // Attempting approveDeactivations on price-only job rejects
      await expect(
        offerCommitService.approveDeactivations(job.id, admin.id, { confirmedAssortmentCoverage: true }),
      ).rejects.toThrow('Cannot deactivate offers from a price-only import');
    });

    it('Invariant 4: Stale imports do not overwrite newer supplier offer information', async () => {
      // Newer offer observed at 10:00:00
      const newerTimestamp = new Date('2026-10-20T10:00:00Z');
      await prisma.supplierOffer.create({
        data: {
          supplierId,
          skuId: sku1Id,
          costPrice: 120,
          currency: 'SAR',
          isAvailable: true,
          lastObservedAt: newerTimestamp,
        },
      });

      // Stale job item created earlier at 09:00:00
      const job = await prisma.ingestionJob.create({
        data: { supplierId, status: IngestionStatus.review_required },
      });
      const item = await prisma.ingestionItem.create({
        data: {
          jobId: job.id,
          supplierSkuCode: 'SUP-SKU-1',
          name: 'Moisturizing Cream 50ml',
          brand: 'SG05 Brand',
          price: 90, // Outdated lower price
          priceType: IngestionPriceType.PURCHASE_COST,
          currency: 'SAR',
          matchedSkuId: sku1Id,
          status: IngestionStatus.approved,
          createdAt: new Date('2026-10-20T09:00:00Z'),
        },
      });

      const commitRes = await offerCommitService.commitJobOffers(job.id);
      expect(commitRes.skippedCount).toBe(1);
      expect(commitRes.committedCount).toBe(0);
      expect(commitRes.itemOutcomes[0].reason).toContain('stale_import_older_than_last_observed_offer');

      // Live offer is untouched
      const liveOffer = await prisma.supplierOffer.findUniqueOrThrow({
        where: { supplierId_skuId: { supplierId, skuId: sku1Id } },
      });
      expect(liveOffer.costPrice.toNumber()).toBe(120);
      expect(liveOffer.lastObservedAt.toISOString()).toBe(newerTimestamp.toISOString());
    });

    it('Invariant 6: approve-deactivations enforces Admin authorization, supplier scope, audit trail, and exact change set', async () => {
      await prisma.supplierOffer.createMany({
        data: [
          { supplierId, skuId: sku1Id, costPrice: 100, currency: 'SAR', isAvailable: true },
          { supplierId, skuId: sku2Id, costPrice: 200, currency: 'SAR', isAvailable: true },
          { supplierId, skuId: sku3Id, costPrice: 300, currency: 'SAR', isAvailable: true },
        ],
      });

      // Snapshot with only SKU 1 (missing SKU 2 and SKU 3)
      const job = await prisma.ingestionJob.create({
        data: { supplierId, status: IngestionStatus.review_required, mode: IngestionImportMode.FULL_SNAPSHOT },
      });
      await prisma.ingestionItem.create({
        data: {
          jobId: job.id,
          supplierSkuCode: 'SUP-SKU-1',
          name: 'Moisturizing Cream 50ml',
          brand: 'SG05 Brand',
          price: 105,
          priceType: IngestionPriceType.PURCHASE_COST,
          currency: 'SAR',
          reportedQuantity: 20,
          matchedSkuId: sku1Id,
          status: IngestionStatus.approved,
        },
      });

      // 1. Non-admin authorization check
      const supplierActor = await createActor(prisma, 'SUPPLIER', supplierId);
      await expect(
        offerCommitService.approveDeactivations(job.id, supplierActor.id, { confirmedAssortmentCoverage: true }),
      ).rejects.toThrow('Only administrators can approve supplier catalog deactivations');

      // 2. Mismatched supplier scope check
      const otherSupplier = await prisma.supplier.create({
        data: { name: `Other Supplier ${Date.now()}`, slug: `other-supp-${Date.now()}` },
      });
      await expect(
        offerCommitService.approveDeactivations(job.id, admin.id, {
          supplierId: otherSupplier.id,
          confirmedAssortmentCoverage: true,
        }),
      ).rejects.toThrow('Job does not belong to specified supplier scope');

      // 3. Exact reviewed change set (only approve SKU 2, do not deactivate SKU 3)
      const approveRes = await offerCommitService.approveDeactivations(job.id, admin.id, {
        supplierId,
        confirmedAssortmentCoverage: true,
        approvedSkuIds: [sku2Id],
      });
      expect(approveRes.deactivatedCount).toBe(1);
      expect(approveRes.deactivatedSkuIds).toEqual([sku2Id]);

      // SKU 2 is deactivated, SKU 3 remains available!
      const offer2 = await prisma.supplierOffer.findUniqueOrThrow({
        where: { supplierId_skuId: { supplierId, skuId: sku2Id } },
      });
      expect(offer2.isAvailable).toBe(false);

      const offer3 = await prisma.supplierOffer.findUniqueOrThrow({
        where: { supplierId_skuId: { supplierId, skuId: sku3Id } },
      });
      expect(offer3.isAvailable).toBe(true);

      // 4. Audit evidence written in NotificationOutbox
      const auditLog = await prisma.notificationOutbox.findFirst({
        where: {
          eventType: 'ingestion.offers_deactivated',
          aggregateId: job.id,
        },
      });
      expect(auditLog).toBeDefined();
      expect((auditLog?.payload as any).approvedBy).toBe(admin.id);
      expect((auditLog?.payload as any).deactivatedSkuIds).toContain(sku2Id);
    });

    it('Invariant 7: Rejected or invalid rows do not abort an otherwise safe batch', async () => {
      const job = await prisma.ingestionJob.create({
        data: { supplierId, status: IngestionStatus.review_required },
      });

      // Row 1: Rejected item
      await prisma.ingestionItem.create({
        data: {
          jobId: job.id,
          supplierSkuCode: 'SUP-REJECTED',
          name: 'Rejected Product',
          brand: 'SG05 Brand',
          price: 50,
          priceType: IngestionPriceType.PURCHASE_COST,
          currency: 'SAR',
          matchedSkuId: sku1Id,
          status: IngestionStatus.rejected,
        },
      });

      // Row 2: Invalid price (<= 0)
      await prisma.ingestionItem.create({
        data: {
          jobId: job.id,
          supplierSkuCode: 'SUP-INVALID-PRICE',
          name: 'Zero Price Product',
          brand: 'SG05 Brand',
          price: 0,
          priceType: IngestionPriceType.PURCHASE_COST,
          currency: 'SAR',
          matchedSkuId: sku2Id,
          status: IngestionStatus.approved,
        },
      });

      // Row 3: Valid item
      await prisma.ingestionItem.create({
        data: {
          jobId: job.id,
          supplierSkuCode: 'SUP-VALID',
          name: 'Valid Product 200ml',
          brand: 'SG05 Brand',
          price: 175,
          priceType: IngestionPriceType.PURCHASE_COST,
          currency: 'SAR',
          matchedSkuId: sku3Id,
          status: IngestionStatus.approved,
        },
      });

      const commitRes = await offerCommitService.commitJobOffers(job.id);
      expect(commitRes.committedCount).toBe(1);
      expect(commitRes.skippedCount).toBe(1);
      expect(commitRes.errorCount).toBe(1);

      // Valid item offer was committed
      const committedOffer = await prisma.supplierOffer.findUniqueOrThrow({
        where: { supplierId_skuId: { supplierId, skuId: sku3Id } },
      });
      expect(committedOffer.costPrice.toNumber()).toBe(175);

      // Invalid rows did not create offers
      const invalidOffer = await prisma.supplierOffer.findUnique({
        where: { supplierId_skuId: { supplierId, skuId: sku2Id } },
      });
      expect(invalidOffer).toBeNull();
    });

    it('Invariant 8: Wholesale offer updates strictly preserve customer selling prices and purchase orders', async () => {
      // 1. Set customer selling price in commerce.selling_prices
      const customerPrice = await prisma.sellingPrice.create({
        data: {
          skuId: sku1Id,
          amount: 250,
          currency: 'SAR',
          validFrom: new Date(),
          isActive: true,
        },
      });

      // 2. Set committed purchase order line
      const po = await prisma.supplierPurchaseOrder.create({
        data: {
          supplierId,
          status: 'confirmed',
          notes: 'Test PO',
        },
      });
      const poLine = await prisma.purchaseOrderLine.create({
        data: {
          purchaseOrderId: po.id,
          skuId: sku1Id,
          requestedQuantity: 10,
          confirmedQuantity: 10,
          unitCost: 80, // Committed agreed purchase price
          currency: 'SAR',
          status: 'confirmed_full',
        },
      });

      // 3. Batch commit updating supplier wholesale cost to 140 SAR
      const job = await prisma.ingestionJob.create({
        data: { supplierId, status: IngestionStatus.review_required },
      });
      await prisma.ingestionItem.create({
        data: {
          jobId: job.id,
          supplierSkuCode: 'SUP-SKU-1',
          name: 'Moisturizing Cream 50ml',
          brand: 'SG05 Brand',
          price: 140,
          priceType: IngestionPriceType.PURCHASE_COST,
          currency: 'SAR',
          matchedSkuId: sku1Id,
          status: IngestionStatus.approved,
        },
      });

      await offerCommitService.commitJobOffers(job.id);

      // Verify SupplierOffer cost updated to 140
      const offer = await prisma.supplierOffer.findUniqueOrThrow({
        where: { supplierId_skuId: { supplierId, skuId: sku1Id } },
      });
      expect(offer.costPrice.toNumber()).toBe(140);

      // Assert customer-facing selling price is STRICTLY UNCHANGED (250 SAR)
      const priceAfter = await prisma.sellingPrice.findUniqueOrThrow({ where: { id: customerPrice.id } });
      expect(priceAfter.amount.toNumber()).toBe(250);

      // Assert committed PurchaseOrderLine unit cost is STRICTLY UNCHANGED (80 SAR)
      const poLineAfter = await prisma.purchaseOrderLine.findUniqueOrThrow({ where: { id: poLine.id } });
      expect(poLineAfter.unitCost.toNumber()).toBe(80);
      expect(poLineAfter.confirmedQuantity).toBe(10);
    });
  });
});

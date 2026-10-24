import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { SourcingService } from '../../src/modules/sourcing/public';
import { CatalogService } from '../../src/modules/catalog/public';
import { createActor, Actor } from '../fixtures/actors';
import { reviewCandidateMedia } from '../fixtures/candidate-review';
import { randomUUID } from 'crypto';
import { IngestionStatus, IngestionImportMode, IngestionPriceType } from '@prisma/client';

describe('SG-11 Full End-to-End Verification: Real Supplier Portal, PO Workflow, and Admin Catalog Review', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sourcingService: SourcingService;
  let catalogService: CatalogService;

  let admin: Actor;
  let hubOperator: Actor;
  let supplierA: Actor;
  let supplierB: Actor;

  const supplierAId = randomUUID();
  const supplierBId = randomUUID();

  let testBrandId: string;
  let testProductId: string;
  let testSku1Id: string;
  let testSku2Id: string;
  let testSku3Id: string;

  let poAId: string;
  let poBId: string;
  let poALine1Id: string;
  let poALine2Id: string;
  let poALine3Id: string;

  let jobUploadId: string;
  let candidateId: string;
  let jobCandidateId: string;
  let payableId: string;

  const cleanupSkuIds: string[] = [];
  const cleanupProductIds: string[] = [];
  const cleanupBrandIds: string[] = [];
  const cleanupJobIds: string[] = [];
  const cleanupCandidateIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = app.get(PrismaService);
    sourcingService = app.get(SourcingService);
    catalogService = app.get(CatalogService);

    // 1. Create Supplier entities
    await prisma.supplier.create({
      data: {
        id: supplierAId,
        name: `Supplier A Nile Co ${Date.now()}`,
        slug: `supplier-a-${Date.now()}`,
      },
    });

    await prisma.supplier.create({
      data: {
        id: supplierBId,
        name: `Supplier B Ahram Co ${Date.now()}`,
        slug: `supplier-b-${Date.now()}`,
      },
    });

    // 2. Create authenticated actors
    admin = await createActor(prisma, 'ADMIN');
    hubOperator = await createActor(prisma, 'HUB_OPERATOR');
    supplierA = await createActor(prisma, 'SUPPLIER', supplierAId);
    supplierB = await createActor(prisma, 'SUPPLIER', supplierBId);

    // 3. Create Brand, Product, and 3 SKUs
    testBrandId = randomUUID();
    cleanupBrandIds.push(testBrandId);
    await prisma.brand.create({
      data: {
        id: testBrandId,
        name: `Brand Cerave E2E ${Date.now()}`,
        slug: `cerave-e2e-${Date.now()}`,
      },
    });

    testProductId = randomUUID();
    cleanupProductIds.push(testProductId);
    await prisma.product.create({
      data: {
        id: testProductId,
        brandId: testBrandId,
        name: `Moisturizing Cream E2E ${Date.now()}`,
        slug: `moist-cream-e2e-${Date.now()}`,
        isPublished: true,
      },
    });

    testSku1Id = randomUUID();
    cleanupSkuIds.push(testSku1Id);
    await prisma.sku.create({
      data: {
        id: testSku1Id,
        productId: testProductId,
        code: `SKU-CRV-50-${Date.now()}`,
        variantName: '50ml',
        size: 50,
        sizeUnit: 'ml',
        barcode: `622100${Date.now().toString().slice(-7)}`,
        isActive: true,
      },
    });

    testSku2Id = randomUUID();
    cleanupSkuIds.push(testSku2Id);
    await prisma.sku.create({
      data: {
        id: testSku2Id,
        productId: testProductId,
        code: `SKU-CRV-177-${Date.now()}`,
        variantName: '177ml',
        size: 177,
        sizeUnit: 'ml',
        barcode: `622200${Date.now().toString().slice(-7)}`,
        isActive: true,
      },
    });

    testSku3Id = randomUUID();
    cleanupSkuIds.push(testSku3Id);
    await prisma.sku.create({
      data: {
        id: testSku3Id,
        productId: testProductId,
        code: `SKU-CRV-340-${Date.now()}`,
        variantName: '340ml',
        size: 340,
        sizeUnit: 'ml',
        barcode: `622300${Date.now().toString().slice(-7)}`,
        isActive: true,
      },
    });

    // 4. Pre-create an initial SupplierOffer for Supplier A on SKU 1
    await prisma.supplierOffer.create({
      data: {
        supplierId: supplierAId,
        skuId: testSku1Id,
        costPrice: 200.0,
        isAvailable: true,
        currency: 'EGP',
      },
    });

    // 5. Create PO for Supplier A with 3 lines
    poAId = randomUUID();
    poALine1Id = randomUUID();
    poALine2Id = randomUUID();
    poALine3Id = randomUUID();

    await prisma.supplierPurchaseOrder.create({
      data: {
        id: poAId,
        supplierId: supplierAId,
        status: 'created',
        lines: {
          create: [
            {
              id: poALine1Id,
              skuId: testSku1Id,
              requestedQuantity: 10,
              unitCost: 200.0,
              currency: 'EGP',
              status: 'pending',
            },
            {
              id: poALine2Id,
              skuId: testSku2Id,
              requestedQuantity: 5,
              unitCost: 400.0,
              currency: 'EGP',
              status: 'pending',
            },
            {
              id: poALine3Id,
              skuId: testSku3Id,
              requestedQuantity: 8,
              unitCost: 550.0,
              currency: 'EGP',
              status: 'pending',
            },
          ],
        },
      },
    });

    // 6. Create PO for Supplier B to verify isolation
    poBId = randomUUID();
    await prisma.supplierPurchaseOrder.create({
      data: {
        id: poBId,
        supplierId: supplierBId,
        status: 'created',
        lines: {
          create: [
            {
              id: randomUUID(),
              skuId: testSku1Id,
              requestedQuantity: 15,
              unitCost: 195.0,
              currency: 'EGP',
              status: 'pending',
            },
          ],
        },
      },
    });
  });

  afterAll(async () => {
    if (cleanupCandidateIds.length > 0) {
      await prisma.productContentDraft.deleteMany({ where: { candidateId: { in: cleanupCandidateIds } } });
      await prisma.ingestionItem.deleteMany({ where: { id: { in: cleanupCandidateIds } } });
    }
    await prisma.supplierOffer.deleteMany({ where: { supplierId: { in: [supplierAId, supplierBId] } } });
    await prisma.payableAdjustment.deleteMany({});
    if (payableId) {
      await prisma.supplierPayable.deleteMany({ where: { id: payableId } });
    }
    await prisma.supplierPayable.deleteMany({ where: { supplierId: { in: [supplierAId, supplierBId] } } });
    await prisma.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: { in: [poAId, poBId] } } });
    await prisma.supplierPurchaseOrder.deleteMany({ where: { id: { in: [poAId, poBId] } } });
    if (cleanupJobIds.length > 0) {
      await prisma.ingestionItem.deleteMany({ where: { jobId: { in: cleanupJobIds } } });
      await prisma.ingestionJob.deleteMany({ where: { id: { in: cleanupJobIds } } });
    }
    if (cleanupSkuIds.length > 0) {
      await prisma.sku.deleteMany({ where: { id: { in: cleanupSkuIds } } });
    }
    if (cleanupProductIds.length > 0) {
      await prisma.product.deleteMany({ where: { id: { in: cleanupProductIds } } });
    }
    if (cleanupBrandIds.length > 0) {
      await prisma.brand.deleteMany({ where: { id: { in: cleanupBrandIds } } });
    }
    await prisma.session.deleteMany({ where: { customerId: { in: [admin.id, hubOperator.id, supplierA.id, supplierB.id] } } });
    await prisma.customer.deleteMany({ where: { id: { in: [admin.id, hubOperator.id, supplierA.id, supplierB.id] } } });
    await prisma.supplier.deleteMany({ where: { id: { in: [supplierAId, supplierBId] } } });

    await app.close();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SCENARIO 1 & 2: Multi-Tenant Isolation & Cross-Tenant Access Restrictions
  // ───────────────────────────────────────────────────────────────────────────

  describe('Scenario 1 & 2: Multi-Tenant Isolation & Cross-Tenant Security', () => {
    it('prevents Supplier A from viewing Supplier B purchase orders (403 Forbidden)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/purchase-orders/${poBId}`)
        .set(supplierA.auth);

      expect(res.status).toBe(403);
    });

    it('prevents Supplier B from viewing Supplier A purchase orders (403 Forbidden)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/purchase-orders/${poAId}`)
        .set(supplierB.auth);

      expect(res.status).toBe(403);
    });

    it('allows Supplier A to view its own purchase order with populated SkuLabels (200 OK)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/purchase-orders/${poAId}`)
        .set(supplierA.auth);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(poAId);
      expect(res.body.lines.length).toBe(3);

      // Verify SkuLabel richness
      const line1 = res.body.lines.find((l: any) => l.skuId === testSku1Id);
      expect(line1).toBeDefined();
      expect(line1.sku).toBeDefined();
      expect(line1.sku.skuCode).toContain('SKU-CRV-50');
      expect(line1.sku.size).toBe(50);
      expect(line1.sku.sizeUnit).toBe('ml');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SCENARIO 3: Complete PO Confirmation Lifecycle (Full, Partial, Unavailable, Price-Change, then Ready)
  // ───────────────────────────────────────────────────────────────────────────

  describe('Scenario 3: Complete PO Confirmation Lifecycle', () => {
    it('allows Supplier A to confirm lines with full, partial, and price_change exceptions', async () => {
      const res = await request(app.getHttpServer())
        .post(`/purchase-orders/${poAId}/confirm`)
        .set(supplierA.auth)
        .send({
          lines: [
            {
              id: poALine1Id,
              status: 'confirmed_full',
            },
            {
              id: poALine2Id,
              status: 'confirmed_partial',
              confirmedQuantity: 3,
              exceptionCode: 'OUT_OF_STOCK',
              exceptionNote: 'Only 3 units remaining in warehouse today',
            },
            {
              id: poALine3Id,
              status: 'price_changed',
              proposedUnitCost: 570.0,
              exceptionNote: 'Supplier factory cost changed to 570 EGP',
            },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('partial');
      expect(res.body.confirmedAt).toBeDefined();

      const poInDb = await prisma.supplierPurchaseOrder.findUnique({
        where: { id: poAId },
        include: { lines: true },
      });

      expect(poInDb!.status).toBe('partial');
      const line1 = poInDb!.lines.find((l) => l.id === poALine1Id)!;
      const line2 = poInDb!.lines.find((l) => l.id === poALine2Id)!;
      const line3 = poInDb!.lines.find((l) => l.id === poALine3Id)!;

      expect(line1.status).toBe('confirmed_full');
      expect(line1.confirmedQuantity).toBe(10);

      expect(line2.status).toBe('confirmed_partial');
      expect(line2.confirmedQuantity).toBe(3);
      expect(line2.exceptionCode).toBe('OUT_OF_STOCK');

      expect(line3.status).toBe('price_changed');
      expect(line3.proposedUnitCost!.toNumber()).toBe(570.0);
    });

    it('allows Supplier A to declare PO Ready for pickup, strictly preserving Ready != Hub Received', async () => {
      const res = await request(app.getHttpServer())
        .post(`/purchase-orders/${poAId}/ready`)
        .set(supplierA.auth);

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('ready');

      const poInDb = await prisma.supplierPurchaseOrder.findUnique({
        where: { id: poAId },
      });

      expect(poInDb!.status).toBe('ready');
      expect(poInDb!.readyAt).toBeDefined();
      // Crucial Architecture Invariant: Supplier Ready DOES NOT equal Hub Received
      expect(poInDb!.receivedAt).toBeNull();
    });

    it('prevents redundant or duplicate confirmation after PO is already ready', async () => {
      const res = await request(app.getHttpServer())
        .post(`/purchase-orders/${poAId}/confirm`)
        .set(supplierA.auth)
        .send({
          lines: [
            { id: poALine1Id, status: 'confirmed_full' },
            { id: poALine2Id, status: 'confirmed_full' },
            { id: poALine3Id, status: 'confirmed_full' },
          ],
        });

      // Cannot re-confirm an already ready purchase order
      expect(res.status).toBe(409);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SCENARIO 4 & 5: Real CSV File Upload, Column Mapping, Staged Diff Preview & Commit
  // ───────────────────────────────────────────────────────────────────────────

  describe('Scenario 4 & 5: Real CSV Upload, Interactive Mapping & Safe Commit', () => {
    it('uploads a real CSV file and flags that column mapping is required', async () => {
      const csvData = [
        'كود_المورد,اسم_المستحضر,الباركود,سعر_التكلفة',
        `SUP-CRV-50,CeraVe Moisturizing Cream 50ml,6221000000001,230.00`,
        `SUP-NEW-SERUM,ShinaCare Barrier Recovery Serum 30ml,6229990000001,175.00`,
      ].join('\n');

      const res = await request(app.getHttpServer())
        .post('/ingestion/jobs/upload')
        .set(supplierA.auth)
        .field('supplierId', supplierAId)
        .field('mode', IngestionImportMode.PARTIAL_UPDATE)
        .attach('file', Buffer.from(csvData, 'utf8'), {
          filename: 'supplier_catalog_e2e.csv',
          contentType: 'text/csv',
        });

      expect(res.status).toBe(201);
      expect(res.body.jobId).toBeDefined();
      jobUploadId = res.body.jobId;
      cleanupJobIds.push(jobUploadId);

      expect(res.body.requiresMapping).toBe(true);
      expect(res.body.sampleHeaders).toContain('كود_المورد');
      expect(res.body.sampleHeaders).toContain('سعر_التكلفة');
    });

    it('prevents Supplier B from viewing Supplier A uploaded job diff (403 Forbidden)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/ingestion/jobs/${jobUploadId}/diff`)
        .set(supplierB.auth);

      expect(res.status).toBe(403);
    });

    it('lets the admin approve the interactive column mapping (suppliers only propose) for the uploaded job', async () => {
      const res = await request(app.getHttpServer())
        .post(`/ingestion/jobs/${jobUploadId}/mapping`)
        .set(admin.auth)
        .send({
          profileName: 'Standard Nile CSV Layout',
          mapping: {
            supplierSku: 'كود_المورد',
            name: 'اسم_المستحضر',
            barcode: 'الباركود',
            price: 'سعر_التكلفة',
            currency: 'EGP',
            semantics: { documentKind: 'PRICE_LIST', priceBasis: 'UNIT_PURCHASE_COST' },
          },
        });

      expect(res.status).toBe(201);
      expect(res.body.jobId).toBe(jobUploadId);
      expect(res.body.importedItemsCount).toBe(2);

      // Verify items were extracted and stored
      const items = await prisma.ingestionItem.findMany({
        where: { jobId: jobUploadId },
      });
      expect(items.length).toBe(2);
      expect(items.some((i) => i.supplierSkuCode === 'SUP-CRV-50')).toBe(true);
      expect(items.some((i) => i.supplierSkuCode === 'SUP-NEW-SERUM')).toBe(true);
    });

    it('computes staged diff preview correctly with row classifications', async () => {
      // Map the first item to testSku1Id so it shows as price update
      const item1 = await prisma.ingestionItem.findFirst({
        where: { jobId: jobUploadId, supplierSkuCode: 'SUP-CRV-50' },
      });
      await prisma.ingestionItem.update({
        where: { id: item1!.id },
        data: { matchedSkuId: testSku1Id },
      });

      const res = await request(app.getHttpServer())
        .get(`/ingestion/jobs/${jobUploadId}/diff`)
        .set(supplierA.auth);

      expect(res.status).toBe(200);
      expect(res.body.jobId).toBe(jobUploadId);
      expect(res.body.counters).toBeDefined();

      // Item 1 had cost 200.0, new cost is 230.0 -> updated (15% jump <= 30%)
      expect(res.body.counters.updated).toBe(1);
      // Item 2 is unmatched candidate -> skipped from offer commit, requires catalog admission
      expect(res.body.counters.skipped).toBe(1);
      const skippedRow = res.body.rows.find((r: any) => !r.matchedSkuId);
      expect(skippedRow).toBeDefined();
      expect(skippedRow.reasons).toContain('unmatched_candidate_requires_catalog_admission');
    });

    it('safely commits matched offers to SupplierOffer in database', async () => {
      const res = await request(app.getHttpServer())
        .post(`/ingestion/jobs/${jobUploadId}/commit-offers`)
        .set(supplierA.auth)
        .send({ autoApplyLowRisk: true });

      expect(res.status).toBe(201);
      expect(res.body.committedCount).toBe(1);

      // Verify database persistence: costPrice was updated from 200 to 230
      const offer = await prisma.supplierOffer.findUnique({
        where: {
          supplierId_skuId: {
            supplierId: supplierAId,
            skuId: testSku1Id,
          },
        },
      });

      expect(offer).toBeDefined();
      expect(offer!.costPrice.toNumber()).toBe(230.0);
      expect(offer!.isAvailable).toBe(true);
    });

    it('re-committing the same published job is idempotent and safe', async () => {
      const res = await request(app.getHttpServer())
        .post(`/ingestion/jobs/${jobUploadId}/commit-offers`)
        .set(supplierA.auth)
        .send({ autoApplyLowRisk: true });

      expect(res.status).toBe(201);
      // Nothing is committed twice. The job still holds a new-product candidate awaiting Admin review, so it is not
      // reported as fully published.
      expect(['ALREADY_PUBLISHED', 'review_required']).toContain(res.body.status);
      expect(res.body.committedCount).toBe(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SCENARIO 6 & 7: Catalog Review Privilege Gate (Unknown Product Candidate)
  // ───────────────────────────────────────────────────────────────────────────

  describe('Scenario 6 & 7: Catalog Review Privilege Gate & Admin Review', () => {
    beforeAll(async () => {
      jobCandidateId = randomUUID();
      cleanupJobIds.push(jobCandidateId);

      await prisma.ingestionJob.create({
        data: {
          id: jobCandidateId,
          supplierId: supplierAId,
          status: IngestionStatus.pending,
          mode: IngestionImportMode.PARTIAL_UPDATE,
        },
      });

      candidateId = randomUUID();
      cleanupCandidateIds.push(candidateId);

      await prisma.ingestionItem.create({
        data: {
          id: candidateId,
          jobId: jobCandidateId,
          supplierSkuCode: 'CAND-NEW-BARRIER',
          name: 'ShinaCare Advanced Barrier Repair Emulsion',
          brand: 'ShinaLab',
          price: 260.0,
          priceType: IngestionPriceType.PURCHASE_COST,
          currency: 'EGP',
          status: IngestionStatus.review_required,
          enrichment: {
            size: 50,
            sizeUnit: 'ml',
            variantName: '50ml Pump',
          },
        },
      });
    });

    it('denies Supplier and Hub Operator from approving or publishing candidates (403 Forbidden)', async () => {
      const resSupplierApprove = await request(app.getHttpServer())
        .patch(`/ingestion/candidates/${candidateId}/approve`)
        .set(supplierA.auth)
        .send({ matchedSkuId: testSku1Id });
      expect(resSupplierApprove.status).toBe(403);

      const resHubApprove = await request(app.getHttpServer())
        .patch(`/ingestion/candidates/${candidateId}/approve`)
        .set(hubOperator.auth)
        .send({ matchedSkuId: testSku1Id });
      expect(resHubApprove.status).toBe(403);

      const resSupplierPublish = await request(app.getHttpServer())
        .post(`/ingestion/candidates/${candidateId}/publish`)
        .set(supplierA.auth);
      expect(resSupplierPublish.status).toBe(403);

      const resHubPublish = await request(app.getHttpServer())
        .post(`/ingestion/candidates/${candidateId}/publish`)
        .set(hubOperator.auth);
      expect(resHubPublish.status).toBe(403);
    });

    it('allows Admin to view candidate review record (200 OK)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/ingestion/candidates/${candidateId}/review-record`)
        .set(admin.auth);

      expect(res.status).toBe(200);
      expect(res.body.candidateId).toBe(candidateId);
      expect(res.body.normalizedIdentity.name).toBe('ShinaCare Advanced Barrier Repair Emulsion');
      expect(res.body.status).toBe(IngestionStatus.review_required);
    });

    it('allows Admin to field-correct candidate (200 OK)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/ingestion/candidates/${candidateId}/correct`)
        .set(admin.auth)
        .send({
          name: 'ShinaCare Barrier Repair Emulsion 50ml (Official)',
          reason: 'Correcting product title to match official carton text',
        });

      expect(res.status).toBe(200);
      expect(res.body.normalizedIdentity.name).toBe('ShinaCare Barrier Repair Emulsion 50ml (Official)');

      const item = await prisma.ingestionItem.findUnique({ where: { id: candidateId } });
      expect(item!.name).toBe('ShinaCare Barrier Repair Emulsion 50ml (Official)');
    });

    it('allows Admin to approve candidate item against canonical catalog SKU (200 OK)', async () => {
      // Approval needs a human media review (verified packshot) and a barcode that equals the canonical SKU's.
      const sku2 = await prisma.sku.findUniqueOrThrow({ where: { id: testSku2Id } });
      const sku2Product = await prisma.product.findUniqueOrThrow({ where: { id: sku2.productId }, include: { brand: true } });
      await prisma.ingestionItem.update({ where: { id: candidateId }, data: {
        barcode: sku2.barcode, name: sku2Product.name + ' 177ml', brand: sku2Product.brand.name,
        enrichment: { size: 177, sizeUnit: 'ml', variantName: '177ml' },
      } });
      await prisma.sku.update({ where: { id: testSku2Id }, data: { variantName: '177 ml' } }); // the reviewed media names the variant
      const mediaReviews = await reviewCandidateMedia(app, admin.auth, candidateId, sku2.barcode!, 177, 'ml');
      const res = await request(app.getHttpServer())
        .patch(`/ingestion/candidates/${candidateId}/approve`)
        .set(admin.auth)
        .send({ matchedSkuId: testSku2Id, mediaReviews });

      expect(res.status).toBe(200);

      const item = await prisma.ingestionItem.findUnique({ where: { id: candidateId } });
      expect(item!.status).toBe(IngestionStatus.approved);
      expect(item!.matchedSkuId).toBe(testSku2Id);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SCENARIO 8: Supplier Payables & Return Credit Adjustment Seam
  // ───────────────────────────────────────────────────────────────────────────

  describe('Scenario 8: Supplier Payables & Return Credit Adjustment Seam', () => {
    beforeAll(async () => {
      payableId = randomUUID();
      await prisma.supplierPayable.create({
        data: {
          id: payableId,
          supplier: { connect: { id: supplierAId } },
          purchaseOrder: { connect: { id: poAId } },
          amount: 600.0,
          currency: 'EGP',
          status: 'open',
          dueDate: new Date(Date.now() + 86400000 * 15),
          basis: [{ lineId: poALine1Id, lineAmount: '600.00' }],
        },
      });
    });

    it('denies Hub Operator from applying supplier return credit (403 Forbidden)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/sourcing/payables/${payableId}/apply-credit`)
        .set(hubOperator.auth)
        .send({
          creditAmount: 100.0,
          supplierReturnRef: 'RET-SG11-E2E-001',
          reason: 'Return credit adjustment for damaged units',
        });

      expect(res.status).toBe(403);
    });

    it('allows Admin to apply return credit, preserving gross acquisition basis (201 Created)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/sourcing/payables/${payableId}/apply-credit`)
        .set(admin.auth)
        .send({
          creditAmount: 100.0,
          supplierReturnRef: 'RET-SG11-E2E-001',
          reason: 'Return credit adjustment for damaged units',
        });

      expect(res.status).toBe(201);
      expect(res.body.adjustmentId).toBeDefined();
      expect(res.body.creditApplied).toBe(100.0);
      expect(res.body.netAmount).toBe(500.0);
    });

    it('lists payables showing gross acquisition cost 600, credit 100, and net cash due 500 EGP', async () => {
      const res = await request(app.getHttpServer())
        .get(`/sourcing/payables?supplierId=${supplierAId}`)
        .set(admin.auth);

      expect(res.status).toBe(200);
      const target = res.body.items.find((p: any) => p.id === payableId);
      expect(target).toBeDefined();
      expect(target.grossAmount).toBe(600.0);
      expect(target.creditApplied).toBe(100.0);
      expect(target.netAmount).toBe(500.0);
    });
  });
});

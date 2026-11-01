import { attachPurchaseOrderLineage } from '../fixtures/purchase-order-lineage';
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

describe('SG-11: Real Supplier Portal, PO Workflow, and Admin Catalog Review (e2e)', () => {
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
  const jobAId = randomUUID();
  const jobBId = randomUUID();

  let testSku1Id: string;
  let testSku2Id: string;
  let poAId: string;
  let poBId: string;
  let candidateId: string;
  let jobCandidateId: string;
  let payableId: string;

  const cleanupCandidateIds: string[] = [];
  const cleanupSkuIds: string[] = [];
  const cleanupProductIds: string[] = [];
  const cleanupBrandIds: string[] = [];

  let cleanupLineage: (() => Promise<void>) | undefined;
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

    // Create suppliers
    await prisma.supplier.create({
      data: {
        id: supplierAId,
        name: `Supplier A ${Date.now()}`,
        slug: `supplier-a-${Date.now()}`,
      },
    });

    await prisma.supplier.create({
      data: {
        id: supplierBId,
        name: `Supplier B ${Date.now()}`,
        slug: `supplier-b-${Date.now()}`,
      },
    });

    // Create actors
    admin = await createActor(prisma, 'ADMIN');
    hubOperator = await createActor(prisma, 'HUB_OPERATOR');
    supplierA = await createActor(prisma, 'SUPPLIER', supplierAId);
    supplierB = await createActor(prisma, 'SUPPLIER', supplierBId);

    // Create a brand and 2 canonical SKUs for testing POs and offers
    const brandId = randomUUID();
    cleanupBrandIds.push(brandId);
    await prisma.brand.create({
      data: {
        id: brandId,
        name: `Brand SG11 ${Date.now()}`,
        slug: `brand-sg11-${Date.now()}`,
      },
    });

    const productId = randomUUID();
    cleanupProductIds.push(productId);
    await prisma.product.create({
      data: {
        id: productId,
        brandId,
        name: `Product SG11 ${Date.now()}`,
        slug: `product-sg11-${Date.now()}`,
        isPublished: true,
      },
    });

    testSku1Id = randomUUID();
    cleanupSkuIds.push(testSku1Id);
    await prisma.sku.create({
      data: {
        id: testSku1Id,
        productId,
        code: `SKU-SG11-1-${Date.now()}`,
        variantName: '50ml',
        size: 50,
        sizeUnit: 'ml',
        barcode: `62211${Date.now().toString().slice(-8)}`,
        isActive: true,
      },
    });

    testSku2Id = randomUUID();
    cleanupSkuIds.push(testSku2Id);
    await prisma.sku.create({
      data: {
        id: testSku2Id,
        productId,
        code: `SKU-SG11-2-${Date.now()}`,
        variantName: '100ml',
        size: 100,
        sizeUnit: 'ml',
        barcode: `62212${Date.now().toString().slice(-8)}`,
        isActive: true,
      },
    });

    // Create PO for Supplier A with 2 lines
    poAId = randomUUID();
    await prisma.supplierPurchaseOrder.create({
      data: {
        id: poAId,
        supplierId: supplierAId,
        status: 'created',
        lines: {
          create: [
            {
              id: randomUUID(),
              skuId: testSku1Id,
              requestedQuantity: 10,
              unitCost: 100.0,
              currency: 'EGP',
              status: 'pending',
            },
            {
              id: randomUUID(),
              skuId: testSku2Id,
              requestedQuantity: 5,
              unitCost: 200.0,
              currency: 'EGP',
              status: 'pending',
            },
          ],
        },
      },
    });

    // Create PO for Supplier B
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
              requestedQuantity: 2,
              unitCost: 95.0,
              currency: 'EGP',
              status: 'pending',
            },
          ],
        },
      },
    });

    // Create Ingestion Jobs for Supplier A & B
    await prisma.ingestionJob.create({
      data: {
        id: jobAId,
        supplierId: supplierAId,
        status: IngestionStatus.pending,
        mode: IngestionImportMode.PARTIAL_UPDATE,
        items: {
          create: [
            {
              id: randomUUID(),
              supplierSkuCode: 'SUP-A-001',
              name: 'Supplier A Test Serum',
              brand: 'TestBrand',
              price: 110.0,
              priceType: IngestionPriceType.PURCHASE_COST,
              currency: 'EGP',
              matchedSkuId: testSku1Id,
              status: IngestionStatus.pending,
            },
          ],
        },
      },
    });

    await prisma.ingestionJob.create({
      data: {
        id: jobBId,
        supplierId: supplierBId,
        status: IngestionStatus.pending,
        mode: IngestionImportMode.PARTIAL_UPDATE,
        items: {
          create: [
            {
              id: randomUUID(),
              supplierSkuCode: 'SUP-B-001',
              name: 'Supplier B Exclusive',
              brand: 'TestBrand',
              price: 90.0,
              priceType: IngestionPriceType.PURCHASE_COST,
              currency: 'EGP',
              matchedSkuId: testSku2Id,
              status: IngestionStatus.pending,
            },
          ],
        },
      },
    });
    cleanupLineage = await attachPurchaseOrderLineage(prisma, poAId);
  });

  afterAll(async () => {
    await cleanupLineage?.();
    if (cleanupCandidateIds.length > 0) {
      await prisma.productContentDraft.deleteMany({ where: { candidateId: { in: cleanupCandidateIds } } });
      await prisma.ingestionItem.deleteMany({ where: { id: { in: cleanupCandidateIds } } });
    }
    await prisma.supplierOffer.deleteMany({ where: { supplierId: { in: [supplierAId, supplierBId] } } });
    await prisma.payableAdjustment.deleteMany({});
    await prisma.supplierPayable.deleteMany({ where: { supplierId: supplierAId } });
    await prisma.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: { in: [poAId, poBId] } } });
    await prisma.supplierPurchaseOrder.deleteMany({ where: { id: { in: [poAId, poBId] } } });
    await prisma.ingestionItem.deleteMany({ where: { jobId: { in: [jobAId, jobBId, jobCandidateId].filter(Boolean) } } });
    await prisma.ingestionJob.deleteMany({ where: { id: { in: [jobAId, jobBId, jobCandidateId].filter(Boolean) } } });
    if (cleanupSkuIds.length > 0) {
      await prisma.sku.deleteMany({ where: { id: { in: cleanupSkuIds } } });
    }
    if (cleanupProductIds.length > 0) {
      await prisma.product.deleteMany({ where: { id: { in: cleanupProductIds } } });
    }
    if (cleanupBrandIds.length > 0) {
      await prisma.brand.deleteMany({ where: { id: { in: cleanupBrandIds } } });
    }
    await prisma.customer.deleteMany({
      where: { id: { in: [admin.id, hubOperator.id, supplierA.id, supplierB.id] } },
    });
    await prisma.supplier.deleteMany({ where: { id: { in: [supplierAId, supplierBId] } } });
    await app.close();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Supplier Isolation & Security Scope
  // ───────────────────────────────────────────────────────────────────────────

  describe('1. Supplier Isolation & Security Scope', () => {
    it('prevents Supplier A from viewing Supplier B purchase orders (403 Forbidden)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/purchase-orders/${poBId}`)
        .set(supplierA.auth);

      expect(res.status).toBe(403);
    });

    it('allows Supplier A to view its own purchase order with SkuLabels (200 OK)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/purchase-orders/${poAId}`)
        .set(supplierA.auth);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(poAId);
      expect(res.body.lines.length).toBe(2);
      expect(res.body.lines[0].sku).toBeDefined();
      expect(res.body.lines[0].sku.skuCode).toBeDefined();
      expect(res.body.lines[0].sku.size).toBe(50);
      expect(res.body.lines[0].sku.sizeUnit).toBe('ml');
    });

    it('prevents Supplier A from viewing Supplier B job diff (403 Forbidden)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/ingestion/jobs/${jobBId}/diff`)
        .set(supplierA.auth);

      expect(res.status).toBe(403);
    });

    it('allows Supplier A to view its own job diff (200 OK)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/ingestion/jobs/${jobAId}/diff`)
        .set(supplierA.auth);

      expect(res.status).toBe(200);
      expect(res.body.jobId).toBe(jobAId);
      expect(res.body.counters).toBeDefined();
      expect(res.body.rows.length).toBe(1);
    });

    it('prevents Supplier A from committing Supplier B job offers (403 Forbidden)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/ingestion/jobs/${jobBId}/commit-offers`)
        .set(supplierA.auth)
        .send({ autoApplyLowRisk: true });

      expect(res.status).toBe(403);
    });

    it('prevents Supplier accounts from approving deactivations (403 Forbidden)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/ingestion/jobs/${jobAId}/approve-deactivations`)
        .set(supplierA.auth)
        .send({ supplierId: supplierAId });

      expect(res.status).toBe(403);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Consolidated PO Confirmation & Ready Workflow
  // ───────────────────────────────────────────────────────────────────────────

  describe('2. Consolidated PO Confirmation & Ready Workflow', () => {
    it('allows Supplier A to confirm PO with mixed full and partial responses', async () => {
      const poBefore = await prisma.supplierPurchaseOrder.findUnique({
        where: { id: poAId },
        include: { lines: true },
      });

      const line1 = poBefore!.lines.find((l) => l.skuId === testSku1Id)!;
      const line2 = poBefore!.lines.find((l) => l.skuId === testSku2Id)!;

      const res = await request(app.getHttpServer())
        .post(`/purchase-orders/${poAId}/confirm`)
        .set(supplierA.auth)
        .send({
          lines: [
            {
              id: line1.id,
              status: 'confirmed_full',
            },
            {
              id: line2.id,
              status: 'confirmed_partial',
              confirmedQuantity: 3,
              exceptionCode: 'OUT_OF_STOCK',
              exceptionNote: 'Only 3 units in stock today',
            },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('partial');

      const poAfter = await prisma.supplierPurchaseOrder.findUnique({
        where: { id: poAId },
        include: { lines: true },
      });

      expect(poAfter!.status).toBe('partial');
      expect(poAfter!.confirmedAt).toBeDefined();
      const confirmedLine1 = poAfter!.lines.find((l) => l.id === line1.id)!;
      const confirmedLine2 = poAfter!.lines.find((l) => l.id === line2.id)!;
      expect(confirmedLine1.status).toBe('confirmed_full');
      expect(confirmedLine1.confirmedQuantity).toBe(10);
      expect(confirmedLine2.status).toBe('confirmed_partial');
      expect(confirmedLine2.confirmedQuantity).toBe(3);
    });

    it('allows Supplier A to declare PO ready for pickup without receiving goods at hub', async () => {
      const res = await request(app.getHttpServer())
        .post(`/purchase-orders/${poAId}/ready`)
        .set(supplierA.auth);

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('ready');

      const po = await prisma.supplierPurchaseOrder.findUnique({
        where: { id: poAId },
      });

      expect(po!.status).toBe('ready');
      expect(po!.readyAt).toBeDefined();
      // Crucial Invariant: Ready != Received at Hub
      expect(po!.receivedAt).toBeNull();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Staged Diff, Safe Offer Commit & Idempotency
  // ───────────────────────────────────────────────────────────────────────────

  describe('3. Staged Diff, Safe Offer Commit & Idempotency', () => {
    it('allows Supplier A to commit own job offers atomically', async () => {
      const res = await request(app.getHttpServer())
        .post(`/ingestion/jobs/${jobAId}/commit-offers`)
        .set(supplierA.auth)
        .send({ autoApplyLowRisk: true });

      expect(res.status).toBe(201);
      expect(res.body.jobId).toBe(jobAId);
      expect(res.body.committedCount).toBe(1);

      // Verify SupplierOffer was created in database
      const offer = await prisma.supplierOffer.findUnique({
        where: {
          supplierId_skuId: {
            supplierId: supplierAId,
            skuId: testSku1Id,
          },
        },
      });

      expect(offer).toBeDefined();
      expect(offer!.costPrice.toNumber()).toBe(110.0);
      // A price-only row never claims availability: stock comes from a quantity column or a supplier confirmation.
      expect(offer!.isAvailable).toBe(false);
    });

    it('re-committing an already published job is idempotent and safe', async () => {
      const res = await request(app.getHttpServer())
        .post(`/ingestion/jobs/${jobAId}/commit-offers`)
        .set(supplierA.auth)
        .send({ autoApplyLowRisk: true });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('ALREADY_PUBLISHED');
      expect(res.body.committedCount).toBe(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Admin Minimal Catalog Review & Candidate Publish
  // ───────────────────────────────────────────────────────────────────────────

  describe('4. Admin Minimal Catalog Review & Candidate Publish', () => {
    beforeAll(async () => {
      jobCandidateId = randomUUID();
      await prisma.ingestionJob.create({
        data: {
          id: jobCandidateId,
          supplierId: supplierAId,
          status: IngestionStatus.pending,
          mode: IngestionImportMode.PARTIAL_UPDATE,
        },
      });

      // Create a ProductCandidate for review
      candidateId = randomUUID();
      cleanupCandidateIds.push(candidateId);

      await prisma.ingestionItem.create({
        data: {
          id: candidateId,
          jobId: jobCandidateId,
          supplierSkuCode: 'CAND-001',
          name: 'ShinaCare Advanced Barrier Cream',
          brand: 'ShinaLab',
          price: 180.0,
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

    it('denies Hub Operator and Supplier from approving candidate (403 Forbidden)', async () => {
      const resHub = await request(app.getHttpServer())
        .patch(`/ingestion/candidates/${candidateId}/approve`)
        .set(hubOperator.auth)
        .send({ matchedSkuId: testSku1Id });
      expect(resHub.status).toBe(403);

      const resSupplier = await request(app.getHttpServer())
        .patch(`/ingestion/candidates/${candidateId}/approve`)
        .set(supplierA.auth)
        .send({ matchedSkuId: testSku1Id });
      expect(resSupplier.status).toBe(403);
    });

    it('allows Admin to view candidate review record (200 OK)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/ingestion/candidates/${candidateId}/review-record`)
        .set(admin.auth);

      expect(res.status).toBe(200);
      expect(res.body.candidateId).toBe(candidateId);
      expect(res.body.normalizedIdentity.name).toBe('ShinaCare Advanced Barrier Cream');
      expect(res.body.status).toBe(IngestionStatus.review_required);
    });

    it('allows Admin to field-correct candidate (200 OK)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/ingestion/candidates/${candidateId}/correct`)
        .set(admin.auth)
        .send({
          name: 'ShinaCare Intensive Barrier Cream 50ml',
          reason: 'Correcting product title per official box text',
        });

      expect(res.status).toBe(200);
      expect(res.body.normalizedIdentity.name).toBe('ShinaCare Intensive Barrier Cream 50ml');

      const item = await prisma.ingestionItem.findUnique({ where: { id: candidateId } });
      expect(item!.name).toBe('ShinaCare Intensive Barrier Cream 50ml');
    });

    it('allows Admin to approve candidate (200 OK)', async () => {
      // Approval needs the candidate's identity to equal the canonical SKU's, plus a human media review.
      const sku1 = await prisma.sku.findUniqueOrThrow({ where: { id: testSku1Id }, include: { product: { include: { brand: true } } } });
      const unit = sku1.sizeUnit!; const size = Number(sku1.size);
      await prisma.sku.update({ where: { id: testSku1Id }, data: { variantName: `${size} ${unit}` } });
      await prisma.ingestionItem.update({ where: { id: candidateId }, data: {
        barcode: sku1.barcode, name: `${sku1.product.name} ${size}${unit}`, brand: sku1.product.brand.name,
        enrichment: { size, sizeUnit: unit, variantName: `${size} ${unit}` },
      } });
      const mediaReviews = await reviewCandidateMedia(app, admin.auth, candidateId, sku1.barcode!, size, unit);
      const res = await request(app.getHttpServer())
        .patch(`/ingestion/candidates/${candidateId}/approve`)
        .set(admin.auth)
        .send({ matchedSkuId: testSku1Id, mediaReviews });

      expect(res.status).toBe(200);

      const item = await prisma.ingestionItem.findUnique({ where: { id: candidateId } });
      expect(item!.status).toBe(IngestionStatus.approved);
      expect(item!.matchedSkuId).toBe(testSku1Id);
    });

    it('denies non-Admin roles from publishing candidate (403 Forbidden)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/ingestion/candidates/${candidateId}/publish`)
        .set(hubOperator.auth);

      expect(res.status).toBe(403);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Supplier Payables & Return Credit Adjustment Seam
  // ───────────────────────────────────────────────────────────────────────────

  describe('5. Supplier Payables & Return Credit Adjustment Seam', () => {
    beforeAll(async () => {
      payableId = randomUUID();
      // Create a payable of 600 EGP for Supplier A linked to poAId
      await prisma.supplierPayable.create({
        data: {
          id: payableId,
          supplier: { connect: { id: supplierAId } },
          purchaseOrder: { connect: { id: poAId } },
          amount: 600.0,
          currency: 'EGP',
          status: 'open',
          dueDate: new Date(Date.now() + 86400000 * 15),
        },
      });
    });

    it('denies Hub Operator from applying supplier return credit (403 Forbidden)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/sourcing/payables/${payableId}/apply-credit`)
        .set(hubOperator.auth)
        .send({
          creditAmount: 100.0,
          supplierReturnRef: 'RET-SG11-001',
          reason: 'Damaged carton refund credit',
        });

      expect(res.status).toBe(403);
    });

    it('allows Admin to apply return credit, preserving gross acquisition basis (201 Created)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/sourcing/payables/${payableId}/apply-credit`)
        .set(admin.auth)
        .send({
          creditAmount: 100.0,
          supplierReturnRef: 'RET-SG11-001',
          reason: 'Damaged carton refund credit',
        });

      expect(res.status).toBe(201);
      expect(res.body.adjustmentId).toBeDefined();
      expect(res.body.creditApplied).toBe(100.0);
      expect(res.body.netAmount).toBe(500.0);

      // Verify payable in database
      const payable = await prisma.supplierPayable.findUnique({
        where: { id: payableId },
        include: { adjustments: true },
      });

      expect(payable!.amount.toNumber()).toBe(500.0);
      expect(payable!.adjustments.length).toBe(1);
      expect(payable!.adjustments[0].amount.toNumber()).toBe(-100.0);
    });

    it('lists payables showing gross acquisition cost 600, credit 100, and net 500 EGP', async () => {
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

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { ExportProfileService } from '../../src/modules/ingestion/services/export-profile.service';
import { FormatFingerprintService } from '../../src/modules/ingestion/services/format-fingerprint.service';
import { RowNormalizationService } from '../../src/modules/ingestion/services/row-normalization.service';
import { createActor, Actor } from '../fixtures/actors';
import { randomUUID } from 'crypto';
import { IngestionImportMode } from '@prisma/client';

describe('SG-12 Real Supplier Export File Pilot: Egyptian Distributor Layouts & Automated Mapping', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let exportProfileService: ExportProfileService;
  let fingerprintService: FormatFingerprintService;
  let normalizationService: RowNormalizationService;

  let admin: Actor;
  let supplierA: Actor;
  let supplierB: Actor;

  const supplierAId = randomUUID();
  const supplierBId = randomUUID();

  let testBrandId: string;
  let testProductId: string;
  let testSku1Id: string;

  let fullJobId: string;
  let priceJobId: string;

  const cleanupSkuIds: string[] = [];
  const cleanupProductIds: string[] = [];
  const cleanupBrandIds: string[] = [];
  const cleanupJobIds: string[] = [];

  const fullCsvPath = path.resolve(__dirname, '../fixtures/launch-supplier-feed-full.csv');
  const priceCsvPath = path.resolve(__dirname, '../fixtures/launch-supplier-feed-price-update.csv');

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = app.get(PrismaService);
    exportProfileService = app.get(ExportProfileService);
    fingerprintService = app.get(FormatFingerprintService);
    normalizationService = app.get(RowNormalizationService);

    // 1. Create Supplier entities
    await prisma.supplier.create({
      data: {
        id: supplierAId,
        name: `Launch Distributor Nile ${Date.now()}`,
        slug: `launch-distributor-nile-${Date.now()}`,
      },
    });

    await prisma.supplier.create({
      data: {
        id: supplierBId,
        name: `Competitor Distributor ${Date.now()}`,
        slug: `competitor-distributor-${Date.now()}`,
      },
    });

    // 2. Create authenticated actors
    admin = await createActor(prisma, 'ADMIN');
    supplierA = await createActor(prisma, 'SUPPLIER', supplierAId);
    supplierB = await createActor(prisma, 'SUPPLIER', supplierBId);

    // 3. Find or create Brand, Product, and initial SKU corresponding to DEMO-SC-001 (barcode: 2000000000015)
    const existingBrand = await prisma.brand.findFirst({
      where: { OR: [{ name: 'CeraVe' }, { slug: { contains: 'cerave' } }] },
    });

    if (existingBrand) {
      testBrandId = existingBrand.id;
    } else {
      testBrandId = randomUUID();
      cleanupBrandIds.push(testBrandId);
      await prisma.brand.create({
        data: {
          id: testBrandId,
          name: `CeraVe Pilot ${Date.now()}`,
          slug: `cerave-pilot-${Date.now()}`,
        },
      });
    }

    const existingProduct = await prisma.product.findFirst({
      where: { brandId: testBrandId },
    });

    if (existingProduct) {
      testProductId = existingProduct.id;
    } else {
      testProductId = randomUUID();
      cleanupProductIds.push(testProductId);
      await prisma.product.create({
        data: {
          id: testProductId,
          brandId: testBrandId,
          title: 'CeraVe Foaming Cleanser 236ml',
          slug: `cerave-foaming-cleanser-236ml-${Date.now()}`,
        },
      });
    }

    const existingSku = await prisma.sku.findFirst({
      where: { barcode: '2000000000015' },
    });

    if (existingSku) {
      testSku1Id = existingSku.id;
    } else {
      testSku1Id = randomUUID();
      cleanupSkuIds.push(testSku1Id);
      await prisma.sku.create({
        data: {
          id: testSku1Id,
          productId: testProductId,
          code: `SKU-CRV-FC-236-${Date.now()}`,
          variantName: '236ml',
          barcode: '2000000000015',
          size: 236,
          sizeUnit: 'ml',
        },
      });
    }
  });

  afterAll(async () => {
    if (cleanupJobIds.length > 0) {
      await prisma.supplierOffer.deleteMany({ where: { supplierId: { in: [supplierAId, supplierBId] } } });
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
    await prisma.session.deleteMany({ where: { customerId: { in: [admin.id, supplierA.id, supplierB.id] } } });
    await prisma.customer.deleteMany({ where: { id: { in: [admin.id, supplierA.id, supplierB.id] } } });
    await prisma.supplier.deleteMany({ where: { id: { in: [supplierAId, supplierBId] } } });

    await app.close();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // PART 1: Full Inventory & Catalog Feed (25 Rows, Launch Distributor Layout)
  // ───────────────────────────────────────────────────────────────────────────

  describe('Part 1: Full Launch Supplier Catalog & Inventory Feed (25 Items)', () => {
    it('discovers and proposes 100% accurate column mapping for all 9 Arabic distributor headers', () => {
      const headers = [
        'كود المورد',
        'اسم الصنف كما في ملف المورد',
        'الباركود',
        'الرصيد المتاح',
        'سعر الجمهور (EGP)',
        'خصم التوريد (%)',
        'سعر الشراء الصافي (EGP)',
        'العبوة',
        'آخر تحديث',
      ];

      const proposal = exportProfileService.proposeMapping(headers);

      expect(proposal.isComplete).toBe(true);
      expect(proposal.unmappedHeaders).toEqual([]);
      expect(proposal.mapping.supplierSku).toBe('كود المورد');
      expect(proposal.mapping.name).toBe('اسم الصنف كما في ملف المورد');
      expect(proposal.mapping.barcode).toBe('الباركود');
      expect(proposal.mapping.quantity).toBe('الرصيد المتاح');
      expect(proposal.mapping.retailPrice).toBe('سعر الجمهور (EGP)');
      expect(proposal.mapping.discount).toBe('خصم التوريد (%)');
      expect(proposal.mapping.price).toBe('سعر الشراء الصافي (EGP)');
      expect(proposal.mapping.units).toBe('العبوة');
      expect(proposal.mapping.sourceTimestamp).toBe('آخر تحديث');
    });

    it('uploads the real 25-row launch supplier CSV fixture via multipart endpoint', async () => {
      const fileBuffer = fs.readFileSync(fullCsvPath);

      const res = await request(app.getHttpServer())
        .post('/ingestion/jobs/upload')
        .set(supplierA.auth)
        .field('supplierId', supplierAId)
        .field('mode', IngestionImportMode.FULL_SNAPSHOT)
        .attach('file', fileBuffer, {
          filename: 'launch-supplier-feed-full.csv',
          contentType: 'text/csv',
        });

      expect(res.status).toBe(201);
      expect(res.body.jobId).toBeDefined();
      fullJobId = res.body.jobId;
      cleanupJobIds.push(fullJobId);

      expect(res.body.requiresMapping).toBe(true);
      expect(res.body.totalRows).toBe(25);
      expect(res.body.sampleHeaders).toContain('كود المورد');
      expect(res.body.sampleHeaders).toContain('سعر الشراء الصافي (EGP)');
      expect(res.body.sampleHeaders).toContain('الرصيد المتاح');
    });

    it('enforces multi-tenant perimeter: Supplier B cannot access Supplier A upload job (403 Forbidden)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/ingestion/jobs/${fullJobId}/diff`)
        .set(supplierB.auth);

      expect(res.status).toBe(403);
    });

    it('applies proposed column mapping and extracts all 25 rows into database items', async () => {
      const res = await request(app.getHttpServer())
        .post(`/ingestion/jobs/${fullJobId}/mapping`)
        .set(supplierA.auth)
        .send({
          profileName: 'Egyptian Launch Distributor Layout v1',
          mapping: {
            supplierSku: 'كود المورد',
            name: 'اسم الصنف كما في ملف المورد',
            barcode: 'الباركود',
            quantity: 'الرصيد المتاح',
            retailPrice: 'سعر الجمهور (EGP)',
            discount: 'خصم التوريد (%)',
            price: 'سعر الشراء الصافي (EGP)',
            units: 'العبوة',
            sourceTimestamp: 'آخر تحديث',
          },
        });

      expect(res.status).toBe(201);
      expect(res.body.jobId).toBe(fullJobId);
      expect(res.body.importedItemsCount).toBe(25);

      const itemsInDb = await prisma.ingestionItem.findMany({
        where: { jobId: fullJobId },
        orderBy: { createdAt: 'asc' },
      });

      expect(itemsInDb.length).toBe(25);

      // Verify specific items
      const item1 = itemsInDb.find((i) => i.supplierSkuCode === 'DEMO-SC-001')!;
      expect(item1).toBeDefined();
      expect(Number(item1.price)).toBe(395.2);
      expect(item1.reportedQuantity).toBe(17);
      expect(item1.barcode).toBe('2000000000015');

      // Verify Starville (DEMO-SC-014): net cost derived from retail 205 and discount 18% -> 168.10 EGP
      const starville = itemsInDb.find((i) => i.supplierSkuCode === 'DEMO-SC-014')!;
      expect(starville).toBeDefined();
      expect(Number(starville.price)).toBe(168.1);
      expect(starville.reportedQuantity).toBe(15);

      // Verify out-of-stock items have reportedQuantity = 0
      const outOfStockItem = itemsInDb.find((i) => i.supplierSkuCode === 'DEMO-SC-007')!;
      expect(outOfStockItem.reportedQuantity).toBe(0);

      // Verify unknown quantity item (DEMO-SC-009) has reportedQuantity = null (not 0!)
      const unknownQtyItem = itemsInDb.find((i) => i.supplierSkuCode === 'DEMO-SC-009')!;
      expect(unknownQtyItem.reportedQuantity).toBeNull();
    });

    it('stages diff preview and safely commits matched offers to SupplierOffer', async () => {
      // Match DEMO-SC-001 to testSku1Id
      const item1 = await prisma.ingestionItem.findFirst({
        where: { jobId: fullJobId, supplierSkuCode: 'DEMO-SC-001' },
      });
      await prisma.ingestionItem.update({
        where: { id: item1!.id },
        data: { matchedSkuId: testSku1Id },
      });

      const diffRes = await request(app.getHttpServer())
        .get(`/ingestion/jobs/${fullJobId}/diff`)
        .set(supplierA.auth);

      expect(diffRes.status).toBe(200);
      expect(diffRes.body.totalRows).toBe(25);
      expect(diffRes.body.counters).toBeDefined();
      expect(diffRes.body.counters.created).toBe(1);
      expect(diffRes.body.counters.skipped).toBe(24);

      // Commit matched offers
      const commitRes = await request(app.getHttpServer())
        .post(`/ingestion/jobs/${fullJobId}/commit-offers`)
        .set(supplierA.auth);

      expect(commitRes.status).toBe(201);
      expect(commitRes.body.committedCount).toBe(1);

      // Verify SupplierOffer in database
      const offerInDb = await prisma.supplierOffer.findFirst({
        where: { supplierId: supplierAId, skuId: testSku1Id },
      });

      expect(offerInDb).toBeDefined();
      expect(Number(offerInDb!.costPrice)).toBe(395.2);
      expect(offerInDb!.isAvailable).toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // PART 2: Price Update / Delta Feed (6 Rows, Delta Layout)
  // ───────────────────────────────────────────────────────────────────────────

  describe('Part 2: Price Update / Delta Feed Layout (6 Items)', () => {
    it('discovers and proposes accurate mapping for the delta price-update format', () => {
      const headers = [
        'كود المورد',
        'اسم الصنف',
        'سعر الجمهور (EGP)',
        'خصم التوريد (%)',
        'سعر الشراء الصافي (EGP)',
        'تاريخ السعر',
      ];

      const proposal = exportProfileService.proposeMapping(headers);

      expect(proposal.isComplete).toBe(true);
      expect(proposal.unmappedHeaders).toEqual([]);
      expect(proposal.mapping.supplierSku).toBe('كود المورد');
      expect(proposal.mapping.name).toBe('اسم الصنف');
      expect(proposal.mapping.retailPrice).toBe('سعر الجمهور (EGP)');
      expect(proposal.mapping.discount).toBe('خصم التوريد (%)');
      expect(proposal.mapping.price).toBe('سعر الشراء الصافي (EGP)');
      expect(proposal.mapping.sourceTimestamp).toBe('تاريخ السعر');
    });

    it('uploads price-update CSV fixture and applies mapping', async () => {
      const fileBuffer = fs.readFileSync(priceCsvPath);

      const uploadRes = await request(app.getHttpServer())
        .post('/ingestion/jobs/upload')
        .set(supplierA.auth)
        .field('supplierId', supplierAId)
        .field('mode', IngestionImportMode.PARTIAL_UPDATE)
        .attach('file', fileBuffer, {
          filename: 'launch-supplier-feed-price-update.csv',
          contentType: 'text/csv',
        });

      expect(uploadRes.status).toBe(201);
      priceJobId = uploadRes.body.jobId;
      cleanupJobIds.push(priceJobId);

      const mappingRes = await request(app.getHttpServer())
        .post(`/ingestion/jobs/${priceJobId}/mapping`)
        .set(supplierA.auth)
        .send({
          profileName: 'Price Update Delta Layout v1',
          mapping: {
            supplierSku: 'كود المورد',
            name: 'اسم الصنف',
            retailPrice: 'سعر الجمهور (EGP)',
            discount: 'خصم التوريد (%)',
            price: 'سعر الشراء الصافي (EGP)',
            sourceTimestamp: 'تاريخ السعر',
          },
        });

      expect(mappingRes.status).toBe(201);
      expect(mappingRes.body.importedItemsCount).toBe(6);
    });

    it('updates existing offer price from 395.20 to 402.80 while preserving inventory availability', async () => {
      // Match DEMO-SC-001 in price update feed to testSku1Id
      const item1 = await prisma.ingestionItem.findFirst({
        where: { jobId: priceJobId, supplierSkuCode: 'DEMO-SC-001' },
      });
      await prisma.ingestionItem.update({
        where: { id: item1!.id },
        data: { matchedSkuId: testSku1Id },
      });

      const diffRes = await request(app.getHttpServer())
        .get(`/ingestion/jobs/${priceJobId}/diff`)
        .set(supplierA.auth);

      expect(diffRes.status).toBe(200);

      // Verify the diff row for DEMO-SC-001 shows safe price increase
      const priceRow = diffRes.body.rows.find((r: any) => r.matchedSkuId === testSku1Id);
      expect(priceRow).toBeDefined();
      expect(priceRow.action).toBe('UPDATE');
      expect(priceRow.before).toBeDefined();
      expect(Number(priceRow.before.costPrice)).toBe(395.2);
      expect(Number(priceRow.after.costPrice)).toBe(402.8);

      // Commit the price update
      const commitRes = await request(app.getHttpServer())
        .post(`/ingestion/jobs/${priceJobId}/commit-offers`)
        .set(supplierA.auth);

      expect(commitRes.status).toBe(201);
      expect(commitRes.body.committedCount).toBe(1);

      // Verify database persistence: costPrice updated, previous quantity preserved
      const updatedOffer = await prisma.supplierOffer.findFirst({
        where: { supplierId: supplierAId, skuId: testSku1Id },
      });

      expect(updatedOffer).toBeDefined();
      expect(Number(updatedOffer!.costPrice)).toBe(402.8);
      // Invariant: Price-only update preserves existing inventory availability
      expect(updatedOffer!.isAvailable).toBe(true);
    });
  });
});

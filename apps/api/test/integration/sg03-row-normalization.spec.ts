import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { createActor, Actor } from '../fixtures/actors';
import { IngestionService } from '../../src/modules/ingestion/services/ingestion.service';
import { RowNormalizationService } from '../../src/modules/ingestion/services/row-normalization.service';
import { ExportProfileService } from '../../src/modules/ingestion/services/export-profile.service';
import {
  NormalizedRowStatus,
  DiscountType,
} from '../../src/modules/ingestion/contracts/row-normalization.contract';
import { QuantityPresence } from '../../src/modules/ingestion/contracts/canonical-supplier-record.contract';
import { IngestionStatus } from '@prisma/client';

describe('SG-03: Row Normalization, Trusted Semantics & Brand/Line Eligibility (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Actor;
  let normalizationService: RowNormalizationService;
  let ingestionService: IngestionService;
  let profileService: ExportProfileService;
  let supplierId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();

    prisma = app.get(PrismaService);
    normalizationService = app.get(RowNormalizationService);
    ingestionService = app.get(IngestionService);
    profileService = app.get(ExportProfileService);

    admin = await createActor(prisma, 'ADMIN');

    const supplier = await prisma.supplier.create({
      data: { name: `SG03 Supplier ${Date.now()}`, slug: `sg03-supplier-${Date.now()}` },
    });
    supplierId = supplier.id;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('1. Table-Driven Arabic & English Normalization', () => {
    const normalizationTestCases = [
      {
        name: 'Arabic title with Tashkeel, Alef variants, Eastern numerals, volume in ml',
        inputName: 'سِيرُومْ الهِيَالُورُونِيكْ أْسِيدْ مَعَ فِيتَامِينْ سِي ٥٠ مل',
        inputBrand: 'اورجيناري',
        expectedNormalizedTitle: 'سيروم الهيالورونيك اسيد مع فيتامين سي 50 مل',
        expectedCleanBaseTitle: 'سيروم الهيالورونيك اسيد مع فيتامين سي',
        expectedSize: 50,
        expectedUnit: 'ml',
        expectedCategory: 'skincare',
      },
      {
        name: 'English title with volume in Liters and multiple punctuation',
        inputName: 'Bioderma Sensibio H2O Micellar Water - 1.5L',
        inputBrand: 'Bioderma',
        expectedNormalizedTitle: 'bioderma sensibio h2o micellar water 1.5l',
        expectedCleanBaseTitle: 'bioderma sensibio h2o micellar water',
        expectedSize: 1500,
        expectedUnit: 'ml',
        expectedCategory: 'skincare',
      },
      {
        name: 'Haircare title with weight in grams and pack count',
        inputName: 'شامبو وبلسم علاجي للشعر التالف علبة من 2 حبة 400 جم',
        inputBrand: 'Vichy',
        expectedNormalizedTitle: 'شامبو وبلسم علاجي للشعر التالف علبه من 2 حبه 400 جم',
        expectedCleanBaseTitle: 'شامبو وبلسم علاجي للشعر التالف',
        expectedSize: 400,
        expectedUnit: 'g',
        expectedCategory: 'haircare',
      },
    ];

    normalizationTestCases.forEach((tc) => {
      it(`normalizes: ${tc.name}`, () => {
        const result = normalizationService.normalizeRow({
          sourceRowNumber: 1,
          supplierSku: 'TEST-SKU-01',
          name: tc.inputName,
          brand: tc.inputBrand,
          price: 50.0,
        });

        expect(result.status).toBe(NormalizedRowStatus.UPDATED_CANDIDATE);
        expect(result.normalizedTitle).toBe(tc.expectedNormalizedTitle);
        expect(result.cleanBaseTitle).toBe(tc.expectedCleanBaseTitle);
        expect(result.extractedSize).toBe(tc.expectedSize);
        expect(result.extractedUnit).toBe(tc.expectedUnit);
        expect(result.scope.category).toBe(tc.expectedCategory);
      });
    });
  });

  describe('2. Strict Quantity & Availability Semantics', () => {
    it('distinguishes explicit >0, explicit 0, unknown blank, missing column, and boolean states', () => {
      // 1. Explicit reported count
      const r1 = normalizationService.normalizeRow({
        sourceRowNumber: 1,
        supplierSku: 'SKU-Q1',
        name: 'CeraVe Moisturizing Cream 50ml',
        price: 40,
        quantity: '120',
        hasQuantityColumn: true,
      });
      expect(r1.inventory.presence).toBe(QuantityPresence.EXPLICIT);
      expect(r1.inventory.reportedQuantity).toBe(120);
      expect(r1.inventory.isInStock).toBe(true);

      // 2. Explicit zero
      const r2 = normalizationService.normalizeRow({
        sourceRowNumber: 2,
        supplierSku: 'SKU-Q2',
        name: 'CeraVe Moisturizing Cream 50ml',
        price: 40,
        quantity: 0,
        hasQuantityColumn: true,
      });
      expect(r2.inventory.presence).toBe(QuantityPresence.ZERO);
      expect(r2.inventory.reportedQuantity).toBe(0);
      expect(r2.inventory.isInStock).toBe(false);

      // 3. Unknown blank cell
      const r3 = normalizationService.normalizeRow({
        sourceRowNumber: 3,
        supplierSku: 'SKU-Q3',
        name: 'CeraVe Moisturizing Cream 50ml',
        price: 40,
        quantity: '',
        hasQuantityColumn: true,
      });
      expect(r3.inventory.presence).toBe(QuantityPresence.UNKNOWN);
      expect(r3.inventory.reportedQuantity).toBeNull();
      expect(r3.inventory.isInStock).toBeNull();

      // 4. Missing column completely
      const r4 = normalizationService.normalizeRow({
        sourceRowNumber: 4,
        supplierSku: 'SKU-Q4',
        name: 'CeraVe Moisturizing Cream 50ml',
        price: 40,
        hasQuantityColumn: false,
      });
      expect(r4.inventory.presence).toBe(QuantityPresence.MISSING);
      expect(r4.inventory.reportedQuantity).toBeNull();
      expect(r4.inventory.isInStock).toBeNull();

      // 5. In-stock boolean text (does NOT fabricate count)
      const r5 = normalizationService.normalizeRow({
        sourceRowNumber: 5,
        supplierSku: 'SKU-Q5',
        name: 'CeraVe Moisturizing Cream 50ml',
        price: 40,
        quantity: 'متوفر',
        hasQuantityColumn: true,
      });
      expect(r5.inventory.presence).toBe(QuantityPresence.EXPLICIT);
      expect(r5.inventory.reportedQuantity).toBeNull(); // No invented number
      expect(r5.inventory.isInStock).toBe(true);
    });
  });

  describe('3. Financial & Price Semantics', () => {
    it('validates supported currencies and rejects malformed/mixed currency strings', () => {
      const valid = normalizationService.normalizeRow({
        sourceRowNumber: 1,
        supplierSku: 'SKU-C1',
        name: 'CeraVe Moisturizing Cream 50ml',
        price: 45.0,
        currency: 'SAR',
      });
      expect(valid.status).toBe(NormalizedRowStatus.UPDATED_CANDIDATE);
      expect(valid.pricing.currency).toBe('SAR');

      const invalid = normalizationService.normalizeRow({
        sourceRowNumber: 2,
        supplierSku: 'SKU-C2',
        name: 'CeraVe Moisturizing Cream 50ml',
        price: 45.0,
        currency: 'SAR / USD', // malformed / mixed
      });
      expect(invalid.status).toBe(NormalizedRowStatus.INVALID);
      expect(invalid.statusReason).toContain('Unsupported or malformed currency');
    });

    it('types discounts strictly into PERCENTAGE or FIXED_AMOUNT', () => {
      // Percentage via '%'
      const r1 = normalizationService.normalizeRow({
        sourceRowNumber: 1,
        supplierSku: 'SKU-D1',
        name: 'CeraVe Moisturizing Cream 50ml',
        price: 50.0,
        discount: '15%',
      });
      expect(r1.pricing.discount?.type).toBe(DiscountType.PERCENTAGE);
      expect(r1.pricing.discount?.value).toBe(15);

      // Percentage via decimal fraction
      const r2 = normalizationService.normalizeRow({
        sourceRowNumber: 2,
        supplierSku: 'SKU-D2',
        name: 'CeraVe Moisturizing Cream 50ml',
        price: 50.0,
        discount: '0.20',
      });
      expect(r2.pricing.discount?.type).toBe(DiscountType.PERCENTAGE);
      expect(r2.pricing.discount?.value).toBe(20);

      // Fixed amount
      const r3 = normalizationService.normalizeRow({
        sourceRowNumber: 3,
        supplierSku: 'SKU-D3',
        name: 'CeraVe Moisturizing Cream 50ml',
        price: 50.0,
        discount: '12.50 SAR',
      });
      expect(r3.pricing.discount?.type).toBe(DiscountType.FIXED_AMOUNT);
      expect(r3.pricing.discount?.value).toBe(12.5);
    });

    it('detects strong price-kind inversion anomaly (wholesale cost > retail price) and holds for REVIEW', () => {
      const anomaly = normalizationService.normalizeRow({
        sourceRowNumber: 1,
        supplierSku: 'SKU-P1',
        name: 'CeraVe Moisturizing Cream 50ml',
        price: 150.0, // wholesale cost reported as 150
        retailPrice: 50.0, // retail price is 50 -> inversion
      });

      expect(anomaly.status).toBe(NormalizedRowStatus.REVIEW);
      expect(anomaly.statusReason).toContain('Price anomaly');
    });

    it('rejects non-positive or corrupt purchase cost with INVALID status', () => {
      const zeroCost = normalizationService.normalizeRow({
        sourceRowNumber: 1,
        supplierSku: 'SKU-Z1',
        name: 'CeraVe Moisturizing Cream 50ml',
        price: 0,
      });
      expect(zeroCost.status).toBe(NormalizedRowStatus.INVALID);

      const negativeCost = normalizationService.normalizeRow({
        sourceRowNumber: 2,
        supplierSku: 'SKU-Z2',
        name: 'CeraVe Moisturizing Cream 50ml',
        price: -25.5,
      });
      expect(negativeCost.status).toBe(NormalizedRowStatus.INVALID);
    });
  });

  describe('4. Brand & Line Scope Eligibility (Skincare/Haircare Pilot)', () => {
    it('classifies approved skincare and haircare items as eligible UPDATED_CANDIDATE', () => {
      const skincare = normalizationService.normalizeRow({
        sourceRowNumber: 1,
        supplierSku: 'SKU-S1',
        name: 'غسول رغوي للوجه للبشرة الدهنية 236 مل',
        brand: 'CeraVe',
        price: 45.0,
      });
      expect(skincare.status).toBe(NormalizedRowStatus.UPDATED_CANDIDATE);
      expect(skincare.scope.category).toBe('skincare');

      const haircare = normalizationService.normalizeRow({
        sourceRowNumber: 2,
        supplierSku: 'SKU-H1',
        name: 'شامبو لعلاج القشرة الدهنية 200 مل',
        brand: 'Vichy',
        price: 65.0,
      });
      expect(haircare.status).toBe(NormalizedRowStatus.UPDATED_CANDIDATE);
      expect(haircare.scope.category).toBe('haircare');
    });

    it('skips clearly excluded goods (food, electronics, clothing) as OUT_OF_SCOPE with reason', () => {
      const food = normalizationService.normalizeRow({
        sourceRowNumber: 1,
        supplierSku: 'SKU-EX1',
        name: 'أرز بسمتي هندي درجة اولى 5 كجم',
        price: 35.0,
      });
      expect(food.status).toBe(NormalizedRowStatus.OUT_OF_SCOPE);
      expect(food.statusReason).toContain('excluded');

      const electronics = normalizationService.normalizeRow({
        sourceRowNumber: 2,
        supplierSku: 'SKU-EX2',
        name: 'شاحن هاتف سريع 20 واط نوع سي',
        price: 45.0,
      });
      expect(electronics.status).toBe(NormalizedRowStatus.OUT_OF_SCOPE);
      expect(electronics.statusReason).toContain('excluded');
    });

    it('holds credible known pilot brand with ambiguous sub-line for REVIEW rather than false-skipping', () => {
      const ambiguousBrandItem = normalizationService.normalizeRow({
        sourceRowNumber: 1,
        supplierSku: 'SKU-AM1',
        name: 'CeraVe Special Edition Organizer Kit',
        brand: 'CeraVe',
        price: 55.0,
      });
      expect(ambiguousBrandItem.status).toBe(NormalizedRowStatus.REVIEW);
      expect(ambiguousBrandItem.scope.category).toBe('unknown');
      expect(ambiguousBrandItem.statusReason).toContain('review required');
    });
  });

  describe('5. End-to-End Spreadsheet Ingestion Item Provenance', () => {
    it('retains complete row-level normalized provenance for in-scope, out-of-scope, and held items', async () => {
      const csv =
        'كود الصنف,اسم المنتج,سعر الشراء,المخزون,الباركود\n' +
        'SKU-01,واقي شمس لاروش بوزيه انفيسيبل فلويد 50 مل,85.00,40,3337875588569\n' +
        'SKU-02,أرز بسمتي فاخر 5 كجم,35.00,10,6221111222333\n' +
        'SKU-03,CeraVe Ambiguous Line Kit,45.00,15,3337871324567\n';

      const file: Express.Multer.File = {
        buffer: Buffer.from(csv, 'utf-8'),
        originalname: 'pilot_supplier_catalog.csv',
        mimetype: 'text/csv',
        size: Buffer.byteLength(csv),
        fieldname: 'file',
        encoding: '7bit',
        destination: '',
        filename: '',
        path: '',
        stream: null as any,
      };

      const uploadResult = await ingestionService.uploadSupplierSpreadsheet(supplierId, file);

      // Apply approved mapping
      const applyResult = await ingestionService.applyJobMapping(
        uploadResult.jobId,
        supplierId,
        {
          mapping: {
            supplierSku: 'كود الصنف',
            name: 'اسم المنتج',
            price: 'سعر الشراء',
            quantity: 'المخزون',
            barcode: 'الباركود',
          },
          profileName: 'SG03 Full Scope Test Profile',
        },
        admin.id,
      );

      expect(applyResult.importedItemsCount).toBe(3);

      const items = await prisma.ingestionItem.findMany({
        where: { jobId: uploadResult.jobId },
        orderBy: { supplierSkuCode: 'asc' },
      });

      expect(items.length).toBe(3);

      // In-scope skincare item -> pending
      const skincareItem = items.find((i) => i.supplierSkuCode === 'SKU-01');
      expect(skincareItem?.status).toBe(IngestionStatus.pending);
      expect((skincareItem?.enrichment as any)?.source?.normalized?.scope?.category).toBe('skincare');

      // Out-of-scope food item -> review_required (retaining raw provenance)
      const foodItem = items.find((i) => i.supplierSkuCode === 'SKU-02');
      expect(foodItem?.status).toBe(IngestionStatus.review_required);
      expect((foodItem?.enrichment as any)?.source?.normalized?.status).toBe(NormalizedRowStatus.OUT_OF_SCOPE);

      // Ambiguous brand item -> review_required
      const ambiguousItem = items.find((i) => i.supplierSkuCode === 'SKU-03');
      expect(ambiguousItem?.status).toBe(IngestionStatus.review_required);
      expect((ambiguousItem?.enrichment as any)?.source?.normalized?.status).toBe(NormalizedRowStatus.REVIEW);
    });
  });
});

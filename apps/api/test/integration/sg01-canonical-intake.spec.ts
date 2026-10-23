import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, BadRequestException } from '@nestjs/common';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { createActor, Actor } from '../fixtures/actors';
import { IngestionService } from '../../src/modules/ingestion/services/ingestion.service';
import {
  FileSourceAdapter,
  InMemorySourceAdapter,
  SupplierSourceKind,
  SupplierDocumentKind,
  QuantityPresence,
  CanonicalPriceType,
} from '../../src/modules/ingestion/public';
import { IngestionImportMode, IngestionPriceType } from '@prisma/client';
import { randomUUID } from 'crypto';

describe('SG-01: Canonical Intake Contract & Replaceable Adapters (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Actor;
  let ingestionService: IngestionService;
  let supplierId: string;
  let productId: string;
  let skuId: string;
  let brandId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();

    prisma = app.get(PrismaService);
    ingestionService = app.get(IngestionService);
    admin = await createActor(prisma, 'ADMIN');

    // Create test supplier, brand, product, sku
    const supplier = await prisma.supplier.create({
      data: { name: `SG01 Supplier ${Date.now()}`, slug: `sg01-supplier-${Date.now()}` },
    });
    supplierId = supplier.id;

    const brand = await prisma.brand.create({
      data: { name: `SG01 Brand ${Date.now()}`, slug: `sg01-brand-${Date.now()}` },
    });
    brandId = brand.id;

    const product = await prisma.product.create({
      data: { name: 'SG01 Product', slug: `sg01-product-${Date.now()}`, brandId: brand.id },
    });
    productId = product.id;

    const sku = await prisma.sku.create({
      data: { productId, code: `SG01-SKU-${randomUUID().slice(0, 6)}`, variantName: '100ml', barcode: '6221234567890' },
    });
    skuId = sku.id;
  });

  afterAll(async () => {
    await prisma.supplierOffer.deleteMany({ where: { supplierId } });
    await prisma.ingestionItem.deleteMany({ where: { job: { supplierId } } });
    await prisma.ingestionJob.deleteMany({ where: { supplierId } });
    await prisma.sku.deleteMany({ where: { productId } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.brand.deleteMany({ where: { id: brandId } });
    await prisma.supplier.deleteMany({ where: { id: supplierId } });
    await prisma.session.deleteMany({ where: { customerId: admin.id } });
    await prisma.customer.deleteMany({ where: { id: admin.id } });
    await app.close();
  });

  describe('Source-Neutral Equivalence (FILE vs IN-MEMORY Adapter)', () => {
    it('produces identical CanonicalSupplierRecord values from CSV and in-memory source', async () => {
      const sourceId = randomUUID();
      const csvData = [
        'SKU_CODE,BRAND,PRODUCT_NAME,BARCODE,COST_PRICE,CURRENCY,STOCK_QTY',
        'CER-001, CeraVe , Moisturizing Cream , 6221234567890 , "185.50" , EGP , 42 ',
        'CER-002, CeraVe , Hydrating Cleanser , 6221234567891 , 120.00 , EGP , 0 ',
        'CER-003, CeraVe , Foaming Cleanser , , 140.00 , EGP , unknown ',
      ].join('\n');

      const fileAdapter = new FileSourceAdapter();
      const fileEnvelope = await fileAdapter.parseAndNormalize(csvData, {
        supplierId,
        sourceId,
        hasHeaderRow: true,
        mapping: {
          skuCodeColumn: 'SKU_CODE',
          brandColumn: 'BRAND',
          productNameColumn: 'PRODUCT_NAME',
          barcodeColumn: 'BARCODE',
          priceColumn: 'COST_PRICE',
          currencyColumn: 'CURRENCY',
          quantityColumn: 'STOCK_QTY',
        },
      });

      const inMemoryAdapter = new InMemorySourceAdapter();
      const inMemoryEnvelope = await inMemoryAdapter.parseAndNormalize(
        [
          {
            supplierSkuCode: 'CER-001',
            rawBrand: 'CeraVe',
            rawProductName: 'Moisturizing Cream',
            barcode: '6221234567890',
            price: 185.50,
            currency: 'EGP',
            quantity: 42,
          },
          {
            supplierSkuCode: 'CER-002',
            rawBrand: 'CeraVe',
            rawProductName: 'Hydrating Cleanser',
            barcode: '6221234567891',
            price: 120.00,
            currency: 'EGP',
            quantity: 0,
          },
          {
            supplierSkuCode: 'CER-003',
            rawBrand: 'CeraVe',
            rawProductName: 'Foaming Cleanser',
            barcode: null,
            price: 140.00,
            currency: 'EGP',
            quantity: 'unknown',
          },
        ],
        {
          supplierId,
          sourceId,
        },
      );

      expect(fileEnvelope.items.length).toBe(3);
      expect(inMemoryEnvelope.items.length).toBe(3);

      for (let i = 0; i < 3; i++) {
        const fileItem = fileEnvelope.items[i];
        const memItem = inMemoryEnvelope.items[i];

        expect(fileItem.supplierSkuCode).toBe(memItem.supplierSkuCode);
        expect(fileItem.rawBrand).toBe(memItem.rawBrand);
        expect(fileItem.rawProductName).toBe(memItem.rawProductName);
        expect(fileItem.barcode).toBe(memItem.barcode);
        expect(fileItem.pricing.amount).toBe(memItem.pricing.amount);
        expect(fileItem.pricing.currency).toBe(memItem.pricing.currency);
        expect(fileItem.pricing.priceType).toBe(memItem.pricing.priceType);
        expect(fileItem.inventory.presence).toBe(memItem.inventory.presence);
        expect(fileItem.inventory.quantity).toBe(memItem.inventory.quantity);
      }

      // Check validation equivalence
      const fileVal = fileAdapter.validateEnvelope(fileEnvelope);
      const memVal = inMemoryAdapter.validateEnvelope(inMemoryEnvelope);
      expect(fileVal.isValid).toBe(true);
      expect(memVal.isValid).toBe(true);
      expect(fileVal.validRecordCount).toBe(memVal.validRecordCount);
    });
  });

  it('does not invent currency, cost type, or a valid amount in generic adapters', async () => {
    const adapter = new InMemorySourceAdapter();
    const envelope = await adapter.parseAndNormalize([
      { supplierSkuCode: 'NO-CURRENCY', rawBrand: 'CeraVe', rawProductName: 'Cream', price: 20 },
      { supplierSkuCode: 'BAD-PRICE', rawBrand: 'CeraVe', rawProductName: 'Cream', price: '20oops', currency: 'EGP', priceType: 'PURCHASE_COST' },
    ], { supplierId, sourceId: randomUUID() });
    expect(envelope.items[0].pricing.currency).toBe('');
    expect(envelope.items[0].pricing.priceType).toBe('UNCLASSIFIED');
    expect(envelope.items[1].pricing.amount).toBe(0);
    expect(adapter.validateEnvelope(envelope).isValid).toBe(false);
  });

  describe('Strict Quantity Semantics (EXPLICIT, ZERO, UNKNOWN, MISSING)', () => {
    it('correctly maps 4 distinct quantity states without assuming zero or available stock', async () => {
      const adapter = new InMemorySourceAdapter();
      const envelope = await adapter.parseAndNormalize(
        [
          { supplierSkuCode: 'Q-1', rawBrand: 'B', rawProductName: 'P1', price: 10, quantity: 15 },
          { supplierSkuCode: 'Q-2', rawBrand: 'B', rawProductName: 'P2', price: 10, quantity: 0 },
          { supplierSkuCode: 'Q-3', rawBrand: 'B', rawProductName: 'P3', price: 10, quantity: 'N/A' },
          { supplierSkuCode: 'Q-4', rawBrand: 'B', rawProductName: 'P4', price: 10, quantity: undefined },
        ],
        { supplierId, sourceId: randomUUID() },
      );

      expect(envelope.items[0].inventory).toEqual({
        presence: QuantityPresence.EXPLICIT,
        quantity: 15,
        rawInput: '15',
      });
      expect(envelope.items[1].inventory).toEqual({
        presence: QuantityPresence.ZERO,
        quantity: 0,
        rawInput: '0',
      });
      expect(envelope.items[2].inventory).toEqual({
        presence: QuantityPresence.UNKNOWN,
        quantity: null,
        rawInput: 'N/A',
      });
      expect(envelope.items[3].inventory).toEqual({
        presence: QuantityPresence.MISSING,
        quantity: null,
        rawInput: undefined,
      });
    });
  });

  describe('Immediate Safety Guard: FULL_SNAPSHOT Mass-Deactivation', () => {
    it('blocks unscoped FULL_SNAPSHOT publish with a clear explanatory error', async () => {
      // Create a FULL_SNAPSHOT job
      const job = await prisma.ingestionJob.create({
        data: {
          supplierId,
          mode: IngestionImportMode.FULL_SNAPSHOT,
          status: 'approved',
          items: {
            create: [
              {
                supplierSkuCode: 'SAFE-01',
                name: 'Safety Item',
                brand: 'Safety Brand',
                price: 100,
                priceType: IngestionPriceType.PURCHASE_COST,
                currency: 'EGP',
                status: 'approved',
                matchedSkuId: skuId,
              },
            ],
          },
        },
      });

      // Attempt to publish without authorization switch
      delete process.env.ALLOW_UNSCOPED_FULL_SNAPSHOT_DEACTIVATION;

      await expect(ingestionService.publishJob(job.id)).rejects.toThrow(
        /FULL_SNAPSHOT mass-deactivation is guarded pending SG-05/i,
      );
    });

    it('allows PARTIAL_UPDATE publish normally without triggering the deactivation guard', async () => {
      const job = await prisma.ingestionJob.create({
        data: {
          supplierId,
          mode: IngestionImportMode.PARTIAL_UPDATE,
          status: 'approved',
          items: {
            create: [
              {
                supplierSkuCode: 'SAFE-PARTIAL-01',
                name: 'Partial Item',
                brand: 'Safety Brand',
                price: 100,
                priceType: IngestionPriceType.PURCHASE_COST,
                currency: 'EGP',
                status: 'published',
                matchedSkuId: skuId,
              },
            ],
          },
        },
      });

      // PARTIAL_UPDATE should succeed and return the published job
      const published = await ingestionService.publishJob(job.id);
      expect(published.status).toBe('published');
    });
  });
});

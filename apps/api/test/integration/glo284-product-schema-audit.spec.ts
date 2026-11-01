import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { CatalogService } from '../../src/modules/catalog/services/catalog.service';
import { ProductTexture, UvFilterType, UsageTargetArea, SafetyWarningKind } from '../../src/modules/catalog/public';
import { MyRoutinesService } from '../../src/modules/care/services/my-routines.service';
import { createActor, Actor } from '../fixtures/actors';

describe('GLO-284: Product Schema Audit & AI-Ready Foundation (e2e/integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let catalogService: CatalogService;
  let myRoutinesService: MyRoutinesService;
  let admin: Actor;

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useLogger(false);
    await app.init();

    prisma = app.get(PrismaService);
    catalogService = app.get(CatalogService);
    myRoutinesService = app.get(MyRoutinesService);
    admin = await createActor(prisma, 'ADMIN');
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('1. Dermatological Fact Persistence & Retrieval via CatalogService', () => {
    it('creates and retrieves a product with comprehensive galenic, photoprotection, and review metadata', async () => {
      const brand = await prisma.brand.create({
        data: { name: 'DermoLab ' + randomUUID().slice(0, 8), slug: 'dermolab-' + randomUUID().slice(0, 8) },
      });

      const product = await catalogService.createProduct({
        name: 'Barrier Defense Sun Gel-Cream SPF 50+',
        brandId: brand.id,
        targetArea: UsageTargetArea.FACE,
        texture: ProductTexture.GEL_CREAM,
        suitableSkinTypes: ['OILY', 'COMBINATION', 'SENSITIVE'],
        suitableHairTypes: [],
        spf: 50,
        broadSpectrum: true,
        uvFilterType: UvFilterType.HYBRID,
        waterResistanceMinutes: 80,
        isFragranceFree: true,
        isNonComedogenic: true,
        claimsEvidence: {
          fragranceFree: { verified: true, sourceUrl: 'https://official.test/cert' },
        },
        factVersion: 1,
        lastReviewedAt: new Date(),
        lastReviewedBy: admin.id,
        isPublished: true,
      });

      expect(product.id).toBeDefined();
      expect(product.texture).toBe(ProductTexture.GEL_CREAM);
      expect(product.targetArea).toBe(UsageTargetArea.FACE);
      expect(product.suitableSkinTypes).toEqual(['OILY', 'COMBINATION', 'SENSITIVE']);
      expect(product.spf).toBe(50);
      expect(product.broadSpectrum).toBe(true);
      expect(product.uvFilterType).toBe(UvFilterType.HYBRID);
      expect(product.waterResistanceMinutes).toBe(80);
      expect(product.isFragranceFree).toBe(true);
      expect(product.isNonComedogenic).toBe(true);
      expect(product.factVersion).toBe(1);
      expect(product.lastReviewedBy).toBe(admin.id);

      // Verify Routine Product Facts extractor for AI/Care engine
      const factsList = await catalogService.getRoutineProductFacts([product.id]);
      const facts = factsList.find(f => f.productId === product.id);
      expect(facts).toBeDefined();
      expect(facts?.texture).toBe(ProductTexture.GEL_CREAM);
      expect(facts?.targetArea).toBe(UsageTargetArea.FACE);
      expect(facts?.suitableSkinTypes).toEqual(['OILY', 'COMBINATION', 'SENSITIVE']);
      expect(facts?.spf).toBe(50);
      expect(facts?.broadSpectrum).toBe(true);
      expect(facts?.uvFilterType).toBe(UvFilterType.HYBRID);
      expect(facts?.waterResistanceMinutes).toBe(80);
      expect(facts?.isFragranceFree).toBe(true);
      expect(facts?.isNonComedogenic).toBe(true);
      expect(facts?.factVersion).toBe(1);
    });

    it('creates a SKU with estimated days of use for replenishment planning', async () => {
      const brand = await prisma.brand.create({
        data: { name: 'ScalpCare ' + randomUUID().slice(0, 8), slug: 'scalpcare-' + randomUUID().slice(0, 8) },
      });

      const product = await catalogService.createProduct({
        name: 'Peptide Density Scalp Serum 60ml',
        brandId: brand.id,
        targetArea: UsageTargetArea.SCALP,
        texture: ProductTexture.SERUM,
        suitableSkinTypes: [],
        suitableHairTypes: ['FINE', 'OILY'],
      });

      const sku = await catalogService.createSku(product.id, {
        code: 'SKU-' + randomUUID().slice(0, 8).toUpperCase(),
        variantName: 'Standard 60ml',
        size: 60,
        sizeUnit: 'ml',
        estimatedDaysOfUse: 45,
      });

      expect(sku.id).toBeDefined();
      expect(sku.size).toBe(60);
      expect(sku.estimatedDaysOfUse).toBe(45);
    });
  });

  describe('2. Database CHECK Constraints (Negative & Boundary Testing)', () => {
    it('rejects SPF lower than 2 with check constraint violation', async () => {
      const brand = await prisma.brand.create({
        data: { name: 'Test Brand ' + randomUUID().slice(0, 8), slug: 'test-' + randomUUID().slice(0, 8) },
      });

      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO catalog.products (id, name, slug, brand_id, spf, fact_version) VALUES ($1::uuid, $2, $3, $4::uuid, $5, 1)`,
          randomUUID(),
          'Invalid Low SPF Product',
          'invalid-low-spf-' + randomUUID().slice(0, 8),
          brand.id,
          1,
        ),
      ).rejects.toThrow();
    });

    it('rejects SPF higher than 100 with check constraint violation', async () => {
      const brand = await prisma.brand.create({
        data: { name: 'Test Brand ' + randomUUID().slice(0, 8), slug: 'test-' + randomUUID().slice(0, 8) },
      });

      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO catalog.products (id, name, slug, brand_id, spf, fact_version) VALUES ($1::uuid, $2, $3, $4::uuid, $5, 1)`,
          randomUUID(),
          'Invalid High SPF Product',
          'invalid-high-spf-' + randomUUID().slice(0, 8),
          brand.id,
          105,
        ),
      ).rejects.toThrow();
    });

    it('rejects non-positive water resistance minutes with check constraint violation', async () => {
      const brand = await prisma.brand.create({
        data: { name: 'Test Brand ' + randomUUID().slice(0, 8), slug: 'test-' + randomUUID().slice(0, 8) },
      });

      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO catalog.products (id, name, slug, brand_id, water_resistance_minutes, fact_version) VALUES ($1::uuid, $2, $3, $4::uuid, $5, 1)`,
          randomUUID(),
          'Invalid Water Resistance Product',
          'invalid-water-res-' + randomUUID().slice(0, 8),
          brand.id,
          0,
        ),
      ).rejects.toThrow();
    });

    it('rejects fact_version < 1 with check constraint violation', async () => {
      const brand = await prisma.brand.create({
        data: { name: 'Test Brand ' + randomUUID().slice(0, 8), slug: 'test-' + randomUUID().slice(0, 8) },
      });

      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO catalog.products (id, name, slug, brand_id, fact_version) VALUES ($1::uuid, $2, $3, $4::uuid, $5)`,
          randomUUID(),
          'Invalid Fact Version Product',
          'invalid-fact-ver-' + randomUUID().slice(0, 8),
          brand.id,
          0,
        ),
      ).rejects.toThrow();
    });

    it('rejects estimated_days_of_use <= 0 on SKU with check constraint violation', async () => {
      const brand = await prisma.brand.create({
        data: { name: 'Test Brand ' + randomUUID().slice(0, 8), slug: 'test-' + randomUUID().slice(0, 8) },
      });
      const prod = await prisma.product.create({
        data: { name: 'Base Product', slug: 'base-product-' + randomUUID().slice(0, 8), brandId: brand.id },
      });

      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO catalog.skus (id, product_id, code, variant_name, estimated_days_of_use) VALUES ($1::uuid, $2::uuid, $3, 'Standard', $4)`,
          randomUUID(),
          prod.id,
          'SKU-ZERO-DAYS-' + randomUUID().slice(0, 6),
          0,
        ),
      ).rejects.toThrow();
    });
  });

  describe('3. Backward Compatibility & Defaults', () => {
    it('defaults fact_version to 1 and dermatological fields to null/empty without breaking legacy writes', async () => {
      const brand = await prisma.brand.create({
        data: { name: 'Legacy Brand ' + randomUUID().slice(0, 8), slug: 'legacy-' + randomUUID().slice(0, 8) },
      });

      const product = await catalogService.createProduct({
        name: 'Simple Cleanser',
        brandId: brand.id,
      });

      expect(product.id).toBeDefined();
      expect(product.texture).toBeNull();
      expect(product.targetArea).toBeNull();
      expect(product.spf).toBeNull();
      expect(product.broadSpectrum).toBeNull();
      expect(product.uvFilterType).toBeNull();
      expect(product.waterResistanceMinutes).toBeNull();
      expect(product.isFragranceFree).toBeNull();
      expect(product.isNonComedogenic).toBeNull();
      expect(product.suitableSkinTypes).toEqual([]);
      expect(product.suitableHairTypes).toEqual([]);
      expect(product.factVersion).toBe(1);
    });
  });

  describe('4. HTTP API Input Validation (DTO Guards)', () => {
    it('validates DTO bounds when updating product via PATCH /products/:id', async () => {
      const brand = await prisma.brand.create({
        data: { name: 'API Brand ' + randomUUID().slice(0, 8), slug: 'api-' + randomUUID().slice(0, 8) },
      });
      const prod = await prisma.product.create({
        data: { name: 'API Test Product', slug: 'api-test-product-' + randomUUID().slice(0, 8), brandId: brand.id },
      });

      // Valid update
      const validRes = await http()
        .patch(`/products/${prod.id}`)
        .set(admin.auth)
        .send({
          texture: ProductTexture.LOTION,
          targetArea: UsageTargetArea.BODY,
          spf: 30,
          broadSpectrum: true,
          uvFilterType: UvFilterType.CHEMICAL,
          isFragranceFree: true,
          factVersion: 2,
        })
        .expect(200);

      expect(validRes.body.texture).toBe(ProductTexture.LOTION);
      expect(validRes.body.targetArea).toBe(UsageTargetArea.BODY);
      expect(validRes.body.spf).toBe(30);
      expect(validRes.body.broadSpectrum).toBe(true);
      expect(validRes.body.uvFilterType).toBe(UvFilterType.CHEMICAL);
      expect(validRes.body.isFragranceFree).toBe(true);
      expect(validRes.body.factVersion).toBe(2);

      // Invalid SPF (> 100)
      await http()
        .patch(`/products/${prod.id}`)
        .set(admin.auth)
        .send({ spf: 150 })
        .expect(400);

      // Invalid texture enum value
      await http()
        .patch(`/products/${prod.id}`)
        .set(admin.auth)
        .send({ texture: 'INVALID_TEXTURE_MAGIC' })
        .expect(400);

      // Invalid UV filter enum value
      await http()
        .patch(`/products/${prod.id}`)
        .set(admin.auth)
        .send({ uvFilterType: 'SOLAR_SHIELD' })
        .expect(400);
    });
  });

  describe('5. Structured Usage Rules with Application Quantity and Intro Phases (GLO-284 §5)', () => {
    it('persists and retrieves application quantity and introductory phase sequencing', async () => {
      const brand = await prisma.brand.create({
        data: { name: 'RetinolBrand ' + randomUUID().slice(0, 8), slug: 'retinolbrand-' + randomUUID().slice(0, 8) },
      });
      const product = await catalogService.createProduct({
        name: 'Pure Retinol 0.3% Night Serum',
        brandId: brand.id,
        isPublished: true,
      });
      const sku = await catalogService.createSku(product.id, {
        code: 'SKU-RET-' + randomUUID().slice(0, 6),
        variantName: '30ml',
        size: 30,
        sizeUnit: 'ml',
      });

      const now = new Date();
      await catalogService.addReviewedUsageRules(product.id, sku.id, [
        {
          targetArea: 'FACE',
          routinePeriod: 'PM',
          rinseMode: 'LEAVE_ON',
          frequencyUnit: 'WEEK',
          usesMin: 2,
          usesMax: 2,
          applicationQuantity: 3,
          applicationUnit: 'drops',
          contactMinutes: null,
          condition: 'introductory',
          isIntroductory: true,
          phaseOrder: 1,
          phaseWeeksMin: 2,
          phaseWeeksMax: 4,
          evidenceText: 'Apply 3 drops twice weekly for first 2-4 weeks',
          sourceUrl: 'https://official.test/directions',
          sourceType: 'OFFICIAL_LABEL',
          reviewedBy: admin.id,
          reviewedAt: now,
        },
      ]);

      const factsList = await catalogService.getRoutineProductFacts([product.id]);
      const facts = factsList.find(f => f.productId === product.id);
      expect(facts).toBeDefined();
      expect(facts?.usageRules).toHaveLength(1);
      const rule = facts!.usageRules[0];
      expect(rule.applicationQuantity).toBe(3);
      expect(rule.applicationUnit).toBe('drops');
      expect(rule.isIntroductory).toBe(true);
      expect(rule.phaseOrder).toBe(1);
      expect(rule.condition).toBe('introductory');
    });
  });

  describe('6. Structured Product Safety Warnings (GLO-284 §4D)', () => {
    it('records and extracts product-level contraindications for recommendation safety', async () => {
      const brand = await prisma.brand.create({
        data: { name: 'SafetyBrand ' + randomUUID().slice(0, 8), slug: 'safetybrand-' + randomUUID().slice(0, 8) },
      });
      const product = await catalogService.createProduct({
        name: 'High Potency Retinoid 1%',
        brandId: brand.id,
        isPublished: true,
      });

      const warning = await catalogService.addProductSafetyWarning(product.id, {
        kind: SafetyWarningKind.CONTRAINDICATION,
        condition: 'PREGNANT',
        descriptionEn: 'Do not use during pregnancy or breastfeeding',
        descriptionAr: 'لا يستخدم أثناء فترة الحمل أو الرضاعة',
        sourceType: 'CLINICAL_GUIDELINE',
        sourceUrl: 'https://guidance.test/retinoids',
        reviewedBy: admin.id,
      });

      expect(warning.id).toBeDefined();
      expect(warning.kind).toBe(SafetyWarningKind.CONTRAINDICATION);
      expect(warning.condition).toBe('PREGNANT');

      const factsList = await catalogService.getRoutineProductFacts([product.id]);
      const facts = factsList.find(f => f.productId === product.id);
      expect(facts?.safetyWarnings).toBeDefined();
      expect(facts?.safetyWarnings?.some(w => w.condition === 'PREGNANT' && w.kind === 'CONTRAINDICATION')).toBe(true);
    });
  });

  describe('7. Regulatory Claims & Contradictory Fact Rejection (GLO-284 §4E)', () => {
    it('refuses to link a fragrance ingredient to a product claimed fragrance-free', async () => {
      const brand = await prisma.brand.create({
        data: { name: 'CleanBrand ' + randomUUID().slice(0, 8), slug: 'cleanbrand-' + randomUUID().slice(0, 8) },
      });
      const product = await catalogService.createProduct({
        name: 'Sensitive Skin Cream',
        brandId: brand.id,
        isFragranceFree: true,
      });

      const fragranceIng = await prisma.ingredient.create({
        data: {
          name: 'Fragrance / Parfum ' + randomUUID().slice(0, 6),
          slug: 'parfum-' + randomUUID().slice(0, 6),
          inciName: 'Parfum',
          primaryFunction: 'Fragrance',
          status: 'APPROVED',
        },
      });

      await expect(
        catalogService.addReviewedProductIngredients(product.id, [fragranceIng.id]),
      ).rejects.toThrow(/Cannot link fragrance ingredient/);
    });

    it('refuses to mark a product fragrance-free when linked ingredients contain fragrance', async () => {
      const brand = await prisma.brand.create({
        data: { name: 'ScentedBrand ' + randomUUID().slice(0, 8), slug: 'scentedbrand-' + randomUUID().slice(0, 8) },
      });
      const product = await catalogService.createProduct({
        name: 'Scented Body Lotion',
        brandId: brand.id,
      });

      const fragranceIng = await prisma.ingredient.create({
        data: {
          name: 'Parfum Blend ' + randomUUID().slice(0, 6),
          slug: 'parfum-blend-' + randomUUID().slice(0, 6),
          inciName: 'Fragrance',
          primaryFunction: 'Fragrance',
          status: 'APPROVED',
        },
      });

      await catalogService.addReviewedProductIngredients(product.id, [fragranceIng.id]);

      await expect(
        catalogService.updateProduct(product.id, { isFragranceFree: true }),
      ).rejects.toThrow(/Cannot mark product fragrance-free/);
    });
  });

  describe('8. Customer Usage Schedules in Care Domain (GLO-284 §5)', () => {
    it('persists and retrieves a customer weekly schedule scoped to routine and item', async () => {
      const customer = await prisma.customer.create({
        data: { email: 'sched-' + randomUUID().slice(0, 6) + '@test.com', name: 'Schedule Customer' },
      });
      const careProfile = await prisma.customerCareProfile.create({
        data: { customerId: customer.id, skinType: 'oily' },
      });
      const routine = await prisma.customerRoutine.create({
        data: {
          careProfileId: careProfile.id,
          blueprintId: randomUUID(),
          blueprintVersion: 1,
          createdFromProposalId: randomUUID(),
          titleAr: 'روتيني الأسبوعي',
          concernSlug: 'acne',
          careArea: 'skin',
          kind: 'TREATMENT',
          tier: 'COMPLETE',
        },
      });

      const brand = await prisma.brand.create({
        data: { name: 'ScheduleBrand ' + randomUUID().slice(0, 8), slug: 'schedbrand-' + randomUUID().slice(0, 8) },
      });
      const product = await catalogService.createProduct({
        name: 'BHA Exfoliating Liquid',
        brandId: brand.id,
      });

      const item = await prisma.customerRoutineItem.create({
        data: {
          routineId: routine.id,
          roleKey: 'treatment',
          sortOrder: 2,
          isEssential: true,
          productId: product.id,
          addedAtVersion: 1,
        },
      });

      const startDate = new Date();
      const schedule = await myRoutinesService.setSchedule(routine.id, customer.id, {
        routineItemId: item.id,
        productId: product.id,
        weekdays: [1, 3, 5], // Mon, Wed, Fri
        timingSlot: 'PM',
        plannedUsesPerOccurrence: 1,
        phase: 1,
        startDate,
        notes: 'Apply after cleansing on dry skin',
        isConfirmed: true,
      });

      expect(schedule.id).toBeDefined();
      expect(schedule.weekdays).toEqual([1, 3, 5]);
      expect(schedule.timingSlot).toBe('PM');
      expect(schedule.isConfirmed).toBe(true);

      const schedules = await myRoutinesService.getSchedules(routine.id, customer.id);
      expect(schedules).toHaveLength(1);
      expect(schedules[0].routineItemId).toBe(item.id);
      expect(schedules[0].weekdays).toEqual([1, 3, 5]);
    });
  });
});

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { CatalogService } from '../../src/modules/catalog/services/catalog.service';
import { ProductTexture, UvFilterType, UsageTargetArea, SafetyWarningKind } from '../../src/modules/catalog/public';
import { MyRoutinesService } from '../../src/modules/care/services/my-routines.service';
import { exclusionFor } from '../../src/modules/care/engine/routine-engine';
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

    it('proves that structured ProductSafetyWarning conditions are consumed by recommendation eligibility logic (Condition 1)', async () => {
      const brand = await prisma.brand.create({
        data: { name: 'SafetyBrand2 ' + randomUUID().slice(0, 8), slug: 'safetybrand2-' + randomUUID().slice(0, 8) },
      });
      const product = await catalogService.createProduct({
        name: 'Pregnancy-Restricted Exfoliant',
        brandId: brand.id,
        isPublished: true,
      });
      await catalogService.addProductSafetyWarning(product.id, {
        kind: SafetyWarningKind.CONTRAINDICATION,
        condition: 'PREGNANT',
        descriptionEn: 'Contraindicated in pregnancy',
        sourceType: 'REGULATORY',
        reviewedBy: admin.id,
      });

      const factsList = await catalogService.getRoutineProductFacts([product.id]);
      const facts = factsList.find(f => f.productId === product.id);
      expect(facts?.safetyWarnings).toHaveLength(1);

      const bp = {
        id: 'bp-test', key: 'test', version: 1, concernSlug: 'acne', careArea: 'skin' as const, kind: 'TREATMENT' as const,
        severityMin: 1, severityMax: 3, titleAr: 'روتين تجريبي', goalAr: null, timelineAr: null, safetyNotesAr: [],
        roles: [{ roleKey: 'treatment', sortOrder: 1, titleAr: 'علاج', isEssential: true, startWeek: 1, requiredActives: [], concentrationRanges: [], usageNoteAr: null }],
      };
      const candidateObj = {
        productId: product.id, skuId: null, name: product.name, brandName: 'SafetyBrand2', imageUrl: null,
        roleKey: 'treatment', tier: 'SMART' as const, concernSlugs: ['acne'], suitableSkinTypes: [], price: 100, currency: 'EGP',
        sellable: true, actives: [], ingredientIds: [], ingredientSlugs: [], ingredientFamilies: [], usageRuleCount: 1,
        factsReviewedAt: [new Date().toISOString()],
        safetyWarnings: facts!.safetyWarnings!.map(w => ({ kind: w.kind, condition: w.condition })),
      };

      const now = new Date();
      // Blocked case: pregnant = YES
      const ctxBlocked = {
        severity: 2, skinType: null, ageBand: 'ADULT' as const, experienceLevel: null, fragranceFree: false,
        safety: { pregnant: 'YES' as const, breastfeeding: 'NO' as const, prescriptionTopical: 'NO' as const, oralRetinoid: 'NO' as const, fragranceSensitive: 'NO' as const },
        allergyIngredientIds: [], tier: 'SMART' as const, budget: null, ownedRoleKeys: [], overrides: { swaps: {}, removed: [], upgrades: [] },
        activeRoutineProducts: [], now,
      };
      const blocked = exclusionFor(candidateObj, bp.roles[0], bp, ctxBlocked, [], []);
      expect(blocked).toEqual({ reason: 'CONDITION:PREGNANT', unknownSafety: false });

      // Unknown case: pregnant = UNKNOWN
      const ctxUnknown = { ...ctxBlocked, safety: { ...ctxBlocked.safety, pregnant: 'UNKNOWN' as const } };
      const unknownRes = exclusionFor(candidateObj, bp.roles[0], bp, ctxUnknown, [], []);
      expect(unknownRes).toEqual({ reason: 'CONDITION:PREGNANT', unknownSafety: true });

      // Permitted case: pregnant = NO
      const ctxPermitted = { ...ctxBlocked, safety: { ...ctxBlocked.safety, pregnant: 'NO' as const } };
      const permitted = exclusionFor(candidateObj, bp.roles[0], bp, ctxPermitted, [], []);
      expect(permitted).toBeNull();
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

    it('rejects invalid weekdays (< 1 or > 7) and non-positive phase at service and database level (Condition 5)', async () => {
      const customer = await prisma.customer.create({
        data: { email: 'sched-val-' + randomUUID().slice(0, 6) + '@test.com', name: 'Schedule Val Customer' },
      });
      const careProfile = await prisma.customerCareProfile.create({
        data: { customerId: customer.id, skinType: 'oily' },
      });
      const routine = await prisma.customerRoutine.create({
        data: {
          careProfileId: careProfile.id, blueprintId: randomUUID(), blueprintVersion: 1, createdFromProposalId: randomUUID(),
          titleAr: 'روتين التحقق', concernSlug: 'acne', careArea: 'skin', kind: 'TREATMENT', tier: 'SMART',
        },
      });
      const brand = await prisma.brand.create({
        data: { name: 'ValBrand ' + randomUUID().slice(0, 8), slug: 'valbrand-' + randomUUID().slice(0, 8) },
      });
      const product = await catalogService.createProduct({ name: 'Val Product', brandId: brand.id });
      const item = await prisma.customerRoutineItem.create({
        data: { routineId: routine.id, roleKey: 'treatment', sortOrder: 1, isEssential: true, productId: product.id, addedAtVersion: 1 },
      });

      // Service level weekday validation: 0 or 8 rejected
      await expect(
        myRoutinesService.setSchedule(routine.id, customer.id, {
          routineItemId: item.id, productId: product.id, weekdays: [0, 2], startDate: new Date(),
        }),
      ).rejects.toThrow(/Invalid weekday '0'/);

      await expect(
        myRoutinesService.setSchedule(routine.id, customer.id, {
          routineItemId: item.id, productId: product.id, weekdays: [2, 8], startDate: new Date(),
        }),
      ).rejects.toThrow(/Invalid weekday '8'/);

      // Service level phase validation: 0 rejected
      await expect(
        myRoutinesService.setSchedule(routine.id, customer.id, {
          routineItemId: item.id, productId: product.id, phase: 0, startDate: new Date(),
        }),
      ).rejects.toThrow(/Schedule phase must be an integer >= 1/);

      // Database CHECK constraint on weekdays: direct SQL bypass rejected
      await expect(
        prisma.$executeRawUnsafe(`
          INSERT INTO "care"."customer_usage_schedules"
            ("id", "customer_routine_id", "routine_item_id", "product_id", "weekdays", "timing_slot", "planned_uses_per_occurrence", "phase", "start_date", "routine_version", "created_at", "updated_at")
          VALUES
            (gen_random_uuid(), '${routine.id}'::uuid, '${item.id}'::uuid, '${product.id}'::uuid, ARRAY[8]::integer[], 'BOTH', 1, 1, CURRENT_DATE, 1, NOW(), NOW())
        `),
      ).rejects.toThrow();

      // Database CHECK constraint on phase: direct SQL bypass rejected
      await expect(
        prisma.$executeRawUnsafe(`
          INSERT INTO "care"."customer_usage_schedules"
            ("id", "customer_routine_id", "routine_item_id", "product_id", "weekdays", "timing_slot", "planned_uses_per_occurrence", "phase", "start_date", "routine_version", "created_at", "updated_at")
          VALUES
            (gen_random_uuid(), '${routine.id}'::uuid, '${item.id}'::uuid, '${product.id}'::uuid, ARRAY[1, 2]::integer[], 'BOTH', 1, 0, CURRENT_DATE, 1, NOW(), NOW())
        `),
      ).rejects.toThrow();
    });

    it('enforces ownership and routine-item identity (Condition 5)', async () => {
      const customer1 = await prisma.customer.create({ data: { email: 'c1-' + randomUUID().slice(0, 6) + '@test.com', name: 'Customer 1' } });
      const customer2 = await prisma.customer.create({ data: { email: 'c2-' + randomUUID().slice(0, 6) + '@test.com', name: 'Customer 2' } });
      const cp1 = await prisma.customerCareProfile.create({ data: { customerId: customer1.id, skinType: 'oily' } });
      const routine1 = await prisma.customerRoutine.create({
        data: { careProfileId: cp1.id, blueprintId: randomUUID(), blueprintVersion: 1, createdFromProposalId: randomUUID(),
          titleAr: 'روتين خاص', concernSlug: 'acne', careArea: 'skin', kind: 'TREATMENT', tier: 'SMART' },
      });
      const brand = await prisma.brand.create({ data: { name: 'OwnerBrand ' + randomUUID().slice(0, 8), slug: 'ownerbrand-' + randomUUID().slice(0, 8) } });
      const product = await catalogService.createProduct({ name: 'Owner Product', brandId: brand.id });
      const item = await prisma.customerRoutineItem.create({
        data: { routineId: routine1.id, roleKey: 'cleanser', sortOrder: 1, isEssential: true, productId: product.id, addedAtVersion: 1 },
      });

      // Customer 2 cannot read or set schedule for Customer 1's routine
      await expect(myRoutinesService.getSchedules(routine1.id, customer2.id)).rejects.toThrow();
      await expect(myRoutinesService.setSchedule(routine1.id, customer2.id, {
        routineItemId: item.id, productId: product.id, startDate: new Date(),
      })).rejects.toThrow();

      // Routine-item mismatch rejected
      await expect(myRoutinesService.setSchedule(routine1.id, customer1.id, {
        routineItemId: randomUUID(), productId: product.id, startDate: new Date(),
      })).rejects.toThrow(/Routine item does not match product or routine/);
    });

    it('prevents duplicates by idempotent upsert and enforces usage rule consistency (Condition 5)', async () => {
      const customer = await prisma.customer.create({ data: { email: 'dup-' + randomUUID().slice(0, 6) + '@test.com', name: 'Dup Customer' } });
      const cp = await prisma.customerCareProfile.create({ data: { customerId: customer.id, skinType: 'oily' } });
      const routine = await prisma.customerRoutine.create({
        data: { careProfileId: cp.id, blueprintId: randomUUID(), blueprintVersion: 1, createdFromProposalId: randomUUID(),
          titleAr: 'روتين عدم التكرار', concernSlug: 'acne', careArea: 'skin', kind: 'TREATMENT', tier: 'SMART' },
      });
      const brand = await prisma.brand.create({ data: { name: 'DupBrand ' + randomUUID().slice(0, 8), slug: 'dupbrand-' + randomUUID().slice(0, 8) } });
      const product = await catalogService.createProduct({ name: 'Retinoid Night Cream', brandId: brand.id });
      const item = await prisma.customerRoutineItem.create({
        data: { routineId: routine.id, roleKey: 'treatment', sortOrder: 1, isEssential: true, productId: product.id, addedAtVersion: 1 },
      });

      // Add a PM-only usage rule with max 3 days per week
      const usageRule = await prisma.productUsageRule.create({
        data: {
          productId: product.id,
          routinePeriod: 'PM',
          rinseMode: 'LEAVE_ON',
          frequencyUnit: 'WEEK',
          usesMin: 1,
          usesMax: 3,
          evidenceText: 'Apply in PM only, up to 3 times weekly',
          sourceUrl: 'https://directions.test',
          sourceType: 'PACKAGING',
          reviewedBy: admin.id,
          reviewedAt: new Date(),
        },
      });

      // Scheduling for AM violates the PM-only rule
      await expect(
        myRoutinesService.setSchedule(routine.id, customer.id, {
          routineItemId: item.id, productId: product.id, sourceUsageRuleId: usageRule.id, timingSlot: 'AM', startDate: new Date(),
        }),
      ).rejects.toThrow(/incompatible with approved PM-only usage rule/);

      // Scheduling 4 days violates usesMax: 3
      await expect(
        myRoutinesService.setSchedule(routine.id, customer.id, {
          routineItemId: item.id, productId: product.id, sourceUsageRuleId: usageRule.id, timingSlot: 'PM', weekdays: [1, 2, 4, 6], startDate: new Date(),
        }),
      ).rejects.toThrow(/exceed maximum approved weekly frequency \(3\)/);

      // Valid PM schedule with 2 days
      const s1 = await myRoutinesService.setSchedule(routine.id, customer.id, {
        routineItemId: item.id, productId: product.id, sourceUsageRuleId: usageRule.id, timingSlot: 'PM', weekdays: [1, 4], phase: 1, startDate: new Date(), notes: 'Initial'
      });
      expect(s1.id).toBeDefined();

      // Repeated call with same slot & phase updates the existing row without creating duplicate
      const s2 = await myRoutinesService.setSchedule(routine.id, customer.id, {
        routineItemId: item.id, productId: product.id, sourceUsageRuleId: usageRule.id, timingSlot: 'PM', weekdays: [2, 5], phase: 1, startDate: new Date(), notes: 'Updated note'
      });
      expect(s2.id).toBe(s1.id);
      expect(s2.weekdays).toEqual([2, 5]);
      expect(s2.notes).toBe('Updated note');

      // Verify list has exactly 1 entry
      const list = await myRoutinesService.getSchedules(routine.id, customer.id);
      expect(list).toHaveLength(1);
    });
  });
});

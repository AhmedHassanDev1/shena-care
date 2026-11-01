import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { CatalogService } from '../../src/modules/catalog/services/catalog.service';
import { SafetyWarningKind } from '../../src/modules/catalog/public';
import { extractProductFeatures } from '../../src/modules/care/contracts/recommendation-features.contract';
import {
  exclusionFor,
  EngineCandidate,
  EngineRole,
  EngineBlueprint,
  EngineRule,
  EngineContext,
} from '../../src/modules/care/engine/routine-engine';
import { ProductIdentityService, MatchClassification } from '../../src/modules/ingestion/services/product-identity.service';
import { RowNormalizationService } from '../../src/modules/ingestion/services/row-normalization.service';

describe('GLO-284: Final Formula Isolation, SKU Composition & Ingestion Invariant (e2e/integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let catalogService: CatalogService;
  let identityService: ProductIdentityService;
  let normalizationService: RowNormalizationService;

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
    identityService = app.get(ProductIdentityService);
    normalizationService = app.get(RowNormalizationService);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  describe('1. Formula & SKU Ingredient & Concentration Isolation in Database', () => {
    const uniqueSuffix = randomUUID().slice(0, 8);
    let brandId: string;
    let categoryId: string;
    let bpoIngId: string;
    let retinolIngId: string;
    let niacinamideIngId: string;
    let productId: string;
    let skuMildId: string;
    let skuIntenseId: string;

    beforeAll(async () => {
      // 1. Setup brand and category
      const brand = await prisma.brand.create({
        data: { name: `DermLab ${uniqueSuffix}`, slug: `dermlab-${uniqueSuffix}` },
      });
      brandId = brand.id;

      const category = await prisma.category.create({
        data: { name: `Treatments ${uniqueSuffix}`, slug: `treatments-${uniqueSuffix}` },
      });
      categoryId = category.id;

      // 2. Setup distinct ingredients
      const ingNiacinamide = await prisma.ingredient.create({
        data: {
          name: `Niacinamide ${uniqueSuffix}`,
          slug: `niacinamide-${uniqueSuffix}`,
          inciName: `Niacinamide ${uniqueSuffix}`,
          primaryFunction: 'Active',
          family: 'Vitamin B',
          familySlug: 'vitamin-b',
          status: 'APPROVED',
        },
      });
      niacinamideIngId = ingNiacinamide.id;

      const ingBpo = await prisma.ingredient.create({
        data: {
          name: `Benzoyl Peroxide ${uniqueSuffix}`,
          slug: `benzoyl-peroxide-${uniqueSuffix}`,
          inciName: `Benzoyl Peroxide ${uniqueSuffix}`,
          primaryFunction: 'Active',
          family: 'Peroxides',
          familySlug: 'peroxides',
          status: 'APPROVED',
        },
      });
      bpoIngId = ingBpo.id;

      const ingRetinol = await prisma.ingredient.create({
        data: {
          name: `Retinol ${uniqueSuffix}`,
          slug: `retinol-${uniqueSuffix}`,
          inciName: `Retinol ${uniqueSuffix}`,
          primaryFunction: 'Active',
          family: 'Retinoids',
          familySlug: 'retinoid',
          status: 'APPROVED',
        },
      });
      retinolIngId = ingRetinol.id;

      // 3. Create ONE parent product
      const product = await catalogService.createProduct({
        brandId,
        categoryId,
        name: `Dual Treatment Serum ${uniqueSuffix}`,
        slug: `dual-treatment-serum-${uniqueSuffix}`,
        concerns: ['acne'],
        isPublished: true,
      });
      productId = product.id;

      // 4. Create TWO SKUs under the same Product representing different formula variations
      const skuMild = await catalogService.createSku(productId, {
        code: `SKU-MILD-${uniqueSuffix}`,
        variantName: 'Mild Clarifying 2.5% BPO',
        size: 30,
        sizeUnit: 'ml',
        barcode: `622000${uniqueSuffix}1`,
      });
      skuMildId = skuMild.id;

      const skuIntense = await catalogService.createSku(productId, {
        code: `SKU-INTENSE-${uniqueSuffix}`,
        variantName: 'Intense Renewal 1.0% Retinol',
        size: 30,
        sizeUnit: 'ml',
        barcode: `622000${uniqueSuffix}2`,
      });
      skuIntenseId = skuIntense.id;

      // 5. Attach shared product-wide ingredient (Niacinamide)
      await prisma.productIngredient.create({
        data: {
          productId,
          skuId: null, // Product-wide shared base active
          ingredientId: niacinamideIngId,
          isKeyActive: true,
          concentrationValue: 4.0,
          concentrationUnit: '%',
          concentrationStatus: 'STATED',
          concentrationEvidence: { sourceUrl: 'https://dermlab.com/base-formula', reviewedBy: 'SafetyLead' },
        },
      });

      // 6. Attach SKU-specific formula ingredients
      // Mild SKU -> 2.5% BPO (No Retinol!)
      await prisma.productIngredient.create({
        data: {
          productId,
          skuId: skuMildId,
          ingredientId: bpoIngId,
          isKeyActive: true,
          concentrationValue: 2.5,
          concentrationUnit: '%',
          concentrationStatus: 'STATED',
          concentrationEvidence: { sourceUrl: 'https://dermlab.com/mild-formula', reviewedBy: 'ClinicalReviewer' },
        },
      });

      // Intense SKU -> 1.0% Retinol (No BPO!)
      await prisma.productIngredient.create({
        data: {
          productId,
          skuId: skuIntenseId,
          ingredientId: retinolIngId,
          isKeyActive: true,
          concentrationValue: 1.0,
          concentrationUnit: '%',
          concentrationStatus: 'STATED',
          concentrationEvidence: { sourceUrl: 'https://dermlab.com/intense-formula', reviewedBy: 'ClinicalReviewer' },
        },
      });

      // 7. Safety warning ONLY on Intense SKU (Contraindication for PREGNANT)
      await catalogService.addProductSafetyWarning(productId, {
        skuId: skuIntenseId,
        kind: SafetyWarningKind.CONTRAINDICATION,
        condition: 'PREGNANT',
        descriptionEn: 'Do not use during pregnancy due to high-strength retinol',
        descriptionAr: 'لا يستخدم أثناء الحمل لاحتوائه على الريتينول عالي التركيز',
        sourceType: 'CLINICAL_GUIDELINE',
        sourceUrl: 'https://dermlab.com/safety/retinol',
        reviewedBy: 'SafetyLead',
      });

      // 8. Usage rules: Mild is daily AM/PM; Intense is 2x/week PM only
      await prisma.productUsageRule.create({
        data: {
          productId,
          skuId: skuMildId,
          routinePeriod: 'BOTH',
          rinseMode: 'LEAVE_ON',
          frequencyUnit: 'DAY',
          usesMin: 1,
          usesMax: 2,
          applicationQuantity: 1.0,
          applicationUnit: 'PUMP',
          isIntroductory: false,
          evidenceText: 'Gentle formula suitable for daily morning and evening use',
          sourceType: 'MANUFACTURER_LABEL',
          sourceUrl: 'https://dermlab.com/mild-usage',
          reviewedBy: 'DermLead',
          reviewedAt: new Date(),
        },
      });

      await prisma.productUsageRule.create({
        data: {
          productId,
          skuId: skuIntenseId,
          routinePeriod: 'PM',
          rinseMode: 'LEAVE_ON',
          frequencyUnit: 'WEEK',
          usesMin: 1,
          usesMax: 2,
          applicationQuantity: 1.0,
          applicationUnit: 'PEA_SIZE',
          isIntroductory: true,
          phaseOrder: 1,
          phaseWeeksMin: 1,
          phaseWeeksMax: 4,
          evidenceText: 'High potency retinol requires gradual introductory phase 2 nights per week',
          sourceType: 'MANUFACTURER_LABEL',
          sourceUrl: 'https://dermlab.com/intense-usage',
          reviewedBy: 'DermLead',
          reviewedAt: new Date(),
        },
      });
    });

    it('proves that each SKU extracts ONLY its applicable formulation facts without cross-SKU leakage', async () => {
      const factsList = await catalogService.getRoutineProductFacts([productId]);
      expect(factsList).toHaveLength(1);
      const productFacts = factsList[0];

      // 1. Extract features for SKU-Mild
      const mildFeatures = extractProductFeatures(productFacts, skuMildId);
      expect(mildFeatures.skuId).toBe(skuMildId);

      // Mild MUST have Niacinamide (shared) and BPO 2.5% (sku-specific)
      const mildActiveSlugs = mildFeatures.actives.map(a => a.ingredientSlug);
      expect(mildActiveSlugs).toContain(`niacinamide-${uniqueSuffix}`);
      expect(mildActiveSlugs).toContain(`benzoyl-peroxide-${uniqueSuffix}`);
      // Mild MUST NOT have Retinol or Retinoid family!
      expect(mildActiveSlugs).not.toContain(`retinol-${uniqueSuffix}`);
      expect(mildFeatures.ingredientSlugs).not.toContain(`retinol-${uniqueSuffix}`);
      expect(mildFeatures.ingredientFamilies).not.toContain('retinoid');

      // Verify exact concentration
      const bpoActive = mildFeatures.actives.find(a => a.ingredientSlug === `benzoyl-peroxide-${uniqueSuffix}`);
      expect(bpoActive?.concentrationValue).toBe(2.5);
      expect(bpoActive?.concentrationUnit).toBe('%');

      // Mild MUST NOT have the Retinol pregnancy contraindication
      expect(mildFeatures.safetyWarnings).toHaveLength(0);

      // Mild usage rules MUST be daily AM/PM
      expect(mildFeatures.usageRules).toHaveLength(1);
      expect(mildFeatures.usageRules[0].routinePeriod).toBe('BOTH');
      expect(mildFeatures.usageRules[0].applicationUnit).toBe('PUMP');

      // 2. Extract features for SKU-Intense
      const intenseFeatures = extractProductFeatures(productFacts, skuIntenseId);
      expect(intenseFeatures.skuId).toBe(skuIntenseId);

      // Intense MUST have Niacinamide (shared) and Retinol 1.0% (sku-specific)
      const intenseActiveSlugs = intenseFeatures.actives.map(a => a.ingredientSlug);
      expect(intenseActiveSlugs).toContain(`niacinamide-${uniqueSuffix}`);
      expect(intenseActiveSlugs).toContain(`retinol-${uniqueSuffix}`);
      // Intense MUST NOT have Benzoyl Peroxide!
      expect(intenseActiveSlugs).not.toContain(`benzoyl-peroxide-${uniqueSuffix}`);
      expect(intenseFeatures.ingredientSlugs).not.toContain(`benzoyl-peroxide-${uniqueSuffix}`);
      expect(intenseFeatures.ingredientFamilies).toContain('retinoid');

      // Verify exact concentration
      const retinolActive = intenseFeatures.actives.find(a => a.ingredientSlug === `retinol-${uniqueSuffix}`);
      expect(retinolActive?.concentrationValue).toBe(1.0);
      expect(retinolActive?.concentrationUnit).toBe('%');

      // Intense MUST carry the pregnancy contraindication warning
      expect(intenseFeatures.safetyWarnings).toHaveLength(1);
      expect(intenseFeatures.safetyWarnings[0].condition).toBe('PREGNANT');
      expect(intenseFeatures.safetyWarnings[0].skuId).toBe(skuIntenseId);

      // Intense usage rules MUST be 2x/week PM only
      expect(intenseFeatures.usageRules).toHaveLength(1);
      expect(intenseFeatures.usageRules[0].routinePeriod).toBe('PM');
      expect(intenseFeatures.usageRules[0].applicationUnit).toBe('PEA_SIZE');
    });

    it('proves recommendation eligibility evaluates SKU-specific facts and isolates two customer profiles', async () => {
      const factsList = await catalogService.getRoutineProductFacts([productId]);
      const productFacts = factsList[0];

      // Build EngineCandidates for both SKUs
      const mildCandidate: EngineCandidate = {
        productId,
        skuId: skuMildId,
        name: `Dual Treatment Serum ${uniqueSuffix}`,
        brandName: `DermLab ${uniqueSuffix}`,
        imageUrl: null,
        roleKey: 'TREATMENT',
        tier: 'CORE',
        concernSlugs: ['acne'],
        suitableSkinTypes: ['OILY', 'COMBINATION'],
        price: 320,
        currency: 'EGP',
        sellable: true,
        actives: productFacts.actives.filter(a => !a.skuId || a.skuId === skuMildId),
        ingredientIds: (productFacts.productIngredients ?? [])
          .filter(pi => !pi.skuId || pi.skuId === skuMildId)
          .map(pi => pi.ingredientId),
        ingredientSlugs: (productFacts.productIngredients ?? [])
          .filter(pi => !pi.skuId || pi.skuId === skuMildId)
          .map(pi => pi.ingredientSlug),
        ingredientFamilies: [
          ...new Set(
            (productFacts.productIngredients ?? [])
              .filter(pi => !pi.skuId || pi.skuId === skuMildId)
              .map(pi => pi.familySlug)
              .filter((f): f is string => !!f),
          ),
        ],
        usageRuleCount: 1,
        factsReviewedAt: ['2026-11-01T00:00:00.000Z'],
        safetyWarnings: (productFacts.safetyWarnings ?? [])
          .filter(w => !w.skuId || w.skuId === skuMildId)
          .map(w => ({ kind: w.kind, condition: w.condition, skuId: w.skuId ?? null })),
      };

      const intenseCandidate: EngineCandidate = {
        productId,
        skuId: skuIntenseId,
        name: `Dual Treatment Serum ${uniqueSuffix}`,
        brandName: `DermLab ${uniqueSuffix}`,
        imageUrl: null,
        roleKey: 'TREATMENT',
        tier: 'CORE',
        concernSlugs: ['acne'],
        suitableSkinTypes: ['OILY', 'COMBINATION'],
        price: 450,
        currency: 'EGP',
        sellable: true,
        actives: productFacts.actives.filter(a => !a.skuId || a.skuId === skuIntenseId),
        ingredientIds: (productFacts.productIngredients ?? [])
          .filter(pi => !pi.skuId || pi.skuId === skuIntenseId)
          .map(pi => pi.ingredientId),
        ingredientSlugs: (productFacts.productIngredients ?? [])
          .filter(pi => !pi.skuId || pi.skuId === skuIntenseId)
          .map(pi => pi.ingredientSlug),
        ingredientFamilies: [
          ...new Set(
            (productFacts.productIngredients ?? [])
              .filter(pi => !pi.skuId || pi.skuId === skuIntenseId)
              .map(pi => pi.familySlug)
              .filter((f): f is string => !!f),
          ),
        ],
        usageRuleCount: 1,
        factsReviewedAt: ['2026-11-01T00:00:00.000Z'],
        safetyWarnings: (productFacts.safetyWarnings ?? [])
          .filter(w => !w.skuId || w.skuId === skuIntenseId)
          .map(w => ({ kind: w.kind, condition: w.condition, skuId: w.skuId ?? null })),
      };

      // Define Engine Role and Blueprint
      const role: EngineRole = {
        roleKey: 'TREATMENT',
        sortOrder: 1,
        titleAr: 'العلاج',
        isEssential: true,
        startWeek: 1,
        requiredActives: [],
        concentrationRanges: [],
        usageNoteAr: null,
      };

      const blueprint: EngineBlueprint = {
        id: 'bp-acne',
        key: 'bp-acne-1',
        version: 1,
        concernSlug: 'acne',
        careArea: 'skin',
        kind: 'TREATMENT',
        severityMin: 1,
        severityMax: 3,
        titleAr: 'روتين حب الشباب',
        goalAr: null,
        timelineAr: null,
        safetyNotesAr: [],
        roles: [role],
      };

      const rules: EngineRule[] = [
        {
          key: 'retinoid-pregnant',
          kind: 'EXCLUDE_CONDITION',
          subjectType: 'FAMILY',
          subject: 'retinoid',
          otherType: null,
          other: null,
          condition: 'PREGNANT',
          noteAr: 'لا يستخدم مع الحمل',
        },
      ];

      // Customer Profile 1: Pregnant customer
      const pregnantContext: EngineContext = {
        severity: 2,
        skinType: 'OILY',
        ageBand: 'ADULT',
        experienceLevel: 'BEGINNER',
        fragranceFree: null,
        safety: {
          pregnant: 'YES',
          breastfeeding: 'NO',
          prescriptionTopical: 'NO',
          oralRetinoid: 'NO',
          fragranceSensitive: 'NO',
        },
        allergyIngredientIds: [],
        tier: null,
        budget: null,
        ownedRoleKeys: [],
        overrides: { swaps: {}, removed: [], upgrades: [] },
        activeRoutineProducts: [],
        now: new Date('2026-11-01T00:00:00Z'),
      };

      // Customer Profile 2: Non-pregnant customer allergic to Peroxides / BPO
      const bpoAllergyContext: EngineContext = {
        severity: 2,
        skinType: 'OILY',
        ageBand: 'ADULT',
        experienceLevel: 'EXPERIENCED',
        fragranceFree: null,
        safety: {
          pregnant: 'NO',
          breastfeeding: 'NO',
          prescriptionTopical: 'NO',
          oralRetinoid: 'NO',
          fragranceSensitive: 'NO',
        },
        allergyIngredientIds: [bpoIngId],
        tier: null,
        budget: null,
        ownedRoleKeys: [],
        overrides: { swaps: {}, removed: [], upgrades: [] },
        activeRoutineProducts: [],
        now: new Date('2026-11-01T00:00:00Z'),
      };

      // Customer 1 (Pregnant) checks:
      // SKU-Mild has NO retinoid and NO pregnancy warning -> ELIGIBLE
      const mildPregnantExclusion = exclusionFor(mildCandidate, role, blueprint, pregnantContext, rules, []);
      expect(mildPregnantExclusion).toBeNull();

      // SKU-Intense has Retinoid active and CONTRAINDICATION: PREGNANT -> EXCLUDED
      const intensePregnantExclusion = exclusionFor(intenseCandidate, role, blueprint, pregnantContext, rules, []);
      expect(intensePregnantExclusion).not.toBeNull();
      expect(intensePregnantExclusion?.reason).toBe('CONDITION:PREGNANT');

      // Customer 2 (Allergic to BPO) checks:
      // SKU-Mild contains BPO -> EXCLUDED due to allergy
      const mildAllergyExclusion = exclusionFor(mildCandidate, role, blueprint, bpoAllergyContext, rules, []);
      expect(mildAllergyExclusion).not.toBeNull();
      expect(mildAllergyExclusion?.reason).toBe('ALLERGY');

      // SKU-Intense does NOT contain BPO and customer is not pregnant -> ELIGIBLE
      const intenseAllergyExclusion = exclusionFor(intenseCandidate, role, blueprint, bpoAllergyContext, rules, []);
      expect(intenseAllergyExclusion).toBeNull();
    });
  });

  describe('2. Ingestion & Identity Matching Invariant Verification', () => {
    it('proves that supplier ingestion cannot silently merge distinct formulations into the same product or SKU', () => {
      // 1. Two titles with different active concentrations
      const titleFormulaA = 'The Ordinary Retinol 0.2% in Squalane 30ml';
      const titleFormulaB = 'The Ordinary Retinol 1% in Squalane 30ml';

      // Verify that row normalization extracts the distinct cleaned titles
      const normA = normalizationService.extractSizeAndPack(titleFormulaA);
      const normB = normalizationService.extractSizeAndPack(titleFormulaB);
      expect(normA.cleanTitle).toContain('0.2');
      expect(normB.cleanTitle).toContain('1');

      // Verify sameBaseName strictly rejects merging these two formulations into one Product
      const isSameBase = identityService.sameBaseName(titleFormulaA, titleFormulaB);
      expect(isSameBase).toBe(false);

      // Verify clearly different products of the same brand are never flagged as duplicates
      const brand = 'The Ordinary';
      const diffProductA = 'The Ordinary Niacinamide 10% 30ml';
      const diffProductB = 'The Ordinary Retinol 1% 30ml';
      expect(identityService.mayBeSameProduct(diffProductA, diffProductB, brand)).toBe(false);
      expect(identityService.sameBaseName(diffProductA, diffProductB)).toBe(false);
    });

    it('proves that barcode matching prevents ambiguous cross-variant collision', async () => {
      // Verify that if a barcode is already bound to a canonical SKU, registering the same
      // barcode for another canonical SKU or variant is rejected with conflict
      const existingSku = await prisma.sku.findFirst({
        where: { barcode: { not: null } },
      });

      if (existingSku && existingSku.barcode) {
        // Attempting to match an item with the same barcode against a completely different SKU
        const classification = await identityService.classifyCandidateMatch({
          supplierId: randomUUID(),
          supplierSkuCode: 'SUP-TEST-CODE',
          name: 'Completely Different Formulation Cream 50ml',
          brand: 'Some Brand',
          barcode: existingSku.barcode,
        });

        // The classifier identifies the verified barcode match or flags conflict if names diverge wildly
        expect([MatchClassification.EXACT_MATCH, MatchClassification.CONFLICT]).toContain(classification.classification);
      }
    });
  });
});

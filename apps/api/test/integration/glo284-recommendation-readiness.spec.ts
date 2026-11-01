import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { CatalogService } from '../../src/modules/catalog/services/catalog.service';
import { MyRoutinesService } from '../../src/modules/care/services/my-routines.service';
import { RoutineEngineService } from '../../src/modules/care/services/routine-engine.service';
import {
  SafetyWarningKind,
  ConcentrationStatus,
  ProductTexture,
  UvFilterType,
  UsageTargetArea,
} from '../../src/modules/catalog/public';
import {
  buildProposal,
  EngineBlueprint,
  EngineContext,
  EngineRule,
  exclusionFor,
} from '../../src/modules/care/engine/routine-engine';
import {
  extractProductFeatures,
  extractCustomerFeatures,
} from '../../src/modules/care/contracts/recommendation-features.contract';
import { createActor, Actor } from '../fixtures/actors';

describe('GLO-284: Recommendation Mathematical Readiness & Formula Isolation (e2e/integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let catalogService: CatalogService;
  let routineEngineService: RoutineEngineService;
  let myRoutinesService: MyRoutinesService;
  let admin: Actor;

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
    routineEngineService = app.get(RoutineEngineService);
    myRoutinesService = app.get(MyRoutinesService);
    admin = await createActor(prisma, 'ADMIN');
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  describe('Priority A: Formula & SKU Identity Isolation', () => {
    it('proves that two SKUs under the same Product do not leak formula-specific safety warnings or usage rules', async () => {
      const brand = await prisma.brand.create({
        data: { name: 'DualSKUBrand ' + randomUUID().slice(0, 8), slug: 'dualskubrand-' + randomUUID().slice(0, 8) },
      });

      // Product represents a treatment serum line
      const product = await catalogService.createProduct({
        name: 'Dual Strength Retinol Serum',
        brandId: brand.id,
        isPublished: true,
      });

      // SKU 1: 0.1% Mild (pregnancy contraindicated)
      const skuMild = await prisma.sku.create({
        data: {
          productId: product.id,
          code: 'DSR-MILD-' + randomUUID().slice(0, 6),
          variantName: '0.1% Mild Formula',
          size: 30,
          sizeUnit: 'ml',
          estimatedDaysOfUse: 60,
          isActive: true,
        },
      });

      // SKU 2: 0.3% Intense (has higher concentration and strict PM-only rule, plus pregnancy contraindication)
      const skuIntense = await prisma.sku.create({
        data: {
          productId: product.id,
          code: 'DSR-INTENSE-' + randomUUID().slice(0, 6),
          variantName: '0.3% Intense Formula',
          size: 30,
          sizeUnit: 'ml',
          estimatedDaysOfUse: 90,
          isActive: true,
        },
      });

      // Warning 1: Scoped ONLY to skuIntense (e.g. intense formula causes barrier escalation)
      const warningIntense = await catalogService.addProductSafetyWarning(product.id, {
        skuId: skuIntense.id,
        kind: SafetyWarningKind.CONTRAINDICATION,
        condition: 'COMPROMISED_BARRIER',
        descriptionEn: 'Intense 0.3% strength contraindicated for compromised skin barrier',
        sourceType: 'CLINICAL_TRIAL',
        reviewedBy: admin.id,
      });
      expect(warningIntense.skuId).toBe(skuIntense.id);

      // Warning 2: Product-wide (applies to all strengths: pregnancy contraindication)
      const warningProductWide = await catalogService.addProductSafetyWarning(product.id, {
        kind: SafetyWarningKind.CONTRAINDICATION,
        condition: 'PREGNANT',
        descriptionEn: 'All retinoids contraindicated in pregnancy',
        sourceType: 'REGULATORY',
        reviewedBy: admin.id,
      });
      expect(warningProductWide.skuId).toBeNull();

      // Usage Rule 1: Scoped to skuIntense (PM only, max 2 uses per week)
      await prisma.productUsageRule.create({
        data: {
          productId: product.id,
          skuId: skuIntense.id,
          routinePeriod: 'PM',
          rinseMode: 'LEAVE_ON',
          frequencyUnit: 'WEEK',
          usesMin: 1,
          usesMax: 2,
          isIntroductory: true,
          phaseOrder: 1,
          evidenceText: 'Apply 0.3% twice weekly at night',
          sourceUrl: 'https://directions.test/intense',
          sourceType: 'PACKAGING',
          reviewedBy: admin.id,
          reviewedAt: new Date(),
        },
      });

      // Usage Rule 2: Scoped to skuMild (PM, up to 5 uses per week)
      await prisma.productUsageRule.create({
        data: {
          productId: product.id,
          skuId: skuMild.id,
          routinePeriod: 'PM',
          rinseMode: 'LEAVE_ON',
          frequencyUnit: 'WEEK',
          usesMin: 2,
          usesMax: 5,
          isIntroductory: false,
          evidenceText: 'Apply 0.1% every other night',
          sourceUrl: 'https://directions.test/mild',
          sourceType: 'PACKAGING',
          reviewedBy: admin.id,
          reviewedAt: new Date(),
        },
      });

      // Load facts via catalog service
      const factsList = await catalogService.getRoutineProductFacts([product.id]);
      const facts = factsList[0];
      expect(facts).toBeDefined();

      // Extract features for Mild SKU
      const mildFeatures = extractProductFeatures(facts, skuMild.id);
      expect(mildFeatures.skuId).toBe(skuMild.id);
      // Mild has product-wide warning (PREGNANT), but NOT the intense barrier warning
      expect(mildFeatures.safetyWarnings.some(w => w.condition === 'PREGNANT')).toBe(true);
      expect(mildFeatures.safetyWarnings.some(w => w.condition === 'COMPROMISED_BARRIER')).toBe(false);
      // Mild usage rules: max 5 uses
      expect(mildFeatures.usageRules).toHaveLength(1);
      expect(mildFeatures.usageRules[0].usesMax).toBe(5);

      // Extract features for Intense SKU
      const intenseFeatures = extractProductFeatures(facts, skuIntense.id);
      expect(intenseFeatures.skuId).toBe(skuIntense.id);
      // Intense has BOTH product-wide (PREGNANT) and SKU-specific (COMPROMISED_BARRIER)
      expect(intenseFeatures.safetyWarnings.some(w => w.condition === 'PREGNANT')).toBe(true);
      expect(intenseFeatures.safetyWarnings.some(w => w.condition === 'COMPROMISED_BARRIER')).toBe(true);
      // Intense usage rules: max 2 uses, introductory
      expect(intenseFeatures.usageRules).toHaveLength(1);
      expect(intenseFeatures.usageRules[0].usesMax).toBe(2);
      expect(intenseFeatures.usageRules[0].isIntroductory).toBe(true);
    });
  });

  describe('Priority C: Mathematical Readiness & Preserved Fact Typing', () => {
    it('verifies that tri-state booleans, numerical units, and undisclosed facts maintain exact typing without silent coercion', async () => {
      const brand = await prisma.brand.create({
        data: { name: 'TypingBrand ' + randomUUID().slice(0, 8), slug: 'typingbrand-' + randomUUID().slice(0, 8) },
      });

      // Product with unverified claims (null != false) and stated photoprotection
      const product = await catalogService.createProduct({
        name: 'SPF 50 Mineral Fluid',
        brandId: brand.id,
        isPublished: true,
        spf: 50,
        broadSpectrum: true,
        uvFilterType: UvFilterType.MINERAL,
        waterResistanceMinutes: 80,
        texture: ProductTexture.LIQUID,
        targetArea: UsageTargetArea.FACE,
        isFragranceFree: null, // UNVERIFIED: must NOT be coerced to false
        isNonComedogenic: true, // VERIFIED: true
        claimsEvidence: {
          nonComedogenicStudy: {
            studyType: 'CLINICAL_COMEDOGENICITY_TEST',
            sampleSize: 45,
            result: 'NON_COMEDOGENIC',
            reviewedBy: admin.id,
          },
        },
      });

      const zincIng = await prisma.ingredient.create({
        data: {
          name: 'Zinc Oxide ' + randomUUID().slice(0, 6),
          slug: 'zinc-oxide-' + randomUUID().slice(0, 6),
          inciName: 'Zinc Oxide',
          primaryFunction: 'UV Filter',
          status: 'APPROVED',
        },
      });

      // Link ingredient with stated concentration
      await prisma.productIngredient.create({
        data: {
          productId: product.id,
          ingredientId: zincIng.id,
          isKeyActive: true,
          concentrationValue: 12.5,
          concentrationUnit: '%',
          concentrationStatus: ConcentrationStatus.STATED,
          concentrationEvidence: {
            sourceUrl: 'https://manufacturer.test/lab-spec',
            reviewedAt: new Date().toISOString(),
          },
        },
      });

      const factsList = await catalogService.getRoutineProductFacts([product.id]);
      const facts = factsList[0];
      const features = extractProductFeatures(facts);

      // Verify mathematical precision
      expect(features.photoprotection.spf).toBe(50);
      expect(features.photoprotection.waterResistanceMinutes).toBe(80);
      expect(features.photoprotection.uvFilterType).toBe('MINERAL');

      // Verify tri-state preservation
      expect(features.claims.isFragranceFree).toBeNull(); // preserved null, NOT false
      expect(features.claims.isNonComedogenic).toBe(true);
      expect(features.claims.claimsEvidence).toBeDefined();

      // Verify concentration numeric typing
      expect(features.actives).toHaveLength(1);
      expect(features.actives[0].concentrationValue).toBe(12.5);
      expect(features.actives[0].concentrationUnit).toBe('%');
      expect(features.actives[0].concentrationVerified).toBe(true);
    });
  });

  describe('Section 9: Final Acceptance Scenario (Two Distinct Customers, Shared Concern)', () => {
    it('extracts correct applicable features, exclusions, and approved choices for two distinct customer profiles with acne', async () => {
      // 1. Setup shared catalog assets for 'acne' concern
      const brand = await prisma.brand.create({
        data: { name: 'AcneDermo ' + randomUUID().slice(0, 8), slug: 'acnedermo-' + randomUUID().slice(0, 8) },
      });

      // Treatment 1: Adapalene 0.1% Gel (Contraindicated in pregnancy)
      const adapaleneIng = await prisma.ingredient.create({
        data: { name: 'Adapalene ' + randomUUID().slice(0, 6), slug: 'adapalene-' + randomUUID().slice(0, 6), familySlug: 'retinoids', inciName: 'Adapalene', primaryFunction: 'Anti-Acne', status: 'APPROVED' },
      });
      const adapaleneProd = await catalogService.createProduct({
        name: 'Adapalene 0.1% Treatment Gel',
        brandId: brand.id,
        isPublished: true,
        concerns: ['acne'],
      });
      const adapaleneSku = await prisma.sku.create({
        data: { productId: adapaleneProd.id, code: 'ADP-01-' + randomUUID().slice(0, 6), variantName: '30g Tube', estimatedDaysOfUse: 60, isActive: true },
      });
      await prisma.productIngredient.create({
        data: { productId: adapaleneProd.id, ingredientId: adapaleneIng.id, isKeyActive: true, concentrationValue: 0.1, concentrationUnit: '%', concentrationEvidence: { sourceUrl: 'https://evidence.test' } },
      });
      await catalogService.addProductSafetyWarning(adapaleneProd.id, {
        kind: SafetyWarningKind.CONTRAINDICATION,
        condition: 'PREGNANT',
        descriptionEn: 'Contraindicated during pregnancy',
        sourceType: 'CLINICAL_GUIDELINE',
        reviewedBy: admin.id,
      });

      // Treatment 2: Azelaic Acid 15% Gel (Pregnancy safe)
      const azelaicIng = await prisma.ingredient.create({
        data: { name: 'Azelaic Acid ' + randomUUID().slice(0, 6), slug: 'azelaic-acid-' + randomUUID().slice(0, 6), familySlug: 'azelaic-acid', inciName: 'Azelaic Acid', primaryFunction: 'Anti-Acne', status: 'APPROVED' },
      });
      const azelaicProd = await catalogService.createProduct({
        name: 'Azelaic Acid 15% Emulsion',
        brandId: brand.id,
        isPublished: true,
        concerns: ['acne'],
      });
      const azelaicSku = await prisma.sku.create({
        data: { productId: azelaicProd.id, code: 'AZA-15-' + randomUUID().slice(0, 6), variantName: '50ml Pump', estimatedDaysOfUse: 45, isActive: true },
      });
      await prisma.productIngredient.create({
        data: { productId: azelaicProd.id, ingredientId: azelaicIng.id, isKeyActive: true, concentrationValue: 15, concentrationUnit: '%', concentrationEvidence: { sourceUrl: 'https://evidence.test' } },
      });

      // Cleanser 1: Gentle Fragrance-Free Cleanser
      const cleanProd = await catalogService.createProduct({
        name: 'Pure Gentle Cleanser',
        brandId: brand.id,
        isPublished: true,
        isFragranceFree: true,
      });
      const cleanSku = await prisma.sku.create({
        data: { productId: cleanProd.id, code: 'PGC-200-' + randomUUID().slice(0, 6), variantName: '200ml Bottle', estimatedDaysOfUse: 60, isActive: true },
      });

      // Cleanser 2: Scented Tea Tree Cleanser (contains parfum)
      const scentedIng = await prisma.ingredient.create({
        data: { name: 'Parfum ' + randomUUID().slice(0, 6), slug: 'fragrance-' + randomUUID().slice(0, 6), inciName: 'Parfum', primaryFunction: 'Fragrance', status: 'APPROVED' },
      });
      const scentedProd = await catalogService.createProduct({
        name: 'Aromatic Tea Tree Cleanser',
        brandId: brand.id,
        isPublished: true,
        isFragranceFree: false,
      });
      const scentedSku = await prisma.sku.create({
        data: { productId: scentedProd.id, code: 'TTC-200-' + randomUUID().slice(0, 6), variantName: '200ml Bottle', estimatedDaysOfUse: 60, isActive: true },
      });
      await prisma.productIngredient.create({
        data: { productId: scentedProd.id, ingredientId: scentedIng.id, isKeyActive: false },
      });

      // Blueprint for acne
      const bp: EngineBlueprint = {
        id: 'bp-acne-acceptance',
        key: 'acne-mild',
        version: 1,
        concernSlug: 'acne',
        careArea: 'skin',
        kind: 'TREATMENT',
        severityMin: 1,
        severityMax: 2,
        titleAr: 'روتين حب الشباب',
        goalAr: null,
        timelineAr: null,
        safetyNotesAr: [],
        roles: [
          { roleKey: 'cleanser', sortOrder: 1, titleAr: 'غسول', isEssential: true, startWeek: 1, requiredActives: [], concentrationRanges: [], usageNoteAr: null },
          { roleKey: 'treatment', sortOrder: 2, titleAr: 'علاج', isEssential: true, startWeek: 1, requiredActives: ['retinoids', 'azelaic-acid'], concentrationRanges: [], usageNoteAr: null },
        ],
      };

      const rules: EngineRule[] = [
        { key: 'retinoid-preg', kind: 'EXCLUDE_CONDITION', subjectType: 'FAMILY', subject: 'retinoids', otherType: null, other: null, condition: 'PREGNANT', noteAr: null },
      ];

      // Retrieve all facts
      const factsList = await catalogService.getRoutineProductFacts([
        adapaleneProd.id,
        azelaicProd.id,
        cleanProd.id,
        scentedProd.id,
      ]);
      const factsMap = new Map(factsList.map(f => [f.productId, f]));

      // -----------------------------------------------------------------------
      // Customer A: Pregnant, sensitive to fragrance, beginner
      // -----------------------------------------------------------------------
      const customerA = await prisma.customer.create({
        data: { email: 'customer-a-' + randomUUID().slice(0, 6) + '@test.com', name: 'Customer A' },
      });
      const cpA = await prisma.customerCareProfile.create({
        data: { customerId: customerA.id, skinType: 'sensitive' },
      });
      const ctxA: EngineContext = {
        severity: 2,
        skinType: 'sensitive',
        ageBand: 'ADULT',
        experienceLevel: 'BEGINNER',
        fragranceFree: true, // prefers fragrance-free
        safety: {
          pregnant: 'YES', // Pregnant!
          breastfeeding: 'NO',
          prescriptionTopical: 'NO',
          oralRetinoid: 'NO',
          fragranceSensitive: 'YES',
        },
        allergyIngredientIds: [],
        tier: 'SMART',
        budget: 300,
        ownedRoleKeys: [],
        overrides: { swaps: {}, removed: [], upgrades: [] },
        activeRoutineProducts: [],
        now: new Date(),
      };

      const custFeaturesA = extractCustomerFeatures(customerA.id, cpA.id, 'acne', ctxA);
      expect(custFeaturesA.constraints.hardSafety.pregnant).toBe('YES');
      expect(custFeaturesA.constraints.fragranceFreePreference).toBe(true);

      // Evaluate candidate exclusions for Customer A
      const adapaleneCandA = {
        productId: adapaleneProd.id, skuId: adapaleneSku.id, name: adapaleneProd.name, brandName: 'AcneDermo', imageUrl: null,
        roleKey: 'treatment', tier: 'SMART' as const, concernSlugs: ['acne'], suitableSkinTypes: [], price: 150, currency: 'EGP',
        sellable: true, actives: factsMap.get(adapaleneProd.id)!.actives,
        ingredientIds: factsMap.get(adapaleneProd.id)!.ingredientIds,
        ingredientSlugs: factsMap.get(adapaleneProd.id)!.ingredientSlugs,
        ingredientFamilies: factsMap.get(adapaleneProd.id)!.ingredientFamilies,
        usageRuleCount: 1,
        factsReviewedAt: [new Date().toISOString()],
        safetyWarnings: factsMap.get(adapaleneProd.id)!.safetyWarnings?.map(w => ({ kind: w.kind, condition: w.condition, skuId: w.skuId })),
      };
      const azelaicCandA = {
        ...adapaleneCandA,
        productId: azelaicProd.id, skuId: azelaicSku.id, name: azelaicProd.name, price: 180,
        actives: factsMap.get(azelaicProd.id)!.actives,
        ingredientIds: factsMap.get(azelaicProd.id)!.ingredientIds,
        ingredientSlugs: factsMap.get(azelaicProd.id)!.ingredientSlugs,
        ingredientFamilies: factsMap.get(azelaicProd.id)!.ingredientFamilies,
        safetyWarnings: factsMap.get(azelaicProd.id)!.safetyWarnings?.map(w => ({ kind: w.kind, condition: w.condition, skuId: w.skuId })),
      };
      const cleanCandA = {
        ...adapaleneCandA,
        productId: cleanProd.id, skuId: cleanSku.id, name: cleanProd.name, roleKey: 'cleanser', price: 90,
        actives: [], ingredientIds: [], ingredientSlugs: [], ingredientFamilies: [], safetyWarnings: [],
      };
      const scentedCandA = {
        ...adapaleneCandA,
        productId: scentedProd.id, skuId: scentedSku.id, name: scentedProd.name, roleKey: 'cleanser', price: 70,
        actives: [], ingredientIds: [scentedIng.id], ingredientSlugs: ['fragrance'], ingredientFamilies: [], safetyWarnings: [],
      };

      // Customer A: Adapalene is EXCLUDED due to PREGNANT contraindication
      const adapExclA = exclusionFor(adapaleneCandA, bp.roles[1], bp, ctxA, rules, []);
      expect(adapExclA?.reason).toBe('CONDITION:PREGNANT');

      // Customer A: Azelaic is QUALIFIED (no contraindication)
      const azaExclA = exclusionFor(azelaicCandA, bp.roles[1], bp, ctxA, rules, []);
      expect(azaExclA).toBeNull();

      // Customer A: Scented cleanser is EXCLUDED due to FRAGRANCE
      const scentExclA = exclusionFor(scentedCandA, bp.roles[0], bp, ctxA, rules, []);
      expect(scentExclA?.reason).toBe('FRAGRANCE');

      // Customer A: Clean cleanser is QUALIFIED
      const cleanExclA = exclusionFor(cleanCandA, bp.roles[0], bp, ctxA, rules, []);
      expect(cleanExclA).toBeNull();

      // -----------------------------------------------------------------------
      // Customer B: Adult non-pregnant, experienced, oily resilient skin
      // -----------------------------------------------------------------------
      const customerB = await prisma.customer.create({
        data: { email: 'customer-b-' + randomUUID().slice(0, 6) + '@test.com', name: 'Customer B' },
      });
      const cpB = await prisma.customerCareProfile.create({
        data: { customerId: customerB.id, skinType: 'oily' },
      });
      const ctxB: EngineContext = {
        severity: 2,
        skinType: 'oily',
        ageBand: 'ADULT',
        experienceLevel: 'EXPERIENCED',
        fragranceFree: false, // does not require fragrance-free
        safety: {
          pregnant: 'NO', // NOT pregnant
          breastfeeding: 'NO',
          prescriptionTopical: 'NO',
          oralRetinoid: 'NO',
          fragranceSensitive: 'NO',
        },
        allergyIngredientIds: [],
        tier: 'COMPLETE',
        budget: 600,
        ownedRoleKeys: [],
        overrides: { swaps: {}, removed: [], upgrades: [] },
        activeRoutineProducts: [],
        now: new Date(),
      };

      const custFeaturesB = extractCustomerFeatures(customerB.id, cpB.id, 'acne', ctxB);
      expect(custFeaturesB.constraints.hardSafety.pregnant).toBe('NO');
      expect(custFeaturesB.constraints.fragranceFreePreference).toBe(false);

      // Customer B: Adapalene is QUALIFIED (pregnant is NO)
      const adapExclB = exclusionFor(adapaleneCandA, bp.roles[1], bp, ctxB, rules, []);
      expect(adapExclB).toBeNull();

      // Customer B: Azelaic is QUALIFIED
      const azaExclB = exclusionFor(azelaicCandA, bp.roles[1], bp, ctxB, rules, []);
      expect(azaExclB).toBeNull();

      // Customer B: Scented cleanser is QUALIFIED (no fragrance restriction)
      const scentExclB = exclusionFor(scentedCandA, bp.roles[0], bp, ctxB, rules, []);
      expect(scentExclB).toBeNull();

      // Build proposal for Customer A vs Customer B
      const proposalA = buildProposal(bp, [adapaleneCandA, azelaicCandA, cleanCandA, scentedCandA], rules, ctxA);
      const treatmentItemA = proposalA.items.find(i => i.roleKey === 'treatment');
      const cleanserItemA = proposalA.items.find(i => i.roleKey === 'cleanser');
      expect(treatmentItemA?.product?.productId).toBe(azelaicProd.id); // Safely chose Azelaic
      expect(cleanserItemA?.product?.productId).toBe(cleanProd.id);   // Safely chose Fragrance-Free cleanser

      const proposalB = buildProposal(bp, [adapaleneCandA, azelaicCandA, cleanCandA, scentedCandA], rules, ctxB);
      const treatmentItemB = proposalB.items.find(i => i.roleKey === 'treatment');
      const cleanserItemB = proposalB.items.find(i => i.roleKey === 'cleanser');
      expect(treatmentItemB?.product?.productId).toBe(adapaleneProd.id); // Chose Adapalene (cheaper 150 vs 180)
      expect(cleanserItemB?.product?.productId).toBe(scentedProd.id);   // Chose cheaper cleanser 70 vs 90
    });
  });
});

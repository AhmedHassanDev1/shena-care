import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { IngredientService } from '../../src/modules/catalog/public';
import { IngredientOntologyService } from '../../src/modules/ingestion/services/ingredient-ontology.service';
import { createActor, Actor } from '../fixtures/actors';
import { VisualStatus } from '../../src/modules/ingestion/contracts/ingredient-ontology.contract';

describe('SG-07: Ingredient Ontology, Evidence-Based Benefits & Claim Boundaries (e2e)', () => {
  jest.setTimeout(60000);

  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Actor;
  let supplierUser: Actor;
  let ingredientService: IngredientService;
  let ontologyService: IngredientOntologyService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();

    prisma = app.get(PrismaService);
    ingredientService = app.get(IngredientService);
    ontologyService = app.get(IngredientOntologyService);
    admin = await createActor(prisma, 'ADMIN');
    supplierUser = await createActor(prisma, 'SUPPLIER');

    // Seed standard dermatological ontology
    await ingredientService.seedStandardOntology();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('1. Acceptance 1: Cross-Product Reuse & Deduplication', () => {
    it('two products referencing Niacinamide resolve to the EXACT same canonical entity with aliases tracked', async () => {
      // Product 1 arrives with English "Niacinamide"
      const res1 = await ontologyService.resolveIngredient('Niacinamide');
      expect(res1.ingredient).toBeDefined();
      expect(res1.ingredient.name).toBe('Niacinamide');
      expect(res1.ingredient.family).toBe('Niacinamide');
      const canonicalId = res1.ingredient.id;

      // Product 2 arrives with Arabic alias "نياسيناميد"
      const res2 = await ontologyService.resolveIngredient('نياسيناميد');
      expect(res2.ingredient).toBeDefined();
      expect(res2.ingredient.id).toBe(canonicalId);
      expect(res2.reused).toBe(true);

      // Product 3 arrives with alternate spelling "Vitamin B3"
      const res3 = await ontologyService.resolveIngredient('Vitamin B3');
      expect(res3.ingredient.id).toBe(canonicalId);
      expect(res3.reused).toBe(true);

      // Verify DB entity has aliases recorded without duplicate rows
      const dbRecords = await prisma.ingredient.findMany({
        where: { slug: 'niacinamide' },
      });
      expect(dbRecords.length).toBe(1);
      expect(dbRecords[0].aliases).toContain('نياسيناميد');
      expect(dbRecords[0].aliases).toContain('Vitamin B3');
    });
  });

  describe('2. Acceptance 2: Chemical Derivatives vs Families (No Conflation)', () => {
    it('differentiates distinct chemical forms under Vitamin C family and never conflates them', async () => {
      const pureAscorbic = await ontologyService.resolveChemicalDerivative('Ascorbic Acid', 'vitamin-c');
      const sap = await ontologyService.resolveChemicalDerivative('Sodium Ascorbyl Phosphate', 'vitamin-c');
      const glucoside = await ontologyService.resolveChemicalDerivative('Ascorbyl Glucoside', 'vitamin-c');
      const ethyl = await ontologyService.resolveChemicalDerivative('3-O-Ethyl Ascorbic Acid', 'vitamin-c');

      // 1. All share the same family "Vitamin C"
      expect(pureAscorbic.familyMatches).toBe(true);
      expect(sap.familyMatches).toBe(true);
      expect(glucoside.familyMatches).toBe(true);
      expect(ethyl.familyMatches).toBe(true);

      // 2. Each is a distinct record with distinct ID and chemical form
      expect(pureAscorbic.derivative.id).not.toBe(sap.derivative.id);
      expect(sap.derivative.id).not.toBe(glucoside.derivative.id);
      expect(glucoside.derivative.id).not.toBe(ethyl.derivative.id);

      expect(pureAscorbic.derivative.chemicalForm).toContain('Pure');
      expect(sap.derivative.chemicalForm).toContain('Salt');
      expect(glucoside.derivative.chemicalForm).toContain('Glucose');
      expect(ethyl.derivative.chemicalForm).toContain('Ether');

      // 3. None are conflated with the generic family name
      expect(pureAscorbic.conflatedWithFamily).toBe(false);
      expect(sap.conflatedWithFamily).toBe(false);
      expect(glucoside.conflatedWithFamily).toBe(false);

      // 4. Evidence-based benefits differ: SAP specifically targets acne/C. acnes, while pure ascorbic targets collagen
      const sapBenefits = sap.derivative.benefits as any[];
      const ascorbicBenefits = pureAscorbic.derivative.benefits as any[];

      expect(sapBenefits.some((b: any) => b.concern === 'acne')).toBe(true);
      expect(ascorbicBenefits.some((b: any) => b.concern === 'anti_aging')).toBe(true);
    });

    it('differentiates Retinol, Retinal, and Hydroxypinacolone Retinoate under Retinoids family', async () => {
      const retinol = await ontologyService.resolveChemicalDerivative('Retinol', 'retinoids');
      const retinal = await ontologyService.resolveChemicalDerivative('Retinal', 'retinoids');
      const hpr = await ontologyService.resolveChemicalDerivative('Hydroxypinacolone Retinoate', 'retinoids');

      expect(retinol.derivative.id).not.toBe(retinal.derivative.id);
      expect(retinal.derivative.id).not.toBe(hpr.derivative.id);

      expect(retinol.derivative.chemicalForm).toContain('2-Step');
      expect(retinal.derivative.chemicalForm).toContain('1-Step');
      expect(hpr.derivative.chemicalForm).toContain('Direct');
    });
  });

  describe('3. Acceptance 3: Raw INCI Parsing & Active vs Excipient Classification', () => {
    it('correctly separates cosmetic excipients and vehicles from active cosmetic ingredients', () => {
      const rawInciList =
        'Aqua/Water/Eau, Glycerin, Niacinamide 10%, Cetearyl Alcohol, Salicylic Acid 2%, Phenoxyethanol, Disodium EDTA, Sodium Hydroxide';

      const parsed = ontologyService.parseInciList(rawInciList);
      expect(parsed.length).toBe(8);

      // Vehicles / Excipients
      const aqua = parsed.find((p) => p.cleanedInci === 'AQUA');
      expect(aqua?.isExcipient).toBe(true);
      expect(aqua?.isActive).toBe(false);

      const glycerin = parsed.find((p) => p.cleanedInci === 'GLYCERIN');
      expect(glycerin?.isExcipient).toBe(true);
      expect(glycerin?.isActive).toBe(false);

      const phenoxy = parsed.find((p) => p.cleanedInci === 'PHENOXYETHANOL');
      expect(phenoxy?.isExcipient).toBe(true);
      expect(phenoxy?.isActive).toBe(false);

      // Actives
      const niacinamide = parsed.find((p) => p.cleanedInci.includes('NIACINAMIDE'));
      expect(niacinamide?.isActive).toBe(true);
      expect(niacinamide?.concentration).toBe('10%');

      const salicylic = parsed.find((p) => p.cleanedInci.includes('SALICYLIC'));
      expect(salicylic?.isActive).toBe(true);
      expect(salicylic?.concentration).toBe('2%');
    });
  });

  describe('4. Acceptance 4: Claim & Efficacy Boundary Enforcement', () => {
    it('allows valid ingredient mechanism claims when the active is present', () => {
      const res = ontologyService.validateClaim({
        claimText: 'Formulated with Niacinamide to help support the skin moisture barrier and refine pores',
        productIngredients: [{ ingredientName: 'Niacinamide', concentration: '5%' }],
      });

      expect(res.isValid).toBe(true);
      expect(res.allowed).toBe(true);
      expect(res.claimType).toBe('INGREDIENT_MECHANISM');
      expect(res.substantiatedActives).toContain('Niacinamide');
    });

    it('rejects ingredient claims when the cited active is absent from the formulation', () => {
      const res = ontologyService.validateClaim({
        claimText: 'Powered by Retinol for rapid cell renewal and fine line reduction',
        productIngredients: [{ ingredientName: 'Hyaluronic Acid' }, { ingredientName: 'Glycerin' }],
      });

      expect(res.isValid).toBe(false);
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain('not found in product formulation');
    });

    it('blocks finished-product therapeutic speed guarantees without clinical trial evidence', () => {
      const res = ontologyService.validateClaim({
        claimText: 'Clinically proven to erase all wrinkles within 7 days and guaranteed 100% cure for acne',
        productIngredients: [{ ingredientName: 'Retinol', concentration: '0.3%' }],
        hasFinishedProductClinicalEvidence: false,
      });

      expect(res.isValid).toBe(false);
      expect(res.allowed).toBe(false);
      expect(res.requiresClinicalTrialEvidence).toBe(true);
      expect(res.reason).toContain('Finished-product therapeutic efficacy or speed-of-results claims require verified finished-product clinical trial evidence');
    });

    it('does NOT blanket-ban Niacinamide + Vitamin C together', () => {
      const res = ontologyService.validateClaim({
        claimText: 'Contains Niacinamide and Vitamin C for comprehensive antioxidant defense and brightening',
        productIngredients: [
          { ingredientName: 'Niacinamide', concentration: '2%' },
          { ingredientName: 'Ascorbyl Glucoside', concentration: '2%' },
        ],
      });

      expect(res.isValid).toBe(true);
      expect(res.allowed).toBe(true);
      expect(res.substantiatedActives).toContain('Niacinamide');
      expect(res.substantiatedActives).toContain('Vitamin C');
    });
  });

  describe('5. Acceptance 5: Visual Status & $0 Asset Policy', () => {
    it('enforces visualStatus = NOT_GENERATED and does not trigger paid generative image jobs', async () => {
      const ing = await ingredientService.getIngredientBySlug('niacinamide');
      expect(ing).toBeDefined();
      expect(ing!.visualStatus).toBe(VisualStatus.NOT_GENERATED);
      expect(ing!.visualUrl).toBeNull();
    });
  });

  describe('6. Acceptance 6: Ingestion Candidate & Product Linkage Integration', () => {
    it('enriches candidate with structured actives, excipients, cautions, and preserves unknown facts', async () => {
      // 1. Create a dummy supplier and job
      const supplier = await prisma.supplier.create({
        data: {
          name: `SG07 Supplier ${Date.now()}`,
          slug: `sg07-supplier-${Date.now()}`,
        },
      });

      const job = await prisma.ingestionJob.create({
        data: {
          supplierId: supplier.id,
          status: 'pending',
          sourceKey: 'test/sg07.csv',
        },
      });

      const candidate = await prisma.ingestionItem.create({
        data: {
          jobId: job.id,
          name: 'SG07 Test Serum',
          brand: 'SG07 Brand',
          barcode: `628${Date.now()}`,
          supplierSkuCode: `SKU_${Date.now()}`,
          price: 150.0,
          currency: 'SAR',
          enrichment: {
            research: {
              extractedFacts: {
                ingredients: [
                  'Aqua',
                  'Niacinamide', // without explicit concentration -> must retain unknown
                  'Salicylic Acid 2%', // with explicit concentration -> extracted
                  'Phenoxyethanol',
                ],
              },
            },
          },
        },
      });

      // 2. Enrich candidate ingredients
      const enrichment = await ontologyService.enrichCandidateIngredients(candidate.id);

      expect(enrichment.actives.length).toBe(2);
      expect(enrichment.excipients.length).toBe(2);

      // Verify concentration extraction vs unknown fact retention
      const niacinamideActive = enrichment.actives.find((a) => a.name === 'Niacinamide');
      expect(niacinamideActive).toBeDefined();
      expect(niacinamideActive!.concentration).toBeUndefined(); // retains unknown

      const salicylicActive = enrichment.actives.find((a) => a.name === 'Salicylic Acid');
      expect(salicylicActive).toBeDefined();
      expect(salicylicActive!.concentration).toBe('2%');

      // Verify unknownFacts array records missing concentration without assuming
      expect(enrichment.unknownFacts.some((f) => f.includes('Concentration of Niacinamide is unknown; retained as null (never assumed)'))).toBe(true);

      // Verify benefits mapped by concern
      expect(enrichment.benefitsByConcern['barrier_repair']).toBeDefined();
      expect(enrichment.benefitsByConcern['acne']).toBeDefined();

      // Verify cautions aggregated
      expect(enrichment.cautions.length).toBeGreaterThan(0);

      // 3. Link ingredients to a canonical Catalog Product
      const brand = await prisma.brand.create({
        data: {
          name: `SG07 Brand ${Date.now()}`,
          slug: `sg07-brand-${Date.now()}`,
        },
      });

      const product = await prisma.product.create({
        data: {
          name: 'SG07 Test Serum',
          slug: `sg07-test-serum-${Date.now()}`,
          brandId: brand.id,
        },
      });

      const linked = await ontologyService.linkProductIngredients(product.id, [
        {
          ingredientId: niacinamideActive!.id,
          isKeyActive: true,
          sortOrder: 0,
        },
        {
          ingredientId: salicylicActive!.id,
          isKeyActive: true,
          concentration: '2%',
          sortOrder: 1,
        },
      ]);

      expect(linked.length).toBe(2);
      expect(linked[0].ingredient.name).toBe('Niacinamide');
      expect(linked[0].concentration).toBeNull(); // unknown retained
      expect(linked[1].ingredient.name).toBe('Salicylic Acid');
      expect(linked[1].concentration).toBe('2%');
    });
  });

  describe('7. Acceptance 7: Authorized API Endpoints', () => {
    it('exposes GET /ingestion/ingredients and POST /ingestion/ingredients/validate-claim with RBAC', async () => {
      // 1. GET /ingestion/ingredients
      const listRes = await request(app.getHttpServer())
        .get('/ingestion/ingredients?isActive=true')
        .set(admin.auth)
        .expect(200);

      expect(Array.isArray(listRes.body)).toBe(true);
      expect(listRes.body.length).toBeGreaterThan(5);

      // 2. GET /ingestion/ingredients/families/:familySlug
      const familyRes = await request(app.getHttpServer())
        .get('/ingestion/ingredients/families/vitamin-c')
        .set(admin.auth)
        .expect(200);

      expect(Array.isArray(familyRes.body)).toBe(true);
      expect(familyRes.body.length).toBeGreaterThanOrEqual(4);

      // 3. POST /ingestion/ingredients/validate-claim
      const claimRes = await request(app.getHttpServer())
        .post('/ingestion/ingredients/validate-claim')
        .set(admin.auth)
        .send({
          claimText: 'Formulated with Salicylic Acid to decongest pores',
          productIngredients: [{ ingredientName: 'Salicylic Acid', concentration: '2%' }],
        })
        .expect(201);

      expect(claimRes.body.isValid).toBe(true);
      expect(claimRes.body.allowed).toBe(true);
    });
  });
});

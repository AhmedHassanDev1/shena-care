import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { RoutinePlacementService } from '../../src/modules/ingestion/services/routine-placement.service';
import {
  ProductResearchService,
  SourceType,
  VerificationStatus,
} from '../../src/modules/ingestion/services/product-research.service';
import {
  ApplicationSite,
  RinseType,
  RoutineCategory,
  RoutineStepType,
  RoutineTiming,
  UsageFrequency,
} from '../../src/modules/ingestion/contracts/routine-placement.contract';
import { createActor, Actor } from '../fixtures/actors';

describe('SG-08: Research Evidence, Canonical Facts & Routine Placement Intelligence (e2e)', () => {
  jest.setTimeout(60000);

  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Actor;
  let supplierUser: Actor;
  let routineService: RoutinePlacementService;
  let researchService: ProductResearchService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();

    prisma = app.get(PrismaService);
    routineService = app.get(RoutinePlacementService);
    researchService = app.get(ProductResearchService);
    admin = await createActor(prisma, 'ADMIN');
    supplierUser = await createActor(prisma, 'SUPPLIER');
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('1. Acceptance 1: Formulations and Usages Yield Distinct Truthful Routines', () => {
    it('places Foaming Cleanser at Step 1 Rinse-off (AM_PM)', () => {
      const res = routineService.determineRoutinePlacement({
        productName: 'CeraVe Foaming Facial Cleanser',
        brand: 'CeraVe',
        category: 'Cleanser',
        usage: ['Wet skin with lukewarm water. Massage cleanser into skin in a gentle, circular motion. Rinse.'],
      });

      expect(res.category).toBe(RoutineCategory.SKIN_CARE);
      expect(res.stepOrder).toBe(1);
      expect(res.stepType).toBe(RoutineStepType.CLEANSER);
      expect(res.rinseType).toBe(RinseType.RINSE_OFF);
      expect(res.timing).toBe(RoutineTiming.AM_PM);
      expect(res.frequency).toBe(UsageFrequency.TWICE_DAILY);
      expect(res.isPhotosensitizing).toBe(false);
      expect(res.requiresDaytimeSunscreen).toBe(false);
    });

    it('places Retinol Serum at Step 3 Leave-on, strictly PM_ONLY with daytime SPF requirement', () => {
      const res = routineService.determineRoutinePlacement({
        productName: 'The Ordinary Retinol 0.5% in Squalane',
        brand: 'The Ordinary',
        category: 'Serum',
        ingredients: ['Squalane', 'Caprylic/Capric Triglyceride', 'Retinol', 'Solanum Lycopersicum Extract'],
        usage: ['Apply a small amount to the face in the PM as part of your skincare regimen.'],
      });

      expect(res.category).toBe(RoutineCategory.SKIN_CARE);
      expect(res.stepOrder).toBe(3);
      expect(res.stepType).toBe(RoutineStepType.TREATMENT_SERUM);
      expect(res.rinseType).toBe(RinseType.LEAVE_ON);
      expect(res.timing).toBe(RoutineTiming.PM_ONLY);
      expect(res.isPhotosensitizing).toBe(true);
      expect(res.requiresDaytimeSunscreen).toBe(true);
      expect(res.warnings.some((w) => w.includes('sunscreen'))).toBe(true);
    });

    it('places High-Strength AHA/BHA Peeling Solution at Step 2 Rinse-off (PM_ONLY, Weekly 1-2 times, 10 min max)', () => {
      const res = routineService.determineRoutinePlacement({
        productName: 'AHA 30% + BHA 2% Peeling Solution',
        brand: 'The Ordinary',
        category: 'Exfoliant',
        ingredients: ['Glycolic Acid', 'Aqua', 'Aloe Barbadensis Leaf Water', 'Salicylic Acid'],
        usage: ['Apply evenly across clean, dry face. Leave on for no more than 10 minutes. Rinse thoroughly with lukewarm water.'],
      });

      expect(res.category).toBe(RoutineCategory.SKIN_CARE);
      expect(res.stepOrder).toBe(2);
      expect(res.stepType).toBe(RoutineStepType.EXFOLIANT);
      expect(res.rinseType).toBe(RinseType.RINSE_OFF);
      expect(res.timing).toBe(RoutineTiming.PM_ONLY);
      expect(res.frequency).toBe(UsageFrequency.WEEKLY_1_2_TIMES);
      expect(res.isPhotosensitizing).toBe(true);
      expect(res.requiresDaytimeSunscreen).toBe(true);
      expect(res.warnings.some((w) => w.includes('10 minutes'))).toBe(true);
    });

    it('places Sunscreen at Step 6 Leave-on, strictly AM_ONLY', () => {
      const res = routineService.determineRoutinePlacement({
        productName: 'La Roche-Posay Anthelios UVMune 400 Invisible Fluid SPF50+',
        brand: 'La Roche-Posay',
        category: 'Sunscreen',
        usage: ['Apply as the last step of your morning skincare routine. Reapply every 2 hours.'],
      });

      expect(res.category).toBe(RoutineCategory.SKIN_CARE);
      expect(res.stepOrder).toBe(6);
      expect(res.stepType).toBe(RoutineStepType.SUNSCREEN);
      expect(res.timing).toBe(RoutineTiming.AM_ONLY);
      expect(res.rinseType).toBe(RinseType.LEAVE_ON);
      expect(res.frequency).toBe(UsageFrequency.DAILY);
      expect(res.requiresDaytimeSunscreen).toBe(false); // It is the sunscreen!
    });

    it('places Haircare products into distinct sequential haircare steps (Shampoo -> Conditioner -> Hair Mask)', () => {
      const shampooRes = routineService.determineRoutinePlacement({
        productName: 'Olaplex No. 4 Bond Maintenance Shampoo',
        brand: 'Olaplex',
        usage: ['Dispense, massage into wet hair and scalp, lather and rinse.'],
      });
      expect(shampooRes.category).toBe(RoutineCategory.HAIR_CARE);
      expect(shampooRes.stepOrder).toBe(1);
      expect(shampooRes.stepType).toBe(RoutineStepType.HAIR_SHAMPOO);
      expect(shampooRes.siteOfUse).toBe(ApplicationSite.SCALP);
      expect(shampooRes.rinseType).toBe(RinseType.RINSE_OFF);

      const condRes = routineService.determineRoutinePlacement({
        productName: 'Olaplex No. 5 Bond Maintenance Conditioner',
        brand: 'Olaplex',
        usage: ['Apply to mid-lengths and ends, leave on for 3 minutes, rinse.'],
      });
      expect(condRes.stepOrder).toBe(2);
      expect(condRes.stepType).toBe(RoutineStepType.HAIR_CONDITIONER);
      expect(condRes.siteOfUse).toBe(ApplicationSite.HAIR_LENGTHS);

      const maskRes = routineService.determineRoutinePlacement({
        productName: 'Olaplex No. 8 Bond Intense Moisture Mask',
        brand: 'Olaplex',
        usage: ['Apply to clean, damp hair weekly, leave on for 10 minutes and rinse thoroughly.'],
      });
      expect(maskRes.stepOrder).toBe(3);
      expect(maskRes.stepType).toBe(RoutineStepType.HAIR_MASK);
      expect(maskRes.frequency).toBe(UsageFrequency.WEEKLY_1_2_TIMES);
    });
  });

  describe('2. Acceptance 2: Ambiguous Ingredients / Frequency Held for Review', () => {
    it('holds frequency as UNCLEAR_HELD and frequencyStatus = HELD_FOR_REVIEW when directions or sources are conflicting or ambiguous', () => {
      const res = routineService.determineRoutinePlacement({
        productName: 'Professional Resurfacing Peel 35%',
        brand: 'ClinicalDerm',
        category: 'Exfoliant',
        usage: ['Use as directed by physician or skincare specialist.'],
        conflictingDistributorUsage: 'Apply daily in the morning', // Conflicting dangerous distributor statement!
      });

      expect(res.frequency).toBe(UsageFrequency.UNCLEAR_HELD);
      expect(res.frequencyStatus).toBe('HELD_FOR_REVIEW');
      expect(res.reasoning).toContain('HELD_FOR_REVIEW');
      expect(res.evidenceSummary.contradictionsFound).toBe(true);
    });
  });

  describe('3. Acceptance 3: Proven Official Facts Outrank Distributor with Contradiction Tracking', () => {
    it('resolves multi-source contradictions: official manufacturer specification outranks distributor declaration', () => {
      const officialFacts = {
        normalizedTitle: 'CeraVe Hydrating Cleanser 473ml',
        brand: 'CeraVe',
        size: { value: 473, unit: 'ml' },
        usage: ['Wet skin with lukewarm water. Massage cleanser and rinse.'],
      };

      const distributorFacts = {
        normalizedTitle: 'CeraVe Hydrating Cleanser 236ml',
        brand: 'CeraVe',
        size: { value: 236, unit: 'ml' }, // Conflicting size on distributor page
        usage: ['Apply generously and wash off.'],
      };

      const officialUrl = 'https://www.cerave.com/skincare/cleansers/hydrating-facial-cleanser';
      const distributorUrl = 'https://www.sephora.com/product/cerave-hydrating-cleanser';

      const result = researchService.resolveMultiSourceContradictions(
        officialFacts,
        distributorFacts,
        officialUrl,
        distributorUrl,
      );

      // 1. Reconciled facts adopt the official manufacturer size
      expect(result.reconciledFacts.size).toEqual({ value: 473, unit: 'ml' });

      // 2. Contradiction is recorded
      expect(result.contradictions.length).toBe(1);
      const sizeContradiction = result.contradictions[0];
      expect(sizeContradiction.fieldName).toBe('size');
      expect(sizeContradiction.winningSource).toBe(SourceType.OFFICIAL_MANUFACTURER);
      expect(sizeContradiction.officialValue).toEqual({ value: 473, unit: 'ml' });
      expect(sizeContradiction.distributorValue).toEqual({ value: 236, unit: 'ml' });
      expect(sizeContradiction.reason).toContain('Official manufacturer specification');

      // 3. Evidence items record SUPPORTED for official and CONFLICT for distributor
      const officialEv = result.evidences.find((e) => e.sourceType === SourceType.OFFICIAL_MANUFACTURER);
      const distributorEv = result.evidences.find((e) => e.sourceType === SourceType.TRUSTED_DISTRIBUTOR);

      expect(officialEv).toBeDefined();
      expect(officialEv!.verificationStatus).toBe(VerificationStatus.SUPPORTED);
      expect(officialEv!.confidence).toBe(0.95);

      expect(distributorEv).toBeDefined();
      expect(distributorEv!.verificationStatus).toBe(VerificationStatus.CONFLICT);
      expect(distributorEv!.confidence).toBe(0.60);
    });
  });

  describe('4. Acceptance 4: Outage Retry & Graceful Fallback', () => {
    it('gracefully degrades during research provider outage without throwing fatal error or blocking offer updates', async () => {
      const origExa = process.env.EXA_API_KEY;
      const origFirecrawl = process.env.FIRECRAWL_API_KEY;
      delete process.env.EXA_API_KEY;
      delete process.env.FIRECRAWL_API_KEY;

      try {
        // Simulate candidate research when external keys are unavailable or API is down
        const result = await researchService.researchProductCandidate({
          candidateId: '00000000-0000-0000-0000-000000000001',
          brand: 'Bioderma',
          name: 'Bioderma Sensibio H2O Micellar Water 500ml',
        });

        expect(result).toBeDefined();
        expect(result.providerStatuses.exa).toBe('UNAVAILABLE');
        expect(result.providerStatuses.firecrawl).toBe('UNAVAILABLE');

        // Deterministic fallback extracts size from long supplier product name
        expect(result.extractedFacts.size).toEqual({ value: 500, unit: 'ml' });
        expect(result.extractedFacts.brand).toBe('Bioderma');
        expect(result.researchedAt).toBeDefined();
      } finally {
        if (origExa) process.env.EXA_API_KEY = origExa;
        if (origFirecrawl) process.env.FIRECRAWL_API_KEY = origFirecrawl;
      }
    });
  });

  describe('5. Acceptance 5: No Invented Warnings', () => {
    it('does not invent warnings for gentle hydrating ingredients and only includes evidence-based warnings', () => {
      const res = routineService.determineRoutinePlacement({
        productName: 'The Ordinary Hyaluronic Acid 2% + B5',
        brand: 'The Ordinary',
        category: 'Serum',
        ingredients: ['Aqua', 'Sodium Hyaluronate', 'Panthenol', 'Glycerin'],
      });

      expect(res.isPhotosensitizing).toBe(false);
      expect(res.requiresDaytimeSunscreen).toBe(false);
      expect(res.warnings.length).toBe(0); // Gentle hydration produces NO invented warnings
    });
  });

  describe('6. Acceptance 6: Authorized API Endpoint', () => {
    it('exposes POST /ingestion/routine/determine-placement guarded by Admin/Hub Operator roles', async () => {
      const res = await request(app.getHttpServer())
        .post('/ingestion/routine/determine-placement')
        .set(admin.auth)
        .send({
          productName: 'SkinCeuticals C E Ferulic 30ml',
          brand: 'SkinCeuticals',
          ingredients: ['Water', 'Ascorbic Acid 15%', 'Tocopherol 1%', 'Ferulic Acid 0.5%'],
        })
        .expect(201);

      expect(res.body.category).toBe(RoutineCategory.SKIN_CARE);
      expect(res.body.stepOrder).toBe(3);
      expect(res.body.stepType).toBe(RoutineStepType.TREATMENT_SERUM);
      expect(res.body.timing).toBe(RoutineTiming.AM_PM);
      expect(res.body.compatibleConcerns).toContain('hyperpigmentation');

      // Unauthenticated access returns 401
      await request(app.getHttpServer())
        .post('/ingestion/routine/determine-placement')
        .send({ productName: 'Test' })
        .expect(401);
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { BrandEnrichmentService } from '../../src/modules/ingestion/services/brand-enrichment.service';
import { createActor, Actor } from '../fixtures/actors';
import {
  BrandResolutionStatus,
  LineResolutionStatus,
} from '../../src/modules/ingestion/contracts/brand-enrichment.contract';

describe('SG-06: Reusable Brand & ProductLine Knowledge Enrichment (e2e)', () => {
  jest.setTimeout(60000);

  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Actor;
  let supplierUser: Actor;
  let hubOperator: Actor;
  let brandEnrichmentService: BrandEnrichmentService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();

    prisma = app.get(PrismaService);
    brandEnrichmentService = app.get(BrandEnrichmentService);
    admin = await createActor(prisma, 'ADMIN');
    supplierUser = await createActor(prisma, 'SUPPLIER');
    hubOperator = await createActor(prisma, 'HUB_OPERATOR');
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  async function cleanFixture() {
    // Delete test product line drafts and brand drafts
    await prisma.productLineDraft.deleteMany({
      where: {
        brandDraft: { slug: { startsWith: 'sg06-' } },
      },
    });
    await prisma.brandDraft.deleteMany({
      where: { slug: { startsWith: 'sg06-' } },
    });

    // Delete canonical product lines and brands
    const brands = await prisma.brand.findMany({
      where: { slug: { startsWith: 'sg06-' } },
    });
    for (const b of brands) {
      await prisma.productLine.deleteMany({ where: { brandId: b.id } });
      await prisma.product.deleteMany({ where: { brandId: b.id } });
      await prisma.brand.delete({ where: { id: b.id } });
    }
  }

  beforeEach(cleanFixture);
  afterEach(cleanFixture);

  describe('1. Acceptance 1: Reusable entity deduplication for unseen brands', () => {
    it('two products referencing the same unseen brand reuse ONE pending brand draft without creating duplicates', async () => {
      const unseenBrandName = `SG06 Unseen Brand ${Date.now()}`;

      // Product 1 arrives with the unseen brand
      const res1 = await brandEnrichmentService.resolveBrand(unseenBrandName);
      expect(res1.status).toBe(BrandResolutionStatus.PENDING_DRAFT);
      expect(res1.isNewDraft).toBe(true);
      expect(res1.brandDraftId).toBeDefined();

      // Product 2 arrives with the same unseen brand
      const res2 = await brandEnrichmentService.resolveBrand(unseenBrandName);
      expect(res2.status).toBe(BrandResolutionStatus.PENDING_DRAFT);
      expect(res2.isNewDraft).toBe(false);
      expect(res2.brandDraftId).toBe(res1.brandDraftId);

      // Verify in DB that only 1 BrandDraft exists
      const drafts = await prisma.brandDraft.findMany({
        where: { id: res1.brandDraftId! },
      });
      expect(drafts.length).toBe(1);
    });
  });

  describe('2. Acceptance 2: Brand name variations collapse with evidence', () => {
    it('collapses Arabic, English, and hyphenated variations to the canonical entity and tracks aliases', async () => {
      // 1. Establish canonical CeraVe brand in catalog
      let canonicalCerave = await prisma.brand.findUnique({ where: { name: 'CeraVe' } });
      if (!canonicalCerave) {
        canonicalCerave = await prisma.brand.create({
          data: {
            name: 'CeraVe',
            slug: 'cerave',
            countryOfOrigin: 'US',
            websiteUrl: 'https://www.cerave.com',
            isActive: true,
          },
        });
      }

      // 2. Incoming Arabic spelling "سيرافي"
      const resAr = await brandEnrichmentService.resolveBrand('سيرافي');
      expect(resAr.canonicalName).toBe('CeraVe');
      expect(resAr.brandId).toBe(canonicalCerave.id);
      expect(resAr.status).toBe(BrandResolutionStatus.EXACT_MATCH);

      // 3. Incoming variations for an unseen brand collapse into the same draft aliases
      const baseUnseen = `SG06 Novel Derm ${Date.now()}`;
      const resInitial = await brandEnrichmentService.resolveBrand(baseUnseen);
      expect(resInitial.status).toBe(BrandResolutionStatus.PENDING_DRAFT);

      // Variation with extra whitespace and alternate casing
      const resVariation = await brandEnrichmentService.resolveBrand(`  ${baseUnseen.toLowerCase()}  `);
      expect(resVariation.brandDraftId).toBe(resInitial.brandDraftId);

      const draft = await prisma.brandDraft.findUniqueOrThrow({
        where: { id: resInitial.brandDraftId! },
      });
      expect(draft.aliases).toContain(baseUnseen.trim());
    });
  });

  describe('3. Acceptance 3 & 4: ProductLine intelligence, Brand ownership & Marketing Adjective Guard', () => {
    it('strictly rejects marketing adjectives (e.g. whitening, moisturizing) from becoming official product lines', async () => {
      const brand = await prisma.brand.create({
        data: { name: `SG06 Brand ${Date.now()}`, slug: `sg06-brand-${Date.now()}` },
      });

      // Attempt with "whitening"
      const resWhitening = await brandEnrichmentService.resolveProductLine(
        { brandId: brand.id },
        'whitening',
      );
      expect(resWhitening.status).toBe(LineResolutionStatus.REJECTED_MARKETING_ADJECTIVE);
      expect(resWhitening.lineId).toBeNull();

      // Attempt with "moisturizing"
      const resMoisturizing = await brandEnrichmentService.resolveProductLine(
        { brandId: brand.id },
        'moisturizing',
      );
      expect(resMoisturizing.status).toBe(LineResolutionStatus.REJECTED_MARKETING_ADJECTIVE);

      // Attempt with Arabic "تفتيح"
      const resArabic = await brandEnrichmentService.resolveProductLine(
        { brandId: brand.id },
        'تفتيح',
      );
      expect(resArabic.status).toBe(LineResolutionStatus.REJECTED_MARKETING_ADJECTIVE);
    });

    it('asserts Brand->Line ownership and prevents cross-brand line collision', async () => {
      // Brand A owns line "Effaclar"
      const brandA = await prisma.brand.create({
        data: { name: `SG06 La Roche ${Date.now()}`, slug: `sg06-laroche-${Date.now()}` },
      });
      const lineA = await prisma.productLine.create({
        data: {
          brandId: brandA.id,
          name: 'Effaclar',
          slug: `sg06-laroche-effaclar-${Date.now()}`,
          isActive: true,
        },
      });

      // Brand B (Bioderma) attempts to claim "Effaclar"
      const brandB = await prisma.brand.create({
        data: { name: `SG06 Bioderma ${Date.now()}`, slug: `sg06-bioderma-${Date.now()}` },
      });

      // Resolving "Effaclar" under Brand A succeeds
      const matchA = await brandEnrichmentService.resolveProductLine(
        { brandId: brandA.id },
        'Effaclar',
      );
      expect(matchA.status).toBe(LineResolutionStatus.MATCHED);
      expect(matchA.lineId).toBe(lineA.id);

      // Resolving "Effaclar" under Brand B triggers CROSS_BRAND_COLLISION
      const matchB = await brandEnrichmentService.resolveProductLine(
        { brandId: brandB.id },
        'Effaclar',
      );
      expect(matchB.status).toBe(LineResolutionStatus.CROSS_BRAND_COLLISION);
      expect(matchB.reason).toContain('belongs to Brand');
    });
  });

  describe('4. Acceptance 5: Verified official logo & $0 asset policy', () => {
    it('stores verified official logo with provenance metadata and does not fabricate missing logos', async () => {
      const draftRes = await brandEnrichmentService.resolveBrand(`SG06 Sourced Brand ${Date.now()}`);
      const draftId = draftRes.brandDraftId!;

      // 1. Missing logo case: enrichment without logo leaves logoUrl as null ($0 policy, never fake)
      const enrichedWithoutLogo = await brandEnrichmentService.enrichBrandDraft(draftId, {
        websiteUrl: 'https://www.sourcedbrand.com',
        countryOfOrigin: 'FR',
        descriptionEn: 'Authentic French dermatological skincare brand.',
        descriptionAr: 'علامة فرنسية أصيلة للعناية بالبشرة الجلدية.',
      });
      expect(enrichedWithoutLogo.logoUrl).toBeNull();
      expect(enrichedWithoutLogo.logoMetadata).toBeNull();

      // 2. Verified official logo from authorized source
      const enrichedWithLogo = await brandEnrichmentService.enrichBrandDraft(draftId, {
        logoInput: {
          logoUrl: 'https://www.sourcedbrand.com/assets/official-logo.svg',
          sourceUrl: 'https://www.sourcedbrand.com/press/brand-assets',
          sourceDomain: 'sourcedbrand.com',
          mediaType: 'image/svg+xml',
          licenseType: 'EDITORIAL_BRAND_LOGO',
          isVerifiedOfficial: true,
        },
      });

      expect(enrichedWithLogo.logoUrl).toBe('https://www.sourcedbrand.com/assets/official-logo.svg');
      expect((enrichedWithLogo.logoMetadata as any).isVerifiedOfficial).toBe(true);
      expect((enrichedWithLogo.logoMetadata as any).licenseType).toBe('EDITORIAL_BRAND_LOGO');

      // 3. Untrusted/unverified logo is rejected
      await expect(
        brandEnrichmentService.enrichBrandDraft(draftId, {
          logoInput: {
            logoUrl: 'https://fake-ai-logos.net/cerave.png',
            sourceUrl: 'https://fake-ai-logos.net',
            sourceDomain: 'fake-ai-logos.net',
            mediaType: 'image/png',
            licenseType: 'EDITORIAL_BRAND_LOGO',
            isVerifiedOfficial: false, // NOT verified!
          },
        }),
      ).rejects.toThrow('Only verified official brand logos from authorized sources are permitted');
    });
  });

  describe('5. Acceptance 6: Approved/Rejected Lifecycle via Authorized API', () => {
    it('enforces Admin authorization, admits brand + lines into canonical catalog upon approval, and rejects correctly', async () => {
      // 1. Stage a BrandDraft with a valid ProductLine draft
      const brandRes = await brandEnrichmentService.resolveBrand(`SG06 Lifecycle Brand ${Date.now()}`);
      const draftId = brandRes.brandDraftId!;

      await brandEnrichmentService.resolveProductLine(
        { brandDraftId: draftId },
        'Sensibio',
      );

      // 2. Non-admin (Supplier and Hub Operator) cannot approve brand draft
      await expect(
        brandEnrichmentService.approveBrandDraft(draftId, supplierUser.id),
      ).rejects.toThrow('Only administrators can approve brand admissions');

      await expect(
        brandEnrichmentService.approveBrandDraft(draftId, hubOperator.id),
      ).rejects.toThrow('Only administrators can approve brand admissions');

      // 3. Admin approves draft
      const approveRes = await brandEnrichmentService.approveBrandDraft(draftId, admin.id);
      expect(approveRes.brand).toBeDefined();
      expect(approveRes.brand.id).toBeDefined();
      expect(approveRes.admittedLinesCount).toBe(1);

      // Verify canonical catalog Brand exists
      const canonicalBrand = await prisma.brand.findUniqueOrThrow({
        where: { id: approveRes.brand.id },
        include: { productLines: true },
      });
      expect(canonicalBrand.isActive).toBe(true);
      expect(canonicalBrand.productLines.length).toBe(1);
      expect(canonicalBrand.productLines[0].name).toBe('Sensibio');

      // 4. Test rejection lifecycle on another draft
      const rejectDraftRes = await brandEnrichmentService.resolveBrand(`SG06 Rejected Brand ${Date.now()}`);
      const rejectDraftId = rejectDraftRes.brandDraftId!;

      // Hub operator cannot reject
      await expect(
        brandEnrichmentService.rejectBrandDraft(rejectDraftId, hubOperator.id, 'Prohibited'),
      ).rejects.toThrow('Only administrators can reject brand drafts');

      const rejected = await brandEnrichmentService.rejectBrandDraft(
        rejectDraftId,
        admin.id,
        'Counterfeit or prohibited manufacturer not eligible for ShinaCare',
      );
      expect(rejected.status).toBe('REJECTED');
      expect(rejected.rejectionReason).toContain('Counterfeit or prohibited manufacturer');
    });

    it('exposes HTTP endpoints GET /ingestion/brands/drafts and POST /ingestion/brands/drafts/:id/approve with strict Admin RBAC', async () => {
      const brandRes = await brandEnrichmentService.resolveBrand(`SG06 HTTP Brand ${Date.now()}`);
      const draftId = brandRes.brandDraftId!;

      // GET drafts (Admin allowed)
      const listRes = await request(app.getHttpServer())
        .get('/ingestion/brands/drafts')
        .set(admin.auth)
        .expect(200);

      expect(Array.isArray(listRes.body)).toBe(true);
      const found = listRes.body.find((d: any) => d.id === draftId);
      expect(found).toBeDefined();

      // Hub operator receives 403 Forbidden on POST approve
      await request(app.getHttpServer())
        .post(`/ingestion/brands/drafts/${draftId}/approve`)
        .set(hubOperator.auth)
        .expect(403);

      // Supplier receives 403 Forbidden on POST approve
      await request(app.getHttpServer())
        .post(`/ingestion/brands/drafts/${draftId}/approve`)
        .set(supplierUser.auth)
        .expect(403);

      // POST approve by Admin succeeds
      const approveRes = await request(app.getHttpServer())
        .post(`/ingestion/brands/drafts/${draftId}/approve`)
        .set(admin.auth)
        .expect(201);

      expect(approveRes.body.brand).toBeDefined();
      expect(approveRes.body.brand.id).toBeDefined();
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, BadRequestException, ForbiddenException } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { BrandEnrichmentService } from '../../src/modules/ingestion/services/brand-enrichment.service';
import { ProductContentService } from '../../src/modules/ingestion/services/product-content.service';
import { IngestionService } from '../../src/modules/ingestion/services/ingestion.service';
import { BrandService } from '../../src/modules/catalog/services/brand.service';
import { CatalogService } from '../../src/modules/catalog/public';
import { StorageService } from '../../src/platform/storage/storage.service';
import { IMAGE_GENERATION_PROVIDER, ImageGenerationProvider } from '../../src/platform/ai/image-generation.port';
import { createActor, Actor } from '../fixtures/actors';
import { BrandResolutionStatus, LineResolutionStatus } from '../../src/modules/ingestion/contracts/brand-enrichment.contract';

// Valid 1x1 PNG buffer for testing real image storage
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/bkAAAAASUVORK5CYII=', 'base64');

describe('SG-09: Verified Packshots, Brand/Line Media & Evidence-Bound Content (e2e)', () => {
  jest.setTimeout(60000);

  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Actor;
  let hubOperator: Actor;
  let supplierUser: Actor;
  let brandEnrichmentService: BrandEnrichmentService;
  let productContentService: ProductContentService;
  let ingestionService: IngestionService;
  let brandService: BrandService;
  let catalogService: CatalogService;
  let storageService: StorageService;
  let imageGenProvider: ImageGenerationProvider;

  const testSupplierId = randomUUID();
  const testJobId = randomUUID();
  const createdCandidateIds: string[] = [];
  const createdBrandDraftIds: string[] = [];
  const createdBrandSlugs: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();

    prisma = app.get(PrismaService);
    brandEnrichmentService = app.get(BrandEnrichmentService);
    productContentService = app.get(ProductContentService);
    ingestionService = app.get(IngestionService);
    brandService = app.get(BrandService);
    catalogService = app.get(CatalogService);
    storageService = app.get(StorageService);
    imageGenProvider = app.get<ImageGenerationProvider>(IMAGE_GENERATION_PROVIDER);

    admin = await createActor(prisma, 'ADMIN');
    hubOperator = await createActor(prisma, 'HUB_OPERATOR');
    supplierUser = await createActor(prisma, 'SUPPLIER');

    // Create supplier and job for test candidates
    await prisma.supplier.create({
      data: {
        id: testSupplierId,
        name: `SG09 Supplier ${Date.now()}`,
        slug: `sg09-supplier-${Date.now()}`,
      },
    });

    await prisma.ingestionJob.create({
      data: {
        id: testJobId,
        supplierId: testSupplierId,
        status: 'pending',
      },
    });
  });

  afterAll(async () => {
    // Cleanup created data
    if (createdCandidateIds.length > 0) {
      await prisma.productContentDraft.deleteMany({ where: { candidateId: { in: createdCandidateIds } } });
      await prisma.ingestionItem.deleteMany({ where: { id: { in: createdCandidateIds } } });
    }
    await prisma.ingestionJob.deleteMany({ where: { id: testJobId } });
    await prisma.supplier.deleteMany({ where: { id: testSupplierId } });

    for (const slug of createdBrandSlugs) {
      const b = await prisma.brand.findUnique({ where: { slug } });
      if (b) {
        await prisma.productLine.deleteMany({ where: { brandId: b.id } });
        await prisma.product.deleteMany({ where: { brandId: b.id } });
        await prisma.brand.delete({ where: { id: b.id } });
      }
      await prisma.productLineDraft.deleteMany({ where: { brandDraft: { slug } } });
      await prisma.brandDraft.deleteMany({ where: { slug } });
    }

    if (app) await app.close();
  });

  async function createTestCandidate(overrides?: Partial<any>) {
    const id = randomUUID();
    const barcode = `BARCODE-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const item = await prisma.ingestionItem.create({
      data: {
        id,
        jobId: testJobId,
        supplierSkuCode: `SKU-${id.slice(0, 8)}`,
        name: overrides?.name || 'CeraVe Foaming Cleanser 236ml',
        brand: overrides?.brand || 'CeraVe',
        barcode: overrides?.barcode || barcode,
        price: 85,
        currency: 'SAR',
        status: overrides?.status || 'review_required',
        enrichment: overrides?.enrichment || {
          research: {
            fieldEvidences: [
              {
                fieldName: 'size',
                sourceUrl: 'https://www.cerave.com/skincare/cleansers/foaming-facial-cleanser',
                sourceType: 'OFFICIAL_MANUFACTURER',
                verificationStatus: 'SUPPORTED',
                proposedValue: { value: 236, unit: 'ml' },
              },
            ],
          },
          ingredients: {
            activeIngredients: [
              { name: 'Ceramides', inciName: 'CERAMIDE NP', family: 'Ceramides' },
              { name: 'Niacinamide', inciName: 'NIACINAMIDE', family: 'Niacinamide' },
              { name: 'Hyaluronic Acid', inciName: 'SODIUM HYALURONATE', family: 'Hyaluronic Acid' },
            ],
          },
        },
      },
    });
    createdCandidateIds.push(item.id);
    return item;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Authentic Brand & ProductLine Media Acquisition, Storage & Provenance
  // ───────────────────────────────────────────────────────────────────────────
  describe('1. Acceptance 1 & 2: Authentic Brand Logo and ProductLine Image Pipeline', () => {
    it('uploads, stores, enriches, and admits genuine Brand logo with verified source provenance', async () => {
      const brandSlug = `sg09-brand-${Date.now()}`;
      createdBrandSlugs.push(brandSlug);

      // 1. Resolve brand draft
      const resolution = await brandEnrichmentService.resolveBrand(`La Roche-Posay SG09 ${Date.now()}`);
      expect(resolution.brandDraftId).toBeDefined();
      const draftId = resolution.brandDraftId!;
      createdBrandDraftIds.push(draftId);

      // 2. Upload authentic logo bytes to storage provider
      const logoUrl = await storageService.uploadFile(
        {
          buffer: png,
          originalname: 'laroche-logo.png',
          mimetype: 'image/png',
        } as Express.Multer.File,
        false,
        'brands',
      );
      expect(logoUrl).toContain('/storage/public/brands/');

      // Verify file physically exists in storage
      const relativePath = logoUrl.slice(logoUrl.indexOf('/storage/') + '/storage/'.length);
      expect(await storageService.exists(relativePath)).toBe(true);

      // 3. Enrich BrandDraft with verified official logo metadata
      const enriched = await brandEnrichmentService.enrichBrandDraft(draftId, {
        websiteUrl: 'https://www.laroche-posay.us',
        countryOfOrigin: 'France',
        descriptionEn: 'La Roche-Posay dermatological skincare',
        descriptionAr: 'منتجات لاروش بوزيه للعناية الطبية بالبشرة',
        logoInput: {
          logoUrl,
          sourceUrl: 'https://www.laroche-posay.us/logo.png',
          sourceDomain: 'laroche-posay.us',
          mediaType: 'image/png',
          licenseType: 'EDITORIAL_BRAND_LOGO',
          isVerifiedOfficial: true,
        },
      });

      expect(enriched.logoUrl).toBe(logoUrl);
      expect((enriched.logoMetadata as any)?.isVerifiedOfficial).toBe(true);
      expect((enriched.logoMetadata as any)?.sourceDomain).toBe('laroche-posay.us');
      expect((enriched.logoMetadata as any)?.licenseType).toBe('EDITORIAL_BRAND_LOGO');

      // 4. Admin approves brand draft into canonical catalog.brands
      const approval = await brandEnrichmentService.approveBrandDraft(draftId, admin.id);
      expect(approval.brand).toBeDefined();
      expect(approval.brand.logoUrl).toBe(logoUrl);

      // 5. Query BrandService to prove display with full provenance
      const canonicalBrand = await brandService.getBrand(approval.brand.id);
      expect(canonicalBrand).toBeDefined();
      expect(canonicalBrand!.logoUrl).toBe(logoUrl);
      expect((canonicalBrand!.logoMetadata as any)?.sourceDomain).toBe('laroche-posay.us');
      expect((canonicalBrand!.logoMetadata as any)?.isVerifiedOfficial).toBe(true);
    });

    it('uploads, stores, enriches, and admits genuine ProductLine image with verified source provenance', async () => {
      const brandSlug = `sg09-linebrand-${Date.now()}`;
      createdBrandSlugs.push(brandSlug);

      // 1. Resolve brand draft and line draft
      const brandRes = await brandEnrichmentService.resolveBrand(`Effaclar Brand ${Date.now()}`);
      const lineRes = await brandEnrichmentService.resolveProductLine(
        { brandDraftId: brandRes.brandDraftId! },
        'Effaclar SG09 Line',
      );
      expect(lineRes.lineDraftId).toBeDefined();
      const lineDraftId = lineRes.lineDraftId!;

      // 2. Upload authentic line banner image bytes to storage provider
      const lineImageUrl = await storageService.uploadFile(
        {
          buffer: png,
          originalname: 'effaclar-line-banner.png',
          mimetype: 'image/png',
        } as Express.Multer.File,
        false,
        'productlines',
      );
      expect(lineImageUrl).toContain('/storage/public/productlines/');
      const relativePath = lineImageUrl.slice(lineImageUrl.indexOf('/storage/') + '/storage/'.length);
      expect(await storageService.exists(relativePath)).toBe(true);

      // 3. Enrich ProductLineDraft with verified official line image metadata
      const enrichedLine = await brandEnrichmentService.enrichProductLineDraft(lineDraftId, {
        descriptionEn: 'Effaclar oily acne-prone skin line',
        descriptionAr: 'مجموعة إيفاكلار للعناية بالبشرة الدهنية والمعرضة للحبوب',
        imageInput: {
          imageUrl: lineImageUrl,
          sourceUrl: 'https://www.laroche-posay.us/effaclar-banner.png',
          sourceDomain: 'laroche-posay.us',
          mediaType: 'image/png',
          licenseType: 'OFFICIAL_PRODUCT_LINE_ASSET',
          isVerifiedOfficial: true,
        },
      });

      expect(enrichedLine.imageUrl).toBe(lineImageUrl);
      expect((enrichedLine.imageMetadata as any)?.isVerifiedOfficial).toBe(true);
      expect((enrichedLine.imageMetadata as any)?.sourceDomain).toBe('laroche-posay.us');

      // 4. Admin approves BrandDraft which admits ProductLineDraft into catalog.product_lines
      await brandEnrichmentService.approveBrandDraft(brandRes.brandDraftId!, admin.id);

      // 5. Query ProductLine to prove linkage and provenance display
      const admittedLineDraft = await prisma.productLineDraft.findUnique({ where: { id: lineDraftId } });
      expect(admittedLineDraft?.canonicalLineId).toBeDefined();

      const canonicalLine = await brandService.getProductLine(admittedLineDraft!.canonicalLineId!);
      expect(canonicalLine).toBeDefined();
      expect(canonicalLine!.imageUrl).toBe(lineImageUrl);
      expect((canonicalLine!.imageMetadata as any)?.sourceDomain).toBe('laroche-posay.us');
      expect((canonicalLine!.imageMetadata as any)?.licenseType).toBe('OFFICIAL_PRODUCT_LINE_ASSET');
    });

    it('rejects unverified or untrusted sources for brand logo and product line images', async () => {
      const brandRes = await brandEnrichmentService.resolveBrand(`Untrusted Media Brand ${Date.now()}`);
      createdBrandSlugs.push(brandRes.slug);

      // Unverified boolean false
      await expect(
        brandEnrichmentService.enrichBrandDraft(brandRes.brandDraftId!, {
          logoInput: {
            logoUrl: 'https://random-site.com/logo.png',
            sourceUrl: 'https://random-site.com/logo.png',
            sourceDomain: 'random-site.com',
            mediaType: 'image/png',
            licenseType: 'EDITORIAL_BRAND_LOGO',
            isVerifiedOfficial: false,
          },
        }),
      ).rejects.toThrow(BadRequestException);

      // Invalid media type
      await expect(
        brandEnrichmentService.enrichBrandDraft(brandRes.brandDraftId!, {
          logoInput: {
            logoUrl: 'https://random-site.com/logo.exe',
            sourceUrl: 'https://random-site.com/logo.exe',
            sourceDomain: 'random-site.com',
            mediaType: 'application/x-msdownload' as any,
            licenseType: 'EDITORIAL_BRAND_LOGO',
            isVerifiedOfficial: true,
          },
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. SKU / Variant-Accurate Media Association & Media Roles
  // ───────────────────────────────────────────────────────────────────────────
  describe('2. Acceptance 3: SKU / Variant-Accurate Media Association', () => {
    it('enforces strict variant-matching: 50ml packshot cannot be approved for a mismatched 100ml SKU', async () => {
      const candidate50ml = await createTestCandidate({
        name: 'Vichy Mineral 89 Serum 50ml',
        brand: 'Vichy',
        enrichment: {
          research: {
            fieldEvidences: [
              {
                fieldName: 'size',
                sourceUrl: 'https://www.vichyusa.com/mineral-89.html',
                sourceType: 'OFFICIAL_MANUFACTURER',
                verificationStatus: 'SUPPORTED',
                proposedValue: { value: 50, unit: 'ml' },
              },
            ],
          },
        },
      });

      // Upload genuine 50ml packshot
      const uploadRes = await request(app.getHttpServer())
        .post(`/ingestion/candidates/${candidate50ml.id}/media`)
        .set('Authorization', `Bearer ${admin.token}`)
        .attach('file', png, { filename: 'vichy-50ml-front.png', contentType: 'image/png' })
        .expect(201);

      expect(uploadRes.body.url).toBeDefined();

      // Attempting to approve the 50ml packshot with a mismatched size 100ml fails
      await request(app.getHttpServer())
        .patch(`/ingestion/candidates/${candidate50ml.id}/approve`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({
          mediaReviews: [
            {
              url: uploadRes.body.url,
              sourceUrl: 'https://www.vichyusa.com/mineral-89.html',
              sourceType: 'OFFICIAL_MANUFACTURER',
              barcode: candidate50ml.barcode!,
              size: 100, // MISMATCH (candidate evidence is 50ml)
              sizeUnit: 'ml',
              variantName: '100 ml',
            },
          ],
        })
        .expect(400);

      // Approving with the exact matching 50ml evidence succeeds
      await request(app.getHttpServer())
        .patch(`/ingestion/candidates/${candidate50ml.id}/approve`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({
          mediaReviews: [
            {
              url: uploadRes.body.url,
              sourceUrl: 'https://www.vichyusa.com/mineral-89.html',
              sourceType: 'OFFICIAL_MANUFACTURER',
              barcode: candidate50ml.barcode!,
              size: 50, // MATCHES evidence
              sizeUnit: 'ml',
              variantName: '50 ml',
            },
          ],
        })
        .expect(200);

      const approvedItem = await prisma.ingestionItem.findUnique({ where: { id: candidate50ml.id } });
      const verifiedMedia = (approvedItem?.enrichment as any)?.media?.find((m: any) => m.originType === 'verified');
      expect(verifiedMedia).toBeDefined();
      expect(verifiedMedia.review.size).toBe(50);
      expect(verifiedMedia.review.variantName).toBe('50 ml');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Missing Image & Error Path (No Misleading Placeholders)
  // ───────────────────────────────────────────────────────────────────────────
  describe('3. Acceptance 4: Missing Image Handling & No Misleading Placeholders', () => {
    it('blocks publication when verified media is missing and never injects a fake placeholder', async () => {
      const candidateNoMedia = await createTestCandidate({
        name: 'Bioderma Sensibio H2O 500ml',
        brand: 'Bioderma',
        status: 'review_required',
      });

      // Attempt to publish candidate without verified media
      await request(app.getHttpServer())
        .post(`/ingestion/candidates/${candidateNoMedia.id}/publish`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(400);

      const itemAfter = await prisma.ingestionItem.findUnique({ where: { id: candidateNoMedia.id } });
      expect(itemAfter?.matchedSkuId).toBeNull();
      expect(itemAfter?.status).not.toBe('published');

      // Verify no fake placeholder image was added to enrichment
      const enrichment = itemAfter?.enrichment as any;
      expect(enrichment?.media || []).toHaveLength(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Narrow ImageGenerationProvider Seam ($0 Cost Gate)
  // ───────────────────────────────────────────────────────────────────────────
  describe('4. Acceptance 5: Narrow ImageGenerationProvider Seam ($0 Cost Policy Gate)', () => {
    it('returns DEFERRED_COST_GATE status and zero external cost without blocking publication', async () => {
      expect(imageGenProvider).toBeDefined();
      expect(imageGenProvider.isConfigured()).toBe(false); // Off by default

      const result = await imageGenProvider.generateImage({
        productName: 'CeraVe Hydrating Cleanser',
        brandName: 'CeraVe',
        prompt: 'A packshot of CeraVe hydrating cleanser',
      });

      expect(result.status).toBe('DEFERRED_COST_GATE');
      expect(result.provider).toBe('none_cost_gate');
      expect(result.reason).toContain('$0 external cost policy');
      expect(result.metadata?.deferredByPolicy).toBe('COST_GATE_20261019');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Evidence-Bound Dual-Language Storefront Content Synthesis
  // ───────────────────────────────────────────────────────────────────────────
  describe('5. Acceptance 6 & 8: Evidence-Bound Bilingual Storefront Content & Reproducibility', () => {
    it('synthesizes truthful Arabic and English storefront content bound strictly to active ingredients and routine', async () => {
      const candidate = await createTestCandidate({
        name: 'CeraVe Resurfacing Retinol Serum 30ml',
        brand: 'CeraVe',
        enrichment: {
          research: {
            fieldEvidences: [
              {
                fieldName: 'size',
                sourceUrl: 'https://www.cerave.com/skincare/serums/resurfacing-retinol-serum',
                sourceType: 'OFFICIAL_MANUFACTURER',
                verificationStatus: 'SUPPORTED',
                proposedValue: { value: 30, unit: 'ml' },
              },
            ],
          },
          ingredients: {
            activeIngredients: [
              { name: 'Retinol', inciName: 'RETINOL', family: 'Retinoids' },
              { name: 'Niacinamide', inciName: 'NIACINAMIDE', family: 'Niacinamide' },
              { name: 'Ceramides', inciName: 'CERAMIDE NP', family: 'Ceramides' },
            ],
          },
        },
      });

      // Generate content
      const contentRes = await productContentService.generateContent(candidate.id);
      expect(contentRes.draft).toBeDefined();

      const draft = contentRes.draft;
      // Bilingual titles
      expect(draft.titleEn).toContain('CeraVe Resurfacing Retinol Serum 30ml');
      expect(draft.titleAr).toContain('CeraVe Resurfacing Retinol Serum (30 مل)');

      // Evidence-based active ingredient benefits
      expect(draft.benefitsEn.some(b => b.toLowerCase().includes('cellular renewal') || b.toLowerCase().includes('fine lines'))).toBe(true);
      expect(draft.benefitsAr.some(b => b.includes('تجديد خلايا البشرة') || b.includes('الخطوط الدقيقة'))).toBe(true);

      // Retinol Routine Placement: PM only with daytime SPF
      expect(draft.usageEn.some(u => u.toLowerCase().includes('evening') && u.toLowerCase().includes('sun protection'))).toBe(true);
      expect(draft.usageAr.some(u => u.includes('مساءً') && u.includes('واقي شمس'))).toBe(true);
      expect(draft.routineStepEn).toContain('Step 3');

      // SEO & keywords
      expect(draft.keywords.length).toBeGreaterThanOrEqual(3);
      expect(draft.keywords).toContain('cerave');
      expect(draft.keywords).toContain('retinol');
      expect(draft.seoTitleAr).toContain('شينا كير');

      // Deterministic evidenceVersion calculation
      expect(draft.evidenceVersion).toBeDefined();
      expect(draft.evidenceVersion).toHaveLength(16);

      // Reproducibility check: re-running synthesis produces the EXACT SAME evidenceVersion
      const secondRun = await productContentService.generateContent(candidate.id);
      expect(secondRun.draft.evidenceVersion).toBe(draft.evidenceVersion);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6. Deterministic Validation Rejects Unsupported Claims
  // ───────────────────────────────────────────────────────────────────────────
  describe('6. Acceptance 7: Deterministic Claim Boundary Validation', () => {
    it('rejects unverified SPF / sun protection claims on a non-sunscreen cleanser', async () => {
      const cleanser = await createTestCandidate({
        name: 'Hydrating Gentle Foam Cleanser 150ml',
        brand: 'Simple',
        enrichment: {
          ingredients: { activeIngredients: ['Hyaluronic Acid'] },
        },
      });

      // Attempting to approve/validate claims with invented SPF on a cleanser
      expect(() => {
        productContentService.validateContentClaims(
          {
            benefitsEn: ['Protects against UVA/UVB rays with SPF 50+ broad spectrum'],
            benefitsAr: ['يوفر حماية فائقة من الشمس بمعامل SPF 50+'],
          },
          cleanser,
          ['Hyaluronic Acid'],
        );
      }).toThrow(BadRequestException);
    });

    it('rejects medical disease cure claims', async () => {
      const eczemaCream = await createTestCandidate({
        name: 'Soothing Barrier Cream 50ml',
        brand: 'Avene',
        enrichment: {
          ingredients: { activeIngredients: ['Ceramides'] },
        },
      });

      expect(() => {
        productContentService.validateContentClaims(
          {
            benefitsEn: ['Cures eczema completely in 3 days'],
            benefitsAr: ['علاج نهائي للأكزيما في 3 أيام'],
          },
          eczemaCream,
          ['Ceramides'],
        );
      }).toThrow(BadRequestException);
    });

    it('rejects Retinoid claims when product contains zero retinoids', async () => {
      const plainHydrator = await createTestCandidate({
        name: 'Pure Hyaluronic Hydrating Essence 100ml',
        brand: 'Cosrx',
        enrichment: {
          ingredients: { activeIngredients: ['Hyaluronic Acid'] },
        },
      });

      expect(() => {
        productContentService.validateContentClaims(
          {
            benefitsEn: ['Contains potent Retinol to erase wrinkles'],
            benefitsAr: ['يحتوي على ريتينول فعال لمحاربة التجاعيد'],
          },
          plainHydrator,
          ['Hyaluronic Acid'],
        );
      }).toThrow(BadRequestException);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 7. Editorial Content Draft Workflow & Authorized API Endpoints
  // ───────────────────────────────────────────────────────────────────────────
  describe('7. Acceptance 9: Editorial Content Draft Approval & RBAC API Endpoints', () => {
    it('restricts content draft approval strictly to Admin (denies Hub Operator and Supplier with 403)', async () => {
      const candidate = await createTestCandidate({
        name: 'Centella Asiatica Calming Ampoule 50ml',
        brand: 'Skin1004',
        enrichment: {
          ingredients: { activeIngredients: ['Centella Asiatica'] },
        },
      });

      // 1. Generate content via endpoint
      await request(app.getHttpServer())
        .post(`/ingestion/candidates/${candidate.id}/content/generate`)
        .set('Authorization', `Bearer ${hubOperator.token}`)
        .expect(201);

      // 2. Query draft via endpoint
      const draftRes = await request(app.getHttpServer())
        .get(`/ingestion/candidates/${candidate.id}/content`)
        .set('Authorization', `Bearer ${hubOperator.token}`)
        .expect(200);

      expect(draftRes.body.titleEn).toContain('Centella');
      expect(draftRes.body.isApproved).toBe(false);

      // 3. Unauthorized user (Supplier) cannot approve content draft (403)
      await request(app.getHttpServer())
        .post(`/ingestion/candidates/${candidate.id}/content/approve`)
        .set('Authorization', `Bearer ${supplierUser.token}`)
        .expect(403);

      // 4. Hub Operator cannot approve content draft (403 - Admin only)
      await request(app.getHttpServer())
        .post(`/ingestion/candidates/${candidate.id}/content/approve`)
        .set('Authorization', `Bearer ${hubOperator.token}`)
        .expect(403);

      // 5. Authorized Admin approves content draft
      const approvedRes = await request(app.getHttpServer())
        .post(`/ingestion/candidates/${candidate.id}/content/approve`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(201);

      expect(approvedRes.body.isApproved).toBe(true);

      // Verify in DB
      const dbDraft = await prisma.productContentDraft.findUnique({ where: { candidateId: candidate.id } });
      expect(dbDraft?.isApproved).toBe(true);
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, BadRequestException } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import {
  ProductIdentityService,
  MatchClassification,
} from '../../src/modules/ingestion/services/product-identity.service';
import { ProductResearchService } from '../../src/modules/ingestion/services/product-research.service';
import { createActor, Actor } from '../fixtures/actors';
import { reviewCandidateMedia } from '../fixtures/candidate-review';

describe('SG-04: Canonical SKU Identity Matching, Supplier Alias Cache & Dedup (e2e)', () => {
  jest.setTimeout(60000);

  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Actor;
  let identityService: ProductIdentityService;
  let researchService: ProductResearchService;
  let supplier1Id: string;
  let supplier2Id: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();

    prisma = app.get(PrismaService);
    identityService = app.get(ProductIdentityService);
    researchService = app.get(ProductResearchService);
    admin = await createActor(prisma, 'ADMIN');
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  async function cleanFixture() {
    const testSupplierSlugs = ['sg04-supplier-1', 'sg04-supplier-2'];
    for (const slug of testSupplierSlugs) {
      const s = await prisma.supplier.findUnique({ where: { slug } });
      if (s) {
        await prisma.supplierSkuAlias.deleteMany({ where: { supplierId: s.id } });
        await prisma.ingestionItem.deleteMany({ where: { job: { supplierId: s.id } } });
        await prisma.ingestionJob.deleteMany({ where: { supplierId: s.id } });
        await prisma.supplierOffer.deleteMany({ where: { supplierId: s.id } });
        await prisma.supplier.delete({ where: { id: s.id } });
      }
    }

    const testBrandSlugs = ['sg04-brand-cerave', 'sg04-brand-cetaphil', 'sg04-brand-conflict'];
    for (const bSlug of testBrandSlugs) {
      const brand = await prisma.brand.findUnique({ where: { slug: bSlug } });
      if (brand) {
        const products = await prisma.product.findMany({ where: { brandId: brand.id } });
        for (const p of products) {
          const skus = await prisma.sku.findMany({ where: { productId: p.id } });
          const skuIds = skus.map((s) => s.id);
          await prisma.skuBarcodeAlias.deleteMany({ where: { skuId: { in: skuIds } } });
          await prisma.supplierOffer.deleteMany({ where: { skuId: { in: skuIds } } });
          await prisma.productMedia.deleteMany({ where: { productId: p.id } });
          await prisma.sku.deleteMany({ where: { id: { in: skuIds } } });
          await prisma.product.delete({ where: { id: p.id } });
        }
        await prisma.brand.delete({ where: { id: brand.id } });
      }
    }
  }

  beforeEach(async () => {
    await cleanFixture();

    const s1 = await prisma.supplier.create({
      data: { name: 'SG04 Supplier 1', slug: 'sg04-supplier-1' },
    });
    supplier1Id = s1.id;

    const s2 = await prisma.supplier.create({
      data: { name: 'SG04 Supplier 2', slug: 'sg04-supplier-2' },
    });
    supplier2Id = s2.id;
  });

  afterEach(cleanFixture);

  describe('1. Acceptance 1: Same product two suppliers differently named → single canonical SKU with two offers', () => {
    it('resolves English and Arabic names to single canonical SKU and creates distinct supplier offers', async () => {
      // Step A: Supplier 1 imports "CeraVe Moisturizing Cream 340g" (English name)
      const job1 = await request(app.getHttpServer())
        .post('/ingestion/jobs')
        .set(admin.auth)
        .send({
          supplierId: supplier1Id,
          items: [
            {
              supplierSkuCode: 'SUP1-CERAVE-340G',
              name: 'CeraVe Moisturizing Cream 340g',
              brand: 'CeraVe',
              barcode: '3337875597381',
              price: 350,
              priceType: 'PURCHASE_COST',
              currency: 'EGP',
            },
          ],
        })
        .expect(201);

      const itemId1 = job1.body.items[0].id;
      const media1 = await reviewCandidateMedia(app, admin.auth, itemId1, '3337875597381', 340, 'g');
      await request(app.getHttpServer())
        .patch(`/ingestion/candidates/${itemId1}/approve`)
        .set(admin.auth)
        .send({ mediaReviews: media1 })
        .expect(200);

      const publish1 = await request(app.getHttpServer())
        .post(`/ingestion/candidates/${itemId1}/publish`)
        .set(admin.auth)
        .expect(200);

      const canonicalSkuId = publish1.body.matchedSkuId;
      expect(canonicalSkuId).toBeDefined();

      // Step B: Supplier 2 imports Arabic name "سيرافي كريم مرطب 340 جم" with same barcode
      const job2 = await request(app.getHttpServer())
        .post('/ingestion/jobs')
        .set(admin.auth)
        .send({
          supplierId: supplier2Id,
          items: [
            {
              supplierSkuCode: 'SUP2-CERAVE-AR-340',
              name: 'سيرافي كريم مرطب للبشرة الجافة 340 جم',
              brand: 'سيرافي',
              barcode: '3337875597381',
              price: 320,
              priceType: 'PURCHASE_COST',
              currency: 'EGP',
            },
          ],
        })
        .expect(201);

      const itemId2 = job2.body.items[0].id;
      await new Promise((r) => setTimeout(r, 100));

      // Candidate 2 must EXACT_MATCH the canonical SKU created by Supplier 1
      const detail2 = await request(app.getHttpServer())
        .get(`/ingestion/candidates/${itemId2}`)
        .set(admin.auth)
        .expect(200);

      expect(detail2.body.matchedSkuId).toBe(canonicalSkuId);
      expect(detail2.body.identity.classification).toBe(MatchClassification.EXACT_MATCH);

      // Supplier 2 approves and publishes
      const media2 = await reviewCandidateMedia(app, admin.auth, itemId2, '3337875597381', 340, 'g');
      await request(app.getHttpServer())
        .patch(`/ingestion/candidates/${itemId2}/approve`)
        .set(admin.auth)
        .send({ mediaReviews: media2 })
        .expect(200);

      await request(app.getHttpServer())
        .post(`/ingestion/candidates/${itemId2}/publish`)
        .set(admin.auth)
        .expect(200);

      // Step C: Verify canonical database state
      // Exactly 1 canonical SKU exists with barcode 3337875597381
      const skuCount = await prisma.sku.count({ where: { barcode: '3337875597381' } });
      expect(skuCount).toBe(1);

      // Exactly 2 distinct SupplierOffers exist for this SKU
      const offers = await prisma.supplierOffer.findMany({ where: { skuId: canonicalSkuId } });
      expect(offers.length).toBe(2);

      const offer1 = offers.find((o) => o.supplierId === supplier1Id);
      const offer2 = offers.find((o) => o.supplierId === supplier2Id);

      expect(offer1).toBeDefined();
      expect(offer1!.costPrice.toNumber()).toBe(350);
      expect(offer2).toBeDefined();
      expect(offer2!.costPrice.toNumber()).toBe(320);
    });
  });

  describe('2. Acceptance 2: Size/variant conflict held (236ml vs 473ml)', () => {
    it('holds CONFLICT when barcode or name matches but package size differs', async () => {
      // Create canonical product with 236ml SKU
      const brand = await prisma.brand.create({
        data: { name: 'SG04 Brand CeraVe', slug: 'sg04-brand-cerave' },
      });
      const product = await prisma.product.create({
        data: {
          name: 'Hydrating Facial Cleanser',
          slug: 'sg04-cerave-hydrating-cleanser',
          brandId: brand.id,
          isPublished: true,
        },
      });
      const sku236 = await prisma.sku.create({
        data: {
          productId: product.id,
          code: 'CERAVE-CLEANSER-236ML',
          variantName: 'Default',
          size: 236,
          sizeUnit: 'ml',
          barcode: '3337872412489',
          isActive: true,
        },
      });

      // Case A: Candidate uploads 473ml with same barcode (conflicting facts)
      const matchWithBarcode = await identityService.classifyCandidateMatch({
        supplierId: supplier1Id,
        supplierSkuCode: 'SUP-473ML',
        name: 'Hydrating Facial Cleanser 473ml',
        brand: 'SG04 Brand CeraVe',
        size: 473,
        sizeUnit: 'ml',
        barcode: '3337872412489',
      });

      expect(matchWithBarcode.classification).toBe(MatchClassification.CONFLICT);
      expect(matchWithBarcode.matchedSkuId).toBeNull();
      expect(matchWithBarcode.conflicts.some((c) => c.includes('barcode_size_mismatch'))).toBe(true);

      // Case B: Candidate uploads 473ml without barcode (brand & name match but different size)
      const matchWithoutBarcode = await identityService.classifyCandidateMatch({
        supplierId: supplier1Id,
        supplierSkuCode: 'SUP-473ML-NO-BC',
        name: 'Hydrating Facial Cleanser 473ml',
        brand: 'SG04 Brand CeraVe',
        size: 473,
        sizeUnit: 'ml',
      });

      expect(matchWithoutBarcode.classification).toBe(MatchClassification.LIKELY_MATCH);
      expect(matchWithoutBarcode.matchedSkuId).toBeNull();
      expect(matchWithoutBarcode.conflicts).toContain('different_size_or_variant_requires_review');
    });
  });

  describe('3. Acceptance 3: Barcode collision held', () => {
    it('detects barcode collision across different brands and refuses auto-match', async () => {
      // Canonical SKU registered to Brand CeraVe
      const brandA = await prisma.brand.create({
        data: { name: 'SG04 Brand CeraVe', slug: 'sg04-brand-cerave' },
      });
      const productA = await prisma.product.create({
        data: {
          name: 'Daily Moisturizing Lotion',
          slug: 'sg04-cerave-daily-lotion',
          brandId: brandA.id,
          isPublished: true,
        },
      });
      await prisma.sku.create({
        data: {
          productId: productA.id,
          code: 'CERAVE-LOTION-236ML',
          variantName: 'Default',
          size: 236,
          sizeUnit: 'ml',
          barcode: '6221000000001',
          isActive: true,
        },
      });

      // Supplier uploads the same barcode claiming Brand Cetaphil
      const match = await identityService.classifyCandidateMatch({
        supplierId: supplier1Id,
        supplierSkuCode: 'CETAPHIL-COLLISION',
        name: 'Moisturizing Cream',
        brand: 'Cetaphil',
        barcode: '6221000000001',
      });

      expect(match.classification).toBe(MatchClassification.CONFLICT);
      expect(match.matchedSkuId).toBeNull();
      expect(match.conflicts.some((c) => c.includes('barcode_brand_mismatch'))).toBe(true);
    });
  });

  describe('4. Acceptance 4: Valid no-match leads to one candidate (Multi-supplier candidate deduplication)', () => {
    it('deduplicates unfamiliar candidates across suppliers and reuses single candidate identity', async () => {
      // Supplier 1 uploads unfamiliar eligible product
      const match1 = await identityService.classifyCandidateMatch({
        supplierId: supplier1Id,
        supplierSkuCode: 'SUP1-BLEMISH-40ML',
        name: 'CeraVe Blemish Control Gel 40ml',
        brand: 'CeraVe',
        barcode: '3337875794056',
        size: 40,
        sizeUnit: 'ml',
      });

      expect(match1.classification).toBe(MatchClassification.NO_MATCH);
      expect(match1.matchedSkuId).toBeNull();
      expect(match1.existingCandidateId).toBeNull();

      // Create IngestionItem candidate for Supplier 1
      const job1 = await prisma.ingestionJob.create({
        data: { supplierId: supplier1Id, status: 'review_required' },
      });
      const candidate1 = await prisma.ingestionItem.create({
        data: {
          jobId: job1.id,
          supplierSkuCode: 'SUP1-BLEMISH-40ML',
          name: 'CeraVe Blemish Control Gel 40ml',
          brand: 'CeraVe',
          barcode: '3337875794056',
          price: 250,
          currency: 'EGP',
          status: 'review_required',
          enrichment: {
            identity: { fingerprint: match1.fingerprint },
            evidence: { manufacturerSource: 'https://cerave.com/blemish-control' },
          },
        },
      });

      // Supplier 2 uploads the same unfamiliar product
      const match2 = await identityService.classifyCandidateMatch({
        supplierId: supplier2Id,
        supplierSkuCode: 'SUP2-BLEMISH-40ML',
        name: 'CeraVe Blemish Control Gel 40ml',
        brand: 'CeraVe',
        barcode: '3337875794056',
        size: 40,
        sizeUnit: 'ml',
      });

      expect(match2.classification).toBe(MatchClassification.NO_MATCH);
      expect(match2.matchedSkuId).toBeNull();
      // Candidate dedup: identifies existing candidate ID from Supplier 1!
      expect(match2.existingCandidateId).toBe(candidate1.id);
      expect(match2.reason).toBe('no_canonical_match_found_existing_candidate_reused');
    });
  });

  describe('5. Acceptance 5: Invalid brand not researched', () => {
    it('classifies invalid brands as INVALID and blocks automated AI research', async () => {
      // Case A: Identity classification classifies fake/gibberish brand as INVALID
      const match = await identityService.classifyCandidateMatch({
        supplierId: supplier1Id,
        supplierSkuCode: 'FAKE-001',
        name: 'Some Miracle Cream',
        brand: 'FakeBrand999',
      });

      expect(match.classification).toBe(MatchClassification.INVALID);
      expect(match.matchedSkuId).toBeNull();
      expect(match.reason).toBe('invalid_or_unvetted_brand');

      // Case B: Research service throws BadRequestException and refuses to call research APIs
      await expect(
        researchService.researchProductCandidate({
          candidateId: 'test-cand-id',
          brand: 'FakeBrand999',
          name: 'Some Miracle Cream',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('6. Acceptance 6: Supply costs never embedded as Product canonical facts', () => {
    it('guarantees Product and Sku models strictly contain no cost or supplier pricing fields', async () => {
      // Query Prisma DMMF to assert model fields
      const dmmf = (prisma as any)._dmmf?.modelMap;
      if (dmmf) {
        const productFields = dmmf.Product?.fields?.map((f: any) => f.name) || [];
        const skuFields = dmmf.Sku?.fields?.map((f: any) => f.name) || [];

        // Assert neither model has cost fields
        expect(productFields).not.toContain('cost');
        expect(productFields).not.toContain('costPrice');
        expect(productFields).not.toContain('wholesalePrice');
        expect(productFields).not.toContain('supplierCost');

        expect(skuFields).not.toContain('cost');
        expect(skuFields).not.toContain('costPrice');
        expect(skuFields).not.toContain('price');
      }

      // Assert created canonical records in DB have only supplier offers holding cost
      const brand = await prisma.brand.create({
        data: { name: 'SG04 Brand CeraVe', slug: 'sg04-brand-cerave' },
      });
      const product = await prisma.product.create({
        data: {
          name: 'Eye Repair Cream',
          slug: 'sg04-cerave-eye-repair-cream',
          brandId: brand.id,
          isPublished: true,
        },
      });
      const sku = await prisma.sku.create({
        data: {
          productId: product.id,
          code: 'CERAVE-EYE-15ML',
          variantName: 'Default',
          size: 15,
          sizeUnit: 'ml',
          barcode: '3337875597111',
          isActive: true,
        },
      });

      const offer = await prisma.supplierOffer.create({
        data: {
          supplierId: supplier1Id,
          skuId: sku.id,
          costPrice: 180,
          currency: 'EGP',
          isAvailable: true,
        },
      });

      const fetchedProduct: any = await prisma.product.findUnique({ where: { id: product.id } });
      const fetchedSku: any = await prisma.sku.findUnique({ where: { id: sku.id } });

      expect(fetchedProduct.cost).toBeUndefined();
      expect(fetchedProduct.costPrice).toBeUndefined();
      expect(fetchedSku.cost).toBeUndefined();
      expect(fetchedSku.costPrice).toBeUndefined();
      expect(offer.costPrice.toNumber()).toBe(180);
    });
  });

  describe('7. SkuBarcodeAlias (GLO-242) Manufacturer Packaging Revision Matching', () => {
    it('matches canonical SKU via approved SkuBarcodeAlias with barcode_alias_exact_match', async () => {
      const brand = await prisma.brand.create({
        data: { name: 'SG04 Brand CeraVe', slug: 'sg04-brand-cerave' },
      });
      const product = await prisma.product.create({
        data: {
          name: 'PM Facial Moisturizing Lotion',
          slug: 'sg04-cerave-pm-facial-lotion',
          brandId: brand.id,
          isPublished: true,
        },
      });
      const sku = await prisma.sku.create({
        data: {
          productId: product.id,
          code: 'CERAVE-PM-52ML',
          variantName: 'Default',
          size: 52,
          sizeUnit: 'ml',
          barcode: '3337875597200', // Original manufacturer barcode
          isActive: true,
        },
      });

      // Approved manufacturer packaging revision barcode alias (GLO-242)
      await prisma.skuBarcodeAlias.create({
        data: {
          barcode: '3337875597299', // New packaging barcode
          skuId: sku.id,
          status: 'approved',
          source: 'packaging_revision',
          reason: '2026 packaging update',
          approvedBy: admin.id,
        },
      });

      // Supplier uploads product with new packaging revision barcode
      const match = await identityService.classifyCandidateMatch({
        supplierId: supplier1Id,
        supplierSkuCode: 'SUP-CERAVE-PM-REVISION',
        name: 'PM Facial Moisturizing Lotion 52ml',
        brand: 'SG04 Brand CeraVe',
        barcode: '3337875597299',
        size: 52,
        sizeUnit: 'ml',
      });

      expect(match.classification).toBe(MatchClassification.EXACT_MATCH);
      expect(match.matchedSkuId).toBe(sku.id);
      expect(match.reason).toBe('barcode_alias_exact_match');
    });
  });
});

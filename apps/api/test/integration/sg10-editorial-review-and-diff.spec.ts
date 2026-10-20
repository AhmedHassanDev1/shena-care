import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { IngestionService } from '../../src/modules/ingestion/services/ingestion.service';
import { BrandEnrichmentService } from '../../src/modules/ingestion/services/brand-enrichment.service';
import { CatalogService, BrandService } from '../../src/modules/catalog/public';
import { StorageService } from '../../src/platform/storage/storage.service';
import { createActor, Actor } from '../fixtures/actors';
import { randomUUID } from 'crypto';
import { IngestionStatus, IngestionPriceType } from '@prisma/client';

describe('SG-10: Dependency-Aware Candidate Review, Final Dedup & Authorized Publication (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ingestionService: IngestionService;
  let brandEnrichmentService: BrandEnrichmentService;
  let catalogService: CatalogService;
  let brandService: BrandService;
  let storageService: StorageService;

  let admin: Actor;
  let hubOperator: Actor;
  let supplierUser: Actor;

  const supplierAId = randomUUID();
  const supplierBId = randomUUID();
  const jobAId = randomUUID();
  const jobBId = randomUUID();

  const createdCandidateIds: string[] = [];
  const createdBrandSlugs: string[] = [];
  const createdSkuCodes: string[] = [];

  const validPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = app.get(PrismaService);
    ingestionService = app.get(IngestionService);
    brandEnrichmentService = app.get(BrandEnrichmentService);
    catalogService = app.get(CatalogService);
    brandService = app.get(BrandService);
    storageService = app.get(StorageService);

    admin = await createActor(prisma, 'ADMIN');
    hubOperator = await createActor(prisma, 'HUB_OPERATOR');
    supplierUser = await createActor(prisma, 'SUPPLIER');

    // Create two test suppliers and jobs for deduplication verification
    await prisma.supplier.create({
      data: {
        id: supplierAId,
        name: `Supplier A ${Date.now()}`,
        slug: `supplier-a-${Date.now()}`,
      },
    });

    await prisma.supplier.create({
      data: {
        id: supplierBId,
        name: `Supplier B ${Date.now()}`,
        slug: `supplier-b-${Date.now()}`,
      },
    });

    await prisma.ingestionJob.create({
      data: {
        id: jobAId,
        supplierId: supplierAId,
        status: 'pending',
      },
    });

    await prisma.ingestionJob.create({
      data: {
        id: jobBId,
        supplierId: supplierBId,
        status: 'pending',
      },
    });
  });

  afterAll(async () => {
    if (createdCandidateIds.length > 0) {
      await prisma.productContentDraft.deleteMany({ where: { candidateId: { in: createdCandidateIds } } });
      await prisma.ingestionItem.deleteMany({ where: { id: { in: createdCandidateIds } } });
    }
    await prisma.supplierOffer.deleteMany({ where: { supplierId: { in: [supplierAId, supplierBId] } } });
    await prisma.supplierSkuAlias.deleteMany({ where: { supplierId: { in: [supplierAId, supplierBId] } } });
    await prisma.ingestionJob.deleteMany({ where: { id: { in: [jobAId, jobBId] } } });
    await prisma.supplier.deleteMany({ where: { id: { in: [supplierAId, supplierBId] } } });

    for (const code of createdSkuCodes) {
      const sku = await prisma.sku.findUnique({ where: { code } });
      if (sku) {
        await prisma.supplierOffer.deleteMany({ where: { skuId: sku.id } });
        await prisma.supplierSkuAlias.deleteMany({ where: { skuId: sku.id } });
        await prisma.sku.delete({ where: { id: sku.id } });
      }
    }

    for (const slug of createdBrandSlugs) {
      const b = await prisma.brand.findUnique({ where: { slug } });
      if (b) {
        const prods = await prisma.product.findMany({ where: { brandId: b.id }, select: { id: true } });
        const prodIds = prods.map(p => p.id);
        if (prodIds.length > 0) {
          const skus = await prisma.sku.findMany({ where: { productId: { in: prodIds } }, select: { id: true } });
          const skuIds = skus.map(s => s.id);
          if (skuIds.length > 0) {
            await prisma.supplierOffer.deleteMany({ where: { skuId: { in: skuIds } } });
            await prisma.supplierSkuAlias.deleteMany({ where: { skuId: { in: skuIds } } });
            await prisma.sku.deleteMany({ where: { id: { in: skuIds } } });
          }
          await prisma.productMedia.deleteMany({ where: { productId: { in: prodIds } } });
          await prisma.product.deleteMany({ where: { id: { in: prodIds } } });
        }
        await prisma.productLine.deleteMany({ where: { brandId: b.id } });
        await prisma.brand.deleteMany({ where: { id: b.id } });
      }
      await prisma.productLineDraft.deleteMany({ where: { brandDraft: { slug } } });
      await prisma.brandDraft.deleteMany({ where: { slug } });
    }

    if (app) await app.close();
  });

  async function createVerifiedPackshot(
    supplierId: string,
    candidateId: string,
    barcode: string,
    size = 236,
    sizeUnit = 'ml',
  ) {
    const filename = `packshot-${Date.now()}.png`;
    const packshotUrl = await storageService.uploadFile(
      {
        buffer: validPng,
        originalname: filename,
        mimetype: 'image/png',
      } as Express.Multer.File,
      true,
      'candidates',
      supplierId,
    );

    return {
      url: packshotUrl,
      type: 'image',
      originType: 'verified',
      review: {
        candidateId,
        barcode,
        sourceUrl: 'https://www.cerave.com/packshot.png',
        sourceType: 'OFFICIAL_MANUFACTURER' as const,
        variantName: `${size}${sizeUnit}`,
        size,
        sizeUnit,
        reviewedBy: admin.id,
        reviewedAt: new Date().toISOString(),
        isTest: false,
      },
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  describe('1. Acceptance 1: Two Suppliers Submitting Same New Product (Final Dedup)', () => {
    it('creates exactly ONE Product and ONE Sku, but links TWO distinct supplier offers', async () => {
      const sharedBarcode = `333787${Date.now().toString().slice(-7)}`;
      const brandName = `BrandDedup${Date.now()}`;
      const brandSlug = brandName.toLowerCase();
      createdBrandSlugs.push(brandSlug);

      // Create Brand in advance so draft doesn't block
      await brandService.createBrand({ name: brandName });

      // 1. Supplier A Candidate
      const candidateAId = randomUUID();
      createdCandidateIds.push(candidateAId);
      const packshotA = await createVerifiedPackshot(supplierAId, candidateAId, sharedBarcode);

      await prisma.ingestionItem.create({
        data: {
          id: candidateAId,
          jobId: jobAId,
          supplierSkuCode: `SUP-A-SKU-${candidateAId.slice(0, 6)}`,
          name: `${brandName} Hydrating Cleanser 236ml`,
          brand: brandName,
          barcode: sharedBarcode,
          price: 12.0,
          priceType: IngestionPriceType.PURCHASE_COST,
          currency: 'USD',
          status: IngestionStatus.approved,
          enrichment: {
            media: [packshotA],
            research: {
              fieldEvidences: [
                {
                  fieldName: 'size',
                  sourceUrl: 'https://www.cerave.com/packshot.png',
                  verificationStatus: 'SUPPORTED',
                  proposedValue: { value: 236, unit: 'ml' },
                },
              ],
            },
          },
        },
      });

      // 2. Supplier B Candidate (different title casing / language representation, same barcode)
      const candidateBId = randomUUID();
      createdCandidateIds.push(candidateBId);
      const packshotB = await createVerifiedPackshot(supplierBId, candidateBId, sharedBarcode);

      await prisma.ingestionItem.create({
        data: {
          id: candidateBId,
          jobId: jobBId,
          supplierSkuCode: `SUP-B-SKU-${candidateBId.slice(0, 6)}`,
          name: `${brandName} Nettoyant Hydratant 236ml`,
          brand: brandName,
          barcode: sharedBarcode,
          price: 11.5,
          priceType: IngestionPriceType.PURCHASE_COST,
          currency: 'USD',
          status: IngestionStatus.approved,
          enrichment: {
            media: [packshotB],
            research: {
              fieldEvidences: [
                {
                  fieldName: 'size',
                  sourceUrl: 'https://www.cerave.com/packshot.png',
                  verificationStatus: 'SUPPORTED',
                  proposedValue: { value: 236, unit: 'ml' },
                },
              ],
            },
          },
        },
      });

      // Publish Candidate A as Admin
      const publishResA = await ingestionService.publishCandidate(candidateAId, admin.id);
      expect(publishResA.status).toBe(IngestionStatus.published);
      expect(publishResA.matchedSkuId).toBeDefined();
      const skuAId = publishResA.matchedSkuId as string;

      // Publish Candidate B as Admin
      const publishResB = await ingestionService.publishCandidate(candidateBId, admin.id);
      expect(publishResB.status).toBe(IngestionStatus.published);
      expect(publishResB.matchedSkuId).toBe(skuAId); // Dedup converged onto the EXACT SAME SKU

      // Verify Database: Exactly 1 SKU with sharedBarcode
      const skus = await prisma.sku.findMany({ where: { barcode: sharedBarcode } });
      expect(skus).toHaveLength(1);
      const sharedSku = skus[0];
      createdSkuCodes.push(sharedSku.code);

      // Verify Database: Exactly 1 canonical Product
      const product = await prisma.product.findUnique({ where: { id: sharedSku.productId } });
      expect(product).toBeDefined();

      // Verify Database: TWO distinct supplier offers linked to this single SKU
      const offers = await prisma.supplierOffer.findMany({
        where: { skuId: sharedSku.id },
      });
      expect(offers).toHaveLength(2);

      const offerA = offers.find(o => o.supplierId === supplierAId);
      const offerB = offers.find(o => o.supplierId === supplierBId);

      expect(offerA).toBeDefined();
      expect(offerA!.costPrice.toNumber()).toBe(12.0);
      expect(offerB).toBeDefined();
      expect(offerB!.costPrice.toNumber()).toBe(11.5);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('2. Acceptance 2 & 3: Mandatory Identity & Packshot Gating', () => {
    it('blocks publication when barcode is missing', async () => {
      const candidateId = randomUUID();
      createdCandidateIds.push(candidateId);
      const packshot = await createVerifiedPackshot(supplierAId, candidateId, 'ANY');

      await prisma.ingestionItem.create({
        data: {
          id: candidateId,
          jobId: jobAId,
          supplierSkuCode: `NO-BARCODE-${candidateId.slice(0, 6)}`,
          name: 'Mystery Product Without Barcode 100ml',
          brand: 'GenericBrand',
          barcode: null,
          price: 20.0,
          priceType: IngestionPriceType.PURCHASE_COST,
          currency: 'USD',
          status: IngestionStatus.approved,
          enrichment: {
            media: [packshot],
          },
        },
      });

      await expect(ingestionService.publishCandidate(candidateId, admin.id)).rejects.toThrow(
        /Missing mandatory barcode identity prevents catalog publication/,
      );
    });

    it('blocks publication when verified packshot is missing', async () => {
      const candidateId = randomUUID();
      createdCandidateIds.push(candidateId);
      const barcode = `BARCODE-${Date.now()}`;

      await prisma.ingestionItem.create({
        data: {
          id: candidateId,
          jobId: jobAId,
          supplierSkuCode: `NO-IMG-${candidateId.slice(0, 6)}`,
          name: 'Product Without Packshot 100ml',
          brand: 'CeraVe',
          barcode,
          price: 20.0,
          priceType: IngestionPriceType.PURCHASE_COST,
          currency: 'USD',
          status: IngestionStatus.approved,
          enrichment: {
            media: [], // Zero media
          },
        },
      });

      await expect(ingestionService.publishCandidate(candidateId, admin.id)).rejects.toThrow(
        /Missing mandatory verified packshot prevents catalog publication/,
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('3. Acceptance 4: Unapproved Brand Draft Gate', () => {
    it('blocks publication if brand is pending draft review, and allows publish once brand draft is approved', async () => {
      const brandName = `UnapprovedBrand-${Date.now()}`;
      const brandSlug = brandName.toLowerCase();
      createdBrandSlugs.push(brandSlug);

      // Create a BrandDraft in PENDING_REVIEW status
      const brandDraft = await prisma.brandDraft.create({
        data: {
          name: brandName,
          canonicalName: brandName,
          slug: brandSlug,
          status: 'PENDING_REVIEW',
        },
      });

      const candidateId = randomUUID();
      createdCandidateIds.push(candidateId);
      const barcode = `BRAND-DRAFT-${Date.now()}`;
      const packshot = await createVerifiedPackshot(supplierAId, candidateId, barcode, 50, 'ml');

      await prisma.ingestionItem.create({
        data: {
          id: candidateId,
          jobId: jobAId,
          supplierSkuCode: `BRAND-DRAFT-SKU-${candidateId.slice(0, 6)}`,
          name: `${brandName} Miracle Cream 50ml`,
          brand: brandName,
          barcode,
          price: 35.0,
          priceType: IngestionPriceType.PURCHASE_COST,
          currency: 'USD',
          status: IngestionStatus.approved,
          enrichment: {
            media: [packshot],
            research: {
              fieldEvidences: [
                {
                  fieldName: 'size',
                  sourceUrl: 'https://www.cerave.com/packshot.png',
                  verificationStatus: 'SUPPORTED',
                  proposedValue: { value: 50, unit: 'ml' },
                },
              ],
            },
          },
        },
      });

      // 1. Should be blocked while BrandDraft is PENDING_REVIEW
      await expect(ingestionService.publishCandidate(candidateId, admin.id)).rejects.toThrow(
        /Brand draft must be approved by Administrator before candidate publication/,
      );

      // 2. Admin approves the BrandDraft
      await brandEnrichmentService.approveBrandDraft(brandDraft.id, admin.id);

      // 3. Candidate publication now succeeds
      const published = await ingestionService.publishCandidate(candidateId, admin.id);
      expect(published.status).toBe(IngestionStatus.published);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('4. Acceptance 5: Rejection Persists With Audit Trail', () => {
    it('persists rejection reason and audit entry, and blocks subsequent publication', async () => {
      const candidateId = randomUUID();
      createdCandidateIds.push(candidateId);
      const barcode = `REJECT-${Date.now()}`;

      await prisma.ingestionItem.create({
        data: {
          id: candidateId,
          jobId: jobAId,
          supplierSkuCode: `REJECT-SKU-${candidateId.slice(0, 6)}`,
          name: 'Counterfeit Suspect Cleanser 200ml',
          brand: 'CeraVe',
          barcode,
          price: 5.0,
          priceType: IngestionPriceType.PURCHASE_COST,
          currency: 'USD',
          status: IngestionStatus.review_required,
        },
      });

      // Reject candidate
      await ingestionService.rejectItem(candidateId, 'Counterfeit packaging detected', admin.id);

      const rejectedItem = await prisma.ingestionItem.findUnique({ where: { id: candidateId } });
      expect(rejectedItem!.status).toBe(IngestionStatus.rejected);
      expect((rejectedItem!.enrichment as any)?.rejectionReason).toBe('Counterfeit packaging detected');
      expect((rejectedItem!.enrichment as any)?.auditTrail?.some((a: any) => a.action === 'REJECTED')).toBe(true);

      // Attempt to publish rejected item fails
      await expect(ingestionService.publishCandidate(candidateId, admin.id)).rejects.toThrow(
        /Candidate item is not approved for publication yet/,
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('5. Acceptance 6: RBAC Publication Security Defect Fix', () => {
    it('denies Hub Operator from publishing candidate with 403 Forbidden', async () => {
      const candidateId = randomUUID();
      createdCandidateIds.push(candidateId);

      await prisma.ingestionItem.create({
        data: {
          id: candidateId,
          jobId: jobAId,
          supplierSkuCode: `RBAC-${candidateId.slice(0, 6)}`,
          name: 'RBAC Test Cleanser 200ml',
          brand: 'CeraVe',
          barcode: `RBAC-${Date.now()}`,
          price: 25.0,
          priceType: IngestionPriceType.PURCHASE_COST,
          currency: 'USD',
          status: IngestionStatus.approved,
        },
      });

      // Hub Operator tries to publish candidate → 403 Forbidden
      const res = await request(app.getHttpServer())
        .post(`/ingestion/candidates/${candidateId}/publish`)
        .set(hubOperator.auth)
        .send();

      expect(res.status).toBe(403);
    });

    it('denies Hub Operator from publishing job with 403 Forbidden', async () => {
      const res = await request(app.getHttpServer())
        .post(`/ingestion/jobs/${jobAId}/publish`)
        .set(hubOperator.auth)
        .send();

      expect(res.status).toBe(403);
    });

    it('allows Hub Operator to access review record and perform editorial corrections', async () => {
      const candidateId = randomUUID();
      createdCandidateIds.push(candidateId);

      await prisma.ingestionItem.create({
        data: {
          id: candidateId,
          jobId: jobAId,
          supplierSkuCode: `REV-${candidateId.slice(0, 6)}`,
          name: 'Original Cleanser 150ml',
          brand: 'CeraVe',
          barcode: `REV-${Date.now()}`,
          price: 20.0,
          priceType: IngestionPriceType.PURCHASE_COST,
          currency: 'USD',
          status: IngestionStatus.review_required,
        },
      });

      // Hub Operator reads review record
      const getRes = await request(app.getHttpServer())
        .get(`/ingestion/candidates/${candidateId}/review-record`)
        .set(hubOperator.auth);

      expect(getRes.status).toBe(200);
      expect(getRes.body.candidateId).toBe(candidateId);
      expect(getRes.body.normalizedIdentity.name).toBe('Original Cleanser 150ml');

      // Hub Operator submits field-level correction
      const patchRes = await request(app.getHttpServer())
        .patch(`/ingestion/candidates/${candidateId}/correct`)
        .set(hubOperator.auth)
        .send({
          name: 'Corrected Cleanser 200ml',
          category: 'CLEANSER',
          reason: 'Corrected volume mismatch',
        });

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.normalizedIdentity.name).toBe('Corrected Cleanser 200ml');
      expect(patchRes.body.auditTrail.some((a: any) => a.action === 'CORRECTED')).toBe(true);
    });

    it('denies Hub Operator and Supplier from approving or rejecting candidates with 403 Forbidden', async () => {
      const candidateId = randomUUID();
      createdCandidateIds.push(candidateId);

      await prisma.ingestionItem.create({
        data: {
          id: candidateId,
          jobId: jobAId,
          supplierSkuCode: `RBAC2-${candidateId.slice(0, 6)}`,
          name: 'RBAC Gate Test Lotion 100ml',
          brand: 'CeraVe',
          barcode: `RBAC2-${Date.now()}`,
          price: 18.0,
          priceType: IngestionPriceType.PURCHASE_COST,
          currency: 'USD',
          status: IngestionStatus.review_required,
        },
      });

      // 1. Hub Operator cannot approve candidate (403)
      const hubApproveRes = await request(app.getHttpServer())
        .patch(`/ingestion/candidates/${candidateId}/approve`)
        .set(hubOperator.auth)
        .send();
      expect(hubApproveRes.status).toBe(403);

      // 2. Hub Operator cannot reject candidate (403)
      const hubRejectRes = await request(app.getHttpServer())
        .patch(`/ingestion/candidates/${candidateId}/reject`)
        .set(hubOperator.auth)
        .send({ reason: 'Hub staff attempt' });
      expect(hubRejectRes.status).toBe(403);

      // 3. Supplier cannot approve candidate (403)
      const supApproveRes = await request(app.getHttpServer())
        .patch(`/ingestion/candidates/${candidateId}/approve`)
        .set(supplierUser.auth)
        .send();
      expect(supApproveRes.status).toBe(403);

      // 4. Supplier cannot publish candidate (403)
      const supPublishRes = await request(app.getHttpServer())
        .post(`/ingestion/candidates/${candidateId}/publish`)
        .set(supplierUser.auth)
        .send();
      expect(supPublishRes.status).toBe(403);
    });

    it('preserves candidate state and recovers safely from publication failure without duplicate records', async () => {
      const candidateId = randomUUID();
      createdCandidateIds.push(candidateId);
      const barcode = `RECOV-${Date.now()}`;
      const brandName = `BrandRecov${Date.now()}`;
      createdBrandSlugs.push(brandName.toLowerCase());
      await brandService.createBrand({ name: brandName });

      await prisma.ingestionItem.create({
        data: {
          id: candidateId,
          jobId: jobAId,
          supplierSkuCode: `RECOV-${candidateId.slice(0, 6)}`,
          name: `${brandName} Recovery Test Cream 100ml`,
          brand: brandName,
          barcode,
          price: 22.0,
          priceType: IngestionPriceType.PURCHASE_COST,
          currency: 'USD',
          status: IngestionStatus.approved,
        },
      });

      // Attempt publish without verified packshot -> fails safely with 400
      await expect(ingestionService.publishCandidate(candidateId, admin.id)).rejects.toThrow(
        /Missing mandatory verified packshot prevents catalog publication/,
      );

      // Verify candidate is still approved and not corrupted
      const itemBefore = await prisma.ingestionItem.findUnique({ where: { id: candidateId } });
      expect(itemBefore!.status).toBe(IngestionStatus.approved);

      // Verify no SKU created
      const skuBefore = await prisma.sku.findFirst({ where: { barcode } });
      expect(skuBefore).toBeNull();

      // Now add verified packshot using helper
      const packshot = await createVerifiedPackshot(supplierAId, candidateId, barcode, 100, 'ml');

      await prisma.ingestionItem.update({
        where: { id: candidateId },
        data: {
          enrichment: { media: [packshot] },
        },
      });

      // Retry publication -> succeeds!
      const publishRes = await ingestionService.publishCandidate(candidateId, admin.id);
      expect(publishRes.status).toBe(IngestionStatus.published);

      // Verify canonical SKU and SupplierOffer created exactly once
      const skuAfter = await prisma.sku.findFirst({ where: { barcode } });
      expect(skuAfter).not.toBeNull();
      createdSkuCodes.push(skuAfter!.code);

      const offer = await prisma.supplierOffer.findUnique({
        where: {
          supplierId_skuId: {
            supplierId: supplierAId,
            skuId: skuAfter!.id,
          },
        },
      });
      expect(offer).not.toBeNull();
      expect(offer!.costPrice.toNumber()).toBe(22.0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('6. Acceptance 7: Request More Info Editorial Flow', () => {
    it('sets review_required status and appends requested info to audit trail', async () => {
      const candidateId = randomUUID();
      createdCandidateIds.push(candidateId);

      await prisma.ingestionItem.create({
        data: {
          id: candidateId,
          jobId: jobAId,
          supplierSkuCode: `REQ-${candidateId.slice(0, 6)}`,
          name: 'Clarification Needed Cream 50ml',
          brand: 'CeraVe',
          barcode: `REQ-${Date.now()}`,
          price: 15.0,
          currency: 'USD',
          status: IngestionStatus.pending,
        },
      });

      const res = await request(app.getHttpServer())
        .post(`/ingestion/candidates/${candidateId}/request-more`)
        .set(admin.auth)
        .send({
          requestedInfo: 'Please provide certificate of analysis for active batch',
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe(IngestionStatus.review_required);
      expect(res.body.auditTrail.some((a: any) => a.action === 'REQUESTED_MORE_INFO')).toBe(true);
      expect(res.body.auditTrail.find((a: any) => a.action === 'REQUESTED_MORE_INFO')?.requestedInfo).toContain('certificate of analysis');
    });
  });
});

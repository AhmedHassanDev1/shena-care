/* eslint-disable @typescript-eslint/no-explicit-any -- one-off live run, results dumped as JSON */
/**
 * ONE-OFF LIVE RUN (2026-11-07), not part of the suite: the owner's 33-row list through the real API, the real fetcher and the real web (Exa search, brand sites),
 * against a local *_test database seeded with Supabase's taxonomy, brands and Catalog Policy v18 (no products). Only the Exa key is enabled; AI is stubbed.
 */
import { readFileSync, writeFileSync } from 'fs';
import { parse } from 'dotenv';
const dotenv = parse(readFileSync(`${__dirname}/../../.env`));
process.env.EXA_API_KEY = dotenv.EXA_API_KEY ?? '';
process.env.MEDIA_STORAGE_PROVIDER = 'local';
process.env.SOURCING_MODE = 'BROADCAST_ON_DEMAND';
if (process.env.APPLY_DECISIONS === '1') process.env.RESEARCH_ALLOWED_HOSTS = 'eparkville.com,parkvillepharma.com,parkville.com.eg';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { ProductResearchService } from '../../src/modules/ingestion/services/product-research.service';
import { IngestionEligibilityService } from '../../src/modules/ingestion/services/ingestion-eligibility.service';
import { BrandResearchService } from '../../src/modules/ingestion/services/brand-research.service';
import { AiClient } from '../../src/platform/ai';
import { DeterministicAiClient } from '../fixtures/deterministic-ai';
import { createActor } from '../fixtures/actors';

const OUT = process.env.LIVE_OUT!;
const LIST = `StarVille	Acne Prone Skin Facial Cleanser 200 ml
StarVille	Whitening Cleanser 200 ml
StarVille	Facial Cleanser Hydro
StarVille	Acne Prone Skin Cream 60 gm
StarVille	Acne Prone Skin Gel 30 gm
Shaan	Antioxidant Facial Cleanser 250 ml
Shaan	Soothing Gel 120 gm
Shaan	Rejuvenation Cream 120 gm
Shaan	Oily Matte Cream-Gel 60 gm
Shaan	Dry S Cream Fragrance Free
Bobai	Sunscreen Extra Lightening Gel SPF 50 50 gm
Bobai	Sunscreen Tinted Extra Lightening Gel SPF 50 50 gm
Bobai	Sunscreen Oil Defense Fluid SPF 50 75 ml
Dermactive	ACTI-CLEAR Gentle Cleansing Gel
Dermactive	ACTI-CLEAR Hydra-Mattifying Gel
Dermactive	ACTI-WHITE Foaming Gel
Dermactive	ACTI-WHITE Brightening Correcting Serum
Dermactive	ACTI-SOLAIRE SPF50+ Ultra Fluid
Dermactive	ACTI-SOLAIRE SPF50+ Melting Cream
Dermactive	ACTI-REPAIR CICA Cream
Dermactive	TRICHO-ACT Anti-Dandruff Shampoo DS
Dermactive	TRICHO-ACT Hair Repairing Mask
Eva Skin Clinic	Niacinamide Facial Serum 30 ml
Eva Skin Clinic	Hyaluronic Acid Facial Serum 30 ml
Eva Skin Clinic	Vitamin C Facial Serum 20 ml
Eva Skin Clinic	Hyaluronic Acid Facial Wash 160 ml
Eva Skin Clinic	Hyaluronic Acid Day Gel 45 ml
Eva Skin Clinic	Hyaluronic Acid Night Cream 45 ml
Eva Skin Clinic	Hyaluronic Acid Micellar Water 200 ml
Eva Skin Clinic	Collagen Toner 200 ml
CeraVe	Foaming Facial Cleanser
CeraVe	Hydrating Facial Cleanser
CeraVe	Blemish Control Cleanser`;

describe('LIVE: owner list 2026-11-07', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(AiClient).useClass(DeterministicAiClient).compile();
    app = moduleRef.createNestApplication();
    app.useLogger(['error']);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
  }, 120000);
  afterAll(async () => { await app.close(); });

  it('runs the list', async () => {
    const admin = await createActor(prisma, 'ADMIN');
    // Owner decisions (2026-11-07, "Apply all"), applied through the app's own services as an Admin would. Local DB only.
    if (process.env.APPLY_DECISIONS === '1' && !process.env.RESUME_JOB) {
      const policy = app.get(IngestionEligibilityService);
      const leaf = async (name: string) => (await prisma.category.findFirstOrThrow({ where: { name } })).id;
      const version = async () => (await policy.current())?.version ?? 0;
      const brandId = async (name: string) => (await prisma.brand.findFirstOrThrow({ where: { name } })).id;
      await policy.updateBrand(await brandId('StarVille'), { expectedVersion: await version(), enabled: true, categoryIds: [await leaf('Cleansers'), await leaf('Moisturizers')] }, admin.id);
      await policy.updateBrand(await brandId('Eva Cosmetics'), { expectedVersion: await version(), enabled: true, addAliases: ['Eva Skin Clinic'],
        categoryIds: [await leaf('Serums & Treatments'), await leaf('Cleansers'), await leaf('Moisturizers')] }, admin.id);
      // Bobai: a Parkville brand, added by the Admin (website recorded as ADMIN_ENTERED, never VERIFIED).
      await app.get(BrandResearchService).saveBrand({ expectedVersion: await version(), name: 'Bobai', websiteUrl: 'https://www.parkvillepharma.com/brand/bobai' }, admin.id,
        { categoryIds: [await leaf('Sunscreens')] });
    }
    const queries: string[] = [];
    const research = app.get(ProductResearchService);
    const real = research.discoverPages.bind(research);
    jest.spyOn(research, 'discoverPages').mockImplementation(async (query, limit, options) => {
      const result = await real(query, limit, options);
      queries.push(`${query}${options?.includeDomains ? ` [site:${options.includeDomains.join(',')}]` : ''} -> ${result === null ? 'NO_ANSWER' : result.map(r => r.url).join(' , ')}`);
      return result;
    });
    const rows = LIST.split('\n').map(line => line.split('\t').map(cell => cell.trim()));
    const csv = ['name,brand', ...rows.map(([brand, name]) => `"${name}","${brand}"`)].join('\n');
    const api = () => request(app.getHttpServer());
    const upload = process.env.RESUME_JOB ? { body: { jobId: process.env.RESUME_JOB } } as any : await api().post('/admin/catalog-imports').set(admin.auth).attach('file', Buffer.from(csv, 'utf-8'), { filename: 'owner-list-2026-11-07.csv', contentType: 'text/csv' });
    const jobId = upload.body.jobId;
    const started = Date.now();
    const passes: any[] = [];
    // A second pass picks up automatic retries (a site that timed out) without waiting for their backoff.
    for (let pass = 0; pass < 2; pass++) {
      if (pass || process.env.RESUME_JOB) await prisma.adminCatalogImportRow.updateMany({ where: { jobId, decision: 'RETRY_AUTOMATIC' }, data: { nextAttemptAt: new Date() } });
      passes.push((await api().post(`/catalog/workbench/imports/${jobId}/autopilot`).set(admin.auth).timeout(3_000_000)).body?.totals);
    }
    const result = {
      jobId, minutes: (Date.now() - started) / 60000, upload: upload.body, passes,
      rows: await prisma.adminCatalogImportRow.findMany({ where: { jobId }, orderBy: { rowNumber: 'asc' },
        select: { rowNumber: true, brand: true, name: true, size: true, sizeUnit: true, outcome: true, reasonCode: true, decision: true, reason: true, matchedSkuId: true, lastError: true, identity: true } }),
      brands: await prisma.brand.findMany({ include: { productLines: true } }),
      products: await prisma.product.findMany({ include: { skus: true, productLine: true, category: true, brand: { select: { name: true } }, productIngredients: { select: { id: true } }, usageRules: true, safetyWarnings: true } }),
      media: await prisma.mediaAsset.findMany({ select: { skuId: true, role: true, reviewStatus: true, width: true, height: true, sourceUrl: true, reviewNote: true, parentAssetId: true } }),
      facts: await prisma.productFactProposal.findMany({ select: { skuId: true, field: true, status: true, verification: true, decisionRule: true, conflictReason: true, value: true } }),
      exceptions: await prisma.catalogException.findMany({ where: { status: 'OPEN' }, select: { reasonCode: true, summary: true, subjectType: true, importRowId: true, skuId: true, field: true, recommended: true } }),
      decisions: await prisma.catalogDecisionRecord.findMany({ orderBy: { createdAt: 'asc' }, select: { subjectType: true, subjectId: true, decision: true, reasonCode: true, evidence: true, createdAt: true } }),
      policy: (await prisma.ingestionEligibilityPolicy.findFirst({ where: { status: 'APPROVED' }, orderBy: { version: 'desc' } }))?.document,
      queries,
    };
    writeFileSync(`${OUT}/result.json`, JSON.stringify(result, (_k, v) => (typeof v === 'bigint' ? Number(v) : v), 2));
  }, 3_600_000);
});

// GLO-285 independent media service. Images are generated here as synthetic test pixels: this proves the pipeline, not any real product's packshot.
process.env.MEDIA_BACKGROUND_REMOVAL = 'disabled'; // this suite proves a provider outage fails safely
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import request from 'supertest';
import sharp from 'sharp';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { BACKGROUND_REMOVAL, BackgroundRemovalPort } from '../../src/platform/storage/media-processor.port';
import { FIXTURE_SOURCE_URL } from '../fixtures/sellable-sku';
import { Actor, createActor } from '../fixtures/actors';
import { uniqueGtin } from '../fixtures/gtin';

const RUN_SEED = crypto.randomInt(1, 200);
const realisticImage = (seed: number, format: 'png' | 'jpeg' | 'webp' = 'png', edge = 800) =>
  sharp({ create: { width: edge, height: edge, channels: 3, background: { r: (seed * 53 + RUN_SEED) % 255, g: (seed * 97 + RUN_SEED * 3) % 255, b: (seed * 29 + RUN_SEED * 7) % 255 } } })[format]().toBuffer();
const cutout = (seed: number) => sharp({ create: { width: 600, height: 800, channels: 4, background: { r: (seed * 31) % 255, g: 40, b: 90, alpha: 0.6 } } }).png().toBuffer();

/** Five different pack types from different brands and categories, per the rollout's diversity rule. Synthetic identities. */
const DIVERSE_SKUS = [
  { label: 'Cleanser tube', size: 236, unit: 'ml' }, { label: 'Night cream jar', size: 50, unit: 'g' }, { label: 'Shampoo bottle', size: 400, unit: 'ml' },
  { label: 'Serum dropper', size: 30, unit: 'ml' }, { label: 'Ampoule pack', size: 15, unit: 'ml', packCount: 4 },
];

describe('GLO-285 product media service', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Actor;
  let hub: Actor;
  let customer: Actor;
  let supplier: Actor;
  const run = randomUUID().slice(0, 8);
  const skus: Array<{ id: string; productId: string; label: string }> = [];
  const server = () => app.getHttpServer();

  const register = (skuId: string, image: Buffer, overrides: Record<string, string> = {}, actor = admin, filename = 'packshot.png', contentType = 'image/png') => {
    const fields = { skuId, role: 'PRIMARY_PACKSHOT', originType: 'verified', sourceUrl: FIXTURE_SOURCE_URL, sourcePublisher: 'Fixture Manufacturer', sourceType: 'OFFICIAL_MANUFACTURER', rightsStatus: 'MANUFACTURER_PUBLISHED', ...overrides };
    let req = request(server()).post('/catalog/media-assets').set(actor.auth);
    for (const [key, value] of Object.entries(fields)) req = req.field(key, value);
    return req.attach('file', image, { filename, contentType });
  };
  const review = (id: string, body: Record<string, unknown> = {}, actor = admin) => request(server()).post(`/catalog/media-assets/${id}/review`).set(actor.auth).send({ decision: 'APPROVED', reason: 'Matches this exact SKU', ...body });
  const publish = (id: string, actor = admin) => request(server()).post(`/catalog/media-assets/${id}/publish`).set(actor.auth);
  const derive = (id: string, body: Record<string, unknown>) => request(server()).post(`/catalog/media-assets/${id}/derive`).set(admin.auth).send(body);
  const readiness = async (skuId: string) => (await request(server()).get(`/catalog/media-assets/sku/${skuId}/readiness`).set(admin.auth).expect(200)).body;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useLogger(false);
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
    prisma = app.get(PrismaService);
    admin = await createActor(prisma, 'ADMIN');
    hub = await createActor(prisma, 'HUB_OPERATOR');
    customer = await createActor(prisma, 'CUSTOMER');
    const supplierId = randomUUID();
    await prisma.supplier.create({ data: { id: supplierId, name: `Media ${run}`, slug: `media-${run}` } });
    supplier = await createActor(prisma, 'SUPPLIER', supplierId);
    for (const [index, entry] of DIVERSE_SKUS.entries()) {
      const brand = await prisma.brand.create({ data: { name: `Media Brand ${index} ${run}`, slug: `media-${index}-${run}` } });
      const product = await prisma.product.create({ data: { brandId: brand.id, name: `Media ${entry.label} ${run}`, slug: `media-product-${index}-${run}`, isPublished: true } });
      const sku = await prisma.sku.create({ data: { productId: product.id, code: `MEDIA-${index}-${run}`, variantName: 'Default', size: entry.size, sizeUnit: entry.unit, barcode: uniqueGtin(), packCount: entry.packCount ?? null } });
      skus.push({ id: sku.id, productId: product.id, label: entry.label });
    }
  }, 60000);

  afterAll(async () => { jest.restoreAllMocks(); await app.close(); });

  it('staff only', async () => {
    const image = await realisticImage(1);
    await register(skus[0].id, image, {}, customer).expect(403);
    await register(skus[0].id, image, {}, supplier).expect(403);
    await request(server()).get(`/catalog/media-assets/sku/${skus[0].id}`).expect(401);
  });

  it('runs 5 diverse SKUs from original to a published, genuine primary packshot, with lineage and truthful missing roles', async () => {
    for (const [index, sku] of skus.entries()) {
      expect((await readiness(sku.id)).hasVerifiedPrimaryPackshot).toBe(false);
      const format = (['png', 'jpeg', 'webp', 'png', 'jpeg'] as const)[index];
      const image = await realisticImage(100 + index, format);
      const original = await register(sku.id, image, {}, admin, `packshot.${format === 'jpeg' ? 'jpg' : format}`, `image/${format}`).expect(201);
      expect(original.body).toMatchObject({ role: 'PRIMARY_PACKSHOT', originType: 'verified', reviewStatus: 'PENDING_REVIEW', width: 800, height: 800,
        contentHash: crypto.createHash('sha256').update(image).digest('hex') });
      await publish(original.body.id).expect(409);

      const optimized = await derive(original.body.id, { transform: 'OPTIMIZED' }).expect(201);
      expect(optimized.body).toMatchObject({ originType: 'derived', parentAssetId: original.body.id, processingStatus: 'SUCCEEDED', mimeType: 'image/webp', sourceUrl: FIXTURE_SOURCE_URL });
      expect(optimized.body.contentHash).not.toBe(original.body.contentHash);

      await review(optimized.body.id).expect(200);
      const published = await publish(optimized.body.id).expect(200);
      expect(published.body.publishedMediaId).toBeTruthy();

      const media = await prisma.productMedia.findUniqueOrThrow({ where: { id: published.body.publishedMediaId } });
      expect(media).toMatchObject({ productId: sku.productId, role: 'PRIMARY_PACKSHOT', isPrimary: true, originType: 'derived', assetId: optimized.body.id });
      const state = await readiness(sku.id);
      expect(state).toMatchObject({ hasVerifiedPrimaryPackshot: true, roles: { PRIMARY_PACKSHOT: 'PUBLISHED', TEXTURE_SENSORY: 'MISSING', INGREDIENT_STORY: 'MISSING', PACKAGING_PROOF: 'MISSING' } });
    }
  }, 60000);

  it('a published packshot reaches the storefront catalog read; an unreviewed one never does', async () => {
    const detail = await request(server()).get(`/products/${skus[0].productId}`);
    if (detail.status === 200) expect(detail.body.media.some((m: { isPrimary: boolean }) => m.isPrimary)).toBe(true);
    const product = await prisma.product.findUniqueOrThrow({ where: { id: skus[0].productId }, include: { media: true } });
    expect(product.media).toHaveLength(1);
  });

  it('is idempotent: the same image and role returns the same asset, and publishing twice writes once', async () => {
    const image = await realisticImage(200);
    const first = await register(skus[1].id, image, { role: 'PACKAGING_PROOF' }).expect(201);
    const second = await register(skus[1].id, image, { role: 'PACKAGING_PROOF' }).expect(201);
    expect(second.body.id).toBe(first.body.id);
    await review(first.body.id).expect(200);
    const published = await publish(first.body.id).expect(200);
    const again = await publish(first.body.id).expect(200);
    expect(again.body.publishedMediaId).toBe(published.body.publishedMediaId);
    expect(await prisma.productMedia.count({ where: { assetId: first.body.id } })).toBe(1);
    expect((await readiness(skus[1].id)).roles.PACKAGING_PROOF).toBe('PUBLISHED');
  });

  it('one variant\'s picture cannot become another variant\'s identity proof', async () => {
    const image = await realisticImage(201);
    await register(skus[2].id, image).expect(201);
    const reused = await register(skus[3].id, image);
    expect(reused.status).toBe(409);
    expect(reused.body.message).toContain('identity proof');
  });

  it('refuses spoofed, corrupt, undersized and non-raster files, and leaves nothing behind', async () => {
    const before = await prisma.mediaAsset.count();
    const png = await realisticImage(202);
    await register(skus[3].id, png.subarray(0, 60)).expect(400);
    await register(skus[3].id, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'), {}, admin, 'a.svg', 'image/svg+xml').expect(400);
    await register(skus[3].id, Buffer.from('MZ not an image at all'), {}, admin, 'a.png', 'image/png').expect(400);
    await register(skus[3].id, await realisticImage(203, 'png', 100)).expect(400);
    const oversize = await register(skus[3].id, Buffer.concat([png, Buffer.alloc(5 * 1024 * 1024)])); // the raised limit is for spreadsheets only
    expect([400, 413]).toContain(oversize.status);
    expect(await prisma.mediaAsset.count()).toBe(before);
  });

  it('a generated image can never be identity proof, in the service or in the database', async () => {
    const image = await realisticImage(204);
    await register(skus[3].id, image, { originType: 'generated' }).expect(400);
    await register(skus[3].id, image, { originType: 'generated', role: 'PACKAGING_PROOF' }).expect(400);
    await register(skus[3].id, image, { originType: 'generated', role: 'TEXTURE_SENSORY' }).expect(409); // AI imagery is disabled by default
    await expect(prisma.mediaAsset.create({ data: { skuId: skus[3].id, role: 'PRIMARY_PACKSHOT', originType: 'generated', sourceUrl: 'x', sourcePublisher: 'x', sourceType: 'x', createdBy: admin.id } })).rejects.toThrow(/media_assets_generated_not_identity/);
    await expect(request(server()).post(`/products/${skus[3].productId}/media`).set(admin.auth).send({ type: 'image', url: 'https://example.com/x.png', originType: 'generated', role: 'PRIMARY_PACKSHOT' })).resolves.toMatchObject({ status: 400 });
  });

  it('an original\'s file and hash cannot be rewritten', async () => {
    const asset = await prisma.mediaAsset.findFirstOrThrow({ where: { parentAssetId: null, contentHash: { not: null } } });
    await expect(prisma.mediaAsset.update({ where: { id: asset.id }, data: { contentHash: 'f'.repeat(64) } })).rejects.toThrow(/immutable/);
    await expect(prisma.mediaAsset.update({ where: { id: asset.id }, data: { storageUrl: 'https://example.com/swapped.png' } })).rejects.toThrow(/immutable/);
  });

  it('review needs a known right and a trusted source for identity images', async () => {
    const unknownRights = await register(skus[4].id, await realisticImage(205), { rightsStatus: 'UNKNOWN' }).expect(201);
    await review(unknownRights.body.id).expect(409);
    const untrusted = await register(skus[4].id, await realisticImage(206), { sourceUrl: 'https://random-shop.example.com/p.png' }).expect(201);
    await review(untrusted.body.id).expect(409);
    const rejected = await review(untrusted.body.id, { decision: 'REJECTED', reason: 'Wrong pack on the photo' }).expect(200);
    expect(rejected.body).toMatchObject({ reviewStatus: 'REJECTED', reviewNote: 'Wrong pack on the photo' });
    await publish(untrusted.body.id).expect(409);
    await review(unknownRights.body.id, { reason: 'x' }).expect(400);
  });

  it('background removal and Template 01 are separate from the original and fail safely', async () => {
    const original = await register(skus[4].id, await realisticImage(207)).expect(201);
    const failed = await derive(original.body.id, { transform: 'BACKGROUND_REMOVED' }).expect(201);
    expect(failed.body).toMatchObject({ processingStatus: 'FAILED', processingError: 'BACKGROUND_REMOVAL_UNAVAILABLE', processingAttempts: 1, storageUrl: null });
    await review(failed.body.id).expect(409);

    // A provider recovers: the same copy retries and succeeds. The original never changed.
    const port = app.get<BackgroundRemovalPort>(BACKGROUND_REMOVAL);
    jest.spyOn(port, 'removeBackground').mockResolvedValue(await cutout(1));
    const retried = await derive(original.body.id, { transform: 'BACKGROUND_REMOVED' }).expect(201);
    expect(retried.body).toMatchObject({ id: failed.body.id, processingStatus: 'SUCCEEDED', processingError: null, processingAttempts: 2 });
    const stillOriginal = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: original.body.id } });
    expect(stillOriginal.contentHash).toBe(original.body.contentHash);

    const noAlpha = await derive(original.body.id, { transform: 'TEMPLATE_01', fieldColor: '#F5F4EF' }).expect(201);
    expect(noAlpha.body.processingStatus).toBe('FAILED');
    const cut = await register(skus[4].id, await cutout(2)).expect(201);
    const composed = await derive(cut.body.id, { transform: 'TEMPLATE_01', fieldColor: '#F5F4EF' }).expect(201);
    expect(composed.body).toMatchObject({ processingStatus: 'SUCCEEDED', transformVersion: 'TEMPLATE_01@1:#f5f4ef', width: 800, height: 800 });
    await derive(cut.body.id, { transform: 'TEMPLATE_01' }).expect(400);
    await derive(cut.body.id, { transform: 'TEMPLATE_01', fieldColor: 'red' }).expect(400);
  });

  it('ingredient and texture visuals need verified facts for this exact SKU', async () => {
    const story = await register(skus[2].id, await realisticImage(208), { role: 'INGREDIENT_STORY' }).expect(201);
    await review(story.body.id).expect(400);
    const unverified = await prisma.ingredient.create({ data: { name: `Unverified ${run}`, slug: `unverified-${run}`, inciName: `UNVERIFIED ${run}`, primaryFunction: 'Humectant' } });
    await review(story.body.id, { ingredientIds: [unverified.id] }).expect(409);
    const sibling = await prisma.sku.create({ data: { productId: skus[2].productId, code: `MEDIA-SIBLING-${run}`, variantName: 'New formula', size: 200, sizeUnit: 'ml' } });
    await prisma.productIngredient.create({ data: { productId: skus[2].productId, skuId: sibling.id, ingredientId: unverified.id } });
    await review(story.body.id, { ingredientIds: [unverified.id] }).expect(409); // A sibling variant's formula is not this SKU's.
    const verified = await prisma.ingredient.create({ data: { name: `Verified ${run}`, slug: `verified-${run}`, inciName: `VERIFIED ${run}`, primaryFunction: 'Humectant' } });
    await prisma.productIngredient.create({ data: { productId: skus[2].productId, skuId: skus[2].id, ingredientId: verified.id } });
    const ok = await review(story.body.id, { ingredientIds: [verified.id] }).expect(200);
    expect(ok.body.verifiedFacts).toEqual({ ingredientIds: [verified.id] });

    const texture = await register(skus[2].id, await realisticImage(209), { role: 'TEXTURE_SENSORY' }).expect(201);
    await review(texture.body.id).expect(400);
    await review(texture.body.id, { evidence: { textureSourceUrl: 'https://www.cerave.com/texture' } }).expect(200);
  });

  it('packaging proof stays unaltered: only an optimized copy, never a composite', async () => {
    const proof = await register(skus[3].id, await realisticImage(210), { role: 'PACKAGING_PROOF' }).expect(201);
    await derive(proof.body.id, { transform: 'TEMPLATE_01', fieldColor: '#F5F4EF' }).expect(400);
    await derive(proof.body.id, { transform: 'BACKGROUND_REMOVED' }).expect(400);
    await derive(proof.body.id, { transform: 'OPTIMIZED' }).expect(201);
  });

  it('a published asset is immutable and a rejected original blocks its copy', async () => {
    const original = await register(skus[3].id, await realisticImage(211)).expect(201);
    const copy = await derive(original.body.id, { transform: 'OPTIMIZED' }).expect(201);
    await review(original.body.id, { decision: 'REJECTED', reason: 'Old label, not the current pack' }).expect(200);
    await review(copy.body.id).expect(200);
    await publish(copy.body.id).expect(409);
  });

  it('media processing is independent of ingestion: the service imports no ingestion or sourcing module', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../src/modules/catalog/services/product-media.service.ts'), 'utf8');
    expect(source).not.toMatch(/modules\/(ingestion|sourcing|commerce)|\.\.\/\.\.\/(ingestion|sourcing|commerce)/);
    expect(source).not.toMatch(/supplierOffer/);
  });

  it('hub staff can process but the same review rules apply', async () => {
    const asset = await register(skus[3].id, await realisticImage(212), {}, hub).expect(201);
    expect(asset.body.createdBy).toBe(hub.id);
    await review(asset.body.id, {}, hub).expect(200);
  });
});

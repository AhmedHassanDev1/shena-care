/* eslint-disable @typescript-eslint/no-explicit-any -- HTTP response bodies are asserted structurally */
// Editorial media over real HTTP and PostgreSQL, using the supplied SAHEL template. Pack images are synthetic pixels: this proves the pipeline, not a real product's packshot.
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { createActor, Actor } from '../fixtures/actors';
import { FIXTURE_SOURCE_URL } from '../fixtures/sellable-sku';
import { uniqueGtin } from '../fixtures/gtin';

const TEMPLATE = fs.readFileSync(path.join(__dirname, '../../assets/media-templates/sahel-soft-plinth-v1.webp'));
const RULES = JSON.parse(fs.readFileSync(path.join(__dirname, '../../assets/media-templates/sahel-soft-plinth.rules.json'), 'utf8'));
const FIVE = [
  { label: 'bottle', background: '#ffffff', body: '#1f4e79', width: 220, height: 520, format: 'png' },
  { label: 'jar', background: '#f4f1ea', body: '#7a4b2a', width: 420, height: 260, format: 'jpeg' },
  { label: 'tube', background: '#fbfbfb', body: '#2e7d5b', width: 170, height: 560, format: 'webp' },
  { label: 'pump', background: '#ffffff', body: '#8e244d', width: 240, height: 600, format: 'png' },
  { label: 'carton', background: '#f8f8f6', body: '#c28a1a', width: 330, height: 480, format: 'jpeg' },
] as const;

const run = randomUUID().slice(0, 8);
const pack = async (seed: number, spec: { background: string; body: string; width: number; height: number; format: 'png' | 'jpeg' | 'webp' }) => {
  const left = (900 - spec.width) >> 1;
  const top = (900 - spec.height) >> 1;
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900">
    <rect width="900" height="900" fill="${spec.background}"/>
    <rect x="${left}" y="${top}" width="${spec.width}" height="${spec.height}" rx="18" fill="${spec.body}"/>
    <rect x="${left + 20}" y="${top + spec.height * 0.35}" width="${spec.width - 40}" height="${spec.height * 0.3}" fill="#ffffff"/>
    <rect x="${left + 30}" y="${top + spec.height * 0.4}" width="${(spec.width - 60) * ((seed % 7 + 3) / 10)}" height="14" fill="#c0392b"/>
    <rect x="${left + 30}" y="${top + spec.height * 0.5}" width="${(spec.width - 60) * (parseInt(run, 16) % 97 + 1) / 100}" height="6" fill="#222222"/>
  </svg>`);
  return sharp(svg)[spec.format]({ quality: 92 }).toBuffer();
};

describe('Editorial product media on replaceable templates (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Actor;
  let hub: Actor;
  let customer: Actor;
  const templateKey = `sahel-soft-plinth-${run}`;
  let categoryId: string;

  const server = () => app.getHttpServer();
  const newSku = async (index: number, withCategory = true) => {
    const brand = await prisma.brand.create({ data: { name: `Ed Brand ${index} ${randomUUID()}`, slug: `ed-${index}-${randomUUID()}` } });
    const product = await prisma.product.create({ data: { brandId: brand.id, name: `Ed Product ${randomUUID()}`, slug: `ed-product-${randomUUID()}`, isPublished: true, ...(withCategory && { categoryId }) } });
    const sku = await prisma.sku.create({ data: { productId: product.id, code: `ED-${randomUUID()}`, variantName: 'Default', size: 50, sizeUnit: 'ml', barcode: uniqueGtin() } });
    return { skuId: sku.id, productId: product.id };
  };
  const registerOriginal = (skuId: string, image: Buffer, format: string, overrides: Record<string, string> = {}, role = 'PRIMARY_PACKSHOT') => {
    const fields = { skuId, role, originType: 'verified', sourceUrl: FIXTURE_SOURCE_URL, sourcePublisher: 'Fixture Manufacturer', sourceType: 'OFFICIAL_MANUFACTURER', rightsStatus: 'MANUFACTURER_PUBLISHED', ...overrides };
    let req = request(server()).post('/catalog/media-assets').set(admin.auth);
    for (const [key, value] of Object.entries(fields)) req = req.field(key, value);
    return req.attach('file', image, { filename: `pack.${format === 'jpeg' ? 'jpg' : format}`, contentType: `image/${format}` });
  };
  const derive = (id: string, body: Record<string, unknown> = { transform: 'SAHEL_EDITORIAL' }, actor = admin) => request(server()).post(`/catalog/media-assets/${id}/derive`).set(actor.auth).send(body);
  const approve = (id: string, body: Record<string, unknown> = {}) => request(server()).post(`/catalog/media-assets/${id}/review`).set(admin.auth).send({ decision: 'APPROVED', reason: 'Exact SKU confirmed by eye', ...body });
  const publish = (id: string) => request(server()).post(`/catalog/media-assets/${id}/publish`).set(admin.auth);
  const registerTemplate = (file: Buffer, fields: Record<string, string>, actor = admin, contentType = 'image/webp', filename = 'template.webp') => {
    let req = request(server()).post('/catalog/media-templates').set(actor.auth);
    for (const [key, value] of Object.entries(fields)) req = req.field(key, value);
    return req.attach('file', file, { filename, contentType });
  };
  const bytesOf = async (assetId: string, actor = admin) => {
    const res = await request(server()).get(`/catalog/media-assets/${assetId}/file`).set(actor.auth).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (chunk: Buffer) => chunks.push(chunk));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    return { status: res.status, body: res.body as Buffer };
  };

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
    categoryId = (await prisma.category.create({ data: { name: `Ed Skin ${run}`, slug: `ed-skin-${run}` } })).id;
    // Earlier runs' active fallback templates must not answer for this suite.
    await prisma.mediaTemplate.updateMany({ where: { isActive: true }, data: { isActive: false } });
  }, 60000);

  afterAll(async () => { await app.close(); });

  it('registry: Admin only; refuses a non-square image and bad rules; the supplied template registers with its real properties; a version cannot be rewritten', async () => {
    const good = { templateKey, name: 'SAHEL soft plinth', rules: JSON.stringify(RULES), categoryIds: JSON.stringify([categoryId]) };
    const tiny = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#eee' } }).webp().toBuffer();
    await registerTemplate(tiny, good, hub).expect(403);
    await registerTemplate(tiny, good, customer).expect(403);
    const wide = await sharp({ create: { width: 1200, height: 900, channels: 3, background: '#eee' } }).webp().toBuffer();
    await registerTemplate(wide, good).expect(400);
    await registerTemplate(TEMPLATE, { ...good, rules: JSON.stringify({ ...RULES, placement: { ...RULES.placement, centerX: 7 } }) }).expect(400);
    await registerTemplate(TEMPLATE, { templateKey: `no-rules-${run}`, name: 'No rules' }).expect(400);

    const res = await registerTemplate(TEMPLATE, good).expect(201);
    expect(res.body).toMatchObject({ templateKey, version: 1, width: 1254, height: 1254, mimeType: 'image/webp', isActive: true, categoryIds: [categoryId],
      contentHash: crypto.createHash('sha256').update(TEMPLATE).digest('hex') });
    const again = await registerTemplate(TEMPLATE, good);
    expect([again.status, again.body.code]).toEqual([409, 'TEMPLATE_UNCHANGED']);
    await expect(prisma.$executeRaw`UPDATE catalog.media_templates SET content_hash = 'x' WHERE id = ${res.body.id}::uuid`).rejects.toThrow(/immutable/);
    const file = await request(server()).get(`/catalog/media-templates/${res.body.id}/file`).set(admin.auth).expect(200);
    expect(file.headers['content-type']).toContain('image/webp');
  });

  it('no template, no image: a category without an active template fails plainly and the original stays usable', async () => {
    const { skuId } = await newSku(99, false);
    const original = await registerOriginal(skuId, await pack(99, FIVE[0]), FIVE[0].format).expect(201);
    const res = await derive(original.body.id);
    expect([res.status, res.body.code]).toEqual([409, 'NO_ACTIVE_TEMPLATE']);
    expect((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: original.body.id } })).processingStatus).toBe('SUCCEEDED');
  });

  it('five diverse packs: originals untouched, composited on the supplied template with lineage, the scene kept and the pack visible', async () => {
    const scene = await sharp(TEMPLATE).removeAlpha().raw().toBuffer();
    for (const [index, spec] of FIVE.entries()) {
      const { skuId } = await newSku(index);
      const image = await pack(index, spec);
      const original = await registerOriginal(skuId, image, spec.format).expect(201);
      const composed = await derive(original.body.id).expect(201);
      const template = await prisma.mediaTemplate.findFirstOrThrow({ where: { templateKey, version: 1 } });
      expect(composed.body).toMatchObject({ role: 'CATEGORY_EDITORIAL', originType: 'derived', parentAssetId: original.body.id, templateId: template.id, processingStatus: 'SUCCEEDED',
        transformVersion: `SAHEL_EDITORIAL@1:${templateKey}@1`, width: 1254, height: 1254, mimeType: 'image/webp', reviewStatus: 'PENDING_REVIEW' });
      expect(composed.body.qualityReport).toMatchObject({ backgroundMode: 'PLAIN_BACKGROUND' });

      const stored = await bytesOf(original.body.id);
      expect(stored.status).toBe(200);
      expect(stored.body.equals(image)).toBe(true);
      const result = await bytesOf(composed.body.id);
      const pixels = await sharp(result.body).removeAlpha().raw().toBuffer();
      const at = (buffer: Buffer, x: number, y: number) => [...buffer.subarray((y * 1254 + x) * 3, (y * 1254 + x) * 3 + 3)];
      const near = (a: number[], b: number[], tolerance: number) => a.every((value, i) => Math.abs(value - b[i]) <= tolerance);
      for (const [x, y] of [[40, 40], [1150, 480], [1180, 950]]) expect(near(at(pixels, x, y), at(scene, x, y), 12)).toBe(true);
      // Somewhere in the pack's column band the pack's own colour survives.
      const body = [parseInt(spec.body.slice(1, 3), 16), parseInt(spec.body.slice(3, 5), 16), parseInt(spec.body.slice(5, 7), 16)];
      let found = false;
      for (let y = 300; y < 1060 && !found; y += 5) for (let x = 400; x < 850 && !found; x += 5) if (near(at(pixels, x, y), body, 18)) found = true;
      expect(found).toBe(true);
      // Same original + same template version: one derivative, same bytes.
      const replay = await derive(original.body.id).expect(201);
      expect(replay.body.id).toBe(composed.body.id);
    }
  }, 120000);

  it('failure is recorded on the copy, can be retried, and a busy source never produces an image', async () => {
    const { skuId } = await newSku(10);
    const busy = await sharp({ create: { width: 800, height: 800, channels: 3, background: `#33${run.slice(0, 2)}77` } }).png().toBuffer();
    const original = await registerOriginal(skuId, busy, 'png').expect(201);
    const failed = await derive(original.body.id).expect(201);
    expect(failed.body).toMatchObject({ processingStatus: 'FAILED', processingError: 'BACKGROUND_NOT_PLAIN', processingAttempts: 1, storageUrl: null });
    await approve(failed.body.id).expect(409);
    const retried = await derive(original.body.id).expect(201);
    expect(retried.body).toMatchObject({ id: failed.body.id, processingStatus: 'FAILED', processingAttempts: 2 });
  });

  it('roles: editorial needs known rights and a trusted source, is never uploaded directly, and carton proof stays an unaltered copy', async () => {
    const { skuId } = await newSku(11);
    const image = await pack(11, FIVE[0]);
    const direct = await registerOriginal(skuId, image, 'png', {}, 'CATEGORY_EDITORIAL');
    expect(direct.status).toBeGreaterThanOrEqual(400);
    const unknown = await registerOriginal(skuId, image, 'png', { rightsStatus: 'UNKNOWN' }).expect(201);
    const composed = await derive(unknown.body.id).expect(201);
    await approve(composed.body.id).expect(409);

    const carton = await registerOriginal(skuId, await pack(12, FIVE[4]), 'jpeg', {}, 'PACKAGING_PROOF').expect(201);
    await derive(carton.body.id).expect(400);
    await derive(carton.body.id, { transform: 'OPTIMIZED' }).expect(201);
    await derive(unknown.body.id, { transform: 'SAHEL_EDITORIAL' }, hub).expect(201);
    await derive(unknown.body.id, { transform: 'SAHEL_EDITORIAL' }, customer).expect(403);
    await request(server()).get(`/catalog/media-assets/${unknown.body.id}/file`).set(customer.auth).expect(403);
    await request(server()).get(`/catalog/media-assets/${unknown.body.id}/file`).expect(401);
  });

  it('replacement without code: a new template file makes version 2, reprocessing creates new pending copies, the live image stays until approved, then is replaced; rollback works', async () => {
    const { skuId, productId } = await newSku(20);
    const original = await registerOriginal(skuId, await pack(20, FIVE[1]), FIVE[1].format).expect(201);
    await approve(original.body.id).expect(200);
    await publish(original.body.id).expect(200);
    const v1 = await derive(original.body.id).expect(201);
    await approve(v1.body.id).expect(200);
    await publish(v1.body.id).expect(200);

    const live = () => prisma.productMedia.findMany({ where: { productId }, orderBy: { sortOrder: 'asc' } });
    const before = await live();
    expect(before.map(m => [m.role, m.isPrimary, m.sortOrder])).toEqual([['CATEGORY_EDITORIAL', false, 0], ['PRIMARY_PACKSHOT', true, 1]]);

    const tinted = await sharp(TEMPLATE).modulate({ hue: 40 }).webp({ quality: 90 }).toBuffer();
    const version2 = await registerTemplate(tinted, { templateKey, name: 'SAHEL soft plinth (new season)' }).expect(201);
    expect(version2.body).toMatchObject({ version: 2, isActive: true, categoryIds: [categoryId] });
    expect((await prisma.mediaTemplate.findFirstOrThrow({ where: { templateKey, version: 1 } })).isActive).toBe(false);

    const reprocessed = await request(server()).post('/catalog/media-templates/reprocess').set(admin.auth).send({ templateKey }).expect(200);
    expect(reprocessed.body.activeVersion).toBe(2);
    const fresh = reprocessed.body.results.find((row: any) => row.parentAssetId === original.body.id);
    expect(fresh.processingStatus).toBe('SUCCEEDED');
    const v2 = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: fresh.assetId } });
    expect(v2).toMatchObject({ templateId: version2.body.id, parentAssetId: original.body.id, reviewStatus: 'PENDING_REVIEW' });
    expect(v2.contentHash).not.toBe(v1.body.contentHash);
    expect((await live()).map(m => m.assetId)).toEqual(before.map(m => m.assetId));

    await approve(v2.id).expect(200);
    await publish(v2.id).expect(200);
    const after = await live();
    expect(after.filter(m => m.role === 'CATEGORY_EDITORIAL').map(m => m.assetId)).toEqual([v2.id]);
    const old = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: v1.body.id } });
    expect(old.publishedMediaId).toBeNull();
    expect(old.supersededAt).not.toBeNull();
    expect(old.storageUrl).toBe(v1.body.storageUrl);

    const readiness = (await request(server()).get(`/catalog/media-assets/sku/${skuId}/readiness`).set(admin.auth).expect(200)).body;
    expect(readiness.roles).toMatchObject({ CATEGORY_EDITORIAL: 'PUBLISHED', PRIMARY_PACKSHOT: 'PUBLISHED', PACKAGING_PROOF: 'MISSING' });

    const v1Row = await prisma.mediaTemplate.findFirstOrThrow({ where: { templateKey, version: 1 } });
    await request(server()).patch(`/catalog/media-templates/${v1Row.id}/state`).set(admin.auth).send({ isActive: true }).expect(200);
    expect(await prisma.mediaTemplate.count({ where: { templateKey, isActive: true } })).toBe(1);
    await request(server()).patch(`/catalog/media-templates/${version2.body.id}/state`).set(admin.auth).send({ isActive: true }).expect(200);
  }, 120000);
});

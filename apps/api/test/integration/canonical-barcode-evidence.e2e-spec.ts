import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { CanonicalResearchService, ProductResearchService, RESEARCH_TRANSPORT } from '../../src/modules/catalog/public';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { createActor } from '../fixtures/actors';
import { uniqueGtin } from '../fixtures/gtin';

describe('canonical source barcode evidence (isolated PostgreSQL)', () => {
  it.each(['absent', 'approved', 'retired'] as const)('isolates formula evidence with a %s alias', async alias => {
    const run = randomUUID(), brandName = `CanonicalProof ${run}`, url = `https://proof-${run}.example/cream`;
    const html = `<h1>${brandName} Hydra Barrier Cream 50 ml</h1><script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: `${brandName} Hydra Barrier Cream 50 ml`, gtin13: '6223012632708' })}</script><h2>Ingredients</h2><p>AQUA, GLYCERIN, PARFUM</p>`;
    const transport = { resolve: async () => ['93.184.216.34'], get: async (source: string) => {
      const body = Buffer.from(source.endsWith('/robots.txt') ? '' : html);
      return { status: source.endsWith('/robots.txt') ? 404 : 200, headers: { get: () => 'text/html' },
        arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length) as ArrayBuffer };
    } };
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(RESEARCH_TRANSPORT).useValue(transport).compile();
    const app = module.createNestApplication();
    app.useLogger(false);
    try {
      await app.init();
      const db = app.get(PrismaService), admin = await createActor(db, 'ADMIN');
      const primaryBarcode = uniqueGtin();
      const sku = await db.sku.create({ data: { code: `SOURCE-${run}`, variantName: '50 ml', size: 50, sizeUnit: 'ml', barcode: primaryBarcode, barcodeStatus: 'VERIFIED',
        product: { create: { name: 'Hydra Barrier Cream', slug: `source-${run}`, brand: { create: { name: brandName, slug: `proof-${run}`, websiteUrl: new URL(url).origin } } } } } });
      if (alias !== 'absent') await db.skuBarcodeAlias.create({ data: { skuId: sku.id, barcode: '6223012632708', status: alias,
        source: 'packaging_revision', reason: 'Synthetic approved/retired alias fixture', approvedBy: admin.id, evidenceRef: url } });
      const research = app.get(CanonicalResearchService);
      if (alias === 'absent') jest.spyOn(app.get(ProductResearchService), 'researchProductCandidate').mockResolvedValue({
        providerStatuses: { exa: 'LIVE' }, researchedAt: new Date().toISOString(), discoveredSources: [], rejectedFacts: [],
        sourceReadings: [{ source: { url: `${url}#ingredients`, sourceType: 'OFFICIAL_MANUFACTURER' }, contentKind: 'HTML',
          facts: { ingredients: ['AQUA', 'CAFFEINE', 'GLYCERIN'] }, evidences: [{ fieldName: 'ingredients', verificationStatus: 'SUPPORTED',
            excerpt: 'AQUA, CAFFEINE, GLYCERIN', observedAt: new Date().toISOString() }] }],
      } as never);
      await research.startRun(sku.id, { sourceUrls: [url], useConfiguredProviders: alias === 'absent' }, admin.id);
      const facts = await db.productFactProposal.findMany({ where: { skuId: sku.id } });
      if (alias === 'approved') {
        expect(facts.some(fact => fact.field === 'composition.inci')).toBe(true);
        const reviewed = await research.autoVerify(sku.id, admin.id);
        expect(reviewed.holds.some(hold => hold.reasonCode === 'BARCODE_CONFLICT')).toBe(false);
        expect((await db.productFactProposal.findFirstOrThrow({ where: { skuId: sku.id, field: 'identity.gtin' } })).status).toBe('APPLIED');
      } else {
        expect(facts.map(fact => fact.field)).toEqual(['identity.gtin']);
        expect((await research.autoVerify(sku.id, admin.id)).holds).toEqual(expect.arrayContaining([expect.objectContaining({ reasonCode: 'BARCODE_CONFLICT' })]));
        expect((await research.factSummary(sku.id)).conflicts).toContain('identity.gtin');
      }
      expect((await db.sku.findUniqueOrThrow({ where: { id: sku.id } })).barcode).toBe(primaryBarcode);
    } finally { await app.close(); }
  }, 60000);
});

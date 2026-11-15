import { CatalogProfileService } from '../../src/application/composition/services/catalog-profile.service';
import { BrandService } from '../../src/modules/catalog/services/brand.service';
import { CatalogSnapshotService } from '../../src/modules/catalog/services/catalog-snapshot.service';
import type { BrandEnrichment } from '../../src/modules/catalog/public';

const verifiedAlias = {
  value: 'Test Beauty', status: 'VERIFIED' as const, origin: 'PAGE' as const,
  sourceUrl: 'https://test-brand.example/about', excerpt: 'Also known as Test Beauty',
};

function harness(profile: Record<string, unknown>) {
  const brand = { id: 'brand-1', name: 'Test Brand', slug: 'test-brand', profile,
    productLines: [], websiteUrl: null, logoUrl: null, logoMetadata: null, description: null, countryOfOrigin: null, isActive: true };
  const catalog = {
    brandPortfolio: jest.fn(async () => ({ brand, products: [] })),
    saveBrandProfile: jest.fn(async (_id: string, next: Record<string, unknown>) => { brand.profile = next; }),
  };
  const profiles = new CatalogProfileService(catalog as never, undefined as never, undefined as never,
    undefined as never, undefined as never, undefined as never, undefined as never);
  const empty = { findMany: jest.fn(async () => []) };
  const prisma = { brand: { findMany: jest.fn(async () => [brand]) }, product: { groupBy: jest.fn(async () => []) },
    ingestionEligibilityPolicy: { findFirst: jest.fn(async () => null) }, brandDraft: empty, category: empty, sku: empty, skuBarcodeAlias: empty };
  const brands = new BrandService(prisma as never);
  const snapshots = new CatalogSnapshotService(prisma as never);
  return { brand, profiles, brands, snapshots };
}

function research(aliases: BrandEnrichment['aliases']): BrandEnrichment {
  return { schema: 1, researchedAt: '2026-11-15T00:00:00Z', brandId: 'brand-1', brandName: 'Test Brand', site: null,
    name: null, description: null, country: null, logo: null, owner: null, aliases, notes: [],
    range: { sources: [], products: [], productTypes: [], domains: [], lines: [], complete: false, note: 'No range evidence' } };
}

describe('brand profile aliases across public and intake reads', () => {
  it('preserves admin aliases and sourced verified aliases through refresh and replay without promoting unverified research', async () => {
    const { brand, profiles, brands, snapshots } = harness({ aliases: ['تيست براند'] });
    const evidence = research([verifiedAlias, { ...verifiedAlias, value: 'Unconfirmed Brand', status: 'UNVERIFIED' }]);

    for (const supplied of [evidence, undefined]) {
      const profile = await profiles.refreshBrand(brand.id, supplied);
      expect((await brands.getBrands())[0].aliases).toEqual(['تيست براند', 'Test Beauty']);
      expect((await snapshots.identitySnapshot()).brands[0].aliases).toEqual(['تيست براند', 'Test Beauty']);
      expect(brand.profile.aliases).toEqual(['تيست براند', verifiedAlias]);
      expect(profile.identity.aliases).toMatchObject({ value: ['Test Beauty'], status: 'VERIFIED' });
    }

    await profiles.refreshBrand(brand.id, research([{ ...verifiedAlias, status: 'UNVERIFIED' }]));
    expect((await brands.getBrands())[0].aliases).toEqual(['تيست براند']);
    expect((await snapshots.identitySnapshot()).brands[0].aliases).toEqual(['تيست براند']);
  });

  it('retains admin aliases when no brand research has been performed', async () => {
    const { brand, profiles, brands } = harness({ aliases: ['تيست براند'] });
    const profile = await profiles.refreshBrand(brand.id);
    expect((await brands.getBrands())[0].aliases).toEqual(['تيست براند']);
    expect(profile.identity.aliases.status).toBe('UNKNOWN');
  });

  it('only exposes explicitly verified sourced aliases, while retaining admin strings', async () => {
    const { brands, snapshots } = harness({ aliases: ['تيست براند', verifiedAlias,
      { value: 'Unconfirmed', status: 'UNVERIFIED' }, { value: 'Unknown', status: 'UNKNOWN' },
      { value: 'No status' }, { value: 42, status: 'VERIFIED' }, null] });
    expect((await brands.getBrands())[0].aliases).toEqual(['تيست براند', 'Test Beauty']);
    expect((await snapshots.identitySnapshot()).brands[0].aliases).toEqual(['تيست براند', 'Test Beauty']);
  });
});

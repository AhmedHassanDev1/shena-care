// GLO-278 Gate 06 — catalog product slugs can no longer collapse Arabic titles onto one product (no database needed).
import { canonicalProductSlug } from '../../src/modules/ingestion/services/canonical-product-slug';
import { ProductIdentityService } from '../../src/modules/ingestion/services/product-identity.service';
import { RowNormalizationService } from '../../src/modules/ingestion/services/row-normalization.service';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { BrandService, CatalogService } from '../../src/modules/catalog/public';

describe('GLO-278 Gate 06: canonical product slug', () => {
  const key = (name: string) => `cerave|${name}`;

  it('gives two different Arabic products of one brand two different, non-empty ASCII slugs', () => {
    const cleanser = canonicalProductSlug('CeraVe', 'غسول رغوي للبشرة الدهنية', key('غسول-رغوي'));
    const cream = canonicalProductSlug('CeraVe', 'كريم مرطب للبشرة الجافة', key('كريم-مرطب'));
    expect(cleanser).not.toBe(cream);
    for (const slug of [cleanser, cream]) {
      expect(slug).toMatch(/^cerave-product-[0-9a-f]{10}$/);
    }
  });

  it('is stable for the same identity and keeps readable English words', () => {
    const a = canonicalProductSlug('La Roche-Posay', 'Effaclar Duo+ Cream', key('effaclar-duo'));
    expect(a).toBe(canonicalProductSlug('La Roche-Posay', 'Effaclar Duo+ Cream', key('effaclar-duo')));
    expect(a).toMatch(/^la-roche-posay-effaclar-duo-cream-[0-9a-f]{10}$/);
  });

  it('never produces an empty brand segment for an Arabic-only brand', () => {
    expect(canonicalProductSlug('سيرافي', 'غسول', key('غسول'))).toMatch(/^brand-product-[0-9a-f]{10}$/);
  });
});

describe('GLO-281: same-brand, same-size possible-duplicate rule', () => {
  const identity = new ProductIdentityService(
    undefined as unknown as PrismaService, undefined as unknown as CatalogService, undefined as unknown as BrandService,
    new RowNormalizationService(),
  );
  const brand = 'Acme Labs';

  it('does not flag clearly different products of one brand in the same size', () => {
    expect(identity.mayBeSameProduct('Acme Labs Niacinamide Serum 30ml', 'Acme Labs Retinol Night Serum 30ml', brand)).toBe(false);
    expect(identity.mayBeSameProduct('Vitamin Glow Serum 30ml', 'Hyaluronic Boost Serum 30 ml', brand)).toBe(false);
  });

  it('flags re-worded titles of what may be the same product', () => {
    expect(identity.mayBeSameProduct('Night Serum 30ml', 'Night Serum Intense 30ml', brand)).toBe(true);
    expect(identity.mayBeSameProduct('Acme Night Serum 30ml', 'Night Serum by Acme Labs 30 ml', brand)).toBe(true);
  });

  it('always flags a cross-script pair (Arabic vs Latin cannot be compared word by word)', () => {
    expect(identity.mayBeSameProduct('Night Serum 30ml', 'سيروم ليلي مركز ٣٠ مل', brand)).toBe(true);
  });
});

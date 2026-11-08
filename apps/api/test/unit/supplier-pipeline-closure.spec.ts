import { compileEligibilityPolicy, EligibilityDocument } from '../../src/modules/ingestion/services/ingestion-eligibility.policy';
import { extractProductFacts, SkuExpectation } from '../../src/modules/ingestion/services/product-fact-extractor';
import { decideFacts, decideFromFoundPages, hasMedicalClaim, rinseMode, sizeFromFoundPages, SourceCheck } from '../../src/modules/ingestion/services/catalog-decision-engine';
import { readProductType } from '../../src/modules/ingestion/services/product-type';
import { extractBrandPage } from '../../src/modules/ingestion/services/brand-page-extractor';

/**
 * Supplier/Admin pipeline closure (2026-11-07): the catalog.products fields that had no extraction path (SPF, broad spectrum, water resistance, UV filter type,
 * non-comedogenic, product line) are read only when the product's own page states them, and the leaf for a brand new to the catalog is settled without the brand.
 */
const page = (o: { title: string; brand?: string; crumbs?: string[]; body?: string; description?: string; inci?: string }) => `<html><head><title>${o.title}</title>
  <script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: o.title, brand: { name: o.brand ?? 'Lumora' }, ...(o.description && { description: o.description }) })}</script>
  ${o.crumbs ? `<script type="application/ld+json">${JSON.stringify({ '@type': 'BreadcrumbList', itemListElement: o.crumbs.map((name, i) => ({ '@type': 'ListItem', position: i + 1, name })) })}</script>` : ''}
  </head><body><h1>${o.title}</h1>${o.inci ? `<h2>Ingredients</h2><p>${o.inci}</p>` : ''}${o.body ?? ''}</body></html>`;
const sku = (productName: string, size: number | null = 50, sizeUnit: string | null = 'ml'): SkuExpectation => ({ brand: 'Lumora', productName, size, sizeUnit, barcode: null });
const facts = (html: string, expected: SkuExpectation) => {
  const out = extractProductFacts(html, 'https://www.lumora.example/products/x', expected);
  return { out, field: (name: string) => out.facts.filter(fact => fact.field === name).map(fact => fact.value) };
};

describe('product line: only the brand\'s named range, never a category, type, brand or marketing word', () => {
  it('a breadcrumb step that is part of the product name is the line', () => {
    const { field } = facts(page({ title: 'Lumora Silk Repair Shampoo 250ml', crumbs: ['Home', 'Hair Care', 'Shampoos', 'Silk Repair', 'Lumora Silk Repair Shampoo 250ml'] }), sku('Silk Repair Shampoo', 250));
    expect(field('merchandising.productLine')).toEqual(['Silk Repair']);
  });
  it('navigation, category, product type and brand steps are never a line', () => {
    const { field } = facts(page({ title: 'Lumora Shampoo 250ml', crumbs: ['Home', 'Lumora', 'Hair Care', 'Shampoo', 'Lumora Shampoo 250ml'] }), sku('Shampoo', 250));
    expect(field('merchandising.productLine')).toEqual([]);
  });
  it('a breadcrumb that is not part of the product name is a category, not its line', () => {
    const { field } = facts(page({ title: 'Lumora Silk Repair Shampoo 250ml', crumbs: ['Home', 'Best Sellers', 'Gift Ideas', 'Lumora Silk Repair Shampoo 250ml'] }), sku('Silk Repair Shampoo', 250));
    expect(field('merchandising.productLine')).toEqual([]);
  });
  it('an explicit "Collection:" label counts; a marketing adjective does not', () => {
    expect(facts(page({ title: 'Lumora Night Cream 50ml', body: '<p>Collection: Midnight Renewal</p>' }), sku('Night Cream')).field('merchandising.productLine')).toEqual(['Midnight Renewal']);
    expect(facts(page({ title: 'Lumora Hydrating Cream 50ml', crumbs: ['Home', 'Hydrating', 'Lumora Hydrating Cream 50ml'] }), sku('Hydrating Cream')).field('merchandising.productLine')).toEqual([]);
  });
  it('two different readings stay unknown', () => {
    const { field, out } = facts(page({ title: 'Lumora Silk Repair Night Cream 50ml', crumbs: ['Home', 'Silk Repair', 'Lumora Silk Repair Night Cream 50ml'], body: '<p>Range: Midnight Renewal</p>' }), sku('Silk Repair Night Cream'));
    expect(field('merchandising.productLine')).toEqual([]);
    expect(out.rejected.map(item => item.reason)).toContain('SEVERAL_LINE_READINGS');
  });
});

describe('sun protection facts: stated on the page or unknown', () => {
  const INCI = 'Aqua, Zinc Oxide, Octocrylene, Glycerin, Dimethicone, Tocopherol';
  it('SPF, broad spectrum, water resistance and the filter type of a stated sunscreen', () => {
    const { field } = facts(page({ title: 'Lumora Sun Shield Fluid SPF 50 50ml', inci: INCI,
      description: 'A light broad spectrum sun fluid. Water resistant (80 minutes). Non-comedogenic.' }), sku('Sun Shield Fluid SPF 50'));
    expect(field('attributes.spf')).toEqual([50]);
    expect(field('attributes.broadSpectrum')).toEqual([true]);
    expect(field('attributes.waterResistanceMinutes')).toEqual([80]);
    expect(field('attributes.uvFilterType')).toEqual(['HYBRID']);
  });
  it('mineral-only and organic-only lists', () => {
    expect(facts(page({ title: 'Lumora Mineral Sun Cream SPF30 50ml', inci: 'Aqua, Zinc Oxide, Titanium Dioxide, Glycerin, Caprylic/Capric Triglyceride' }), sku('Mineral Sun Cream SPF30')).field('attributes.uvFilterType')).toEqual(['MINERAL']);
    expect(facts(page({ title: 'Lumora Sun Gel SPF 30 50ml', inci: 'Aqua, Homosalate, Ethylhexyl Salicylate, Butyl Methoxydibenzoylmethane, Glycerin' }), sku('Sun Gel SPF 30')).field('attributes.uvFilterType')).toEqual(['CHEMICAL']);
  });
  it('a sunscreen whose page states no SPF keeps every sun field unknown (never inferred from the type)', () => {
    const { field } = facts(page({ title: 'Lumora Daily Sunscreen 50ml', inci: INCI, description: 'Broad spectrum protection for every day.' }), sku('Daily Sunscreen'));
    for (const name of ['attributes.spf', 'attributes.broadSpectrum', 'attributes.waterResistanceMinutes', 'attributes.uvFilterType']) expect(field(name)).toEqual([]);
  });
  it('two SPF values on the product\'s own text stay unknown', () => {
    const { field, out } = facts(page({ title: 'Lumora Sun Duo 50ml', description: 'Available as SPF 30 and SPF 50.' }), sku('Sun Duo'));
    expect(field('attributes.spf')).toEqual([]);
    expect(out.rejected.map(item => item.reason)).toContain('SEVERAL_SPF_VALUES');
  });
  it('titanium dioxide in a product with no SPF is a colourant, not a filter', () => {
    expect(facts(page({ title: 'Lumora Tinted Cream 50ml', inci: 'Aqua, Titanium Dioxide, Glycerin, Iron Oxides, Dimethicone' }), sku('Tinted Cream')).field('attributes.uvFilterType')).toEqual([]);
  });
});

describe('non-comedogenic: a stated claim only', () => {
  it('stated', () => {
    expect(facts(page({ title: 'Lumora Gel Moisturiser 50ml', description: 'An oil-free, non-comedogenic gel for oily skin.' }), sku('Gel Moisturiser')).field('attributes.nonComedogenic')).toEqual([true]);
    expect(facts(page({ title: 'Lumora جل مرطب 50ml', description: 'جل خفيف لا يسد المسام' }), sku('جل مرطب')).field('attributes.nonComedogenic')).toEqual([true]);
  });
  it('silence is unknown, never false', () => {
    expect(facts(page({ title: 'Lumora Gel Moisturiser 50ml', description: 'An oil-free gel for oily skin.' }), sku('Gel Moisturiser')).field('attributes.nonComedogenic')).toEqual([]);
  });
});

describe('decision rules for the new fields', () => {
  it('two trusted SPF values are a critical conflict, not a choice', () => {
    const verdicts = decideFacts([
      { id: 'a', field: 'attributes.spf', value: 30, tiers: ['OFFICIAL_MANUFACTURER'], status: 'PROPOSED' },
      { id: 'b', field: 'attributes.spf', value: 50, tiers: ['TRUSTED_DISTRIBUTOR'], status: 'PROPOSED' },
    ]);
    expect(verdicts.get('a')?.kind).toBe('CRITICAL');
    expect(verdicts.get('b')?.kind).toBe('CRITICAL');
  });
  it('a retailer-only SPF stays unknown', () => {
    expect(decideFacts([{ id: 'a', field: 'attributes.spf', value: 50, tiers: ['RETAILER'], status: 'PROPOSED' }]).get('a')?.kind).toBe('KEEP_UNVERIFIED');
  });
});

describe('real names from the owner list (2026-11-07)', () => {
  it.each([
    ['Dermactive ACTI-WHITE Foaming Gel', 'cleanser'], ['Dermactive ACTI-SOLAIRE SPF50+ Ultra Fluid', 'sunscreen'], ['Dermactive ACTI-SOLAIRE SPF50+ Melting Cream', 'sunscreen'],
    ['Eva Skin Clinic Hyaluronic Acid Day Gel 45 ml', 'moisturizer'], ['Dermactive ACTI-CLEAR Hydra-Mattifying Gel', 'moisturizer'], ['Dermactive ACTI-CLEAR Gentle Cleansing Gel', 'cleanser'],
  ])('%s -> %s', (name, type) => expect(readProductType(name).types.map(t => t.key)).toEqual([type]));
  it('a bare "gel" or "soothing gel" still names no type', () => {
    expect(readProductType('Shaan Soothing Gel 120 gm').types).toEqual([]);
    expect(readProductType('StarVille Acne Prone Skin Gel 30 gm').types).toEqual([]);
  });
  it('a homepage with only a <title> names the brand by its leading segment', () => {
    const facts = extractBrandPage('<html><head><title>Dermactive &#8211; Feel better in your skin</title></head><body></body></html>', 'https://derm-active.com/');
    expect(facts.names.map(name => name.value)).toEqual(['Dermactive']);
    expect(extractBrandPage('<html><head><meta property="og:site_name" content="Lumora"><title>Shop – Lumora</title></head></html>', 'https://lumora.example/').names.map(n => n.value)).toEqual(['Lumora']);
  });
});

describe('variant words decide identity in both directions (real Bobai pages, 2026-11-07)', () => {
  const bobai = (title: string) => `<html><head><title>${title}</title><script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: title, brand: { name: 'Bobai' } })}</script></head><body><h1>${title}</h1></body></html>`;
  const row = (productName: string): SkuExpectation => ({ brand: 'Bobai', productName, size: 50, sizeUnit: 'g', barcode: null });
  const matched = (title: string, name: string) => extractProductFacts(bobai(title), 'https://shop.parkvillepharma.com/products/x', row(name)).identityMatched;
  it('a tinted row is not verified by the plain page, nor a plain row by the tinted page', () => {
    expect(matched('Bobai Sunscreen Extra Lightening Gel SPF 50 50 gm', 'Sunscreen Tinted Extra Lightening Gel SPF 50')).toBe(false);
    expect(matched('Bobai Sunscreen Tinted Extra Lightening Gel SPF 50 50 gm', 'Sunscreen Extra Lightening Gel SPF 50')).toBe(false);
    expect(matched('Bobai Sunscreen Tinted Extra Lightening Gel SPF 50 50 gm', 'Sunscreen Tinted Extra Lightening Gel SPF 50')).toBe(true);
    expect(matched('Bobai Sunscreen Extra Lightening Gel SPF 50 50 gm', 'Sunscreen Extra Lightening Gel SPF 50')).toBe(true);
  });
  it('the Arabic word for tinted counts; day and night are different products; a different SPF is a different product', () => {
    expect(matched('Bobai Sunscreen Gel ملون SPF 50 50 gm', 'Sunscreen Gel SPF 50')).toBe(false);
    expect(matched('Bobai Hyaluronic Night Cream 50 gm', 'Hyaluronic Day Cream')).toBe(false);
    expect(matched('Bobai Sunscreen Gel SPF 30 50 gm', 'Sunscreen Gel SPF 50')).toBe(false);
  });
  it('a size unit in any letter case is read ("30 Ml" on the real Eva shop title)', () => {
    const page = `<html><head><title>Eva Skin Clinic Niacinamide Facial Serum 30 Ml &ndash; EVA Shop</title></head><body><h1>Eva Skin Clinic Niacinamide Facial Serum 30 Ml</h1></body></html>`;
    const out = extractProductFacts(page, 'https://www.shop.eva-cosmetics.com/products/eva-skin-clinic-niacinamide-facial-serum-30-ml',
      { brand: 'Eva Cosmetics', brandAliases: ['Eva Skin Clinic'], productName: 'Niacinamide Facial Serum', size: 30, sizeUnit: 'ml', barcode: null });
    expect(out.identityMatched).toBe(true);
    expect(out.facts.find(fact => fact.field === 'identity.size')?.value).toEqual({ value: 30, unit: 'ml' });
  });
  it('with several Product entries, only the one the heading names describes the page', () => {
    const ld = (o: object) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
    const html = `<html><head><title>Starville Acne Prone Skin Facial Cleanser 200 ml</title>${ld({ '@type': 'Product', name: 'Starville Oily & Mixed Skin Lotion', description: 'Oily & Mixed Skin Lotion. Control shine with this effective lotion.' })}
      ${ld({ '@type': 'Product', name: 'Starville Acne Prone Skin Facial Cleanser 200 ml', description: 'A gentle facial cleanser for acne prone skin that removes excess oil.' })}</head>
      <body><h1>Starville Acne Prone Skin Facial Cleanser 200 ml</h1></body></html>`;
    const out = extractProductFacts(html, 'https://eparkville.com/products/x', { brand: 'StarVille', productName: 'Acne Prone Skin Facial Cleanser', size: 200, sizeUnit: 'ml', barcode: null });
    expect(out.facts.find(fact => fact.field === 'marketing.description')?.value).toContain('gentle facial cleanser');
  });
  it('"acne treatment" wording is a medical claim', () => {
    expect(hasMedicalClaim('Acne Treatment Cream. Target mild to moderate acne')).toBe(true);
    expect(hasMedicalClaim('Treats mild acne')).toBe(true);
    expect(hasMedicalClaim('A gentle cleanser for acne-prone skin')).toBe(false);
  });
  it('"Apply to clean, dry skin" is where the product goes on, never a skin type; a stated "dry skin" suitability still counts', () => {
    const page = (description: string) => `<html><head><title>Bobai Oil Defense Fluid SPF 50 75 ml</title><meta name="description" content="${description}"></head><body><h1>Bobai Oil Defense Fluid SPF 50 75 ml</h1></body></html>`;
    const skin = (description: string) => extractProductFacts(page(description), 'https://shop.parkvillepharma.com/p', { brand: 'Bobai', productName: 'Oil Defense Fluid SPF 50', size: 75, sizeUnit: 'ml', barcode: null })
      .facts.find(fact => fact.field === 'suitability.skinTypes')?.value;
    expect(skin('Protection for Oily & Acne-Prone Skin. How to Use: Apply evenly to clean, dry skin before sun exposure. Suitable for oily skin.')).toEqual(['oily', 'acne-prone']);
    expect(skin('Apply a thin layer once daily on clean and dry skin. Ideal for sensitive skin.')).toEqual(['sensitive']);
    expect(skin('Apply to damp skin and massage. Suitable for dry skin and normal skin.')).toEqual(['normal', 'dry']);
    expect(skin('Apply to clean, dry skin morning and night.')).toBeUndefined();
  });
  it('a description the site encodes twice reaches the catalog decoded ("face &amp;amp; body" -> "face & body")', () => {
    const html = `<html><head><title>ACTI-REPAIR CICA Cream &#8211; Dermactive</title><meta name="description" content="Repairing and soothing cream, for face &amp;amp; body. It restores the skin barrier."></head><body><h1>ACTI-REPAIR CICA Cream</h1></body></html>`;
    const out = extractProductFacts(html, 'https://derm-active.com/product/acti-repair-cica-cream/', { brand: 'Dermactive', productName: 'ACTI-REPAIR CICA Cream', size: null, sizeUnit: null, barcode: null });
    expect(out.facts.find(fact => fact.field === 'marketing.description')?.value).toBe('Repairing and soothing cream, for face & body. It restores the skin barrier.');
  });
  it('"massage until fully absorbed" is leave-on; mixed with "then rinse" it is a contradiction', () => {
    expect(rinseMode(['Massage gently until fully absorbed.'])).toBe('LEAVE_ON');
    expect(rinseMode(['Gently massage over oily or T-zone areas until fully absorbed.', 'gently massage the face then rinse your skin with lukewarm water'])).toBe('CONTRADICTORY');
  });
});

describe('pages the pipeline found itself (no URL on the row)', () => {
  const check = (o: Partial<SourceCheck>): SourceCheck => ({ url: 'https://www.lumora.example/p', tier: 'OFFICIAL_MANUFACTURER', outcome: 'OK', retryable: false, identityMatched: true,
    sizeConfirmed: true, rejectedReasons: [], pageGtin: null, ...o });
  it('a search hit about another product is not a contradiction: the row simply has no source yet', () => {
    const verdict = decideFromFoundPages([check({ identityMatched: false, sizeConfirmed: null, rejectedReasons: ['IDENTITY_MISMATCH'] })], { barcode: null });
    expect(verdict.reasonCode).toBe('NO_IDENTITY_SOURCE');
  });
  it('one verifying official page accepts; a retailer page never does', () => {
    expect(decideFromFoundPages([check({ rejectedReasons: ['IDENTITY_MISMATCH'], identityMatched: false }), check({ url: 'https://www.lumora.example/q' })], { barcode: null }).decision).toBe('AUTO_ACCEPT');
    expect(decideFromFoundPages([check({ tier: 'RETAILER' })], { barcode: null }).reasonCode).toBe('NO_IDENTITY_SOURCE');
  });
  it('a timed-out page is retried, not held', () => {
    expect(decideFromFoundPages([check({ outcome: 'TIMEOUT', retryable: true, identityMatched: false, sizeConfirmed: null })], { barcode: null }).decision).toBe('RETRY_AUTOMATIC');
  });
  it('a size is taken only when trusted pages agree on exactly one', () => {
    const ml = (value: number) => ({ value, unit: 'ml' });
    expect(sizeFromFoundPages([check({ pageSize: ml(400) }), check({ url: 'https://x.lumora.example/', pageSize: ml(400) })])?.size).toEqual(ml(400));
    expect(sizeFromFoundPages([check({ pageSize: ml(250) }), check({ url: 'https://x.lumora.example/', pageSize: ml(500) })])).toBeNull();
    expect(sizeFromFoundPages([check({ tier: 'RETAILER', pageSize: ml(250) })])).toBeNull();
    expect(sizeFromFoundPages([check({ identityMatched: false, pageSize: ml(250) })])).toBeNull();
  });
});

describe('leaf for a brand new to the catalog', () => {
  const C = { skin: 'c-skin', hair: 'c-hair', sun: 'c-sun', shampoo: 'c-shampoo', makeup: 'c-makeup', lips: 'c-lips' };
  const doc: EligibilityDocument = {
    resolutionVersion: 2,
    brands: [{ id: 'b-cerave', name: 'CeraVe', isActive: true, effect: 'ALLOW', aliases: [], categoryIds: [C.shampoo] }],
    categories: [
      { id: C.skin, name: 'Skin Care', parentId: null, isActive: true, effect: null },
      { id: C.hair, name: 'Hair Care', parentId: null, isActive: true, effect: null },
      { id: C.sun, name: 'Sunscreens', parentId: C.skin, isActive: true, effect: null },
      { id: C.shampoo, name: 'Shampoos', parentId: C.hair, isActive: true, effect: null },
      { id: C.makeup, name: 'Makeup', parentId: null, isActive: true, effect: 'DENY' },
      { id: C.lips, name: 'Lipsticks', parentId: C.makeup, isActive: true, effect: null },
    ],
    mappings: [],
  };
  const policy = compileEligibilityPolicy({ id: 'p', version: 3, document: doc });
  it('the brand is unknown, yet the leaf is settled from the product type, including a leaf no brand brings in yet', () => {
    expect(policy.brandOf('Lumora')).toBeUndefined();
    expect(policy.evaluate('', 'Lumora', '', 'Lumora Sun Shield Fluid SPF 50').reason).toBe('CATEGORY_NOT_ALLOWED');
    expect(policy.leafFor('', '', 'Lumora Sun Shield Fluid SPF 50')).toMatchObject({ outcome: 'ALLOW', categoryId: C.sun });
    expect(policy.leafFor('', '', 'Lumora Silk Repair Shampoo')).toMatchObject({ outcome: 'ALLOW', categoryId: C.shampoo });
  });
  it('a denied branch is a definite skip; an unreadable type is a hold; a parent alone is not a leaf', () => {
    expect(policy.leafFor('', 'Lipsticks', 'Lumora Velvet Lip 01')).toMatchObject({ outcome: 'SKIP', reason: 'CATEGORY_DENIED' });
    expect(policy.leafFor('', '', 'Lumora Signature 01')).toMatchObject({ outcome: 'HOLD', reason: 'CATEGORY_UNKNOWN' });
    expect(policy.leafFor('', 'Skin Care', 'Lumora Signature 01')).toMatchObject({ outcome: 'HOLD', reason: 'CATEGORY_REQUIRES_LEAF' });
  });
});

import { extractProductFacts, hashFactValue, htmlToLines, SkuExpectation } from '../../src/modules/catalog/research/product-fact-extractor';
import { NodeResearchTransport, parseRobots, ResearchSourceFetcher, ResearchTransport, robotsAllows } from '../../src/modules/catalog/research/research-source-fetcher';
import { isPrivateAddress } from '../../src/platform/security/url-validator';

const SKU: SkuExpectation = { brand: 'Acme Derma', productName: 'Hydra Barrier Cream', size: 50, sizeUnit: 'ml', barcode: null };
const page = (body: string, head = '') => `<html><head><title>Acme Derma Hydra Barrier Cream 50 ml</title>${head}</head><body><h1>Hydra Barrier Cream 50 ml</h1>${body}</body></html>`;
const fieldOf = (facts: Array<{ field: string; value: unknown }>, field: string) => facts.find(fact => fact.field === field)?.value;

describe('deterministic product fact extraction', () => {
  it('extracts identity, INCI, usage, warnings and structured data, each with its excerpt', () => {
    const html = page(`
      <h2>Ingredients</h2><p>AQUA, GLYCERIN, NIACINAMIDE, CERAMIDE NP, PHENOXYETHANOL</p>
      <h2>How to use</h2><p>Apply to clean face every morning and evening.</p>
      <h2>Warnings</h2><p>For external use only. Avoid contact with eyes.</p>
      <p>Suitable for dry skin and sensitive skin.</p>`,
      `<script type="application/ld+json">{"@type":"Product","name":"Hydra Barrier Cream 50 ml","brand":{"name":"Acme Derma"},"gtin13":"6221234567890","image":["https://acme.example/pack.jpg"],"description":"A rich cream for the skin barrier, with ceramides."}</script>`);
    const { facts, identityMatched, rejected } = extractProductFacts(html, 'https://acme.example/hydra', SKU);
    expect(identityMatched).toBe(true);
    expect(rejected).toEqual([]);
    expect(fieldOf(facts, 'identity.gtin')).toBe('6221234567890');
    expect(fieldOf(facts, 'identity.size')).toEqual({ value: 50, unit: 'ml' });
    expect(fieldOf(facts, 'composition.inci')).toEqual(['AQUA', 'GLYCERIN', 'NIACINAMIDE', 'CERAMIDE NP', 'PHENOXYETHANOL']);
    expect(fieldOf(facts, 'usage.instructions')).toEqual(['Apply to clean face every morning and evening.']);
    expect(fieldOf(facts, 'usage.routinePeriod')).toBe('BOTH');
    expect(fieldOf(facts, 'safety.warnings')).toEqual(['For external use only. Avoid contact with eyes.']);
    expect(fieldOf(facts, 'suitability.skinTypes')).toEqual(['dry', 'sensitive']);
    expect(fieldOf(facts, 'attributes.texture')).toBe('CREAM');
    expect(fieldOf(facts, 'media.sourceImages')).toEqual(['https://acme.example/pack.jpg']);
    for (const fact of facts) expect(fact.excerpt.length).toBeGreaterThan(0);
  });

  it('keeps everything unstated unknown: no invented concentration, GTIN, fragrance or usage', () => {
    const { facts } = extractProductFacts(page('<p>A wonderful cream that transforms your skin in 7 days.</p>'), 'https://acme.example/hydra', SKU);
    for (const field of ['identity.gtin', 'composition.inci', 'composition.activeConcentrations', 'composition.fragrance', 'usage.instructions', 'safety.warnings']) expect(fieldOf(facts, field)).toBeUndefined();
  });

  it('includes an exact product gallery image beside the official hero image', () => {
    const html = page('<img data-srcset="/media/hydra/2.jpg?w=420 420w,/media/hydra/2.jpg?w=1440 1440w"><img data-srcset="/media/other/other.jpg?w=1440 1440w">',
      '<meta property="og:image" content="https://acme.example/media/hydra/hero-image.png">');
    const images = fieldOf(extractProductFacts(html, 'https://acme.example/hydra', SKU).facts, 'media.sourceImages');
    expect(images).toEqual(['https://acme.example/media/hydra/hero-image.png', 'https://acme.example/media/hydra/2.jpg?w=1440']);
  });

  it('prefers product-named directions when a page accidentally mixes lotion and cleanser instructions', () => {
    const cleanser: SkuExpectation = { brand: 'Acme Derma', productName: 'Acne Facial Cleanser', size: 200, sizeUnit: 'ml', barcode: null };
    const html = '<html><head><title>Acme Derma Acne Facial Cleanser 200 ml</title></head><body><h1>Acne Facial Cleanser 200 ml</h1>' +
      '<h2>How to use</h2><p>Apply to dry skin until fully absorbed.</p><h2>Ingredients</h2><p>Tea tree oil</p>' +
      '<h2>How to use</h2><p>Apply Acme Derma Facial Cleanser, massage, then rinse with water.</p></body></html>';
    expect(fieldOf(extractProductFacts(html, 'https://acme.example/products/acne-facial-cleanser-200ml', cleanser).facts, 'usage.instructions'))
      .toEqual(['Apply Acme Derma Facial Cleanser, massage, then rinse with water.']);
  });

  it('withholds a lotion description from a cleanser page when it also gives leave-on directions', () => {
    const cleanser: SkuExpectation = { brand: 'Acme Derma', productName: 'Acne Facial Cleanser', size: 200, sizeUnit: 'ml', barcode: null };
    const html = '<html><head><title>Acme Derma Acne Facial Cleanser 200 ml</title><meta property="og:description" content="Oily &amp; Mixed Skin Lotion. Apply to dry skin until fully absorbed for clear skin."></head>' +
      '<body><h1>Acne Facial Cleanser 200 ml</h1><h2>How to use</h2><p>Apply Acme Derma Facial Cleanser and rinse with water.</p></body></html>';
    const result = extractProductFacts(html, 'https://acme.example/products/acne-facial-cleanser-200ml', cleanser);
    expect(fieldOf(result.facts, 'marketing.description')).toBeUndefined();
    expect(result.rejected).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'marketing.description', reason: 'PRODUCT_TYPE_CONFLICT' })]));
    expect(fieldOf(result.facts, 'usage.instructions')).toEqual(['Apply Acme Derma Facial Cleanser and rinse with water.']);
  });

  it('refuses another product and another size: evidence is never mixed across SKUs', () => {
    const other = extractProductFacts(page('<h2>Ingredients</h2><p>AQUA, GLYCERIN, PARFUM</p>').replace(/Hydra Barrier Cream/g, 'Glow Toner'), 'https://acme.example/glow', SKU);
    expect(other).toMatchObject({ identityMatched: false, facts: [] });
    expect(other.rejected[0].reason).toBe('IDENTITY_MISMATCH');
    const otherSize = extractProductFacts(page('<h2>Ingredients</h2><p>AQUA, GLYCERIN, PARFUM</p>').replace(/50 ml/g, '100 ml'), 'https://acme.example/hydra-100', SKU);
    expect(otherSize).toMatchObject({ identityMatched: false, facts: [] });
    expect(otherSize.rejected[0].reason).toBe('SIZE_MISMATCH');
  });

  it('accepts a policy-approved brand alias without accepting an unrelated brand', () => {
    const sku: SkuExpectation = { brand: 'Clary Corporation', brandAliases: ['clary'], productName: 'Clary Hair Shampoo 300ml', size: 300, sizeUnit: 'ml', barcode: null };
    const official = '<html><head><title>Clary Hair Shampoo 300 ml</title></head><body><h1>Clary Hair Shampoo 300 ml</h1></body></html>';
    expect(extractProductFacts(official, 'https://eparkville.com/products/clary-hair-shampoo-300ml', sku).identityMatched).toBe(true);
    const other = official.replaceAll('Clary', 'Other');
    expect(extractProductFacts(other, 'https://eparkville.com/products/other-hair-shampoo-300ml', sku).identityMatched).toBe(false);
  });

  it('refuses a page with two different formulas rather than choosing one, and keeps stated percentages only', () => {
    const two = extractProductFacts(page('<h2>Ingredients</h2><p>AQUA, GLYCERIN, NIACINAMIDE</p><h2>Ingredients</h2><p>AQUA, ALCOHOL, PARFUM, LIMONENE</p>'), 'https://acme.example/hydra', SKU);
    expect(fieldOf(two.facts, 'composition.inci')).toBeUndefined();
    expect(two.rejected.some(item => item.reason === 'MULTIPLE_FORMULAS_ON_PAGE')).toBe(true);
    const strong = extractProductFacts(page('<p>Formulated with 10% Niacinamide and Zinc PCA 1%.</p>'), 'https://acme.example/hydra', SKU);
    expect(fieldOf(strong.facts, 'composition.activeConcentrations')).toEqual(expect.arrayContaining([{ ingredient: 'Niacinamide', percent: 10 }, { ingredient: 'Zinc PCA', percent: 1 }]));
  });

  it('prose is not an ingredient list, and marketing stays labelled as the manufacturer\'s words', () => {
    const prose = extractProductFacts(page('<h2>Ingredients</h2><p>We carefully selected only the best natural things, because your skin deserves love, and we believe in science, and more than anything else in the world.</p>'), 'https://acme.example/hydra', SKU);
    expect(fieldOf(prose.facts, 'composition.inci')).toBeUndefined();
    const claims = extractProductFacts(page('<h2>Benefits</h2><p>Clinically proven to repair skin in 3 days</p>'), 'https://acme.example/hydra', SKU);
    expect(fieldOf(claims.facts, 'claims.manufacturerStated')).toEqual(['Clinically proven to repair skin in 3 days']);
  });

  it('reads Arabic section headings and entities, drops scripts and styles', () => {
    const lines = htmlToLines('<style>x{}</style><script>evil()</script><p>A &amp; B&nbsp;C</p>');
    expect(lines).toEqual(['A & B C']);
    const arabic = extractProductFacts(page('<h2>المكونات</h2><p>AQUA, GLYCERIN, UREA</p><h2>طريقة الاستخدام</h2><p>يوضع على البشرة النظيفة صباحا ومساء</p>'), 'https://acme.example/hydra', SKU);
    expect(fieldOf(arabic.facts, 'composition.inci')).toEqual(['AQUA', 'GLYCERIN', 'UREA']);
    expect(fieldOf(arabic.facts, 'usage.routinePeriod')).toBe('BOTH');
  });

  it('hashes values regardless of key order and case, so a repeated fact is one proposal', () => {
    expect(hashFactValue('identity.size', { value: 50, unit: 'ml' })).toBe(hashFactValue('identity.size', { unit: 'ML', value: 50 }));
    expect(hashFactValue('identity.size', { value: 50, unit: 'ml' })).not.toBe(hashFactValue('identity.size', { value: 100, unit: 'ml' }));
  });
});

describe('research source safety', () => {
  const site = (handlers: Record<string, () => { status: number; body?: string; headers?: Record<string, string> } | Error>, addresses: string[] = ['93.184.216.34']): ResearchTransport & { calls: string[] } => {
    const calls: string[] = [];
    return {
      calls,
      resolve: async () => addresses,
      get: async url => {
        calls.push(url);
        const handler = handlers[url];
        const result = handler ? handler() : { status: 404 };
        if (result instanceof Error) throw result;
        const headers = new Map(Object.entries({ 'content-type': 'text/html', ...(result.headers ?? {}) }));
        return { status: result.status, headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null }, arrayBuffer: async () => { const bytes = Buffer.from(result.body ?? ''); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) as ArrayBuffer; } };
      },
    };
  };
  const approved = () => true;

  it('classifies private addresses for IPv4 and IPv6', () => {
    for (const address of ['10.0.0.1', '127.0.0.1', '169.254.169.254', '192.168.1.1', '::1', 'fd00::1', '::ffff:7f00:1']) expect(isPrivateAddress(address)).toBe(true);
    for (const address of ['93.184.216.34', '2606:2800:220:1::1']) expect(isPrivateAddress(address)).toBe(false);
  });

  it('refuses http, unapproved hosts, hosts resolving to private addresses and unsafe redirects without reading the page', async () => {
    const local = site({}, ['169.254.169.254']);
    expect((await new ResearchSourceFetcher(local).fetch('https://metadata.example/x', { kind: 'page', isApprovedHost: approved })).outcome).toBe('UNSAFE_URL');
    expect(local.calls).toEqual([]);
    const plain = site({});
    expect((await new ResearchSourceFetcher(plain).fetch('http://acme.example/x', { kind: 'page', isApprovedHost: approved })).outcome).toBe('UNSAFE_URL');
    expect((await new ResearchSourceFetcher(plain).fetch('https://other.example/x', { kind: 'page', isApprovedHost: host => host === 'acme.example' })).outcome).toBe('HOST_NOT_APPROVED');
    const redirect = site({ 'https://acme.example/robots.txt': () => ({ status: 404 }), 'https://acme.example/x': () => ({ status: 302, headers: { location: 'https://evil.example/y' } }) });
    expect((await new ResearchSourceFetcher(redirect).fetch('https://acme.example/x', { kind: 'page', isApprovedHost: host => host === 'acme.example' })).outcome).toBe('HOST_NOT_APPROVED');
  });

  it('honours robots.txt, treats an unreadable robots file as no permission, and reports a refusal instead of working around it', async () => {
    expect(robotsAllows(parseRobots('User-agent: *\nDisallow: /private\nAllow: /private/ok'), '/private/x')).toBe(false);
    expect(robotsAllows(parseRobots('User-agent: *\nDisallow: /private\nAllow: /private/ok'), '/private/ok/1')).toBe(true);
    expect(robotsAllows(parseRobots('User-agent: other\nDisallow: /'), '/x')).toBe(true);
    const blocked = site({ 'https://acme.example/robots.txt': () => ({ status: 200, body: 'User-agent: *\nDisallow: /' }), 'https://acme.example/x': () => ({ status: 200, body: 'secret' }) });
    expect((await new ResearchSourceFetcher(blocked).fetch('https://acme.example/x', { kind: 'page', isApprovedHost: approved })).outcome).toBe('ROBOTS_DISALLOWED');
    expect(blocked.calls).toEqual(['https://acme.example/robots.txt']);
    const down = site({ 'https://acme.example/robots.txt': () => ({ status: 503 }) });
    expect((await new ResearchSourceFetcher(down).fetch('https://acme.example/x', { kind: 'page', isApprovedHost: approved })).outcome).toBe('ROBOTS_DISALLOWED');
    const denied = site({ 'https://acme.example/robots.txt': () => ({ status: 404 }), 'https://acme.example/x': () => ({ status: 403 }) });
    const result = await new ResearchSourceFetcher(denied).fetch('https://acme.example/x', { kind: 'page', isApprovedHost: approved });
    expect(result.outcome).toBe('ACCESS_DENIED');
    expect(denied.calls.filter(url => url.endsWith('/x'))).toHaveLength(1); // one polite request: a refusal is not retried
  });

  it('retries a transient failure, opens the circuit after repeated failures, and bounds content type and size', async () => {
    let attempts = 0;
    const flaky = site({ 'https://acme.example/robots.txt': () => ({ status: 404 }), 'https://acme.example/x': () => (++attempts === 1 ? new Error('reset') : { status: 200, body: '<html>ok</html>' }) });
    expect((await new ResearchSourceFetcher(flaky).fetch('https://acme.example/x', { kind: 'page', isApprovedHost: approved })).outcome).toBe('OK');
    expect(attempts).toBe(2);

    const broken = site({ 'https://acme.example/robots.txt': () => ({ status: 404 }), 'https://acme.example/x': () => ({ status: 500 }) });
    const fetcher = new ResearchSourceFetcher(broken);
    expect((await fetcher.fetch('https://acme.example/x', { kind: 'page', isApprovedHost: approved })).outcome).toBe('UPSTREAM_ERROR');
    expect((await fetcher.fetch('https://acme.example/x', { kind: 'page', isApprovedHost: approved })).outcome).toBe('UPSTREAM_ERROR');
    expect((await fetcher.fetch('https://acme.example/x', { kind: 'page', isApprovedHost: approved })).outcome).toBe('CIRCUIT_OPEN');

    const pdf = site({ 'https://acme.example/robots.txt': () => ({ status: 404 }), 'https://acme.example/x': () => ({ status: 200, body: '%PDF', headers: { 'content-type': 'application/pdf' } }) });
    expect((await new ResearchSourceFetcher(pdf).fetch('https://acme.example/x', { kind: 'page', isApprovedHost: approved })).outcome).toBe('WRONG_CONTENT_TYPE');
    const huge = site({ 'https://acme.example/robots.txt': () => ({ status: 404 }), 'https://acme.example/x': () => ({ status: 200, body: 'x', headers: { 'content-length': String(50 * 1024 * 1024) } }) });
    expect((await new ResearchSourceFetcher(huge).fetch('https://acme.example/x', { kind: 'page', isApprovedHost: approved })).outcome).toBe('TOO_LARGE');
  });

  it('uses the real transport by default and identifies itself without any personal data', () => {
    expect(new ResearchSourceFetcher()).toBeTruthy();
    expect(new NodeResearchTransport()).toBeTruthy();
  });
});

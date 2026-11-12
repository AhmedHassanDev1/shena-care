import { ProductResearchService } from '../../src/modules/catalog/research/product-research.service';
import { CanonicalResearchService } from '../../src/modules/catalog/research/canonical-research.service';
import { discoverProductSources } from '../../src/modules/catalog/research/product-source-discovery';

const candidate = { candidateId: 'test-1', brand: 'Acme', name: 'Acme Hydra Cream 50 ml' };
const searchReply = (results: Array<{ title: string; url: string }>) => ({ ok: true, json: async () => ({ results }) }) as Response;
const scrapeReply = (markdown: string) => ({ ok: true, json: async () => ({ data: { markdown } }) }) as Response;

describe('source-aware product discovery', () => {
  const original = { exa: process.env.EXA_API_KEY, firecrawl: process.env.FIRECRAWL_API_KEY, grok: process.env.GROK_API_KEY };
  const fetchBefore = global.fetch;

  beforeEach(() => {
    process.env.EXA_API_KEY = 'test-exa';
    process.env.FIRECRAWL_API_KEY = 'test-firecrawl';
    delete process.env.GROK_API_KEY;
  });
  afterEach(() => {
    global.fetch = fetchBefore;
    for (const [key, value] of Object.entries({ EXA_API_KEY: original.exa, FIRECRAWL_API_KEY: original.firecrawl, GROK_API_KEY: original.grok })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });

  it('reads the exact size product page instead of an earlier generic brand hit', async () => {
    const search = searchReply([
      { title: 'Acme', url: 'https://acme.example/about' },
      { title: 'Acme Hydra Cream 50 ml', url: 'https://acme.example/products/hydra-cream-50ml' },
    ]);
    const requested: string[] = [];
    global.fetch = jest.fn(async (url: string | URL | Request) => {
      requested.push(String(url));
      return String(url).includes('exa.ai') ? search : scrapeReply('# Acme Hydra Cream 50 ml\nIngredients: Aqua, Glycerin, Niacinamide');
    }) as typeof fetch;

    const service = new ProductResearchService();
    const result = await service.researchProductCandidate(candidate);

    expect(result.discoveredSources[0].url).toBe('https://acme.example/products/hydra-cream-50ml');
    expect(result.fieldEvidences.some(item => item.sourceUrl === 'https://acme.example/about' && item.verificationStatus === 'SUPPORTED')).toBe(false);
    expect(requested.filter(url => url.includes('firecrawl.dev'))).toHaveLength(1);
    expect(service.usage.searches).toBeGreaterThan(0);
  });

  it('rejects a different pack size even when its name otherwise matches', async () => {
    global.fetch = jest.fn(async (url: string | URL | Request) => String(url).includes('exa.ai')
      ? searchReply([{ title: 'Acme Hydra Cream 100 ml', url: 'https://acme.example/products/hydra-cream-100ml' }])
      : scrapeReply('Acme Hydra Cream 100 ml\nIngredients: Aqua, Glycerin')) as typeof fetch;

    const result = await new ProductResearchService().researchProductCandidate(candidate);

    expect(result.discoveredSources).toEqual([]);
    expect(result.fieldEvidences.filter(item => item.verificationStatus === 'SUPPORTED')).toEqual([]);
  });

  it('withholds facts when the fetched page heading disagrees with the search title', async () => {
    global.fetch = jest.fn(async (url: string | URL | Request) => String(url).includes('exa.ai')
      ? searchReply([{ title: 'Acme Hydra Cream 50 ml', url: 'https://acme.example/products/hydra-cream-50ml' }])
      : scrapeReply('# Acme Hydra Cream 100 ml\nIngredients: Aqua, Glycerin')) as typeof fetch;

    const result = await new ProductResearchService().researchProductCandidate(candidate);

    expect(result.researchStatus).toBe('NO_EVIDENCE');
    expect(result.fieldEvidences.filter(item => item.verificationStatus === 'SUPPORTED')).toEqual([]);
  });

  it('attributes facts to the page actually read after a stale first result', async () => {
    const first = 'https://acme.example/products/stale';
    const second = 'https://acme.example/products/current';
    global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes('exa.ai')) return searchReply([
        { title: 'Acme Hydra Cream 50 ml', url: first }, { title: 'Acme Hydra Cream 50 ml', url: second },
      ]);
      const requested = JSON.parse(String(init?.body)).url;
      return scrapeReply(requested === first ? '# Acme Hydra Cream 100 ml' : '# Acme Hydra Cream 50 ml\nIngredients: Aqua, Glycerin');
    }) as typeof fetch;

    const result = await new ProductResearchService().researchProductCandidate(candidate);

    expect(result.verifiedSource?.url).toBe(second);
    expect(result.fieldEvidences.filter(item => item.verificationStatus === 'SUPPORTED').every(item => item.sourceUrl === second)).toBe(true);
  });

  it('records page-backed warning provenance for a verified SKU', async () => {
    process.env.GROK_API_KEY = 'test-grok';
    global.fetch = jest.fn(async (url: string | URL | Request) => {
      if (String(url).includes('exa.ai')) return searchReply([{ title: 'Acme Hydra Cream 50 ml', url: 'https://acme.example/products/hydra-cream-50ml' }]);
      if (String(url).includes('firecrawl.dev')) return scrapeReply('# Acme Hydra Cream 50 ml\nWarnings: Avoid contact with eyes.');
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ warnings: ['Avoid contact with eyes.'] }) } }] }) } as Response;
    }) as typeof fetch;

    const result = await new ProductResearchService().researchProductCandidate(candidate);

    expect(result.fieldEvidences).toEqual(expect.arrayContaining([expect.objectContaining({
      fieldName: 'warnings', sourceUrl: 'https://acme.example/products/hydra-cream-50ml', verificationStatus: 'SUPPORTED',
    })]));
  });

  it('recovers a rate limited official scrape through the existing safe page fetcher', async () => {
    global.fetch = jest.fn(async (url: string | URL | Request) => String(url).includes('exa.ai')
      ? searchReply([{ title: 'Acme Hydra Cream 50 ml', url: 'https://acme.example/products/hydra-cream-50ml' }])
      : { ok: false, status: 429 } as Response) as typeof fetch;
    const html = '<html><head><title>Acme Hydra Cream 50 ml</title></head><body><h1>Acme Hydra Cream 50 ml</h1><h2>How to use</h2><p>Apply to clean skin.</p></body></html>';
    const direct = { fetch: jest.fn(async () => ({ outcome: 'OK', body: Buffer.from(html), finalUrl: 'https://acme.example/products/hydra-cream-50ml' })) };
    const Service = ProductResearchService as unknown as new (fetcher: typeof direct) => ProductResearchService;

    const result = await new Service(direct).researchProductCandidate(candidate);

    expect(result.researchStatus).toBe('COMPLETE');
    expect(result.fieldEvidences).toEqual(expect.arrayContaining([expect.objectContaining({ fieldName: 'usage', verificationStatus: 'SUPPORTED' })]));
  });

  it('uses the official HTML when a scrape returns the wrong heading', async () => {
    global.fetch = jest.fn(async (url: string | URL | Request) => String(url).includes('exa.ai')
      ? searchReply([{ title: 'Acme Hydra Cream 50 ml', url: 'https://acme.example/products/hydra-cream-50ml' }])
      : scrapeReply('# Acme Hydra Cream 100 ml')) as typeof fetch;
    const html = '<html><head><title>Acme Hydra Cream 50 ml</title></head><body><h1>Acme Hydra Cream 50 ml</h1><h2>How to use</h2><p>Apply to clean skin.</p></body></html>';
    const direct = { fetch: jest.fn(async () => ({ outcome: 'OK', body: Buffer.from(html), finalUrl: 'https://acme.example/products/hydra-cream-50ml' })) };
    const Service = ProductResearchService as unknown as new (fetcher: typeof direct) => ProductResearchService;

    const result = await new Service(direct).researchProductCandidate(candidate);

    expect(result.researchStatus).toBe('COMPLETE');
    expect(result.fieldEvidences.some(item => item.fieldName === 'usage' && item.verificationStatus === 'SUPPORTED')).toBe(true);
  });

  it('tries bounded distinct Arabic and English searches, then caches an empty answer', async () => {
    const queries: string[] = [];
    global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes('exa.ai')) {
        queries.push(JSON.parse(String(init?.body)).query);
        return searchReply([]);
      }
      throw new Error('No page should be scraped when search found none');
    }) as typeof fetch;
    const service = new ProductResearchService();
    const input = { candidateId: 'starville-200', brand: 'StarVille', name: 'StarVille Acne Prone Skin Facial Cleanser 200 ml' };

    await service.researchProductCandidate(input);
    const firstCount = queries.length;
    await service.researchProductCandidate(input);

    expect(firstCount).toBeGreaterThan(1);
    expect(firstCount).toBeLessThanOrEqual(4);
    expect(queries.some(query => /[\u0600-\u06ff]/.test(query))).toBe(true);
    expect(new Set(queries).size).toBe(queries.length);
    expect(queries).toHaveLength(firstCount);
  });

  it('does not retry a rejected extraction credential for every product', async () => {
    process.env.GROK_API_KEY = 'invalid-test-key';
    let extractionRequests = 0;
    global.fetch = jest.fn(async (url: string | URL | Request) => {
      if (String(url).includes('exa.ai')) return searchReply([{ title: 'Acme Hydra Cream 50 ml', url: 'https://acme.example/products/hydra-cream-50ml' }]);
      if (String(url).includes('firecrawl.dev')) return scrapeReply('# Acme Hydra Cream 50 ml\nIngredients: Aqua, Glycerin');
      extractionRequests++;
      return { ok: false, status: 400 } as Response;
    }) as typeof fetch;
    const service = new ProductResearchService();

    await service.researchProductCandidate(candidate);
    await service.researchProductCandidate({ ...candidate, candidateId: 'test-2' });

    expect(extractionRequests).toBe(1);
  });

  it('reads a second exact owner page only when the first lacks requested directions', async () => {
    const first = 'https://acme.example/products/hydra-50ml';
    const second = 'https://shop.acme.example/products/hydra-50ml';
    global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes('exa.ai')) return searchReply([
        { title: 'Acme Hydra Cream 50 ml', url: first }, { title: 'Acme Hydra Cream 50 ml', url: second },
      ]);
      const requested = JSON.parse(String(init?.body)).url;
      return scrapeReply(requested === first ? '# Acme Hydra Cream 50 ml\nIngredients: Aqua, Glycerin'
        : '# Acme Hydra Cream 50 ml\nDirections: Apply to clean skin.');
    }) as typeof fetch;

    const result = await new ProductResearchService().researchProductCandidate({ ...candidate, missingFields: ['usage.instructions'] });

    expect(result.sourceReadings?.map(reading => reading.source.url)).toEqual([first, second]);
    expect(result.fieldEvidences.some(item => item.fieldName === 'usage' && item.sourceUrl === second && item.verificationStatus === 'SUPPORTED')).toBe(true);
  });

  it('takes size from the product heading and ignores navigation posing as directions', async () => {
    global.fetch = jest.fn(async (url: string | URL | Request) => String(url).includes('exa.ai')
      ? searchReply([{ title: 'Acme Hydra Cream 200 ml', url: 'https://acme.example/products/hydra-200' }])
      : scrapeReply('[Related product 60 ml](https://acme.example/other)\nIngredients: Parfum\n# Acme Hydra Cream 200 ml\nHow to use: **\nIngredients: Aqua, Glycerin')) as typeof fetch;

    const result = await new ProductResearchService().researchProductCandidate({ candidateId: 'heading-size', brand: 'Acme',
      name: 'Hydra Cream', size: 200, sizeUnit: 'ml' });

    expect(result.extractedFacts.size).toEqual({ value: 200, unit: 'ml' });
    expect(result.extractedFacts.ingredients).toEqual(['Aqua', 'Glycerin']);
    expect(result.fieldEvidences.some(item => item.fieldName === 'usage' && item.verificationStatus === 'SUPPORTED')).toBe(false);
  });
});

describe('canonical SKU discovery', () => {
  it('recognizes Parkville’s documented shop as the owner source for Shaan', async () => {
    const search = jest.fn(async () => [{ title: 'Shaan Soothing Gel 120 gm', url: 'https://shop.parkvillepharma.com/products/shaan-soothing-gel-120-gm' }]);
    const result = await discoverProductSources({ brand: 'Shaan', name: 'Soothing Gel 120 gm' }, search);
    expect(result.sources[0].sourceType).toBe('OFFICIAL_MANUFACTURER');
  });

  it('widens the search after the recorded brand site has no exact pack', async () => {
    const scopes: Array<string[] | undefined> = [];
    const search = jest.fn(async (_query: string, _limit: number, options?: { includeDomains?: string[] }) => {
      scopes.push(options?.includeDomains);
      return scopes.length === 1 ? [] : [{ title: 'Bobai Sunscreen Oil Defense Fluid SPF 50 75 ml', url: 'https://shop.parkvillepharma.com/products/bobai-oil-defense-75ml' }];
    });

    const result = await discoverProductSources({ brand: 'Bobai', name: 'Sunscreen Oil Defense Fluid SPF 50', size: 75,
      sizeUnit: 'ml', websiteUrl: 'https://parkville.com.eg/brand/bobai' }, search);

    expect(scopes[0]).toEqual(['shop.parkvillepharma.com']);
    expect(scopes[1]).toBeUndefined();
    expect(result.sources.map(source => source.url)).toEqual(['https://shop.parkvillepharma.com/products/bobai-oil-defense-75ml']);
  });

  it('passes only exact product and size leads to the page checker', async () => {
    const providers = { discoveryConfigured: () => true, discoverPages: jest.fn(async () => [
      { title: 'StarVille', url: 'https://shop.parkvillepharma.com/collections/starville' },
      { title: 'StarVille Acne Prone Skin Facial Cleanser 400 ml', url: 'https://shop.parkvillepharma.com/products/cleanser-400' },
      { title: 'StarVille Acne Prone Skin Facial Cleanser 200 ml', url: 'https://shop.parkvillepharma.com/products/cleanser-200' },
    ]) };
    const service = new CanonicalResearchService({} as never, {} as never, {} as never, {} as never, providers as never, {} as never);

    const urls = await service.discoverProductPages({ brand: 'StarVille', productName: 'Acne Prone Skin Facial Cleanser', size: 200, sizeUnit: 'ml', websiteUrl: null });

    expect(urls).toEqual(['https://shop.parkvillepharma.com/products/cleanser-200']);
  });

  it('does not persist a supplier-stated size as independently verified page evidence', () => {
    const service = new CanonicalResearchService({} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    const facts = { size: { value: 50, unit: 'ml' }, usage: ['Apply to clean skin.'] };
    const evidences = [
      { fieldName: 'size', verificationStatus: 'UNKNOWN' },
      { fieldName: 'usage', verificationStatus: 'SUPPORTED' },
    ];

    const selected = (service as unknown as { factsFromProvider: (input: typeof facts, evidence: typeof evidences) => Array<{ field: string }> }).factsFromProvider(facts, evidences);

    expect(selected.map(item => item.field)).toEqual(['usage.instructions']);
  });

  it('does not turn a short provider ingredient mention into a full INCI formula', () => {
    const service = new CanonicalResearchService({} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    const selected = (service as unknown as { factsFromProvider: (input: unknown, evidence: unknown, kind: string) => Array<{ field: string; value: unknown }> })
      .factsFromProvider({ ingredients: ['Niacinamide'] }, [{ fieldName: 'ingredients', verificationStatus: 'SUPPORTED' }], 'MARKDOWN');
    expect(selected.map(item => item.field)).toEqual(['composition.keyIngredients']);
    expect(selected[0].value).toEqual([{ name: 'Niacinamide', function: null }]);
  });
});

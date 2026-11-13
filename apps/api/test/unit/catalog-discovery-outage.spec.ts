import { CanonicalResearchService } from '../../src/modules/catalog/research/canonical-research.service';
import { ProductResearchService } from '../../src/modules/catalog/research/product-research.service';

describe('catalog discovery outage semantics', () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.EXA_API_KEY;
  afterEach(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.EXA_API_KEY; else process.env.EXA_API_KEY = originalKey;
  });
  const service = () => new CanonicalResearchService({} as never, {} as never, {} as never, {} as never, new ProductResearchService(), {} as never);
  const expected = { brand: 'CeraVe', productName: 'Hydrating Cleanser', size: 236, sizeUnit: 'ml', websiteUrl: 'https://www.cerave.com' };

  it('propagates a configured provider outage so intake retries instead of settling NO_IDENTITY_SOURCE', async () => {
    process.env.EXA_API_KEY = 'offline-test-key';
    global.fetch = (async () => { throw new TypeError('fetch failed'); }) as typeof fetch;
    await expect(service().discoverProductPages(expected)).rejects.toThrow('RESEARCH_DISCOVERY_UNAVAILABLE');
  });
  it('keeps an answered search with no evidence distinct from an outage', async () => {
    process.env.EXA_API_KEY = 'offline-test-key';
    global.fetch = (async () => ({ ok: true, json: async () => ({ results: [] }) })) as unknown as typeof fetch;
    await expect(service().discoverProductPages(expected)).resolves.toEqual([]);
  });
});

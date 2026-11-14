import { CanonicalResearchService } from '../../src/modules/catalog/research/canonical-research.service';

describe('source image import revalidates exact current variant evidence', () => {
  const page = 'https://www.bioderma.co.uk/p/sensibio-h2o';
  const image = (size: number) => `https://back-ac-prod.bioderma.com/${size}.jpg`;
  const html = `<h1>Bioderma Sensibio H2O</h1><p>250 ml 500 ml</p><meta property="og:image" content="${image(500)}"><form data-product-sku="sensibio" data-product-variants="${JSON.stringify([250, 500].map(size => ({ name: `Sensibio H2O ${size} ml`, variantAttributes: { volume: size }, assets: [{ position: 0, type: 'image', path: image(size) }] }))).replace(/"/g, '&#34;')}"></form>`;
  function setup(status = 'PROPOSED') {
    const fact = { id: 'fact', skuId: 'sku', field: 'media.sourceImages', status, value: [image(250), image(500)], evidence: [{ sourceUrl: page, sourceTier: 'OFFICIAL_MANUFACTURER' }] };
    const db = { productFactProposal: { findUnique: jest.fn().mockResolvedValue(fact) }, ingestionEligibilityPolicy: { findFirst: jest.fn().mockResolvedValue(null) },
      sku: { findUnique: jest.fn().mockResolvedValue({ id: 'sku', size: { toNumber: () => 250 }, sizeUnit: 'ml', barcode: null, product: { name: 'Sensibio H2O', brand: { name: 'Bioderma', websiteUrl: 'https://www.bioderma.co.uk' } } }) } };
    const fetcher = { fetch: jest.fn().mockImplementation(async (_url, options) => ({ outcome: 'OK', body: Buffer.from(options.kind === 'page' ? html : 'original'), contentType: options.kind === 'page' ? 'text/html' : 'image/jpeg' })) };
    return { service: new CanonicalResearchService(db as never, {} as never, {} as never, fetcher as never, {} as never, {} as never), fetcher };
  }
  it('refuses a previously extracted default 500 ml image for the 250 ml SKU', async () => {
    const { service } = setup();
    await expect(service.fetchSourceImage('fact', image(500))).rejects.toMatchObject({ response: { code: 'IMAGE_VARIANT_NOT_CONFIRMED' } });
  });
  it('imports only the current exact-variant original bytes and source', async () => {
    const { service, fetcher } = setup();
    await expect(service.fetchSourceImage('fact', image(250))).resolves.toMatchObject({ buffer: Buffer.from('original'), sourceUrl: page, skuId: 'sku' });
    expect(fetcher.fetch).toHaveBeenCalledWith(page, expect.objectContaining({ kind: 'page' }));
  });
  it('cannot import rejected image evidence', async () => {
    const { service, fetcher } = setup('REJECTED');
    await expect(service.fetchSourceImage('fact', image(250))).rejects.toThrow();
    expect(fetcher.fetch).not.toHaveBeenCalled();
  });
});

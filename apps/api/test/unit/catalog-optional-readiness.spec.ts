import { CatalogEnrichmentService } from '../../src/application/composition/services/intake/catalog-enrichment.service';
import { MarketPriceResearchService } from '../../src/application/composition/services/intake/market-price-research.service';

describe('catalog readiness distinguishes optional content and sourcing mode', () => {
  const previous = process.env.SOURCING_MODE;
  afterAll(() => { if (previous === undefined) delete process.env.SOURCING_MODE; else process.env.SOURCING_MODE = previous; });
  function service(canOrder = true) {
    return new CatalogEnrichmentService(
      { getSkuDetail: async () => ({ identityStatus: 'EVIDENCE_VERIFIED', product: { categoryId: 'category' } }), getRoutineProfile: async () => null } as never,
      { factSummary: async () => ({ applied: ['usage.instructions'], conflicts: [] }) } as never,
      { readiness: async () => ({ roles: { PRIMARY_PACKSHOT: 'APPROVED' } }) } as never, {} as never,
      { openForSku: async () => [] } as never,
      { getCurrentSellingPrice: async () => ({ amount: 100 }), getSellingTerms: async () => ({ isListed: true, price: { amount: 100 }, canOrder }) } as never,
      { purchaseCosts: async () => new Map() } as never, { latestCheck: async () => null } as never,
    );
  }
  it('missing optional description and INCI remain warnings, not a primary catalog gate', async () => {
    process.env.SOURCING_MODE = 'INTERNAL_BUY_LIST';
    const result = await service().readiness('sku');
    expect(result.pdp).toMatchObject({ ready: true, missing: [], warnings: ['DESCRIPTION_NOT_VERIFIED'] });
  });
  it('does not require a supplier offer cost for INTERNAL_BUY_LIST, but still requires Commerce orderability', async () => {
    process.env.SOURCING_MODE = 'INTERNAL_BUY_LIST';
    expect((await service().readiness('sku')).selling).toMatchObject({ ready: true, purchaseCost: null });
    expect((await service(false).readiness('sku')).selling).toMatchObject({ ready: false, missing: expect.arrayContaining(['NOT_COMMERCIALLY_ORDERABLE']) });
  });
  it('preserves the offer-cost requirement in OFFER_BASED mode', async () => {
    process.env.SOURCING_MODE = 'OFFER_BASED';
    expect((await service().readiness('sku')).selling).toMatchObject({ ready: false, missing: expect.arrayContaining(['NO_SUPPLIER_COST']) });
  });
  it('does not turn missing supplier cost into a pricing prerequisite in internal-buy-list mode', async () => {
    process.env.SOURCING_MODE = 'INTERNAL_BUY_LIST';
    const market = new MarketPriceResearchService({} as never, { latestCheck: async () => null, observations: async () => [] } as never,
      {} as never, {} as never, { purchaseCosts: async () => new Map() } as never);
    expect((await market.latest('sku')).pricing).toMatchObject({ state: 'OWNED_BY_COMMERCE', purchaseCost: null });
  });
});

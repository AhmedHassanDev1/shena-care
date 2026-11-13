import { checkObservation, extractPageOffers, marketReference } from '../../src/modules/intake/lib/market-price';

const html = (offer: Record<string, unknown>, extra = '', name = 'The Ordinary Niacinamide 10% + Zinc 1% 30ml') =>
  `<h1>${name}</h1><script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name, offers: { '@type': 'Offer', price: 650, priceCurrency: 'EGP', ...offer } })}</script>${extra}`;
const expected = { productName: 'Niacinamide 10% + Zinc 1%', size: 30, sizeUnit: 'ml', barcode: null };
const now = new Date('2026-11-14T12:00:00Z');
const observation = (id: string, regularPriceEgp: number | null, priceType = 'REGULAR', sourceType = 'ESTABLISHED_PHARMACY') => ({
  id, sellerDomain: `${id}.eg`, priceEgp: regularPriceEgp ?? 400, regularPriceEgp, observedAt: now, confidence: 0.85,
  evidenceExcerpt: JSON.stringify({ rule: 'market-price@2', priceType, sourceType, currency: 'EGP' }),
});

describe('regular market prices remain separate from promotion and commerce', () => {
  it('records an undiscounted exact offer as regular, with its evidence type', () => {
    expect(extractPageOffers(html({}))[0]).toMatchObject({ price: 650, regularPrice: 650, priceType: 'REGULAR' });
  });
  it('never treats a sale-only amount or a coupon page as regular', () => {
    expect(extractPageOffers(html({}, '<span class="sale-price">Sale price 650 EGP</span>'))[0]).toMatchObject({ regularPrice: null, priceType: 'PROMOTIONAL' });
    expect(extractPageOffers(html({}, '<p>Save 10% with coupon CARE10</p>'))[0]).toMatchObject({ regularPrice: null, priceType: 'PROMOTIONAL' });
    expect(extractPageOffers(html({}, '<del>950 EGP</del><ins>650 EGP</ins>'))[0]).toMatchObject({ regularPrice: null, priceType: 'PROMOTIONAL' });
  });
  it('retains a structured struck price only as a candidate, not a verified reference', () => {
    const offer = extractPageOffers(html({ price: 500, priceSpecification: { priceType: 'https://schema.org/StrikethroughPrice', price: 950 } }))[0];
    expect(offer).toMatchObject({ regularPrice: 950, priceType: 'LIST_CANDIDATE' });
    expect(marketReference([observation('a', 950, 'LIST_CANDIDATE')], now, 14)).toBeNull();
  });
  it('does not read aggregate lowPrice as an exact offer', () => {
    expect(extractPageOffers(html({ '@type': 'AggregateOffer', price: undefined, lowPrice: 400, highPrice: 900 }))).toEqual([]);
  });
  it('rejects missing size, invalid GTIN, strength mismatch and unverified sellers', () => {
    const offer = extractPageOffers(html({}))[0];
    expect(checkObservation({ ...offer, name: 'The Ordinary Niacinamide 10% + Zinc 1%' }, expected, { identityMatched: true, sellerTrust: 'TRUSTED_RETAILER' })).toMatchObject({ accepted: false, reason: 'SIZE_NOT_CONFIRMED' });
    expect(checkObservation({ ...offer, gtin: '1234567890123' }, expected, { identityMatched: true, sellerTrust: 'TRUSTED_RETAILER' })).toMatchObject({ accepted: false, reason: 'INVALID_GTIN' });
    expect(checkObservation(offer, expected, { identityMatched: true, sellerTrust: 'DISCOVERED' })).toMatchObject({ accepted: false, reason: 'SELLER_NOT_VERIFIED' });
    expect(checkObservation({ ...offer, name: 'The Ordinary Niacinamide 5% + Zinc 1% 30ml' }, expected, { identityMatched: true, sellerTrust: 'OFFICIAL' }).accepted).toBe(false);
  });
  it('excludes legacy unclassified and promotional prices, saves one pharmacy as medium', () => {
    expect(marketReference([{ ...observation('old', 500), evidenceExcerpt: null }], now, 14)).toBeNull();
    expect(marketReference([observation('sale', null, 'PROMOTIONAL')], now, 14)).toBeNull();
    expect(marketReference([observation('a', 650)], now, 14)).toMatchObject({ medianEgp: 650, regularMedianEgp: 650, confidence: 'MEDIUM', currency: 'EGP' });
  });
  it('uses the median of independent regular sources, high confidence only when consistent', () => {
    expect(marketReference([observation('a', 650), observation('b', 670)], now, 14)).toMatchObject({ medianEgp: 660, confidence: 'HIGH' });
    expect(marketReference([observation('a', 650), observation('b', 1800)], now, 14)).toMatchObject({ confidence: 'UNVERIFIED', priceReviewRequired: true });
  });
  it('requires corroboration for struck prices and ignores unverified marketplace sellers', () => {
    expect(marketReference([observation('a', 650, 'LIST_CANDIDATE'), observation('b', 660)], now, 14)).toMatchObject({ medianEgp: 655, confidence: 'HIGH' });
    expect(marketReference([observation('a', 650, 'REGULAR', 'UNVERIFIED')], now, 14)).toBeNull();
  });
});

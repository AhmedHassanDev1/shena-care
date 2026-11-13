import { normalizeCell, parseAmount, parseBarcode, readMeasures, sameMeasure, variantMarkers } from './intake-text';

export const MARKET_RULE_VERSION = 'market-price@2';
export type MarketPriceType = 'REGULAR' | 'PROMOTIONAL' | 'LIST_CANDIDATE';
export type MarketSourceType = 'OFFICIAL' | 'AUTHORIZED_DISTRIBUTOR' | 'ESTABLISHED_PHARMACY' | 'TRUSTED_RETAILER' | 'UNVERIFIED';
export interface MarketPriceEvidence { rule: string; priceType: MarketPriceType; sourceType: MarketSourceType; currency: 'EGP'; excerpt?: string }

/** Versioned evidence uses the existing observation evidence column; legacy amounts are not silently declared regular. */
export function readMarketPriceEvidence(excerpt?: string | null): MarketPriceEvidence | null {
  try {
    const value = JSON.parse(excerpt ?? 'null');
    return value?.rule === MARKET_RULE_VERSION && ['REGULAR', 'PROMOTIONAL', 'LIST_CANDIDATE'].includes(value.priceType)
      && ['OFFICIAL', 'AUTHORIZED_DISTRIBUTOR', 'ESTABLISHED_PHARMACY', 'TRUSTED_RETAILER', 'UNVERIFIED'].includes(value.sourceType)
      && value.currency === 'EGP' ? value : null;
  } catch { return null; }
}

/** One listed offer a product page states in its own structured data (JSON-LD Product/Offer) or product meta tags. Never read from free text. */
export interface PageOffer {
  name: string;
  price: number;
  currency: string | null;
  /** A list / strikethrough price stated next to a lower current price. */
  regularPrice: number | null;
  priceType: MarketPriceType;
  inStock: boolean | null;
  gtin: string | null;
  basis: 'JSON_LD' | 'META';
  excerpt: string;
}

const decode = (value: string) => value.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

function jsonLdNodes(html: string): Array<Record<string, unknown>> {
  const nodes: Array<Record<string, unknown>> = [];
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1].trim());
      const queue: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
      while (queue.length) {
        const node = queue.shift();
        if (!node || typeof node !== 'object') continue;
        const record = node as Record<string, unknown>;
        nodes.push(record);
        if (Array.isArray(record['@graph'])) queue.push(...record['@graph']);
      }
    } catch { /* malformed block: not evidence */ }
  }
  return nodes;
}

const isType = (node: Record<string, unknown>, type: string) => {
  const value = node['@type'];
  return Array.isArray(value) ? value.includes(type) : value === type;
};

const availabilityOf = (value: unknown): boolean | null => {
  const text = String(value ?? '').toLowerCase();
  if (!text) return null;
  if (/instock|limitedavailability|onlineonly|presale/.test(text)) return true;
  if (/outofstock|soldout|discontinued/.test(text)) return false;
  return null;
};

/** Every offer the page's own Product markup states, with its currency and list price when given. */
export function extractPageOffers(html: string): PageOffer[] {
  const offers: PageOffer[] = [];
  const visible = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ');
  const promotional = /\b(?:sale[-_ ]price|special[-_ ]price|flash sale|coupon|promo code|loyalty price|save\s+\d+\s*%|\d+\s*%\s*off)\b|كوبون|خصم|لفترة محدودة/i.test(visible)
    || /<(?:del|s)\b[^>]*>[\s\S]*?\d[\s\S]*?<\/(?:del|s)>/i.test(visible);
  for (const node of jsonLdNodes(html).filter(node => isType(node, 'Product'))) {
    const name = typeof node.name === 'string' ? decode(node.name) : '';
    const gtin = ['gtin13', 'gtin', 'gtin12', 'gtin14', 'gtin8'].map(key => node[key]).find(value => typeof value === 'string' || typeof value === 'number');
    const rawOffers = Array.isArray(node.offers) ? node.offers : node.offers ? [node.offers] : [];
    for (const raw of rawOffers as Array<Record<string, unknown>>) {
      if (!raw || typeof raw !== 'object') continue;
      const list = (Array.isArray(raw.offers) ? raw.offers : [raw]) as Array<Record<string, unknown>>;
      for (const offer of list) {
        if (!offer || typeof offer !== 'object' || isType(offer, 'AggregateOffer')) continue;
        const price = parseAmount(offer.price);
        if (price === null || price <= 0) continue;
        const specs = (Array.isArray(offer.priceSpecification) ? offer.priceSpecification : offer.priceSpecification ? [offer.priceSpecification] : []) as Array<Record<string, unknown>>;
        const listSpec = specs.find(spec => /strikethrough|listprice|msrp/i.test(String(spec.priceType ?? '')));
        const regular = listSpec ? parseAmount(listSpec.price) : null;
        const priceType: MarketPriceType = regular !== null && regular > price ? 'LIST_CANDIDATE'
          : promotional || specs.some(spec => /saleprice|discount/i.test(String(spec.priceType ?? ''))) ? 'PROMOTIONAL' : 'REGULAR';
        offers.push({ name, price, currency: typeof offer.priceCurrency === 'string' ? offer.priceCurrency.toUpperCase() : null,
          regularPrice: priceType === 'LIST_CANDIDATE' ? regular : priceType === 'REGULAR' ? price : null, priceType,
          inStock: availabilityOf(offer.availability), gtin: gtin !== undefined ? String(gtin) : null,
          basis: 'JSON_LD', excerpt: JSON.stringify({ name, price, regularPrice: regular, priceType, currency: offer.priceCurrency }).slice(0, 300) });
      }
    }
  }
  if (!offers.length) {
    const meta = (property: string) => html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i'))?.[1]
      ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`, 'i'))?.[1];
    const amount = parseAmount(meta('product:price:amount') ?? meta('og:price:amount'));
    if (amount !== null && amount > 0) {
      const name = decode(meta('og:title') ?? '');
      offers.push({ name, price: amount, currency: (meta('product:price:currency') ?? meta('og:price:currency') ?? '').toUpperCase() || null,
        regularPrice: promotional ? null : amount, priceType: promotional ? 'PROMOTIONAL' : 'REGULAR',
        inStock: availabilityOf(meta('product:availability') ?? meta('og:availability')), gtin: null, basis: 'META', excerpt: `og ${name} ${amount}` });
    }
  }
  return offers;
}

const BUNDLE = /\b(bundle|set of|kit|pack of|duo pack|value pack|combo|gift set|routine set)\b|\b\d\s*[x×]\s*\d|\s[x×]\s*[2-9]\b|\+\s*free|عرض|مجموعه|مجموعة|باكدج|بكج|هديه|هدية|\d\s*\+\s*\d/iu;

export interface ObservationCheck {
  accepted: boolean;
  reason: string | null;
  confidence: number;
}

/**
 * Whether an offer is a price for exactly this SKU: EGP stated, the page already proven to describe this product (identity checked by the caller), the same
 * size and pack, no bundle wording, and no conflicting barcode or strength. Promotional observations are retained separately from regular-price evidence.
 */
export function checkObservation(offer: PageOffer, expected: { size: number | null; sizeUnit: string | null; barcode: string | null; productName: string },
  page: { identityMatched: boolean; sellerTrust: 'OFFICIAL' | 'TRUSTED_RETAILER' | 'DISCOVERED' }): ObservationCheck {
  const reject = (reason: string): ObservationCheck => ({ accepted: false, reason, confidence: 0 });
  if (!page.identityMatched) return reject('PAGE_IS_ANOTHER_PRODUCT');
  if (page.sellerTrust === 'DISCOVERED') return reject('SELLER_NOT_VERIFIED');
  if (offer.currency !== 'EGP') return reject(offer.currency ? `CURRENCY_${offer.currency}` : 'CURRENCY_NOT_STATED');
  if (BUNDLE.test(normalizeCell(offer.name))) return reject('BUNDLE_OR_SET');
  const stated = readMeasures(offer.name);
  if (stated.packCount && stated.packCount > 1) return reject('MULTI_PACK');
  if (stated.measures.length > 1) return reject('SEVERAL_SIZES_IN_NAME');
  if (stated.measures.length === 1 && expected.size !== null && sameMeasure(stated.measures[0], { size: expected.size, unit: expected.sizeUnit }) === false) return reject('SIZE_DIFFERS');
  if (offer.gtin && !parseBarcode(offer.gtin)) return reject('INVALID_GTIN');
  if (offer.gtin && expected.barcode && offer.gtin.replace(/^0+/, '') !== expected.barcode.replace(/^0+/, '')) return reject('BARCODE_DIFFERS');
  if (expected.size === null || (!stated.measures.length && !(offer.gtin && expected.barcode && parseBarcode(expected.barcode)))) return reject('SIZE_NOT_CONFIRMED');
  const [a, b] = [variantMarkers(offer.name), variantMarkers(expected.productName)];
  if (a.spf.join() !== b.spf.join()) return reject('SPF_DIFFERS');
  if (a.percents.join() !== b.percents.join()) return reject('STRENGTH_DIFFERS');
  if (offer.price < 5 || offer.price > 50000) return reject('IMPLAUSIBLE_PRICE');
  const sizeConfirmed = stated.measures.length === 1 || Boolean(offer.gtin && expected.barcode);
  const base = page.sellerTrust === 'OFFICIAL' ? 0.95 : page.sellerTrust === 'TRUSTED_RETAILER' ? 0.85 : 0.65;
  return { accepted: true, reason: null, confidence: Math.round((sizeConfirmed ? base : base - 0.15) * 100) / 100 };
}

export interface ReferenceInput { id: string; sellerDomain: string; priceEgp: number; regularPriceEgp: number | null; observedAt: Date; confidence: number; sourceUrl?: string; evidenceExcerpt?: string | null }
export interface MarketReference {
  minEgp: number;
  medianEgp: number;
  maxEgp: number;
  /** The regular-price reference. Current promotional amounts never enter this median. */
  regularMedianEgp: number | null;
  sellers: number;
  observations: number;
  excluded: Array<{ id: string; reason: string }>;
  freshestAt: string;
  currency: 'EGP';
  priceType: 'REGULAR';
  confidence: 'HIGH' | 'MEDIUM' | 'UNVERIFIED';
  priceReviewRequired: boolean;
  evidence: Array<{ id: string; sourceUrl?: string; sellerDomain: string; regularPriceEgp: number; priceType: MarketPriceType; sourceType: MarketSourceType; observedAt: string }>;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 100) / 100;
};

/**
 * Regular-price evidence only, with one vote per seller. A struck list price needs independent regular-price corroboration. Large differences remain visible
 * for price-only review; they do not hold identity research or silently promote a suspicious reference to high confidence.
 */
export function marketReference(observations: ReferenceInput[], now: Date, maxAgeDays: number): MarketReference | null {
  const cutoff = now.getTime() - maxAgeDays * 86_400_000;
  const latest = new Map<string, ReferenceInput>();
  const excluded: MarketReference['excluded'] = [];
  for (const item of [...observations].sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime())) {
    if (item.observedAt.getTime() < cutoff) { excluded.push({ id: item.id, reason: 'STALE' }); continue; }
    const evidence = readMarketPriceEvidence(item.evidenceExcerpt);
    if (!evidence || evidence.sourceType === 'UNVERIFIED') { excluded.push({ id: item.id, reason: 'UNVERIFIED_PRICE_EVIDENCE' }); continue; }
    if (evidence.priceType === 'PROMOTIONAL' || !item.regularPriceEgp || !Number.isFinite(item.regularPriceEgp) || item.regularPriceEgp < 5 || item.regularPriceEgp > 50000) {
      excluded.push({ id: item.id, reason: 'NO_REGULAR_PRICE' }); continue;
    }
    if (evidence.priceType === 'LIST_CANDIDATE' && !observations.some(other => other.sellerDomain !== item.sellerDomain && other.observedAt.getTime() >= cutoff
      && readMarketPriceEvidence(other.evidenceExcerpt)?.priceType === 'REGULAR' && readMarketPriceEvidence(other.evidenceExcerpt)?.sourceType !== 'UNVERIFIED'
      && other.regularPriceEgp && Math.max(other.regularPriceEgp, item.regularPriceEgp!) / Math.min(other.regularPriceEgp, item.regularPriceEgp!) <= 1.25)) {
      excluded.push({ id: item.id, reason: 'LIST_PRICE_NOT_CORROBORATED' }); continue;
    }
    const listing = `${item.sellerDomain}|${item.sourceUrl ?? ''}`;
    if (latest.has(listing)) { excluded.push({ id: item.id, reason: 'OLDER_FROM_SAME_LISTING' }); continue; }
    latest.set(listing, item);
  }
  const bySeller = new Map<string, ReferenceInput[]>();
  for (const item of latest.values()) bySeller.set(item.sellerDomain, [...(bySeller.get(item.sellerDomain) ?? []), item]);
  const fresh = [...bySeller.values()].map(items => ({ ...items[0], priceEgp: median(items.map(item => item.regularPriceEgp!)), listings: items.length }));
  if (!fresh.length) return null;
  const prices = fresh.map(item => item.priceEgp), priceReviewRequired = Math.max(...prices) / Math.min(...prices) > 1.25;
  const official = fresh.some(item => readMarketPriceEvidence(item.evidenceExcerpt)?.sourceType === 'OFFICIAL');
  const pharmacy = fresh.some(item => readMarketPriceEvidence(item.evidenceExcerpt)?.sourceType === 'ESTABLISHED_PHARMACY');
  return { minEgp: Math.min(...prices), medianEgp: median(prices), maxEgp: Math.max(...prices), regularMedianEgp: median(prices),
    sellers: fresh.length, observations: latest.size, excluded, freshestAt: new Date(Math.max(...fresh.map(item => item.observedAt.getTime()))).toISOString(),
    currency: 'EGP', priceType: 'REGULAR', confidence: priceReviewRequired ? 'UNVERIFIED' : official || fresh.length >= 2 ? 'HIGH' : pharmacy ? 'MEDIUM' : 'UNVERIFIED', priceReviewRequired,
    evidence: [...latest.values()].map(item => ({ id: item.id, sourceUrl: item.sourceUrl, sellerDomain: item.sellerDomain, regularPriceEgp: item.regularPriceEgp!,
      priceType: readMarketPriceEvidence(item.evidenceExcerpt)!.priceType, sourceType: readMarketPriceEvidence(item.evidenceExcerpt)!.sourceType, observedAt: item.observedAt.toISOString() })) };
}

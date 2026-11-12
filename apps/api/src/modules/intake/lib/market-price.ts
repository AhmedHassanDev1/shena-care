import { normalizeCell, parseAmount, readMeasures, sameMeasure, variantMarkers } from './intake-text';

export const MARKET_RULE_VERSION = 'market-price@1';

/** One listed offer a product page states in its own structured data (JSON-LD Product/Offer) or product meta tags. Never read from free text. */
export interface PageOffer {
  name: string;
  price: number;
  currency: string | null;
  /** A list / strikethrough price stated next to a lower current price. */
  regularPrice: number | null;
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
  for (const node of jsonLdNodes(html).filter(node => isType(node, 'Product'))) {
    const name = typeof node.name === 'string' ? decode(node.name) : '';
    const gtin = ['gtin13', 'gtin', 'gtin12', 'gtin14', 'gtin8'].map(key => node[key]).find(value => typeof value === 'string' || typeof value === 'number');
    const rawOffers = Array.isArray(node.offers) ? node.offers : node.offers ? [node.offers] : [];
    for (const raw of rawOffers as Array<Record<string, unknown>>) {
      if (!raw || typeof raw !== 'object') continue;
      const list = (Array.isArray(raw.offers) ? raw.offers : [raw]) as Array<Record<string, unknown>>;
      for (const offer of list) {
        const price = parseAmount(offer.price ?? offer.lowPrice);
        if (price === null || price <= 0) continue;
        const specs = (Array.isArray(offer.priceSpecification) ? offer.priceSpecification : offer.priceSpecification ? [offer.priceSpecification] : []) as Array<Record<string, unknown>>;
        const listSpec = specs.find(spec => /strikethrough|listprice|msrp/i.test(String(spec.priceType ?? '')));
        const regular = listSpec ? parseAmount(listSpec.price) : null;
        offers.push({ name, price, currency: typeof offer.priceCurrency === 'string' ? offer.priceCurrency.toUpperCase() : null,
          regularPrice: regular !== null && regular > price ? regular : null, inStock: availabilityOf(offer.availability), gtin: gtin !== undefined ? String(gtin) : null,
          basis: 'JSON_LD', excerpt: JSON.stringify({ name, price: offer.price, priceCurrency: offer.priceCurrency, availability: offer.availability }).slice(0, 300) });
      }
    }
  }
  if (!offers.length) {
    const meta = (property: string) => html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i'))?.[1]
      ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`, 'i'))?.[1];
    const amount = parseAmount(meta('product:price:amount') ?? meta('og:price:amount'));
    if (amount !== null && amount > 0) {
      const name = decode(meta('og:title') ?? '');
      offers.push({ name, price: amount, currency: (meta('product:price:currency') ?? meta('og:price:currency') ?? '').toUpperCase() || null, regularPrice: null,
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
 * size and pack, no bundle wording, and no conflicting barcode or strength. Promo prices are kept as the offer price with the list price beside them.
 */
export function checkObservation(offer: PageOffer, expected: { size: number | null; sizeUnit: string | null; barcode: string | null; productName: string },
  page: { identityMatched: boolean; sellerTrust: 'OFFICIAL' | 'TRUSTED_RETAILER' | 'DISCOVERED' }): ObservationCheck {
  const reject = (reason: string): ObservationCheck => ({ accepted: false, reason, confidence: 0 });
  if (!page.identityMatched) return reject('PAGE_IS_ANOTHER_PRODUCT');
  if (offer.currency !== 'EGP') return reject(offer.currency ? `CURRENCY_${offer.currency}` : 'CURRENCY_NOT_STATED');
  if (BUNDLE.test(normalizeCell(offer.name))) return reject('BUNDLE_OR_SET');
  const stated = readMeasures(offer.name);
  if (stated.packCount && stated.packCount > 1) return reject('MULTI_PACK');
  if (stated.measures.length > 1) return reject('SEVERAL_SIZES_IN_NAME');
  if (stated.measures.length === 1 && expected.size !== null && sameMeasure(stated.measures[0], { size: expected.size, unit: expected.sizeUnit }) === false) return reject('SIZE_DIFFERS');
  if (offer.gtin && expected.barcode && offer.gtin.replace(/^0+/, '') !== expected.barcode.replace(/^0+/, '')) return reject('BARCODE_DIFFERS');
  const [a, b] = [variantMarkers(offer.name), variantMarkers(expected.productName)];
  if (a.spf.length && b.spf.length && a.spf[0] !== b.spf[0]) return reject('SPF_DIFFERS');
  if (a.percents.length && b.percents.length && a.percents.join() !== b.percents.join()) return reject('STRENGTH_DIFFERS');
  if (offer.price < 5 || offer.price > 50000) return reject('IMPLAUSIBLE_PRICE');
  const sizeConfirmed = stated.measures.length === 1 || Boolean(offer.gtin && expected.barcode);
  const base = page.sellerTrust === 'OFFICIAL' ? 0.95 : page.sellerTrust === 'TRUSTED_RETAILER' ? 0.85 : 0.65;
  return { accepted: true, reason: null, confidence: Math.round((sizeConfirmed ? base : base - 0.15) * 100) / 100 };
}

export interface ReferenceInput { id: string; sellerDomain: string; priceEgp: number; regularPriceEgp: number | null; observedAt: Date; confidence: number; sourceUrl?: string }
export interface MarketReference {
  minEgp: number;
  medianEgp: number;
  maxEgp: number;
  /** Regular (non-promo) prices where stated, for context. */
  regularMedianEgp: number | null;
  sellers: number;
  observations: number;
  excluded: Array<{ id: string; reason: string }>;
  freshestAt: string;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 100) / 100;
};

/**
 * Advisory range from accepted observations: the latest observation per seller within the freshness window, then anything below 60% or above 160% of the
 * median excluded as an outlier (a wrong pack, a clearance, a typo). Null when nothing is left.
 */
export function marketReference(observations: ReferenceInput[], now: Date, maxAgeDays: number): MarketReference | null {
  const cutoff = now.getTime() - maxAgeDays * 86_400_000;
  const latest = new Map<string, ReferenceInput>();
  const excluded: MarketReference['excluded'] = [];
  for (const item of [...observations].sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime())) {
    if (item.observedAt.getTime() < cutoff) { excluded.push({ id: item.id, reason: 'STALE' }); continue; }
    const listing = `${item.sellerDomain}|${item.sourceUrl ?? ''}`;
    if (latest.has(listing)) { excluded.push({ id: item.id, reason: 'OLDER_FROM_SAME_LISTING' }); continue; }
    latest.set(listing, item);
  }
  const bySeller = new Map<string, ReferenceInput[]>();
  for (const item of latest.values()) bySeller.set(item.sellerDomain, [...(bySeller.get(item.sellerDomain) ?? []), item]);
  const fresh = [...bySeller.values()].map(items => ({ ...items[0], priceEgp: median(items.map(item => item.priceEgp)),
    regularPriceEgp: items.some(item => item.regularPriceEgp) ? median(items.map(item => item.regularPriceEgp ?? item.priceEgp)) : null, listings: items.length }));
  if (!fresh.length) return null;
  const mid = median(fresh.map(item => item.priceEgp));
  const kept = fresh.filter(item => {
    const outlier = item.priceEgp < mid * 0.6 || item.priceEgp > mid * 1.6;
    if (outlier) excluded.push({ id: item.id, reason: 'OUTLIER' });
    return !outlier;
  });
  if (!kept.length) return null;
  const prices = kept.map(item => item.priceEgp);
  const regular = kept.map(item => item.regularPriceEgp ?? item.priceEgp);
  return { minEgp: Math.min(...prices), medianEgp: median(prices), maxEgp: Math.max(...prices), regularMedianEgp: kept.some(item => item.regularPriceEgp) ? median(regular) : null,
    sellers: kept.length, observations: kept.reduce((total, item) => total + item.listings, 0), excluded, freshestAt: new Date(Math.max(...kept.map(item => item.observedAt.getTime()))).toISOString() };
}

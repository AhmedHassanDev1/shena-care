import { curatedSpellings } from './brand-aliases';
import { extractProductFacts, SkuExpectation } from './product-fact-extractor';
import { hostIsBrandDomain } from './research-evidence';
import { isTrustedMediaSource } from '../../../platform/security/media-review';
import { validateSafeUrl } from '../../../platform/security/url-validator';

export interface ProductSearchInput {
  brand: string;
  name: string;
  barcode?: string | null;
  brandAliases?: string[];
  websiteUrl?: string | null;
  size?: number | null;
  sizeUnit?: string | null;
  missingFields?: string[];
}

export interface DiscoveredProductSource {
  url: string;
  title: string;
  sourceType: 'OFFICIAL_MANUFACTURER' | 'TRUSTED_DISTRIBUTOR' | 'RETAILER';
}

const ARABIC_PRODUCT_WORDS: Record<string, string> = {
  cleanser: 'غسول', facial: 'للوجه', gel: 'جل', cream: 'كريم', sunscreen: 'واقي شمس',
  serum: 'سيروم', shampoo: 'شامبو', conditioner: 'بلسم', niacinamide: 'نياسيناميد',
  hyaluronic: 'هيالورونيك', antioxidant: 'مضاد للأكسدة', soothing: 'مهدئ',
};
// Owner storefronts confirmed by their own brand navigation and contact pages. No arbitrary retailer gets this tier.
const OWNER_SHOPS: Record<string, string> = {
  shaan: 'shop.parkvillepharma.com', starville: 'shop.parkvillepharma.com', bobai: 'shop.parkvillepharma.com',
  'eva cosmetics': 'shop.eva-cosmetics.com',
};
const EGYPTIAN_BRAND_SPELLINGS: Record<string, string> = {
  shaan: 'شان', bobai: 'بوباي', 'eva cosmetics': 'ايفا', 'l oreal paris': 'لوريال باريس',
};
const brandKey = (name: string) => name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export function isVerifiedBrandShop(host: string, brand: string): boolean {
  const shop = OWNER_SHOPS[brandKey(brand)];
  const bare = host.toLowerCase().replace(/^www\./, '');
  return !!shop && (bare === shop || bare.endsWith(`.${shop}`));
}

function expectedSku(input: ProductSearchInput): SkuExpectation {
  const sizeFromName = input.name.match(/(\d+(?:\.\d+)?)\s*(ml|gm|g|kg|l|oz)\s*$/i);
  return { brand: input.brand, brandAliases: input.brandAliases, productName: input.name,
    size: input.size ?? (sizeFromName ? Number(sizeFromName[1]) : null),
    sizeUnit: input.sizeUnit ?? (sizeFromName ? (sizeFromName[2].toLowerCase() === 'gm' ? 'g' : sizeFromName[2].toLowerCase()) : null),
    barcode: input.barcode ?? null };
}

/** Search variants are leads only. Every returned page still has to prove the exact SKU. */
export function productSearchQueries(input: ProductSearchInput): string[] {
  const expected = expectedSku(input);
  const name = input.name.toLowerCase().includes(input.brand.toLowerCase()) ? input.name : `${input.brand} ${input.name}`;
  const size = expected.size && expected.sizeUnit && !new RegExp(`\\b${expected.size}\\s*(?:${expected.sizeUnit}|gm)\\b`, 'i').test(name)
    ? ` ${expected.size} ${expected.sizeUnit}` : '';
  const aliases = [...new Set([...(input.brandAliases ?? []), ...curatedSpellings(input.brand)])];
  const arabicBrand = aliases.find(alias => /[\u0600-\u06ff]/.test(alias)) ?? EGYPTIAN_BRAND_SPELLINGS[brandKey(input.brand)] ?? input.brand;
  const arabicName = input.name.toLowerCase().split(/[^a-z]+/).map(word => ARABIC_PRODUCT_WORDS[word]).filter(Boolean).join(' ');
  const arabicSize = expected.size ? `${expected.size} ${expected.sizeUnit === 'ml' ? 'مل' : expected.sizeUnit === 'g' ? 'جم' : expected.sizeUnit ?? ''}` : '';
  const focus = input.missingFields?.some(field => /composition|safety|usage|ingredient|warning|direction/i.test(field))
    ? 'ingredients directions warnings' : 'product';
  return [...new Set([
    input.barcode ? `${input.barcode} ${name}` : `${name}${size} official product`,
    input.barcode ? `${name}${size} official product` : `${name}${size} Egypt`,
    `${name}${size} ${focus}`,
    `${arabicBrand} ${arabicName || input.name} ${arabicSize}`,
  ].map(query => query.replace(/\s+/g, ' ').trim()).filter(Boolean))];
}

/** A search result cannot lend its title to a different page returned by the scraper. */
export function fetchedPageMatchesSku(input: ProductSearchInput, markdown: string, url: string): boolean {
  const expected = expectedSku(input);
  if (markdown.trimStart().startsWith('<')) {
    const check = extractProductFacts(markdown, url, expected);
    return check.identityMatched && (expected.size === null || check.facts.some(fact => fact.field === 'identity.size'));
  }
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (!heading) return false;
  const check = extractProductFacts(`<h1>${heading.replace(/[<>&]/g, ' ')}</h1>`, url, expected);
  return check.identityMatched && (expected.size === null || check.facts.some(fact => fact.field === 'identity.size'));
}

/** Query only until an official exact match or two distinct exact candidates exist. */
export async function discoverProductSources(
  input: ProductSearchInput,
  search: (query: string, limit: number, options?: { includeDomains?: string[] }) => Promise<Array<{ url: string; title: string }> | null>,
): Promise<{ sources: DiscoveredProductSource[]; providerAnswered: boolean }> {
  const expected = expectedSku(input);
  const site = OWNER_SHOPS[brandKey(input.brand)] ?? (() => { try { return input.websiteUrl ? new URL(input.websiteUrl).hostname.toLowerCase().replace(/^www\./, '') : null; } catch { return null; } })();
  const sources: DiscoveredProductSource[] = [];
  let providerAnswered = false;
  for (const [index, query] of productSearchQueries(input).entries()) {
    const pages = await search(query, 5, site && index === 0 ? { includeDomains: [site] } : {});
    if (pages === null) break;
    providerAnswered = true;
    for (const page of pages) {
      try {
        validateSafeUrl(page.url);
        const url = new URL(page.url);
        if (url.protocol !== 'https:') continue;
        if (/\.(pdf|jpe?g|png|webp|gif|svg|zip|docx?|xlsx?)$/i.test(url.pathname)) continue;
        const title = page.title.trim();
        const check = extractProductFacts(`<h1>${title.replace(/[<>&]/g, ' ')}</h1>`, page.url, expected);
        if (!check.identityMatched || (expected.size !== null && !check.facts.some(fact => fact.field === 'identity.size'))) continue;
        if (sources.some(source => source.url === page.url)) continue;
        const host = url.hostname.toLowerCase().replace(/^www\./, '');
        const official = hostIsBrandDomain(host, input.brand) || isVerifiedBrandShop(host, input.brand)
          || (input.websiteUrl !== undefined && input.websiteUrl !== null && (() => { try { const owner = new URL(input.websiteUrl).hostname.toLowerCase().replace(/^www\./, ''); return host === owner || host.endsWith(`.${owner}`); } catch { return false; } })());
        const sourceType = official ? 'OFFICIAL_MANUFACTURER' : isTrustedMediaSource(page.url) ? 'TRUSTED_DISTRIBUTOR' : 'RETAILER';
        sources.push({ url: page.url, title, sourceType });
      } catch { /* unsafe or invalid search result */ }
    }
    if (sources.some(source => source.sourceType === 'OFFICIAL_MANUFACTURER') || sources.length >= 2) break;
  }
  const rank = { OFFICIAL_MANUFACTURER: 0, TRUSTED_DISTRIBUTOR: 1, RETAILER: 2 };
  return { sources: sources.sort((a, b) => rank[a.sourceType] - rank[b.sourceType]).slice(0, 3), providerAnswered };
}

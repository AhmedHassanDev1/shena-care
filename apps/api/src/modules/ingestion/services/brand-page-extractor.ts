/**
 * Deterministic extraction of brand identity facts from ONE fetched web page (normally an official homepage).
 * Everything returned is literally on that page and carries the excerpt that states it. Nothing is inferred, translated or
 * completed from memory; what the page does not say stays absent.
 */
export interface BrandPageFact<T = string> { value: T; excerpt: string; source: 'JSON_LD' | 'META' | 'HTML' | 'TITLE' }
export interface BrandPageFacts {
  /** Names the site gives itself, strongest evidence first. */
  names: Array<BrandPageFact>;
  alternateNames: Array<BrandPageFact>;
  description: BrandPageFact | null;
  /** Absolute https image URLs that the page presents as its logo (PNG, JPEG, WebP or SVG; SVG is only ever rasterized, never stored). */
  logoCandidates: Array<BrandPageFact>;
  /** Where the brand was founded (structured `foundingLocation`). */
  foundingCountry: BrandPageFact | null;
  /** Country of the company's registered address: not necessarily the brand's origin. */
  addressCountry: BrandPageFact | null;
  parentCompany: BrandPageFact | null;
}

const MAX_HTML = 4 * 1024 * 1024;
const MAX_DESCRIPTION = 320;
const RASTER = /\.(png|jpe?g|webp|svg)(?:[?#].*)?$/i;

const decodeEntities = (value: string) => value
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
/** Visible text of an attribute or snippet: no markup, one line, bounded. */
// eslint-disable-next-line no-control-regex -- control characters in page text are removed on purpose
const clean = (value: unknown, max = 200): string => (typeof value === 'string' ? decodeEntities(value) : '').replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** A tag whose quoted attribute values may themselves contain ">". */
const TAG = (name: string) => new RegExp(String.raw`<${name}\b(?:[^>"']|"[^"]*"|'[^']*')*>`, 'gi');

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  return out;
}

function absoluteHttps(raw: string | undefined, base: string): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.trim(), base);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null;
  } catch { return null; }
}

type Json = Record<string, unknown>;
const asArray = <T>(value: T | T[] | undefined | null): T[] => (value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]);
const text = (value: unknown): string => {
  if (typeof value === 'string') return clean(value);
  if (value && typeof value === 'object') return text((value as Json).name ?? (value as Json)['@value']);
  return '';
};

function jsonLdNodes(html: string): Json[] {
  const nodes: Json[] = [];
  const visit = (value: unknown, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 4) return;
    if (Array.isArray(value)) { value.forEach(item => visit(item, depth + 1)); return; }
    nodes.push(value as Json);
    visit((value as Json)['@graph'], depth + 1);
  };
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(m[1].trim())); } catch { /* malformed structured data is simply not evidence */ }
  }
  return nodes;
}

const isOrganization = (node: Json) => asArray(node['@type'] as string | string[]).some(type => /^(Organization|Corporation|Brand|LocalBusiness|OnlineStore|Store|WebSite)$/i.test(String(type)));
const isLogoImage = (url: string) => RASTER.test(new URL(url).pathname + new URL(url).search);

const displayCountry = (raw: string): string => {
  const value = raw.trim();
  if (/^[A-Za-z]{2}$/.test(value)) {
    try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(value.toUpperCase()) ?? value; } catch { return value; }
  }
  return value;
};

/** "COSRX Official", "Lumora | Skincare for sensitive skin", "Lumora Online Store" → the name part. Only storefront words are dropped, never a meaningful word. */
export function cleanSiteName(raw: string): string {
  const first = raw.split(/\s+[|–—:·•]\s+|\s+-\s+/)[0].trim();
  const stripped = first.replace(/\b(official|online store|store|shop|website|global)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  return stripped.length >= 2 ? stripped : first;
}

/** Payment methods, social networks, badges and partners carry the word "logo" too; none of them is the brand's logo. */
const NOT_BRAND_LOGO = /(pay|visa|master-?card|paypal|klarna|amex|stripe|facebook|instagram|tiktok|youtube|twitter|whatsapp|snapchat|trust|badge|award|certif|partner|shipping|payment|secure)/i;
const siteKey = (host: string) => { const labels = host.toLowerCase().replace(/^www\./, '').split('.'); return labels.slice(-2).join('.'); };

export function extractBrandPage(htmlInput: string, pageUrl: string): BrandPageFacts {
  const html = htmlInput.slice(0, MAX_HTML);
  const facts: BrandPageFacts = { names: [], alternateNames: [], description: null, logoCandidates: [], foundingCountry: null, addressCountry: null, parentCompany: null };
  const seen = new Set<string>();
  const addName = (list: BrandPageFact[], value: string, excerpt: string, source: BrandPageFact['source']) => {
    const v = clean(value, 120);
    if (!v || v.length < 2 || seen.has(`${list === facts.names}:${v.toLowerCase()}`)) return;
    seen.add(`${list === facts.names}:${v.toLowerCase()}`);
    list.push({ value: v, excerpt: clean(excerpt, 200), source });
  };

  const nodes = jsonLdNodes(html).filter(isOrganization);
  for (const node of nodes) {
    const name = text(node.name);
    if (name) addName(facts.names, cleanSiteName(name), `"name": "${name}"`, 'JSON_LD');
    for (const alt of asArray(node.alternateName as string | string[])) { const v = text(alt); if (v) addName(facts.alternateNames, v, `"alternateName": "${v}"`, 'JSON_LD'); }
    if (!facts.description && text(node.description)) facts.description = { value: text(node.description).slice(0, MAX_DESCRIPTION), excerpt: text(node.description).slice(0, 200), source: 'JSON_LD' };
    for (const logo of asArray(node.logo as unknown)) {
      const raw = typeof logo === 'string' ? logo : (logo as Json)?.url ?? (logo as Json)?.contentUrl;
      const url = absoluteHttps(typeof raw === 'string' ? raw : undefined, pageUrl);
      if (url && isLogoImage(url)) facts.logoCandidates.push({ value: url, excerpt: `"logo": "${url}"`, source: 'JSON_LD' });
    }
    const parent = text(node.parentOrganization);
    if (!facts.parentCompany && parent) facts.parentCompany = { value: parent, excerpt: `"parentOrganization": "${parent}"`, source: 'JSON_LD' };
    const founded = asArray(node.foundingLocation as unknown).map(place => text((place as Json)?.address ?? place)).find(Boolean);
    const foundedCountry = asArray(node.foundingLocation as unknown).map(place => text(((place as Json)?.address as Json)?.addressCountry ?? (place as Json)?.addressCountry)).find(Boolean) ?? founded;
    if (!facts.foundingCountry && foundedCountry) facts.foundingCountry = { value: displayCountry(foundedCountry), excerpt: `"foundingLocation": "${foundedCountry}"`, source: 'JSON_LD' };
    const addressCountry = asArray(node.address as unknown).map(address => text((address as Json)?.addressCountry)).find(Boolean);
    if (!facts.addressCountry && addressCountry) facts.addressCountry = { value: displayCountry(addressCountry), excerpt: `"addressCountry": "${addressCountry}"`, source: 'JSON_LD' };
  }

  const metas = [...html.matchAll(TAG('meta'))].map(m => ({ raw: m[0], a: attrs(m[0]) }));
  const meta = (key: string) => metas.find(m => (m.a.property ?? m.a.name ?? '').toLowerCase() === key && m.a.content);
  const siteName = meta('og:site_name') ?? meta('application-name');
  if (siteName) addName(facts.names, cleanSiteName(siteName.a.content), siteName.raw, 'META');
  // The homepage's own <title> ("Dermactive – Feel better in your skin"): its leading segment is how the site names itself. Weakest evidence, so it comes last;
  // research still counts it only when it agrees with the brand being looked up (regression from the real derm-active.com homepage, 2026-11-07).
  const title = clean(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '', 200);
  if (title && !facts.names.length) addName(facts.names, cleanSiteName(title), `<title>${title}</title>`, 'TITLE');
  const metaDescription = meta('description') ?? meta('og:description');
  if (!facts.description && metaDescription && clean(metaDescription.a.content, MAX_DESCRIPTION).length >= 20) {
    facts.description = { value: clean(metaDescription.a.content, MAX_DESCRIPTION), excerpt: clean(metaDescription.raw, 200), source: 'META' };
  }

  // Header/navigation images that call themselves a logo. A favicon or a campaign og:image is not a logo.
  const region = html.match(/<(header|nav)\b[\s\S]*?<\/\1>/i)?.[0] ?? html.slice(0, 60_000);
  for (const m of region.matchAll(TAG('img'))) {
    const a = attrs(m[0]);
    const candidate = absoluteHttps(a.src || a['data-src'], pageUrl);
    // From the page's own markup only: the image must come from the site's own domain and must not be a payment/social/partner mark.
    const label = `${a.alt ?? ''} ${a.class ?? ''} ${a.id ?? ''} ${new URL(candidate ?? 'https://x.invalid/').pathname}`;
    if (candidate && /logo/i.test(label) && !NOT_BRAND_LOGO.test(label) && siteKey(new URL(candidate).hostname) === siteKey(new URL(pageUrl).hostname) && isLogoImage(candidate)) {
      facts.logoCandidates.push({ value: candidate, excerpt: clean(m[0], 200), source: 'HTML' });
    }
  }
  const unique = new Map(facts.logoCandidates.map(candidate => [candidate.value, candidate]));
  facts.logoCandidates = [...unique.values()].slice(0, 3);
  return facts;
}

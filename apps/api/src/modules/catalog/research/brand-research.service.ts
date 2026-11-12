import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../../platform/database/prisma.service';
import { validateSafeUrl } from '../../../platform/security/url-validator';
import { StorageService } from '../../../platform/storage/storage.service';
import { BrandService } from '../public';
import { slugify } from '../utils/slug.util';
import { ResearchBrandDto, SaveResearchedBrandDto } from './dto/brand-research.dto';
import { BrandPageFact, extractBrandPage } from './brand-page-extractor';
import { ProductResearchService } from './product-research.service';
import { curatedBrandAlias } from './brand-enrichment.service';
import { cleanSiteName } from './brand-page-extractor';
import { normalizeLogo } from './brand-logo';
import { hostIsBrandDomain, registrableLabel } from './research-evidence';
import { ResearchSourceFetcher } from './research-source-fetcher';
import { htmlToLines } from './product-fact-extractor';
import { productTypeRule, readProductType } from './product-type';

/** Where a range page sits relative to the brand: its own site, the company that owns it, an approved distributor, or anyone else. */
export type RangeSourceTier = 'OFFICIAL_BRAND_SITE' | 'OWNER_SITE' | 'TRUSTED_DISTRIBUTOR' | 'OTHER';
/**
 * Research on a brand we already hold. Only what the pages read literally state is recorded, each with its page; VERIFIED means the brand's own domain, or the
 * owner's own domain naming the brand. The range is the brand's offer as the sources list it: never ShinaCare's imported products, never claimed complete.
 */
export interface BrandEnrichment {
  schema: 1; researchedAt: string; brandId: string; brandName: string;
  site: { url: string; host: string; verifiedOfficial: boolean; outcome: string } | null;
  name: ResearchedField | null; description: ResearchedField | null; country: ResearchedField | null; logo: ResearchedField | null; aliases: ResearchedField[];
  owner: { name: ResearchedField; country: ResearchedField | null; brandOrigin: ResearchedField | null; namesBrand: boolean; ownDomain: boolean } | null;
  range: {
    sources: Array<{ url: string; tier: RangeSourceTier; outcome: string; products: number }>;
    products: Array<{ name: string; productType: string | null; domain: string | null; sourceUrl: string; tier: RangeSourceTier }>;
    productTypes: Array<{ value: string; products: number }>; domains: string[]; lines: Array<{ value: string; products: number }>;
    complete: false; note: string;
  };
  notes: string[];
}

const DEMONYMS: Record<string, string> = { egyptian: 'Egypt', french: 'France', american: 'United States', german: 'Germany', korean: 'South Korea', 'south korean': 'South Korea',
  japanese: 'Japan', italian: 'Italy', spanish: 'Spain', british: 'United Kingdom', swiss: 'Switzerland', turkish: 'Turkey', saudi: 'Saudi Arabia', emirati: 'United Arab Emirates', jordanian: 'Jordan', lebanese: 'Lebanon' };
const COUNTRIES = ['Egypt', 'France', 'United States', 'USA', 'Germany', 'South Korea', 'Korea', 'Japan', 'Italy', 'Spain', 'United Kingdom', 'UK', 'Switzerland', 'Turkey', 'Saudi Arabia', 'UAE', 'Jordan', 'Lebanon'];
const BUNDLE = /\b(offer|pack|bundle|set|kit|range|routine|collection|box)\b/i;

export type FieldStatus = 'VERIFIED' | 'UNVERIFIED';
/** What happened to a brand an import row names that the catalog did not hold. */
export type BrandOnboarding =
  | { kind: 'CREATED'; brandId: string; name: string; policyVersion: number; fields: Record<string, unknown>; logoSaved: boolean; site: string }
  | { kind: 'EXISTS'; brandId: string; name: string }
  | { kind: 'HOLD'; reasonCode: 'BRAND_NOT_VERIFIED' | 'BRAND_MATCHES_EXISTING' | 'BRAND_EXISTS_NOT_ENABLED'; summary: string; evidence: Record<string, unknown> }
  | { kind: 'RETRY'; reason: string };
/** One researched value with the page that states it. VERIFIED only ever means "stated on a page of the brand's own domain". */
export interface ResearchedField { value: string; status: FieldStatus; origin: 'PAGE' | 'ADMIN'; sourceUrl: string; excerpt: string; note?: string }
/** The logo as fetched (mediaType/contentHash describe the original bytes); what gets stored is always a re-encoded PNG. */
export interface ResearchedLogo extends ResearchedField { mediaType: string; contentHash: string; bytes: number; storedAs: 'image/png' }
/** A possible English identity for an Arabic-only name. A suggestion for the Admin to confirm, never an assertion. */
export interface BrandCandidate { name: string; nameSource: 'CURATED' | 'TITLE' | 'DOMAIN'; url: string | null; host: string | null; title: string; arabicMatch: boolean }
export interface BrandResearch {
  schema: 1;
  researchedAt: string;
  query: string;
  /** FOUND: an official-looking page was read. PARTIAL: read, but little on it. NOT_FOUND: nothing usable. UNAVAILABLE: the search provider or the site could not be reached. */
  outcome: 'FOUND' | 'PARTIAL' | 'NOT_FOUND' | 'UNAVAILABLE';
  site: { url: string; host: string; verifiedOfficial: boolean; origin: 'ADMIN' | 'SEARCH' } | null;
  name: ResearchedField | null;
  website: ResearchedField | null;
  description: ResearchedField | null;
  country: ResearchedField | null;
  parentCompany: ResearchedField | null;
  aliases: ResearchedField[];
  logo: ResearchedLogo | null;
  /** Only for a non-Latin name with no site named: where an Admin may choose to continue. */
  candidates: BrandCandidate[];
  references: Array<{ url: string; title: string; host: string }>;
  notes: string[];
}

const MAX_CANDIDATES = 5;
/** Marketplaces, social networks and encyclopedias describe a brand; they are never its official site. */
const NOT_OFFICIAL = /(^|\.)(wikipedia|wikimedia|facebook|instagram|twitter|x|youtube|tiktok|linkedin|pinterest|amazon|noon|jumia|ebay|aliexpress|temu|reddit|google|bing|yahoo|snapchat|whatsapp|olx|souq|carrefouregypt|b-tech|sephora|ulta|boots|nahdi|iherb|lookfantastic|cultbeauty)\./i;
const RESEARCH_LIMIT = { windowMs: 10 * 60_000, max: 12 };

const fold = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const hasLatin = (value: string) => /[a-z]/i.test(value);
const bare = (host: string) => host.toLowerCase().replace(/^www\./, '');
const related = (a: string, b: string) => {
  const [x, y] = [fold(a), fold(b)];
  return x.length >= 3 && y.length >= 3 && (x.includes(y) || y.includes(x));
};
const REGION_SUFFIX = /(?:\s*[-|–—:]\s*|\s+)(?:official\s+(?:site|website|store|shop)|online\s+(?:store|shop)|international|global|middle\s+east|mena|gcc|ksa|uae|saudi\s+arabia|egypt|eg|africa|south\s+africa|europe|uk|united\s+kingdom|us|usa|united\s+states|canada|ca|australia|au|nz|new\s+zealand|singapore|sg|malaysia|my|india|in|ireland|ie|arabia|en)\s*$/i;
const clip = (value: string, max: number) => value.normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * Smart Add Brand. Research is advisory: it reads the brand's own website through the shared safe fetcher, extracts only what that page literally states,
 * and returns it with the evidence for an Admin to accept, edit or drop. The server — not the browser — decides at save time which fields count as verified,
 * so a changed value can never keep a "verified" label. Nothing here invents a logo, a country or a company.
 */
@Injectable()
export class BrandResearchService {
  private readonly recent = new Map<string, number[]>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly brands: BrandService,
    private readonly providers: ProductResearchService,
    private readonly fetcher: ResearchSourceFetcher,
    private readonly storage: StorageService,
  ) {}

  private async assertAdmin(actorId: string): Promise<void> {
    const actor = await this.prisma.customer.findUnique({ where: { id: actorId }, select: { isActive: true, roles: true } });
    if (!actor || !actor.isActive || !actor.roles.includes('ADMIN')) throw new ForbiddenException('Admin access required');
  }

  private brandSlug(name: string): string {
    return slugify(name);
  }

  private async findExistingBrand(name: string) {
    const slug = slugify(name);
    return this.prisma.brand.findFirst({
      where: { OR: [{ slug }, { name: { equals: name, mode: 'insensitive' } }] },
    });
  }

  private async assertNewBrand(name: string): Promise<void> {
    const existing = await this.findExistingBrand(name);
    if (existing) {
      throw new ConflictException({
        code: 'BRAND_EXISTS',
        message: `${existing.name} already exists`,
        brandId: existing.id,
        name: existing.name,
      });
    }
  }

  private throttle(actorId: string) {
    const now = Date.now();
    const hits = (this.recent.get(actorId) ?? []).filter(at => now - at < RESEARCH_LIMIT.windowMs);
    if (hits.length >= RESEARCH_LIMIT.max) throw new HttpException({ code: 'RESEARCH_RATE_LIMITED', message: 'Too many brand lookups; wait a few minutes or enter the details by hand' }, HttpStatus.TOO_MANY_REQUESTS);
    this.recent.set(actorId, [...hits, now]);
  }

  /** Reads the web for one brand name. Persists only the evidence (on the brand's draft record); the canonical Brand is untouched. */
  async research(dto: ResearchBrandDto, actorId: string, options: { throttle?: boolean } = {}): Promise<{ draftId: string; research: BrandResearch }> {
    await this.assertAdmin(actorId);
    const query = clip(dto.name, 120);
    if (query.length < 2) throw new BadRequestException('Brand name is required');
    await this.assertNewBrand(query);
    // The reviewed dictionary may already tie this Arabic spelling to a brand we hold, under its English name.
    const curated = hasLatin(query) ? null : curatedBrandAlias(query);
    if (curated) {
      const held = await this.findExistingBrand(curated.canonicalName);
      if (held) throw new ConflictException({ code: 'BRAND_EXISTS', message: `${held.name} already exists`, brandId: held.id, name: held.name });
    }
    if (dto.alias) await this.assertNewBrand(clip(dto.alias, 120));
    // The limit protects the interactive lookup; the import pipeline reads one site per new brand and is bounded by the file.
    if (options.throttle !== false) this.throttle(actorId);

    const research: BrandResearch = { schema: 1, researchedAt: new Date().toISOString(), query, outcome: 'NOT_FOUND', site: null,
      name: null, website: null, description: null, country: null, parentCompany: null, aliases: [], logo: null, candidates: [], references: [], notes: [] };
    const latin = hasLatin(query) ? query : null;

    // 1. Where to look: the page an Admin named, otherwise what the search provider finds.
    let candidate: { url: URL; origin: 'ADMIN' | 'SEARCH' } | null = null;
    if (dto.websiteUrl) {
      const parsed = this.safeHttps(dto.websiteUrl);
      if (!parsed) throw new BadRequestException({ code: 'INVALID_WEBSITE', message: 'The website must be a public https address' });
      candidate = { url: new URL(`${parsed.origin}/`), origin: 'ADMIN' };
    } else if (!latin) {
      // A non-Latin name cannot be matched to a brand domain, so no site is read on its own authority. Offer candidates; the Admin decides which, if any, is the brand.
      research.notes.push('NEEDS_LATIN_NAME');
      research.candidates = await this.arabicCandidates(query, curated, research);
    } else {
      const found = await this.providers.discoverPages(`${latin} official website brand`, 8);
      if (found === null) research.notes.push('SEARCH_UNAVAILABLE');
      const pages = (found ?? []).flatMap(page => { const url = this.safeHttps(page.url); return url ? [{ url, title: clip(page.title, 160) }] : []; });
      research.references = pages.map(page => ({ url: page.url.toString(), title: page.title, host: page.url.hostname })).slice(0, 6);
      const official = pages.find(page => latin && hostIsBrandDomain(page.url.hostname, latin));
      const guess = official ?? pages.find(page => !NOT_OFFICIAL.test(page.url.hostname));
      if (guess) candidate = { url: new URL(`${guess.url.origin}/`), origin: 'SEARCH' };
      else if (found !== null) research.notes.push('NO_SITE_FOUND');
    }

    // 2. Read that one site (homepage only), through the bounded, robots-respecting fetcher.
    if (candidate) {
      const siteHost = bare(candidate.url.hostname);
      const verifiedOfficial = Boolean(latin) && hostIsBrandDomain(candidate.url.hostname, latin!);
      const fetched = await this.fetcher.fetch(candidate.url.toString(), { kind: 'page', isApprovedHost: host => bare(host) === siteHost || bare(host).endsWith(`.${siteHost}`) });
      if (fetched.outcome !== 'OK' || !fetched.body) {
        research.notes.push(`SITE_${fetched.outcome}`);
        research.site = { url: candidate.url.toString(), host: candidate.url.hostname, verifiedOfficial, origin: candidate.origin };
      } else {
        const pageUrl = fetched.finalUrl;
        research.site = { url: new URL(pageUrl).origin + '/', host: new URL(pageUrl).hostname, verifiedOfficial, origin: candidate.origin };
        if (!verifiedOfficial) research.notes.push(latin ? 'DOMAIN_NOT_BRAND' : 'NEEDS_LATIN_NAME');
        await this.fill(research, fetched.body.toString('utf8'), pageUrl, query, verifiedOfficial);
      }
    }

    const alias = dto.alias ? clip(dto.alias, 120) : '';
    if (alias && fold(alias) !== fold(research.name?.value ?? query) && !research.aliases.some(a => fold(a.value) === fold(alias))) {
      research.aliases.unshift({ value: alias, status: 'UNVERIFIED', origin: 'ADMIN', sourceUrl: '', excerpt: '' });
    }

    // 3. Name the outcome honestly.
    const useful = [research.name, research.description, research.logo, research.country, research.parentCompany].filter(Boolean).length;
    research.outcome = research.site && useful >= 2 ? 'FOUND' : research.site && useful >= 1 ? 'PARTIAL'
      : research.notes.some(note => note === 'SEARCH_UNAVAILABLE' || note.startsWith('SITE_')) ? 'UNAVAILABLE' : 'NOT_FOUND';

    // The official spelling may already be a brand we hold, under a name the Admin did not type.
    for (const label of [research.name?.value, ...research.aliases.map(alias => alias.value)]) {
      if (!label) continue;
      const existing = await this.findExistingBrand(label);
      if (existing) throw new ConflictException({ code: 'BRAND_EXISTS', message: `${existing.name} already exists`, brandId: existing.id, name: existing.name });
    }

    const draftId = await this.storeEvidence(query, research);
    return { draftId, research };
  }

  /** English-name candidates for an Arabic-only name: the reviewed dictionary first, then search results. Nothing is read or saved here. */
  private async arabicCandidates(query: string, curated: { canonicalName: string } | null, research: BrandResearch): Promise<BrandCandidate[]> {
    const candidates: BrandCandidate[] = [];
    if (curated) candidates.push({ name: curated.canonicalName, nameSource: 'CURATED', url: null, host: null, title: '', arabicMatch: true });
    const found = await this.providers.discoverPages(`${query} brand official website`, 10);
    if (found === null) research.notes.push('SEARCH_UNAVAILABLE');
    const seen = new Set<string>();
    const fromSearch: BrandCandidate[] = [];
    for (const page of found ?? []) {
      const url = this.safeHttps(page.url);
      if (!url || NOT_OFFICIAL.test(url.hostname)) continue;
      const site = registrableLabel(url.hostname);
      if (!site || seen.has(site)) continue;
      seen.add(site);
      const title = clip(page.title, 160);
      // The name is only ever text the page or its domain states: a Latin title segment that agrees with the domain, else the domain's own label.
      const fromTitle = hasLatin(title) ? cleanSiteName(title.replace(/^[^A-Za-z]+/, '')).slice(0, 60) : '';
      const titled = fromTitle.length >= 2 && related(fromTitle, site);
      const name = titled ? fromTitle : site.replace(/[^a-z0-9]+/gi, ' ').trim();
      if (!hasLatin(name) || fold(name).length < 3) continue;
      fromSearch.push({ name, nameSource: titled ? 'TITLE' : 'DOMAIN', url: `${url.origin}/`, host: url.hostname, title, arabicMatch: fold(title).includes(fold(query)) });
    }
    // A page that itself states the Arabic name is the strongest hint; the rest keep their search order.
    fromSearch.sort((a, b) => Number(b.arabicMatch) - Number(a.arabicMatch));
    return [...candidates, ...fromSearch].slice(0, MAX_CANDIDATES);
  }

  private safeHttps(raw: string): URL | null {
    try {
      const url = new URL(raw);
      if (url.protocol !== 'https:' || url.username || url.password) return null;
      validateSafeUrl(url.toString());
      return url;
    } catch { return null; }
  }

  private async fill(research: BrandResearch, html: string, pageUrl: string, query: string, verified: boolean) {
    const facts = extractBrandPage(html, pageUrl);
    const status: FieldStatus = verified ? 'VERIFIED' : 'UNVERIFIED';
    const field = (fact: BrandPageFact, note?: string, forceUnverified = false): ResearchedField => ({
      value: fact.value, status: forceUnverified ? 'UNVERIFIED' : status, origin: 'PAGE', sourceUrl: pageUrl, excerpt: fact.excerpt, ...(note && { note }),
    });

    // Regional storefronts name themselves "Garnier AU" or "La Roche-Posay Canada": the brand is the name without the region (and with plain hyphens).
    for (const fact of facts.names) {
      const plain = fact.value.replace(/[‐-―]/g, '-');
      const bare = plain.replace(REGION_SUFFIX, '').trim();
      fact.value = bare.length >= 2 && related(bare, query) ? bare : plain;
      // Same name, different casing ("BIODERMA", "Cerave"): keep the typed casing when it is mixed case, the brand's own styling.
      if (fold(fact.value) === fold(query) && /[a-z]/.test(query) && /[A-Z]/.test(query)) fact.value = query;
    }
    const named = facts.names.find(fact => related(fact.value, query));
    const official = named ?? facts.names[0];
    if (official) research.name = field(official, named ? undefined : 'NAME_DIFFERS', !named);
    research.website = { value: new URL(pageUrl).origin + '/', status, origin: 'PAGE', sourceUrl: pageUrl, excerpt: pageUrl };
    if (facts.description) research.description = field(facts.description);
    if (facts.foundingCountry) research.country = field(facts.foundingCountry);
    else if (facts.addressCountry) research.country = field(facts.addressCountry, 'ADDRESS_NOT_ORIGIN', true);
    if (facts.parentCompany) research.parentCompany = field(facts.parentCompany);

    const officialName = research.name?.value;
    const aliases: ResearchedField[] = facts.alternateNames.filter(fact => !officialName || fold(fact.value) !== fold(officialName)).slice(0, 6).map(fact => field(fact));
    // What the Admin typed is how suppliers spell the brand: keep it as an alias when the official name differs.
    if (officialName && fold(query) !== fold(officialName) && !aliases.some(alias => fold(alias.value) === fold(query))) {
      aliases.unshift({ value: query, status: 'UNVERIFIED', origin: 'ADMIN', sourceUrl: '', excerpt: '' });
    }
    research.aliases = aliases;

    for (const candidate of facts.logoCandidates) {
      const logo = await this.readLogo(candidate.value);
      if (logo) {
        const { png: _png, ...described } = logo;
        research.logo = { ...field(candidate), value: candidate.value, ...described };
        break;
      }
    }
    if (!research.logo) research.notes.push(facts.logoCandidates.length ? 'LOGO_UNUSABLE' : 'LOGO_NOT_FOUND');
  }

  /**
   * Fetches a logo and turns it into the only thing we ever store: a validated, re-encoded PNG. SVG passes a strict allow-list first and is
   * rasterized; anything unsafe, undecodable or implausible is not a logo we keep. The hash describes the original bytes.
   */
  private async readLogo(url: string, expectedHash?: string): Promise<{ mediaType: string; contentHash: string; bytes: number; storedAs: 'image/png'; png: Buffer } | null> {
    const host = bare(new URL(url).hostname);
    const fetched = await this.fetcher.fetch(url, { kind: 'image', isApprovedHost: h => bare(h) === host });
    if (fetched.outcome !== 'OK' || !fetched.body) return null;
    const mediaType = (fetched.contentType ?? '').split(';')[0].trim().toLowerCase();
    const contentHash = createHash('sha256').update(fetched.body).digest('hex');
    if (expectedHash && contentHash !== expectedHash) return null;
    const normalized = await normalizeLogo(mediaType, fetched.body);
    if (!normalized) return null;
    return { mediaType, contentHash, bytes: fetched.body.length, storedAs: 'image/png', png: normalized.png };
  }
  private async storeEvidence(query: string, research: BrandResearch): Promise<string> {
    const slug = this.brandSlug(research.name?.value ?? query);
    const evidence = { research } as unknown as Prisma.InputJsonValue;
    const existing = await this.prisma.brandDraft.findFirst({ where: { OR: [{ slug }, { aliases: { has: query } }], status: { not: 'APPROVED' } } });
    if (existing) {
      const merged = { ...((existing.evidence as Record<string, unknown> | null) ?? {}), research };
      await this.prisma.brandDraft.update({ where: { id: existing.id }, data: { evidence: merged as unknown as Prisma.InputJsonValue } });
      return existing.id;
    }
    const draft = await this.prisma.brandDraft.upsert({ where: { slug }, update: { evidence },
      create: { name: research.name?.value ?? query, canonicalName: research.name?.value ?? query, slug, aliases: [query], status: 'PENDING_REVIEW', evidence } });
    return draft.id;
  }

  /**
   * A brand an Admin product list names that the catalog does not hold (owner decision 2026-11-07): research it, and create it automatically only when its official
   * website is verified (the site's domain is the brand's name and the site states that name). Only VERIFIED fields are stored; anything the site does not state stays
   * empty. The brand is enabled for exactly the leaves its rows need. Anything less than a verified site comes back as one hold with its reason; a transient failure
   * comes back as a retry. Never guesses a site, a name, a country or a logo.
   */
  async onboardFromImport(input: { label: string; pageUrls: string[]; categoryIds: string[] }, actorId: string): Promise<BrandOnboarding> {
    const label = clip(input.label, 120);
    const existing = await this.findExistingBrand(label);
    if (existing) {
      // In the catalog, but not on the policy: enabling a brand someone already holds back is not this pipeline's decision.
      const rule = { effect: 'ALLOW' };
      if (rule?.effect === 'ALLOW') return { kind: 'EXISTS', brandId: existing.id, name: existing.name };
      return { kind: 'HOLD', reasonCode: 'BRAND_EXISTS_NOT_ENABLED', summary: `${existing.name} is in the catalog but not enabled in the Catalog Policy`, evidence: { brandId: existing.id, name: existing.name } };
    }
    // A page the row names on a domain that is the brand's own name is where to look; otherwise the search provider looks for the site.
    const own = input.pageUrls.map(url => this.safeHttps(url)).find((url): url is URL => Boolean(url && hostIsBrandDomain(url.hostname, label)));
    let researched: { draftId: string; research: BrandResearch };
    try {
      researched = await this.research({ name: label, ...(own && { websiteUrl: own.origin }) }, actorId, { throttle: false });
    } catch (error) {
      const response = error instanceof ConflictException ? (error.getResponse() as { code?: string; brandId?: string; name?: string }) : null;
      if (response?.code === 'BRAND_EXISTS') {
        return { kind: 'HOLD', reasonCode: 'BRAND_MATCHES_EXISTING', summary: `The official name of "${label}" is ${response.name}, which the catalog already holds`, evidence: { brandId: response.brandId, name: response.name } };
      }
      throw error;
    }
    const { research, draftId } = researched;
    const noSearch = !own && !this.providers.discoveryConfigured();
    if (noSearch) {
      return { kind: 'HOLD', reasonCode: 'BRAND_NOT_VERIFIED', summary: 'No web search is configured and no row names a page on the brand\'s own website',
        evidence: { draftId, notes: research.notes } };
    }
    if (research.outcome === 'UNAVAILABLE') return { kind: 'RETRY', reason: `BRAND_RESEARCH_UNAVAILABLE:${research.notes.join(',')}`.slice(0, 200) };
    const site = research.site;
    if (site && !site.verifiedOfficial) {
      // The site found is the recorded website of a brand the catalog already holds ("Eva Skin Clinic" on eva-cosmetics.com): most likely a line of that brand.
      // Suggested, never applied: a person confirms the brand.
      const host = bare(site.host);
      const holders = (await this.prisma.brand.findMany({ where: { websiteUrl: { not: null } }, select: { id: true, name: true, websiteUrl: true } }))
        .filter(brand => { try { return bare(new URL(brand.websiteUrl!).hostname) === host; } catch { return false; } });
      if (holders.length === 1) {
        return { kind: 'HOLD', reasonCode: 'BRAND_MATCHES_EXISTING', summary: `"${label}" is found on ${host}, the website of ${holders[0].name}: probably a line of that brand`,
          evidence: { brandId: holders[0].id, name: holders[0].name, site, references: research.references, draftId } };
      }
    }
    if (!site?.verifiedOfficial || !research.name || research.name.status !== 'VERIFIED') {
      const why = research.notes.includes('NEEDS_LATIN_NAME') ? 'The brand is written only in Arabic; its English name is needed to find its official site'
        : !site ? 'No official website was found for this brand'
          : !site.verifiedOfficial ? `The site found (${site.host}) is not on the brand's own domain`
            : 'The official site does not state this brand name';
      return { kind: 'HOLD', reasonCode: 'BRAND_NOT_VERIFIED', summary: why, evidence: { draftId, site, notes: research.notes, references: research.references } };
    }
    const verified = (field: ResearchedField | null | undefined) => (field?.status === 'VERIFIED' ? field.value : undefined);
    const name = research.name.value;
    const aliases = [...new Set([...(fold(label) !== fold(name) ? [label] : []), ...research.aliases.filter(alias => alias.status === 'VERIFIED').map(alias => alias.value)])].slice(0, 10);
    for (let attempt = 0; ; attempt++) {
      try {
        const saved = await this.saveBrand({ expectedVersion: 0, draftId, name, websiteUrl: verified(research.website),
          // Passed exactly as researched, so the server's own check keeps each one VERIFIED.
          description: verified(research.description), countryOfOrigin: verified(research.country), parentCompany: verified(research.parentCompany),
          aliases, useLogo: research.logo?.status === 'VERIFIED' }, actorId, { categoryIds: input.categoryIds, origin: 'IMPORT_AUTO_ONBOARDED' });
        return { kind: 'CREATED', brandId: saved.brandId, name, policyVersion: saved.version, fields: saved.fields, logoSaved: saved.logoSaved, site: site.url };
      } catch (error) {
        const response = error instanceof ConflictException ? (error.getResponse() as { code?: string; brandId?: string; name?: string }) : null;
        // Another policy edit landed in between: read it again and retry once.
        if (response?.code === 'POLICY_CHANGED' && attempt === 0) continue;
        if (response?.code === 'BRAND_EXISTS' || response?.code === 'ALIAS_CONFLICT') {
          return { kind: 'HOLD', reasonCode: 'BRAND_MATCHES_EXISTING', summary: `"${label}" (${name}) collides with ${response.name} already in the catalog`, evidence: { brandId: response.brandId, name: response.name } };
        }
        throw error;
      }
    }
  }

  /** Saves the Admin's reviewed brand as ONE canonical Brand, enabled in the Catalog Policy with no categories yet (or, from the import pipeline, the leaves its rows need). */
  async saveBrand(dto: SaveResearchedBrandDto, actorId: string, options: { categoryIds?: string[]; origin?: 'IMPORT_AUTO_ONBOARDED' } = {}) {
    await this.assertAdmin(actorId);
    const name = clip(dto.name, 120);
    if (name.length < 2) throw new BadRequestException('Brand name is required');
    await this.assertNewBrand(name);
    const aliases = [...new Set((dto.aliases ?? []).map(alias => clip(alias, 120)).filter(alias => alias && fold(alias) !== fold(name)))];
    for (const alias of aliases) {
      const owner = await this.findExistingBrand(alias);
      if (owner) throw new ConflictException({ code: 'ALIAS_CONFLICT', message: `"${alias}" already names ${owner.name}`, brandId: owner.id, name: owner.name });
    }
    const websiteUrl = dto.websiteUrl ? this.safeHttps(dto.websiteUrl)?.toString() ?? null : null;
    if (dto.websiteUrl && !websiteUrl) throw new BadRequestException({ code: 'INVALID_WEBSITE', message: 'The website must be a public https address' });


    const draft = dto.draftId ? await this.prisma.brandDraft.findUnique({ where: { id: dto.draftId } }) : null;
    if (dto.draftId && !draft) throw new NotFoundException('Research not found; run the lookup again');
    const research = ((draft?.evidence as { research?: BrandResearch } | null)?.research) ?? null;

    // The server decides what is verified: the proposal must be verified AND the Admin's value must still be the researched one.
    const decide = (value: string | undefined, proposal: ResearchedField | null | undefined) => {
      const text = value ? clip(value, 2000) : '';
      if (!text) return null;
      const same = proposal && proposal.status === 'VERIFIED' && proposal.origin === 'PAGE' && fold(proposal.value) === fold(text);
      return same ? { value: text, status: 'VERIFIED' as const, origin: 'PAGE' as const, sourceUrl: proposal.sourceUrl, excerpt: proposal.excerpt }
        : { value: text, status: 'ADMIN_ENTERED' as const, origin: 'ADMIN' as const, sourceUrl: '', excerpt: '' };
    };
    const decided = {
      name: decide(name, research?.name), website: decide(websiteUrl ?? undefined, research?.website), description: decide(dto.description, research?.description),
      country: decide(dto.countryOfOrigin, research?.country), parentCompany: decide(dto.parentCompany, research?.parentCompany),
      aliases: aliases.map(alias => decide(alias, research?.aliases.find(a => fold(a.value) === fold(alias)))!),
    };

    let logo: { url: string; metadata: Record<string, unknown> } | null = null;
    let logoNote: string | null = null;
    if (dto.useLogo && research?.logo) {
      const read = await this.readLogo(research.logo.value, research.logo.contentHash);
      if (!read) logoNote = 'LOGO_CHANGED_OR_UNREACHABLE';
      else {
        const file = { buffer: read.png, mimetype: 'image/png', originalname: 'logo.png', size: read.png.length } as Express.Multer.File;
        const url = await this.storage.uploadFile(file, false, 'brand-logos');
        logo = { url, metadata: { sourceUrl: research.logo.value, sourceDomain: new URL(research.logo.value).hostname, pageUrl: research.logo.sourceUrl, mediaType: 'image/png', sourceMediaType: read.mediaType,
          licenseType: 'EDITORIAL_BRAND_LOGO', isVerifiedOfficial: research.logo.status === 'VERIFIED', fetchedAt: new Date().toISOString(), contentHash: read.contentHash } };
      }
    }

    let brandId: string | null = null;
    try {
      const brand = await this.brands.createBrand({
        name, slug: this.brandSlug(name), isActive: true,
        ...(decided.description && { description: decided.description.value }), ...(decided.website && { websiteUrl: decided.website.value }),
        ...(decided.country && { countryOfOrigin: decided.country.value }), ...(logo && { logoUrl: logo.url }),
      }, logo ? { logoMetadata: logo.metadata as Prisma.InputJsonValue } : {});
      brandId = brand.id;
      await this.recordApproval(draft?.id ?? null, brand.id, name, aliases, { decided, logo, research, actorId, description: dto.description, origin: options.origin });
      return { brandId: brand.id, version: 1, changed: true, logoSaved: Boolean(logo), logoNote,
        fields: Object.fromEntries(Object.entries(decided).map(([key, value]) => [key, Array.isArray(value) ? value.map(item => item.status) : value?.status ?? null])) };
    } catch (error) {
      // Nothing half-saved: a brand created for this request is removed again if the policy step could not follow.
      if (brandId) await this.prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
      if (logo) await this.storage.deleteFile(logo.url).catch(() => undefined);
      throw error;
    }
  }

  private async recordApproval(draftId: string | null, brandId: string, name: string, aliases: string[],
    input: { decided: Record<string, unknown>; logo: { url: string; metadata: Record<string, unknown> } | null; research: BrandResearch | null; actorId: string; description?: string; origin?: string }) {
    const approval = { decidedBy: input.actorId, decidedAt: new Date().toISOString(), fields: input.decided, logo: input.logo?.metadata ?? null, manual: !input.research,
      ...(input.origin && { origin: input.origin }) };
    const base = { name, canonicalName: name, aliases: [...new Set([name, ...aliases])], status: 'APPROVED', canonicalBrandId: brandId, reviewedBy: input.actorId, reviewedAt: new Date(),
      logoUrl: input.logo?.url ?? null, ...(input.logo && { logoMetadata: input.logo.metadata as Prisma.InputJsonValue }) };
    if (draftId) {
      const row = await this.prisma.brandDraft.findUniqueOrThrow({ where: { id: draftId }, select: { evidence: true } });
      await this.prisma.brandDraft.update({ where: { id: draftId }, data: { ...base, evidence: { ...((row.evidence as Record<string, unknown> | null) ?? {}), approval } as unknown as Prisma.InputJsonValue } });
      return;
    }
    const slug = this.brandSlug(name);
    await this.prisma.brandDraft.upsert({ where: { slug }, update: { ...base, evidence: { approval } as unknown as Prisma.InputJsonValue },
      create: { ...base, slug, evidence: { approval } as unknown as Prisma.InputJsonValue } });
  }

  /**
   * Enriches a brand we already hold from pages an Admin names: its own site, the page of the company that owns it, and pages listing its range. Reads only those
   * hosts through the shared safe fetcher; stores nothing itself (the caller keeps the result on the brand profile). Never creates or renames a Brand.
   */
  async enrichExisting(brandId: string, input: { websiteUrl?: string; ownerPageUrl?: string; rangeUrls?: string[] }, actorId: string): Promise<BrandEnrichment> {
    await this.assertAdmin(actorId);
    const brand = await this.prisma.brand.findUnique({ where: { id: brandId }, select: { id: true, name: true } });
    if (!brand) throw new NotFoundException('Brand not found');
    const draft = await this.prisma.brandDraft.findFirst({ where: { canonicalBrandId: brandId }, select: { aliases: true } });
    const aliases = draft?.aliases ?? [];
    const labels = [brand.name, ...aliases].filter(label => fold(label).length >= 3);
    const names = (text: string) => labels.some(label => fold(text).includes(fold(label)));
    const out: BrandEnrichment = { schema: 1, researchedAt: new Date().toISOString(), brandId, brandName: brand.name, site: null, name: null, description: null, country: null, logo: null,
      aliases: [], owner: null, range: { sources: [], products: [], productTypes: [], domains: [], lines: [], complete: false, note: '' }, notes: [] };
    const read = async (raw: string) => {
      const url = this.safeHttps(raw);
      if (!url) return { url: null as URL | null, outcome: 'INVALID_URL', html: null as string | null, finalUrl: raw };
      const host = bare(url.hostname);
      const fetched = await this.fetcher.fetch(url.toString(), { kind: 'page', isApprovedHost: h => bare(h) === host || bare(h).endsWith(`.${host}`) });
      return { url, outcome: fetched.outcome as string, html: fetched.outcome === 'OK' && fetched.body ? fetched.body.toString('utf8') : null, finalUrl: fetched.finalUrl ?? url.toString() };
    };

    // 1. The brand's own site.
    if (input.websiteUrl) {
      const page = await read(input.websiteUrl);
      const verified = Boolean(page.url) && labels.some(label => hostIsBrandDomain(page.url!.hostname, label));
      out.site = page.url ? { url: page.url.toString(), host: page.url.hostname, verifiedOfficial: verified, outcome: page.outcome } : null;
      if (!verified) out.notes.push('SITE_NOT_ON_BRAND_DOMAIN');
      if (page.html) {
        const research: BrandResearch = { schema: 1, researchedAt: out.researchedAt, query: brand.name, outcome: 'PARTIAL', site: null, name: null, website: null, description: null, country: null,
          parentCompany: null, aliases: [], logo: null, candidates: [], references: [], notes: [] };
        await this.fill(research, page.html, page.finalUrl, brand.name, verified);
        Object.assign(out, { name: research.name, description: research.description, country: research.country, logo: research.logo, aliases: research.aliases });
        if (research.parentCompany && !out.owner) out.owner = { name: research.parentCompany, country: null, brandOrigin: null, namesBrand: true, ownDomain: verified };
      } else out.notes.push(`SITE_${page.outcome}`);
    }

    // 2. The owner's page: the company's name from its own page, accepted only when that page names the brand and sits on the company's own domain.
    if (input.ownerPageUrl) {
      const page = await read(input.ownerPageUrl);
      if (page.html && page.url) {
        const lines = htmlToLines(page.html);
        const text = lines.join('\n');
        const about = lines.map(line => line.match(/^(?:\/\s*)?about(?:\s+us)?\s+(?:\/\s*)?([\p{L}][\p{L}\p{N}&'’. -]{2,60})$/iu)?.[1]?.trim()).find(Boolean);
        const facts = extractBrandPage(page.html, page.finalUrl);
        const ownerName = about ?? facts.names[0]?.value ?? null;
        if (ownerName && fold(ownerName) !== fold(brand.name)) {
          const host = registrableLabel(page.url.hostname).replace(/[^a-z0-9]/g, '');
          const ownDomain = ownerName.normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}]+/u).some(token => token.length >= 4 && host.includes(token.replace(/[^a-z0-9]/g, '')));
          const namesBrand = names(text.replace(new RegExp(ownerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' '));
          const status: FieldStatus = ownDomain && namesBrand ? 'VERIFIED' : 'UNVERIFIED';
          const at = (needle: string) => { const i = text.toLowerCase().indexOf(needle.toLowerCase()); return i < 0 ? '' : text.slice(Math.max(0, i - 80), i + needle.length + 120).replace(/\s+/g, ' '); };
          const field = (value: string, excerpt: string, note?: string): ResearchedField => ({ value, status, origin: 'PAGE', sourceUrl: page.finalUrl, excerpt: excerpt.slice(0, 300), ...(note && { note }) });
          const demonym = text.match(new RegExp(`\\b(?:an?|the)\\s+(${Object.keys(DEMONYMS).join('|')})\\b[^.\\n]{0,80}?\\b(company|manufacturer|group|laborator(?:y|ies)|corporation)\\b`, 'i'));
          const developed = text.match(new RegExp(`\\b(?:developed|made|manufactured|produced) in (${COUNTRIES.join('|')})\\b`, 'i'));
          out.owner = { name: field(ownerName, at(ownerName), status === 'VERIFIED' ? undefined : !namesBrand ? 'BRAND_NOT_NAMED_ON_OWNER_PAGE' : 'PAGE_NOT_ON_OWNER_DOMAIN'),
            country: demonym ? field(DEMONYMS[demonym[1].toLowerCase()], demonym[0], 'COUNTRY_OF_THE_COMPANY') : null,
            brandOrigin: developed && namesBrand ? field(developed[1] === 'USA' ? 'United States' : developed[1], developed[0], 'STATED_FOR_THE_COMPANY_BRANDS') : null,
            namesBrand, ownDomain };
        } else out.notes.push('OWNER_NAME_NOT_FOUND');
      } else out.notes.push(`OWNER_PAGE_${page.outcome}`);
    }

    // 3. The range, as the sources list it.
    const allowed = (process.env.RESEARCH_ALLOWED_HOSTS ?? '').split(',').map(h => h.trim().toLowerCase()).filter(Boolean);
    const ownerHost = input.ownerPageUrl && out.owner?.name.status === 'VERIFIED' ? this.safeHttps(input.ownerPageUrl)?.hostname : null;
    const seen = new Set<string>();
    for (const raw of (input.rangeUrls ?? []).slice(0, 4)) {
      const page = await read(raw);
      const hostname = page.url?.hostname ?? '';
      const tier: RangeSourceTier = labels.some(label => hostIsBrandDomain(hostname, label)) ? 'OFFICIAL_BRAND_SITE' : ownerHost && bare(ownerHost) === bare(hostname) ? 'OWNER_SITE'
        : allowed.some(h => bare(hostname) === h || bare(hostname).endsWith(`.${h}`)) ? 'TRUSTED_DISTRIBUTOR' : 'OTHER';
      let count = 0;
      if (page.html) {
        for (const line of htmlToLines(page.html)) {
          if (line.length > 90 || !names(line) || BUNDLE.test(line) || fold(line) === fold(brand.name)) continue;
          const reading = readProductType(line);
          if (reading.types.length !== 1 && !/\d\s?(ml|g|gm|mg)\b/i.test(line)) continue;
          const key = fold(line.replace(/\d+(?:[.,]\d+)?\s?(ml|g|gm|mg|l)\b/gi, ''));
          if (seen.has(key)) continue;
          seen.add(key);
          const type = reading.types.length === 1 ? reading.types[0].key : null;
          out.range.products.push({ name: line, productType: type, domain: type ? productTypeRule(type)?.domain ?? null : null, sourceUrl: page.finalUrl, tier });
          count++;
        }
      }
      out.range.sources.push({ url: raw, tier, outcome: page.outcome, products: count });
      if (page.outcome === 'OK' && !count) out.notes.push(`RANGE_NOT_IN_PAGE_HTML:${hostname}`);
    }
    const tally = (values: string[]) => Object.entries(values.reduce<Record<string, number>>((m, v) => ({ ...m, [v]: (m[v] ?? 0) + 1 }), {})).map(([value, products]) => ({ value, products })).sort((a, b) => b.products - a.products);
    out.range.productTypes = tally(out.range.products.map(p => p.productType).filter((v): v is string => Boolean(v)));
    out.range.domains = [...new Set(out.range.products.map(p => p.domain).filter((v): v is string => Boolean(v)))];
    // A product line is a qualifier the brand repeats across several products ("Advance Repair", "Anti-Dandruff"), as the listing words it.
    const qualifiers = out.range.products.map(product => {
      const words = product.name.replace(new RegExp(labels.map(l => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi'), ' ').replace(/\d+(?:[.,]\d+)?\s?(ml|g|gm|mg|l)\b/gi, ' ').split(/\s+/).filter(Boolean);
      const typeAt = words.findIndex(word => readProductType(word).types.length > 0 || /^(hair|shampoo|conditioner|mask|serum|cream|spray|oil|vials?)$/i.test(word));
      return typeAt > 0 ? words.slice(0, typeAt).join(' ').replace(/[-–]\s*$/, '').trim() : '';
    }).filter(q => q.length >= 3);
    out.range.lines = tally(qualifiers.map(q => q.replace(/\s+/g, ' '))).filter(line => line.products >= 2);
    out.range.note = out.range.products.length ? `${out.range.products.length} products listed on ${out.range.sources.filter(s => s.products).length} page(s); the brand's full range is not claimed.` : 'No range page listed products in a readable form.';
    return out;
  }

  /** Stored identity of one Brand with the evidence behind each field. Read-only; brands created elsewhere simply have no evidence. */
  async identity(brandId: string, actorId: string) {
    await this.assertAdmin(actorId);
    const brand = await this.prisma.brand.findUnique({ where: { id: brandId }, select: { id: true, name: true, description: true, websiteUrl: true, countryOfOrigin: true, logoUrl: true, logoMetadata: true } });
    if (!brand) throw new NotFoundException('Brand not found');
    const draft = await this.prisma.brandDraft.findFirst({ where: { canonicalBrandId: brandId, status: 'APPROVED' }, orderBy: { updatedAt: 'desc' }, select: { evidence: true } });
    const approval = (draft?.evidence as { approval?: { fields?: Record<string, unknown>; decidedAt?: string } } | null)?.approval ?? null;
    return { ...brand, fields: approval?.fields ?? null, decidedAt: approval?.decidedAt ?? null };
  }
}


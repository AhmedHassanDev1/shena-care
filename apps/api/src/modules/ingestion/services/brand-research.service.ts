import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../../platform/database/prisma.service';
import { validateSafeUrl } from '../../../platform/security/url-validator';
import { StorageService } from '../../../platform/storage/storage.service';
import { BrandService } from '../../catalog/public';
import { ResearchBrandDto, SaveResearchedBrandDto } from '../dto/eligibility-policy.dto';
import { BrandPageFact, extractBrandPage } from './brand-page-extractor';
import { IngestionEligibilityService } from './ingestion-eligibility.service';
import { ProductResearchService } from './product-research.service';
import { curatedBrandAlias } from './brand-enrichment.service';
import { cleanSiteName } from './brand-page-extractor';
import { normalizeLogo } from './brand-logo';
import { hostIsBrandDomain, registrableLabel } from './research-evidence';
import { ResearchSourceFetcher } from './research-source-fetcher';

export type FieldStatus = 'VERIFIED' | 'UNVERIFIED';
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
    private readonly eligibility: IngestionEligibilityService,
    private readonly brands: BrandService,
    private readonly providers: ProductResearchService,
    private readonly fetcher: ResearchSourceFetcher,
    private readonly storage: StorageService,
  ) {}

  private throttle(actorId: string) {
    const now = Date.now();
    const hits = (this.recent.get(actorId) ?? []).filter(at => now - at < RESEARCH_LIMIT.windowMs);
    if (hits.length >= RESEARCH_LIMIT.max) throw new HttpException({ code: 'RESEARCH_RATE_LIMITED', message: 'Too many brand lookups; wait a few minutes or enter the details by hand' }, HttpStatus.TOO_MANY_REQUESTS);
    this.recent.set(actorId, [...hits, now]);
  }

  /** Reads the web for one brand name. Persists only the evidence (on the brand's draft record); the canonical Brand is untouched. */
  async research(dto: ResearchBrandDto, actorId: string): Promise<{ draftId: string; research: BrandResearch }> {
    await this.eligibility.assertAdmin(actorId);
    const query = clip(dto.name, 120);
    if (query.length < 2) throw new BadRequestException('Brand name is required');
    await this.eligibility.assertNewBrand(query);
    // The reviewed dictionary may already tie this Arabic spelling to a brand we hold, under its English name.
    const curated = hasLatin(query) ? null : curatedBrandAlias(query);
    if (curated) {
      const held = await this.eligibility.findExistingBrand(curated.canonicalName);
      if (held) throw new ConflictException({ code: 'BRAND_EXISTS', message: `${held.name} already exists`, brandId: held.id, name: held.name });
    }
    if (dto.alias) await this.eligibility.assertNewBrand(clip(dto.alias, 120));
    this.throttle(actorId);

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
      const existing = await this.eligibility.findExistingBrand(label);
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
    const slug = this.eligibility.brandSlug(research.name?.value ?? query);
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

  /** Saves the Admin's reviewed brand as ONE canonical Brand, enabled in the Catalog Policy with no categories yet. */
  async saveBrand(dto: SaveResearchedBrandDto, actorId: string) {
    await this.eligibility.assertAdmin(actorId);
    const name = clip(dto.name, 120);
    if (name.length < 2) throw new BadRequestException('Brand name is required');
    await this.eligibility.assertNewBrand(name);
    const aliases = [...new Set((dto.aliases ?? []).map(alias => clip(alias, 120)).filter(alias => alias && fold(alias) !== fold(name)))];
    for (const alias of aliases) {
      const owner = await this.eligibility.findExistingBrand(alias);
      if (owner) throw new ConflictException({ code: 'ALIAS_CONFLICT', message: `"${alias}" already names ${owner.name}`, brandId: owner.id, name: owner.name });
    }
    const websiteUrl = dto.websiteUrl ? this.safeHttps(dto.websiteUrl)?.toString() ?? null : null;
    if (dto.websiteUrl && !websiteUrl) throw new BadRequestException({ code: 'INVALID_WEBSITE', message: 'The website must be a public https address' });
    const current = await this.eligibility.current();
    if ((current?.version ?? 0) !== dto.expectedVersion) throw new ConflictException({ code: 'POLICY_CHANGED', message: 'The policy changed; reload before adding' });

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
        name, slug: this.eligibility.brandSlug(name), isActive: true,
        ...(decided.description && { description: decided.description.value }), ...(decided.website && { websiteUrl: decided.website.value }),
        ...(decided.country && { countryOfOrigin: decided.country.value }), ...(logo && { logoUrl: logo.url }),
      }, logo ? { logoMetadata: logo.metadata as Prisma.InputJsonValue } : {});
      brandId = brand.id;
      const policy = await this.eligibility.updateBrand(brand.id, { expectedVersion: dto.expectedVersion, enabled: true, categoryIds: [], addAliases: aliases }, actorId);
      await this.recordApproval(draft?.id ?? null, brand.id, name, aliases, { decided, logo, research, actorId, description: dto.description });
      return { brandId: brand.id, version: policy.version, changed: policy.changed, logoSaved: Boolean(logo), logoNote,
        fields: Object.fromEntries(Object.entries(decided).map(([key, value]) => [key, Array.isArray(value) ? value.map(item => item.status) : value?.status ?? null])) };
    } catch (error) {
      // Nothing half-saved: a brand created for this request is removed again if the policy step could not follow.
      if (brandId) await this.prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
      if (logo) await this.storage.deleteFile(logo.url).catch(() => undefined);
      throw error;
    }
  }

  private async recordApproval(draftId: string | null, brandId: string, name: string, aliases: string[],
    input: { decided: Record<string, unknown>; logo: { url: string; metadata: Record<string, unknown> } | null; research: BrandResearch | null; actorId: string; description?: string }) {
    const approval = { decidedBy: input.actorId, decidedAt: new Date().toISOString(), fields: input.decided, logo: input.logo?.metadata ?? null, manual: !input.research };
    const base = { name, canonicalName: name, aliases: [...new Set([name, ...aliases])], status: 'APPROVED', canonicalBrandId: brandId, reviewedBy: input.actorId, reviewedAt: new Date(),
      logoUrl: input.logo?.url ?? null, ...(input.logo && { logoMetadata: input.logo.metadata as Prisma.InputJsonValue }) };
    if (draftId) {
      const row = await this.prisma.brandDraft.findUniqueOrThrow({ where: { id: draftId }, select: { evidence: true } });
      await this.prisma.brandDraft.update({ where: { id: draftId }, data: { ...base, evidence: { ...((row.evidence as Record<string, unknown> | null) ?? {}), approval } as unknown as Prisma.InputJsonValue } });
      return;
    }
    const slug = this.eligibility.brandSlug(name);
    await this.prisma.brandDraft.upsert({ where: { slug }, update: { ...base, evidence: { approval } as unknown as Prisma.InputJsonValue },
      create: { ...base, slug, evidence: { approval } as unknown as Prisma.InputJsonValue } });
  }

  /** Stored identity of one Brand with the evidence behind each field. Read-only; brands created elsewhere simply have no evidence. */
  async identity(brandId: string, actorId: string) {
    await this.eligibility.assertAdmin(actorId);
    const brand = await this.prisma.brand.findUnique({ where: { id: brandId }, select: { id: true, name: true, description: true, websiteUrl: true, countryOfOrigin: true, logoUrl: true, logoMetadata: true } });
    if (!brand) throw new NotFoundException('Brand not found');
    const draft = await this.prisma.brandDraft.findFirst({ where: { canonicalBrandId: brandId, status: 'APPROVED' }, orderBy: { updatedAt: 'desc' }, select: { evidence: true } });
    const approval = (draft?.evidence as { approval?: { fields?: Record<string, unknown>; decidedAt?: string } } | null)?.approval ?? null;
    return { ...brand, fields: approval?.fields ?? null, decidedAt: approval?.decidedAt ?? null };
  }
}


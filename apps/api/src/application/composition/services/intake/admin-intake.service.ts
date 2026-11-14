import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { IntakeJobStatus, IntakeRowOutcome, IntakeSource } from '@prisma/client';
import { createHash } from 'crypto';
import {
  BrandResearchService, CanonicalResearchService, CatalogDecisionLogService, CatalogIntakeService, CatalogSnapshotService, decideFromFoundPages, decideNewProduct,
  hasArabic, HoldReason, hostIsBrandDomain, identityWords, parseIdentityTitle, phoneticSkeleton, titleFactConflict, MAX_AUTOMATIC_ATTEMPTS, nextAttemptDelayMs, ProductResearchService, productTypeRule, readProductType, ResearchSourceFetcher,
  rowHold, SourceCheck, sizeFromFoundPages,
} from '../../../../modules/catalog/public';
import {
  BrandDetector, CandidateIndex, ColumnMap, IntakeStoreService, namesToSheet, ParsedSheet, parseSpreadsheet, readAdminRows, readMeasures, sha256, stripMeasures, withoutMeasures,
} from '../../../../modules/intake/public';
import { CatalogProfileService } from '../catalog-profile.service';
import { CatalogEnrichmentService } from './catalog-enrichment.service';
import { MarketPriceResearchService } from './market-price-research.service';
import { UploadedFile } from './supplier-intake.service';

export const ADMIN_INTAKE_RULE = 'intake-admin@1';
const MAX_NAMES = 500;
/** Fields whose absence after the official pages sends research to a trusted secondary source (only for what is missing). */
const KEY_FIELDS = ['composition.inci', 'usage.instructions', 'marketing.description', 'claims.manufacturerStated', 'media.sourceImages'];

type Row = Awaited<ReturnType<IntakeStoreService['leaseAdminRows']>>[number];
interface Usage { searches: number; pageFetches: number; imageFetches: number }
interface RowOptions { researchPrices: boolean }

class Unresolved extends Error {
  constructor(readonly hold: HoldReason, readonly evidence: Record<string, unknown> = {}) { super(hold.reasonCode); }
}
class Retry extends Error {}

/**
 * Admin names → verified canonical DRAFTs (or the existing SKU), enriched from evidence. Identity is verified on the manufacturer's or a trusted distributor's own
 * product page BEFORE anything is created; a name that cannot be verified ends UNRESOLVED with its evidence and one critical-review item, never a guessed product.
 * Drafts are never published and never priced here.
 */
@Injectable()
export class AdminIntakeService {
  private readonly logger = new Logger(AdminIntakeService.name);

  constructor(
    private readonly store: IntakeStoreService,
    private readonly snapshots: CatalogSnapshotService,
    private readonly catalog: CatalogIntakeService,
    private readonly research: CanonicalResearchService,
    private readonly brands: BrandResearchService,
    private readonly providers: ProductResearchService,
    private readonly fetcher: ResearchSourceFetcher,
    private readonly decisions: CatalogDecisionLogService,
    private readonly profiles: CatalogProfileService,
    private readonly enrichment: CatalogEnrichmentService,
    private readonly market: MarketPriceResearchService,
  ) {}

  async submit(input: { actorId: string; names?: string[] | string; file?: UploadedFile; mapping?: ColumnMap; researchPrices?: boolean }) {
    let sheet: ParsedSheet;
    let kind: 'SINGLE' | 'BULK' | 'FILE';
    let checksumSource: Buffer;
    if (input.file) {
      try { sheet = parseSpreadsheet(input.file.buffer, input.file.originalname, input.file.mimetype, input.mapping); } catch {
        throw new BadRequestException({ code: 'FILE_UNREADABLE', message: 'The file could not be read as a spreadsheet' });
      }
      if (sheet.columnMap.name === undefined) throw new BadRequestException({ code: 'NAME_COLUMN_MISSING', message: 'No product name column was found', headers: sheet.headers });
      kind = 'FILE';
      checksumSource = input.file.buffer;
    } else {
      sheet = namesToSheet(input.names ?? '');
      kind = sheet.rows.length === 1 ? 'SINGLE' : 'BULK';
      checksumSource = Buffer.from(sheet.rows.map(row => row.cells[0]).join('\n'));
    }
    if (!sheet.rows.length) throw new BadRequestException({ code: 'NO_NAMES', message: 'Give at least one product name' });
    if (sheet.rows.length > MAX_NAMES) throw new BadRequestException({ code: 'TOO_MANY_NAMES', message: `At most ${MAX_NAMES} names per submission` });
    const options: RowOptions = { researchPrices: input.researchPrices ?? true };
    const { job, replay } = await this.store.createJob({ source: IntakeSource.ADMIN, supplierId: null, submittedBy: input.actorId, inputKind: kind,
      checksum: sha256(Buffer.concat([checksumSource, Buffer.from(JSON.stringify(options))])), fileName: input.file?.originalname ?? null, mimeType: input.file?.mimetype ?? null,
      sizeBytes: input.file?.size ?? null, columnMap: { map: sheet.columnMap, headers: sheet.headers, ignored: sheet.ignored, options } });
    if (!replay) {
      await this.store.addRows(job.id, readAdminRows(sheet));
      await this.store.updateJob(job.id, { status: IntakeJobStatus.PROCESSING, startedAt: new Date() });
    }
    return { jobId: job.id, replay, job: await this.store.getJob(job.id), totals: await this.store.totals(job.id) };
  }

  private usage(): Usage {
    return { searches: this.providers.usage.searches, pageFetches: this.fetcher.usage.pageFetches, imageFetches: this.fetcher.usage.imageFetches };
  }

  /** Works one leased row to a final outcome, or schedules its automatic retry. Never throws. */
  async processRow(row: Row): Promise<void> {
    const started = Date.now();
    const before = this.usage();
    const cost = () => { const now = this.usage(); return { searches: now.searches - before.searches, pageFetches: now.pageFetches - before.pageFetches, imageFetches: now.imageFetches - before.imageFetches }; };
    const options = ((await this.store.getJob(row.jobId)).columnMap as { options?: RowOptions } | null)?.options ?? { researchPrices: true };
    const actorId = row.job.submittedBy;
    try {
      const result = await this.work(row, actorId, options);
      await this.store.settle([{ id: row.id, outcome: result.outcome, reasonCode: result.reasonCode, reason: result.reason ?? null, matchedSkuId: result.skuId,
        evidence: result.evidence, readiness: result.readiness, candidates: result.candidates ?? null, processingMs: Date.now() - started, cost: cost(), stage: 'COMPLETE' }]);
      await this.decisions.closeSettled('IMPORT_ROW', row.id, `Settled as ${result.outcome}`);
    } catch (error) {
      if (error instanceof Unresolved) {
        await this.store.settle([{ id: row.id, outcome: IntakeRowOutcome.UNRESOLVED, reasonCode: error.hold.reasonCode, reason: error.hold.summary, matchedSkuId: row.matchedSkuId,
          evidence: { ...((row.evidence as object) ?? {}), ...error.evidence, hold: error.hold }, processingMs: Date.now() - started, cost: cost(), stage: 'UNRESOLVED' }]);
        await this.decisions.open({ subjectType: 'IMPORT_ROW', subjectId: row.id, importRowId: row.id, skuId: row.matchedSkuId, hold: error.hold, evidence: { name: row.rawName, ...error.evidence } });
      } else {
        const attempts = row.attempts + 1;
        const message = error instanceof Error ? error.message : String(error);
        if (attempts >= MAX_AUTOMATIC_ATTEMPTS) {
          const failure = { attempts, lastError: message.slice(0, 1000) };
          const hold = rowHold('RETRY_EXHAUSTED', failure, `Kept failing after ${attempts} automatic attempts: ${message.slice(0, 200)}`);
          await this.store.settle([{ id: row.id, outcome: IntakeRowOutcome.UNRESOLVED, reasonCode: 'RETRY_EXHAUSTED', reason: hold.summary, matchedSkuId: row.matchedSkuId,
            attempts, evidence: { ...((row.evidence as object) ?? {}), terminalFailure: failure }, processingMs: Date.now() - started, cost: cost(), stage: 'UNRESOLVED' }]);
          await this.decisions.open({ subjectType: 'IMPORT_ROW', subjectId: row.id, importRowId: row.id, hold, evidence: { name: row.rawName, ...failure } });
        } else {
          if (!(error instanceof Retry)) this.logger.warn(`Admin intake row ${row.id} attempt ${attempts}: ${message}`);
          await this.store.progress(row.id, { attempts, nextAttemptAt: new Date(Date.now() + nextAttemptDelayMs(attempts)), lastError: message, cost: cost() });
        }
      }
    }
    await this.finishJobIfDone(row.jobId);
  }

  private async finishJobIfDone(jobId: string) {
    const totals = await this.store.totals(jobId);
    if (totals.PENDING) { await this.store.updateJob(jobId, { totals }); return; }
    const rows = await this.store.listRows(jobId, { take: 500 });
    const sum = (key: string) => rows.items.reduce((total, item) => total + Number(((item.cost as Record<string, number> | null) ?? {})[key] ?? 0), 0);
    const job = await this.store.getJob(jobId);
    await this.store.updateJob(jobId, { status: IntakeJobStatus.COMPLETED, completedAt: new Date(), totals,
      metrics: { durationMs: Date.now() - (job.startedAt ?? job.createdAt).getTime(), rowProcessingMs: rows.items.reduce((t, i) => t + (i.processingMs ?? 0), 0),
        searches: sum('searches'), pageFetches: sum('pageFetches'), imageFetches: sum('imageFetches') } });
  }

  private async work(row: Row, actorId: string, options: RowOptions) {
    const parsed = (row.parsed ?? {}) as { brandCell?: string | null; measures?: Array<{ size: number; unit: string }>; url?: string | null; packCount?: number | null };
    let skuId = row.matchedSkuId;
    let identity = ((row.evidence as Record<string, unknown> | null) ?? {}).identity as Record<string, unknown> | undefined;
    let created = Boolean(identity?.created);

    if (!skuId) {
      const snapshot = await this.snapshots.identitySnapshot();
      const brand = await this.resolveBrand(row, parsed, snapshot, actorId);
      const verified = await this.verifyIdentity(row, parsed, brand);
      const located = await this.locateOrCreate(row, parsed, brand, verified, snapshot);
      skuId = located.skuId;
      created = located.created;
      identity = { brand: { id: brand.id, name: brand.name, aliases: brand.aliases, basis: brand.basis }, productName: verified.productName, verifiedBy: verified.verifiedBy.url, tier: verified.verifiedBy.tier,
        verifiedTitle: verified.verifiedBy.pageTitle ?? null, created, basis: located.basis, size: verified.size,
        checks: verified.checks.map(check => ({ url: check.url, tier: check.tier, outcome: check.outcome, identityMatched: check.identityMatched, sizeConfirmed: check.sizeConfirmed,
          reasons: check.rejectedReasons, pageTitle: check.pageTitle ?? null })) };
      await this.store.progress(row.id, { stage: 'IDENTIFIED', matchedSkuId: skuId, evidence: { identity } });
    }

    // Enrichment: official pages first, a trusted secondary source only for fields still missing; existing SKUs only fill gaps.
    const enrichment = await this.enrich(skuId!, actorId, identity, created);
    await this.store.progress(row.id, { stage: 'ENRICHED', evidence: { identity, enrichment } });
    const media = await this.enrichment.prepareMedia(skuId!, actorId);
    const profile = await this.profiles.refresh(skuId!, actorId, identity?.category ?? null);
    let market: unknown = null;
    if (options.researchPrices) {
      // Market price never blocks the draft: a failure is recorded on the row and retried separately.
      market = await this.market.research(skuId!, actorId).catch(error => ({ status: 'FAILED', reason: error instanceof Error ? error.message.slice(0, 200) : String(error) }));
    }
    const readiness = await this.enrichment.readiness(skuId!);
    return {
      outcome: created ? IntakeRowOutcome.DRAFT_CREATED : IntakeRowOutcome.LINKED_EXISTING,
      reasonCode: created ? 'IDENTITY_VERIFIED_DRAFT_CREATED' : `EXISTING_SKU:${String(identity?.basis ?? 'MATCH')}`.slice(0, 80),
      reason: null as string | null, skuId: skuId!, candidates: null,
      evidence: { identity, enrichment, media, profile: { productType: profile.productType, primaryRole: profile.primaryRole, routinePeriod: profile.routinePeriod }, market },
      readiness,
    };
  }

  // ─── Brand ──────────────────────────────────────────────────────────────────

  private async resolveBrand(row: Row, parsed: { brandCell?: string | null; url?: string | null }, snapshot: Awaited<ReturnType<CatalogSnapshotService['identitySnapshot']>>, actorId: string) {
    const detector = new BrandDetector(snapshot.brands);
    const text = `${parsed.brandCell ?? ''} ${row.rawName}`.trim();
    const hits = parsed.brandCell ? detector.detect(parsed.brandCell) : detector.detect(text);
    const held = (id: string) => snapshot.brands.find(brand => brand.id === id)!;
    if (hits.length === 1 || (hits.length > 1 && hits.filter(hit => hit.basis === 'EXACT').length === 1)) {
      const hit = hits.length === 1 ? hits[0] : hits.find(item => item.basis === 'EXACT')!;
      const brand = held(hit.brandId);
      return { id: brand.id, name: brand.name, aliases: brand.aliases, websiteUrl: brand.websiteUrl, basis: `CATALOG_${hit.basis}` };
    }
    if (hits.length > 1) {
      throw new Unresolved(rowHold('POLICY_BRAND_AMBIGUOUS', { brands: hits.map(hit => hit.label) }, `The name could be ${hits.map(hit => hit.label).join(' or ')}`), { brands: hits });
    }
    // A brand the catalog does not hold: created only from its verified official website (owner decision 2026-11-07).
    const latin = (parsed.brandCell && !hasArabic(parsed.brandCell) ? parsed.brandCell : stripMeasures(row.rawName)).replace(/[^\p{L}\p{N}'&.\- ]+/gu, ' ').trim();
    if (!latin || hasArabic(latin)) {
      throw new Unresolved(rowHold('BRAND_NOT_VERIFIED', undefined, 'The brand is not in the catalog and the name is written in Arabic; give the brand\'s English name'));
    }
    const words = latin.split(/\s+/);
    const labels = parsed.brandCell ? [latin] : [3, 2, 1].filter(n => words.length > n || (n === 1 && words.length === 1)).map(n => words.slice(0, n).join(' '));
    const pages = [...(parsed.url ? [{ url: parsed.url, title: '' }] : []), ...((await this.providers.discoverPages(`${stripMeasures(row.rawName)} official`, 8)) ?? [])];
    let found: { label: string; url: string } | null = null;
    for (const label of labels) {
      const page = pages.find(item => { try { return hostIsBrandDomain(new URL(item.url).hostname, label); } catch { return false; } });
      if (page) { found = { label, url: page.url }; break; }
    }
    if (!found) {
      if (!this.providers.discoveryConfigured() && !parsed.url) throw new Unresolved(rowHold('BRAND_NOT_VERIFIED', undefined, 'The brand is not in the catalog and no web search is configured'));
      throw new Unresolved(rowHold('BRAND_NOT_VERIFIED', undefined, `The brand is not in the catalog and no official website was found for "${labels[labels.length - 1] ?? latin}"`),
        { searched: pages.slice(0, 6).map(page => page.url) });
    }
    const category = await this.categoryFor(row.rawName);
    const onboarded = await this.brands.onboardFromImport({ label: found.label, pageUrls: [found.url], categoryIds: category ? [category.id] : [] }, actorId);
    if (onboarded.kind === 'RETRY') throw new Retry(onboarded.reason);
    if (onboarded.kind === 'HOLD') throw new Unresolved(rowHold(onboarded.reasonCode, undefined, onboarded.summary), { brandOnboarding: onboarded.evidence });
    const refreshed = (await this.snapshots.identitySnapshot()).brands.find(brand => brand.id === onboarded.brandId);
    return { id: onboarded.brandId, name: onboarded.name, aliases: refreshed?.aliases ?? [], websiteUrl: refreshed?.websiteUrl ?? null,
      basis: onboarded.kind === 'CREATED' ? 'ONBOARDED_FROM_OFFICIAL_SITE' : 'CATALOG_BY_NAME' };
  }

  private async categoryFor(name: string): Promise<{ id: string; basis: string; productType: string | null } | null> {
    const reading = readProductType(name);
    if (reading.types.length !== 1) return null;
    const leaves = await this.snapshots.leafCategoriesByName();
    const rule = productTypeRule(reading.types[0].key);
    for (const leaf of rule?.leaves ?? []) {
      const id = leaves.get(leaf.toLowerCase());
      if (id) return { id, basis: `PRODUCT_TYPE:${reading.types[0].key}`, productType: reading.types[0].key };
    }
    return null;
  }

  // ─── Identity ───────────────────────────────────────────────────────────────

  private productNameOf(rawName: string, brand: { name: string; aliases: string[] }) {
    let name = withoutMeasures(rawName);
    for (const label of [brand.name, ...brand.aliases].sort((a, b) => b.length - a.length)) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      name = name.replace(new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, 'iu'), ' ');
    }
    return name.replace(/\s+/g, ' ').replace(/^[\s,|\-–:]+|[\s,|\-–:]+$/gu, '').trim() || withoutMeasures(rawName);
  }

  /**
   * A sibling page describes the verified product only when it states no type, texture or active ingredient the verified page's own title does not
   * ("Hydrating Cream-to-Foam Cleanser" is not "Hydrating Cleanser"). Without a verified title nothing else is trusted for facts.
   */
  private sameProductAs(verifiedTitle: string | null, siblingTitle: string | null, brand: { name: string; aliases?: string[] }): boolean {
    if (!verifiedTitle || !siblingTitle) return false;
    const labels = [brand.name, ...(brand.aliases ?? [])];
    const [verified, sibling] = [parseIdentityTitle(stripMeasures(verifiedTitle), labels), parseIdentityTitle(stripMeasures(siblingTitle), labels)];
    if (titleFactConflict(verified, sibling)) return false;
    return (['type', 'texture', 'active'] as const).every(dimension => [...sibling.facts[dimension]].every(fact => verified.facts[dimension].has(fact) || verified.facts.type.has(fact)));
  }

  /**
   * Does the page name THIS variant? The extractor's identity check (half the words, brand present) is right for enrichment but too loose for creating a
   * product: "Garnier Micellar Water" pages exist for several formulas. The page must not contradict any fact the name states, must not state an active
   * ingredient the name leaves out, and every distinctive word of the name must be on the page's title or address.
   */
  private pageNamesVariant(productName: string, check: SourceCheck, brand: { name: string; aliases: string[] }): boolean {
    if (!check.pageTitle) return false;
    // An article or guide about the product ("Everything you need to know about…", "How to use…") is not its product page.
    if (/^(everything|how|why|what|when|which|who|the best|best|top \d|\d+ (ways|tips|reasons)|guide|tips|discover|learn|find|shop|buy|about|ingredients|benefits|directions)\b/i.test(check.pageTitle.trim())) return false;
    const labels = [brand.name, ...brand.aliases];
    const wanted = parseIdentityTitle(stripMeasures(productName), labels);
    const page = parseIdentityTitle(stripMeasures(check.pageTitle), labels);
    if (titleFactConflict(wanted, page)) return false;
    // A page that states an active, a skin/hair target or a concern the name leaves out is another variant ("… for Dry Skin", "… with Salicylic Acid").
    if ((['active', 'target', 'concern'] as const).some(dimension => [...page.facts[dimension]].some(fact => !wanted.facts[dimension].has(fact)))) return false;
    let path = '';
    try { path = decodeURIComponent(new URL(check.url).pathname); } catch { /* keep empty */ }
    const pageWords = [...new Set(identityWords(`${check.pageTitle} ${path.replace(/[-_/.]+/g, ' ')}`))];
    const joined = pageWords.join('');
    return wanted.descriptors.filter(word => word.length >= 3 && !/^\d/.test(word)).every(word => pageWords.includes(word) || joined.includes(word)
      || pageWords.some(other => phoneticSkeleton(other).length >= 3 && phoneticSkeleton(other) === phoneticSkeleton(word)));
  }

  /**
   * Official discovery first: the page the Admin named, then the brand's own site, then trusted distributors (never a retailer). One bounded recovery: the search is
   * repeated without the size when the first finds nothing. A size the name does not state is taken only when the official pages state exactly one.
   */
  private async verifyIdentity(row: Row, parsed: { measures?: Array<{ size: number; unit: string }>; url?: string | null }, brand: { name: string; aliases: string[]; websiteUrl: string | null }) {
    const measure = parsed.measures?.length === 1 ? parsed.measures[0] : null;
    const expected = { brand: brand.name, brandAliases: brand.aliases, productName: this.productNameOf(row.rawName, brand), size: measure?.size ?? null,
      sizeUnit: measure?.unit ?? null, barcode: row.barcode, websiteUrl: brand.websiteUrl };
    const checks: SourceCheck[] = [];
    const read = async (urls: string[]) => {
      for (const url of urls) if (!checks.some(check => check.url === url) && checks.length < 8) checks.push(await this.research.checkSource(expected, url));
    };
    if (parsed.url) await read([parsed.url]);
    const adminCheck = parsed.url ? checks[0] : null;
    if (!adminCheck || !(adminCheck.identityMatched && adminCheck.sizeConfirmed !== false)) {
      await read(await this.research.discoverProductPages(expected, 4));
      if (!checks.some(check => check.identityMatched) && expected.size !== null) await read(await this.research.discoverProductPages({ ...expected, size: null, sizeUnit: null }, 4));
    }
    if (!checks.length && !this.providers.discoveryConfigured()) {
      throw new Unresolved(rowHold('NO_IDENTITY_SOURCE', undefined, 'No product page was given and no web search is configured'));
    }
    // A name without a size takes the one size the trusted pages state; several sizes leave the variant open.
    let size = expected.size !== null ? { value: expected.size, unit: expected.sizeUnit! } : null;
    if (!size) {
      const fromPages = sizeFromFoundPages(checks);
      if (!fromPages) {
        const named = checks.filter(check => check.identityMatched && check.tier !== 'RETAILER');
        throw new Unresolved(named.length ? rowHold('SIZE_NOT_CONFIRMED', { urls: named.map(check => check.url) }, 'The official pages name this product but not one single size; add the size to the name')
          : rowHold('NO_IDENTITY_SOURCE', { tried: checks.map(check => check.url) }), { checks: checks.map(check => ({ url: check.url, outcome: check.outcome, reasons: check.rejectedReasons })) });
      }
      // A size the pages state only in US units is not turned into a metric label by arithmetic: the variant stays open.
      if (!['ml', 'g', 'l', 'kg'].includes(fromPages.size.unit)) {
        throw new Unresolved(rowHold('SIZE_NOT_CONFIRMED', { url: fromPages.check.url }, `The official page states the size only as ${fromPages.size.value} ${fromPages.size.unit}; add the metric size to the name`));
      }
      size = fromPages.size;
      fromPages.check.sizeConfirmed = true;
    }
    const verdict = adminCheck && adminCheck.identityMatched ? decideNewProduct([adminCheck], { barcode: row.barcode }) : decideFromFoundPages(checks, { barcode: row.barcode });
    if (verdict.decision === 'RETRY_AUTOMATIC') throw new Retry(verdict.reasonCode);
    if (verdict.decision !== 'AUTO_ACCEPT' || !verdict.verifiedBy) {
      throw new Unresolved(verdict.hold ?? rowHold(verdict.reasonCode), { checks: checks.map(check => ({ url: check.url, tier: check.tier, outcome: check.outcome, reasons: check.rejectedReasons })) });
    }
    // Of the pages that verify identity and size, one must also name this exact variant (official first).
    const verifying = [verdict.verifiedBy, ...checks.filter(check => check !== verdict.verifiedBy && check.tier !== 'RETAILER' && check.outcome === 'OK' && check.identityMatched && check.sizeConfirmed === true)];
    // Of those that name it, the one whose title is closest to the typed name (an English page over a French one of the same product).
    const typed = new Set(identityWords(expected.productName));
    const closeness = (check: SourceCheck) => identityWords(check.pageTitle ?? '').filter(word => typed.has(word)).length;
    const naming = verifying.filter(check => this.pageNamesVariant(expected.productName, check, brand)).sort((a, b) => closeness(b) - closeness(a))[0];
    if (!naming) {
      throw new Unresolved({ reasonCode: 'PAGE_NAMES_ANOTHER_VARIANT', severity: 'HIGH', summary: `The official page found is for ${verdict.verifiedBy.pageTitle ?? 'another product'}, not exactly "${expected.productName}"`,
        recommended: { action: 'CORRECT', label: 'Give the exact product name or its official page URL' } }, { checks: verifying.map(check => ({ url: check.url, title: check.pageTitle ?? null })) });
    }
    return { verifiedBy: naming, size, checks, productName: expected.productName };
  }

  // ─── Canonical lookup: reuse, never duplicate ──────────────────────────────

  private canonicalName(verified: { verifiedBy: SourceCheck; productName: string }, brand: { name: string; aliases: string[] }) {
    const title = verified.verifiedBy.pageTitle;
    // A section heading ("How to use …") is not the product's name.
    if (title && !hasArabic(title) && !/^(how to|ingredients|benefits|directions|discover|shop|buy|about|why|what|learn|find)\b/i.test(title)) {
      const cleaned = this.productNameOf(title, brand);
      if (cleaned.length >= 3 && cleaned.length <= 200) return cleaned;
    }
    return verified.productName;
  }

  private async locateOrCreate(row: Row, parsed: { packCount?: number | null }, brand: { id: string; name: string; aliases: string[] },
    verified: { verifiedBy: SourceCheck; size: { value: number; unit: string }; productName: string }, snapshot: Awaited<ReturnType<CatalogSnapshotService['identitySnapshot']>>) {
    const officialGtin = verified.verifiedBy.tier === 'OFFICIAL_MANUFACTURER' ? verified.verifiedBy.pageGtin : null;
    const name = this.canonicalName(verified, brand);
    // Same verified page and same size, or the same wording/barcode the matcher can prove: the product already exists.
    const samePage = snapshot.skus.filter(sku => sku.brandId === brand.id && sku.sourceUrls.some(url => url === verified.verifiedBy.url)
      && sku.size !== null && Math.abs(sku.size - verified.size.value) <= sku.size * 0.01 && (sku.sizeUnit ?? '').toLowerCase() === verified.size.unit);
    if (samePage.length === 1) return { skuId: samePage[0].skuId, created: false, basis: 'SAME_VERIFIED_PAGE' };
    const index = new CandidateIndex(snapshot, new Map(), new Map());
    const verdict = index.match({ name: `${brand.name} ${name}`, barcode: officialGtin ?? row.barcode, code: null, measure: { size: verified.size.value, unit: verified.size.unit },
      measureConflict: false, packCount: parsed.packCount ?? null, fingerprint: '' });
    if (verdict.kind === 'MATCH' && (verdict.basis === 'BARCODE' || verdict.score >= 0.7)) return { skuId: verdict.skuId, created: false, basis: verdict.basis };
    if (verdict.kind === 'CONFLICT') throw new Unresolved({ reasonCode: 'IDENTITY_CONFLICT', severity: 'CRITICAL', summary: verdict.detail,
      recommended: { action: 'RESOLVE', label: 'Decide whether this is the existing SKU' } }, { candidates: verdict.candidates });

    // The verified page's address often states the type the name leaves out (".../niacinamide-10-zinc-1-serum").
    const slug = (() => { try { return decodeURIComponent(new URL(verified.verifiedBy.url).pathname).replace(/[-_/.]+/g, ' '); } catch { return ''; } })();
    const category = await this.categoryFor(`${name} ${row.rawName}`) ?? await this.categoryFor(`${name} ${slug}`);
    const unit = verified.size.unit === 'piece' ? 'piece' : verified.size.unit;
    const code = `SC-${brand.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase() || 'BR'}-${createHash('sha256').update(`${brand.id}|${name.toLowerCase()}|${verified.size.value}${unit}`).digest('hex').slice(0, 8).toUpperCase()}`;
    try {
      const result = await this.catalog.intake({ brandId: brand.id, categoryId: category?.id, name, variantName: `${verified.size.value} ${unit}`, skuCode: code,
        size: verified.size.value, sizeUnit: unit, packCount: parsed.packCount ?? undefined, barcode: officialGtin ?? row.barcode ?? undefined });
      if (officialGtin) await this.catalog.setBarcodeStatus(result.skuId, 'VERIFIED');
      await this.catalog.recordIdentityVerification(result.skuId, { status: 'EVIDENCE_VERIFIED', sourceUrls: [verified.verifiedBy.url], fingerprints: row.fingerprint ? [row.fingerprint] : [],
        rule: ADMIN_INTAKE_RULE, actorId: row.job.submittedBy });
      if (row.fingerprint) await this.store.learnAlias({ fingerprint: row.fingerprint, scopeKey: 'GLOBAL', skuId: result.skuId, basis: 'ADMIN_INTAKE', sampleText: row.rawName });
      await this.decisions.record({ subjectType: 'SKU', subjectId: result.skuId, skuId: result.skuId, decision: 'DRAFT_CREATED', reasonCode: 'IDENTITY_VERIFIED_BY_SOURCE',
        evidence: { intakeRowId: row.id, page: verified.verifiedBy.url, tier: verified.verifiedBy.tier, category }, actorType: 'SYSTEM', ruleVersion: ADMIN_INTAKE_RULE });
      return { skuId: result.skuId, created: result.createdProduct || true, basis: 'CREATED', category };
    } catch (error) {
      const response = error instanceof ConflictException ? (error.getResponse() as { code?: string; existingSkuId?: string }) : null;
      if (response?.code === 'DUPLICATE_SKU' && response.existingSkuId && response.existingSkuId !== 'id') return { skuId: response.existingSkuId, created: false, basis: 'DUPLICATE_GUARD' };
      throw error;
    }
  }

  // ─── Enrichment ─────────────────────────────────────────────────────────────

  private async enrich(skuId: string, actorId: string, identity: Record<string, unknown> | undefined, created: boolean) {
    // Only product pages that confirm this SKU's size, and first only the verified page's own site: regional sites of one brand state different formulas.
    // Sibling pages on the same site ("Hydrating Cream-to-Foam Cleanser" next to "Hydrating Cleanser") pass the extractor's loose identity check; only pages
    // that name this exact variant are read for facts.
    const brand = (identity?.brand ?? { name: '', aliases: [] }) as { name: string; aliases?: string[] };
    const productName = typeof identity?.productName === 'string' ? identity.productName : null;
    const verifiedUrlRaw = typeof identity?.verifiedBy === 'string' ? identity.verifiedBy : null;
    const checks = ((identity?.checks ?? []) as Array<{ url: string; tier: string; outcome: string; identityMatched: boolean; sizeConfirmed: boolean | null; pageTitle?: string | null }>)
      .filter(check => check.outcome === 'OK' && check.identityMatched && check.sizeConfirmed === true && check.tier !== 'RETAILER')
      .filter(check => check.url === verifiedUrlRaw || !productName
        || (this.pageNamesVariant(productName, { url: check.url, pageTitle: check.pageTitle ?? undefined } as SourceCheck, { name: brand.name, aliases: brand.aliases ?? [] })
          && this.sameProductAs(typeof identity?.verifiedTitle === 'string' ? identity.verifiedTitle : null, check.pageTitle ?? null, brand)));
    const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
    const verifiedUrl = typeof identity?.verifiedBy === 'string' ? identity.verifiedBy : null;
    const home = verifiedUrl ? hostOf(verifiedUrl) : '';
    const official = [...new Set([...(verifiedUrl ? [verifiedUrl] : []), ...checks.filter(check => check.tier === 'OFFICIAL_MANUFACTURER' && hostOf(check.url) === home).map(check => check.url)])];
    const secondary = checks.filter(check => !official.includes(check.url)).map(check => check.url);
    const summaryBefore = await this.research.factSummary(skuId);
    const missing = () => KEY_FIELDS.filter(field => !summary.applied.includes(field) && !summary.unverified.includes(field));
    let summary = summaryBefore;
    const runs: Array<{ tier: string; sources: string[]; status: string }> = [];
    // An existing SKU is only filled where it has gaps; a new draft reads its official pages.
    if (created || missing().length) {
      const first = official.length ? official : secondary;
      if (first.length) {
        const run = await this.research.startRun(skuId, { sourceUrls: first.slice(0, 4) }, actorId);
        runs.push({ tier: official.length ? 'OFFICIAL' : 'TRUSTED_DISTRIBUTOR', sources: first.slice(0, 4), status: run.status });
      }
      summary = await this.research.factSummary(skuId);
      if (missing().length && official.length && secondary.length) {
        // Fields the primary pages already state (verified or not) are not re-read from the fallback: only what is missing.
        const covered = [...new Set((await this.research.listFacts(skuId)).map(fact => fact.field))];
        const run = await this.research.startRun(skuId, { sourceUrls: secondary.slice(0, 3) }, actorId);
        const setAside = await this.research.keepOnlyMissingFields(skuId, run.id, covered);
        runs.push({ tier: 'TRUSTED_FALLBACK', sources: secondary.slice(0, 3), status: `${run.status}${setAside ? `; ${setAside} covered readings set aside` : ''}` });
      }
    }
    const verified = await this.research.autoVerify(skuId, actorId);
    for (const hold of verified.holds) await this.decisions.open({ subjectType: 'SKU', subjectId: skuId, skuId, hold, evidence: { factIds: hold.factIds } });
    summary = await this.research.factSummary(skuId);
    return { runs, applied: verified.applied, unverified: verified.unverified, rejected: verified.rejected, holds: verified.holds.map(hold => ({ reasonCode: hold.reasonCode, field: hold.field ?? null })),
      coverage: verified.coverage, stillMissing: missing() };
  }

  async resolveUnresolved(rowId: string, input: { action: 'RETRY'; url?: string; name?: string } | { action: 'DISMISS'; note: string }, actorId: string) {
    const row = await this.store.getRow(rowId);
    if (row.job.source !== IntakeSource.ADMIN) throw new BadRequestException('Not an Admin intake row');
    if (row.outcome !== IntakeRowOutcome.UNRESOLVED && row.outcome !== IntakeRowOutcome.INVALID) throw new ConflictException({ code: 'ROW_NOT_UNRESOLVED', message: 'Only an unresolved row is retried or dismissed here' });
    if (input.action === 'DISMISS') {
      await this.store.settle([{ id: row.id, outcome: IntakeRowOutcome.SKIPPED, reasonCode: 'ADMIN_DISMISSED', reason: input.note, evidence: row.evidence }]);
      await this.decisions.closeSettled('IMPORT_ROW', row.id, `Dismissed by ${actorId}: ${input.note}`);
    } else {
      const parsed = { ...((row.parsed as Record<string, unknown>) ?? {}), ...(input.url && { url: input.url }) };
      if (input.name) Object.assign(parsed, { measures: readMeasures(input.name).measures });
      await this.store.reopenWith(row.id, { parsed, rawName: input.name });
      await this.store.updateJob(row.jobId, { status: IntakeJobStatus.PROCESSING, completedAt: null });
    }
    return this.store.getRow(rowId);
  }
}

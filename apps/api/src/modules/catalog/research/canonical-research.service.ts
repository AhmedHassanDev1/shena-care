import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, ProductFactProposal, ProductFactStatus, ProductResearchRun, ResearchRunStatus } from '@prisma/client';
import { CatalogService, IngredientService, UpdateProductDto, CatalogIntakeService } from '../public';
import { PrismaService } from '../../../platform/database/prisma.service';
import { isTrustedMediaSource } from '../../../platform/security/media-review';
import { ALL_FACT_FIELDS, ExtractedFact, extractProductFacts, FactField, hashFactValue, RESEARCH_SCHEMA_VERSION, SkuExpectation } from './product-fact-extractor';
import { decideFacts, DECISION_RULE_VERSION, FactReading, hasMedicalClaim, HoldReason, SourceCheck } from './catalog-decision-engine';
import { isInstructionLine } from './product-fact-extractor';

import { ProductResearchService } from './product-research.service';
import { hostIsBrandDomain, ValidatedFacts } from './research-evidence';
import { FetchedSource, RETRYABLE_OUTCOMES, ResearchSourceFetcher } from './research-source-fetcher';

export type SourceTier = 'OFFICIAL_MANUFACTURER' | 'TRUSTED_DISTRIBUTOR' | 'RETAILER';
export interface RunSource { url: string; tier: SourceTier; origin: 'ADMIN' | 'PROVIDER'; outcome: string; detail?: string; contentHash?: string; fetchedAt?: string; factCount?: number }
export interface AutoVerifyResult {
  applied: string[];
  unverified: string[];
  rejected: string[];
  holds: Array<HoldReason & { factIds: string[] }>;
  /** Per field: VERIFIED | UNVERIFIED | CONFLICT | UNKNOWN. */
  coverage: Record<string, string>;
}
export interface FactEvidence { sourceUrl: string; sourceTier: SourceTier; excerpt: string; observedAt: string; contentHash?: string; extractor: string }

const CONFIDENCE: Record<SourceTier, number> = { OFFICIAL_MANUFACTURER: 0.95, TRUSTED_DISTRIBUTOR: 0.75, RETAILER: 0.5 };
/** Fields with one true value per SKU: two different values cannot both be proposed quietly. */
const SINGLE_VALUE_FIELDS: ReadonlySet<FactField> = new Set(['identity.gtin', 'identity.size', 'composition.inci', 'composition.fragrance', 'attributes.texture', 'usage.targetArea', 'usage.routinePeriod',
  'attributes.spf', 'attributes.waterResistanceMinutes', 'attributes.uvFilterType', 'merchandising.productLine']);
/** Two lists differing by a few spellings are the same formula read twice, not a conflict. */
const INCI_SAME_FORMULA = 0.9;
const MAX_SOURCES = 6;
const SAFE_OVERWRITE_NEVER: ReadonlySet<FactField> = new Set(['identity.gtin', 'identity.size']);

const foldInci = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
function sameFormula(a: string[], b: string[]): boolean {
  const left = new Set(a.map(foldInci));
  const right = new Set(b.map(foldInci));
  const shared = [...left].filter(item => right.has(item)).length;
  return shared / Math.max(left.size, right.size) >= INCI_SAME_FORMULA;
}

const parseAllowedHosts = () => (process.env.RESEARCH_ALLOWED_HOSTS ?? '').split(',').map(host => host.trim().toLowerCase()).filter(Boolean);

/**
 * Research for one canonical SKU, for new products and for enriching existing ones. Nothing here touches supplier files. A run only ever writes its own tables: Catalog changes
 * happen one reviewed fact at a time, through Catalog's own services, and a provider failure leaves Catalog exactly as it was.
 */
@Injectable()
export class CanonicalResearchService {
  private readonly logger = new Logger(CanonicalResearchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly ingredients: IngredientService,
    private readonly fetcher: ResearchSourceFetcher,
    private readonly providers: ProductResearchService,
    private readonly intake: CatalogIntakeService,
  ) {}

  /**
   * Usage an older rule applied from description text ("A hydrating cleansing lotion for normal to dry skin…") is not an instruction. Such a fact is rejected
   * with its reason; lines that do instruct are kept. The catalog's usage text is corrected only while it still equals what that fact wrote (compare-and-set),
   * so verified instructions and later corrections are never destroyed. Returns what changed, for the audit trail.
   */
  async invalidateNonInstructionUsage(skuId: string, actorId: string) {
    const sku = await this.skuContext(skuId);
    const applied = await this.prisma.productFactProposal.findMany({ where: { skuId, field: 'usage.instructions', status: ProductFactStatus.APPLIED } });
    const changes: Array<{ factId: string; action: 'REJECTED' | 'TRIMMED'; removedLines: string[] }> = [];
    for (const fact of applied) {
      const lines = fact.value as string[];
      const kept = lines.filter(line => isInstructionLine(line));
      if (kept.length === lines.length) continue;
      const removed = lines.filter(line => !kept.includes(line));
      if (!kept.length) {
        await this.prisma.productFactProposal.update({ where: { id: fact.id }, data: { status: ProductFactStatus.REJECTED, verification: 'REJECTED', decidedBy: 'AUTO',
          decisionRule: `${DECISION_RULE_VERSION}:NOT_AN_INSTRUCTION`, conflictReason: 'The applied text describes the product; it gives no instruction', reviewedAt: new Date(), reviewNote: `Invalidated automatically by ${actorId}` } });
        await this.intake.replaceUsageIf(sku.productId, lines.join('\n'), null);
        changes.push({ factId: fact.id, action: 'REJECTED', removedLines: removed });
      } else {
        await this.prisma.productFactProposal.update({ where: { id: fact.id }, data: { value: kept as Prisma.InputJsonValue, reviewNote: `Description lines removed automatically: ${removed.length}` } });
        await this.intake.replaceUsageIf(sku.productId, lines.join('\n'), kept.join('\n'));
        changes.push({ factId: fact.id, action: 'TRIMMED', removedLines: removed });
      }
    }
    return changes;
  }

  /** Withdraws an applied description when the source page is shown to contain copy for a different product type. */
  async invalidateAppliedDescription(factId: string, reason: string, actorId: string): Promise<boolean> {
    const fact = await this.prisma.productFactProposal.findUnique({ where: { id: factId } });
    if (!fact || fact.field !== 'marketing.description' || fact.status !== ProductFactStatus.APPLIED || typeof fact.value !== 'string') {
      throw new ConflictException('Expected an applied description fact');
    }
    const sku = await this.skuContext(fact.skuId);
    const cleared = await this.intake.clearDescriptionIf(sku.productId, fact.value);
    if (!cleared) throw new ConflictException('The description has changed since this fact was applied');
    await this.prisma.productFactProposal.update({ where: { id: factId }, data: { status: ProductFactStatus.REJECTED,
      verification: 'REJECTED', decidedBy: 'ADMIN', reviewedBy: actorId, reviewedAt: new Date(), reviewNote: reason,
      decisionRule: `${DECISION_RULE_VERSION}:PRODUCT_TYPE_CONFLICT`, conflictReason: reason } });
    return true;
  }

  private async skuContext(skuId: string) {
    const sku = await this.prisma.sku.findUnique({ where: { id: skuId }, include: { product: { include: { brand: true } } } });
    if (!sku) throw new NotFoundException('Canonical SKU not found');
    return sku;
  }

  private async expectation(sku: Awaited<ReturnType<CanonicalResearchService['skuContext']>>): Promise<SkuExpectation> {
    const policy = await this.prisma.ingestionEligibilityPolicy.findFirst({ where: { status: 'APPROVED' }, orderBy: { version: 'desc' }, select: { document: true } });
    const document = policy?.document as { brands?: Array<{ id: string; effect?: string | null; aliases?: string[] }> } | undefined;
    const rule = document?.brands?.find(brand => brand.id === sku.product.brandId && brand.effect === 'ALLOW');
    return { brand: sku.product.brand.name, brandAliases: rule?.aliases ?? [], productName: sku.product.name, size: sku.size?.toNumber() ?? null, sizeUnit: sku.sizeUnit, barcode: sku.barcode };
  }

  private approvedHost(sku: Awaited<ReturnType<CanonicalResearchService['skuContext']>>) {
    return this.approvedHostFor(sku.product.brand);
  }

  /** The hosts research may read for a brand: its own site, configured distributors, brand-named domains and trusted media hosts. Works before a SKU exists. */
  private approvedHostFor(brand: { name: string; websiteUrl: string | null }) {
    const sku = { product: { brand } };
    const brandSite = sku.product.brand.websiteUrl ? (() => { try { return new URL(sku.product.brand.websiteUrl!).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; } })() : null;
    const configured = parseAllowedHosts();
    return (host: string) => {
      const bare = host.replace(/^www\./, '');
      return (brandSite !== null && (bare === brandSite || bare.endsWith(`.${brandSite}`)))
        || configured.some(allowed => bare === allowed || bare.endsWith(`.${allowed}`))
        || hostIsBrandDomain(host, sku.product.brand.name)
        || isTrustedMediaSource(`https://${host}/`);
    };
  }

  /** A page on the brand's own website: its recorded site, or a domain that is the brand's name. Trusted distributors and media hosts are not. */
  private isBrandOwnPage(url: string, brand: { name: string; websiteUrl: string | null }): boolean {
    try {
      const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
      const site = brand.websiteUrl ? new URL(brand.websiteUrl).hostname.toLowerCase().replace(/^www\./, '') : null;
      return (site !== null && (host === site || host.endsWith(`.${site}`))) || hostIsBrandDomain(host, brand.name);
    } catch { return false; }
  }

  private tierOf(url: string, brand: string): SourceTier {
    const host = new URL(url).hostname.toLowerCase();
    if (hostIsBrandDomain(host, brand)) return 'OFFICIAL_MANUFACTURER';
    if (isTrustedMediaSource(url)) return 'OFFICIAL_MANUFACTURER';
    return parseAllowedHosts().some(allowed => host === allowed || host.endsWith(`.${allowed}`)) ? 'TRUSTED_DISTRIBUTOR' : 'RETAILER';
  }

  /**
   * Starts a run from the pages a person named. Paid discovery only runs when the request asks for it and the provider is configured. The call returns after the sources are read;
   * a source that fails stays recorded and `resume` reads only those.
   */
  async startRun(skuId: string, input: { sourceUrls?: string[]; useConfiguredProviders?: boolean }, actorId: string): Promise<ProductResearchRun> {
    const sku = await this.skuContext(skuId);
    const urls = [...new Set((input.sourceUrls ?? []).map(url => url.trim()).filter(Boolean))];
    for (const url of urls) {
      let parsed: URL;
      try { parsed = new URL(url); } catch { throw new BadRequestException(`Not a URL: ${url}`); }
      if (parsed.protocol !== 'https:') throw new BadRequestException(`Only https sources are read: ${url}`);
    }
    if (!urls.length && !input.useConfiguredProviders) throw new BadRequestException('Name at least one source page, or ask for configured discovery');
    const run = await this.prisma.productResearchRun.create({ data: { skuId, schemaVersion: RESEARCH_SCHEMA_VERSION, requestedBy: actorId,
      sources: urls.slice(0, MAX_SOURCES).map(url => ({ url, tier: this.tierOf(url, sku.product.brand.name), origin: 'ADMIN', outcome: 'PENDING' })) as unknown as Prisma.InputJsonValue } });
    return this.execute(run.id, input.useConfiguredProviders ?? false);
  }

  /**
   * Reads one product page against what a list row states, before any catalog record exists. This is how a product new to the catalog gets its identity verified by
   * evidence: the page must be the manufacturer's or a trusted distributor's, name the brand (or an approved alias) and the product, and state the same size.
   * Reads only; writes nothing. A transient failure is reported as retryable.
   */
  async checkSource(expected: SkuExpectation & { websiteUrl: string | null }, url: string): Promise<SourceCheck> {
    let tier: SourceCheck['tier'];
    try { tier = this.tierOf(url, expected.brand); } catch {
      return { url, tier: 'RETAILER', outcome: 'INVALID_URL', retryable: false, identityMatched: false, sizeConfirmed: null, rejectedReasons: ['INVALID_URL'], pageGtin: null };
    }
    const isApproved = this.approvedHostFor({ name: expected.brand, websiteUrl: expected.websiteUrl });
    const fetched = await this.fetcher.fetch(url, { kind: 'page', isApprovedHost: isApproved });
    const base = { url, tier, outcome: fetched.outcome as string, retryable: RETRYABLE_OUTCOMES.has(fetched.outcome), pageGtin: null as string | null };
    if (fetched.outcome !== 'OK' || !fetched.body) return { ...base, identityMatched: false, sizeConfirmed: null, rejectedReasons: [fetched.outcome] };
    const extraction = extractProductFacts(fetched.body.toString('utf8'), fetched.finalUrl, expected);
    const reasons = extraction.rejected.map(item => item.reason);
    const sizeFact = extraction.facts.find(fact => fact.field === 'identity.size');
    const sizeConfirmed = reasons.includes('SIZE_MISMATCH') ? false : sizeFact ? true : null;
    const gtin = extraction.facts.find(fact => fact.field === 'identity.gtin')?.value as string | undefined;
    const title = extraction.facts.find(fact => fact.field === 'identity.name')?.value;
    return { ...base, identityMatched: extraction.identityMatched, sizeConfirmed, rejectedReasons: reasons, pageGtin: gtin ?? null,
      ...(typeof title === 'string' && { pageTitle: title.slice(0, 200) }),
      // The one size the page itself names for this product (its title), when the row had none to compare.
      ...(expected.size === null && sizeFact && { pageSize: sizeFact.value as { value: number; unit: string }, pageSizeExcerpt: sizeFact.excerpt }) };
  }

  /**
   * Candidate product pages for a list row that names none: the configured search, first inside the brand's own website, then anywhere, keeping only hosts research
   * may read and that are the manufacturer or a trusted distributor (never a retailer). Official pages first. Nothing is read here; each page is still checked
   * against the row by checkSource before it can verify anything. No search configured → no candidates.
   */
  async discoverProductPages(expected: { brand: string; productName: string; size: number | null; sizeUnit: string | null; websiteUrl: string | null }, limit = 4): Promise<string[]> {
    if (!this.providers.discoveryConfigured()) return [];
    const site = (() => { try { return expected.websiteUrl ? new URL(expected.websiteUrl).hostname.replace(/^www\./, '') : null; } catch { return null; } })();
    const name = expected.productName.toLowerCase().includes(expected.brand.toLowerCase()) ? expected.productName : `${expected.brand} ${expected.productName}`;
    const query = `${name}${expected.size !== null && expected.sizeUnit ? ` ${expected.size} ${expected.sizeUnit}` : ''}`;
    const found = [...(site ? (await this.providers.discoverPages(query, 6, { includeDomains: [site] })) ?? [] : []), ...((await this.providers.discoverPages(query, 8)) ?? [])];
    const isApproved = this.approvedHostFor({ name: expected.brand, websiteUrl: expected.websiteUrl });
    const rank: Record<SourceTier, number> = { OFFICIAL_MANUFACTURER: 0, TRUSTED_DISTRIBUTOR: 1, RETAILER: 2 };
    const urls: Array<{ url: string; tier: SourceTier }> = [];
    for (const page of found) {
      let url: URL;
      try { url = new URL(page.url); } catch { continue; }
      if (url.protocol !== 'https:' || !isApproved(url.hostname)) continue;
      // A brochure or an image is not a product page; fetching it only spends the host's failure budget (a PDF opened the eva-cosmetics.com breaker, 2026-11-07).
      if (/\.(pdf|jpe?g|png|webp|gif|svg|zip|docx?|xlsx?)$/i.test(url.pathname)) continue;
      const tier = this.tierOf(url.toString(), expected.brand);
      if (tier === 'RETAILER' || urls.some(item => item.url === url.toString())) continue;
      urls.push({ url: url.toString(), tier });
    }
    return urls.sort((a, b) => rank[a.tier] - rank[b.tier]).slice(0, limit).map(item => item.url);
  }

  /**
   * Field-level verification of every open reading for one SKU, by the rules in catalog-decision-engine. Consistent, well-sourced facts are written through Catalog with
   * no person involved; contradictions that matter (size, barcode, ingredients, active strength, instructions, warnings) come back as holds; everything else that cannot
   * be settled stays unknown. Safe to repeat: applied facts are never re-applied and decided readings are not revisited.
   */
  async autoVerify(skuId: string, actorId: string): Promise<AutoVerifyResult> {
    const facts = await this.listFacts(skuId);
    const readings: FactReading[] = facts.map(fact => ({ id: fact.id, field: fact.field, value: fact.value, status: fact.status,
      tiers: [...new Set((fact.evidence as unknown as FactEvidence[]).map(item => item.sourceTier))] }));
    // A barcode becomes VERIFIED only from the manufacturer itself; a distributor's or retailer's code stays unknown.
    for (const reading of readings) if (reading.field === 'identity.gtin') reading.tiers = reading.tiers.filter(tier => tier === 'OFFICIAL_MANUFACTURER');
    const verdicts = decideFacts(readings);
    const result: AutoVerifyResult = { applied: [], unverified: [], rejected: [], holds: [], coverage: {} };
    const holdByKey = new Map<string, HoldReason & { factIds: string[] }>();
    const mark = (id: string, data: Prisma.ProductFactProposalUpdateInput) => this.prisma.productFactProposal.update({ where: { id }, data });
    const rule = (name: string) => `${DECISION_RULE_VERSION}:${name}`;
    // Ingredients before the concentrations that refer to them.
    const order = (field: string) => (field === 'composition.inci' ? 0 : field === 'composition.activeConcentrations' ? 2 : 1);
    const pending = facts.filter(fact => verdicts.has(fact.id)).sort((a, b) => order(a.field) - order(b.field) || a.id.localeCompare(b.id));
    for (const fact of pending) {
      const verdict = verdicts.get(fact.id)!;
      if (verdict.kind === 'APPLY') {
        try {
          await this.apply(fact, fact.evidence as unknown as FactEvidence[], actorId, false);
          await mark(fact.id, { status: ProductFactStatus.APPLIED, appliedAt: new Date(), reviewedAt: new Date(), reviewNote: `Automatic: ${verdict.rule}`,
            verification: 'VERIFIED', decidedBy: 'AUTO', decisionRule: rule(verdict.rule), conflictReason: null });
          if (SINGLE_VALUE_FIELDS.has(fact.field as FactField)) {
            await this.prisma.productFactProposal.updateMany({ where: { skuId, field: fact.field, id: { not: fact.id }, status: { in: [ProductFactStatus.PROPOSED, ProductFactStatus.CONFLICT] } },
              data: { status: ProductFactStatus.REJECTED, verification: 'REJECTED', decidedBy: 'AUTO', decisionRule: rule('SUPERSEDED'), conflictReason: `Superseded by ${fact.id}` } });
          }
          result.applied.push(fact.field);
        } catch (error) {
          const response = error instanceof ConflictException ? (error.getResponse() as { code?: string; message?: string; current?: unknown }) : null;
          const reason = response?.message ?? (error instanceof Error ? error.message : String(error));
          if (response && (fact.field === 'identity.size' || fact.field === 'identity.gtin')) {
            // The catalog already states a different size or barcode: a contradiction about what this product is.
            const code = fact.field === 'identity.size' ? 'SIZE_CONTRADICTS_CATALOG' : 'BARCODE_CONFLICT';
            holdByKey.set(`${fact.field}:${code}`, { reasonCode: code, severity: 'CRITICAL', field: fact.field, summary: reason, factIds: [fact.id],
              recommended: { action: 'RESOLVE', label: 'Decide which value is right', payload: { factId: fact.id, current: response.current } } });
            await mark(fact.id, { status: ProductFactStatus.CONFLICT, verification: 'CONFLICT', decidedBy: 'AUTO', decisionRule: rule(code), conflictReason: reason });
          } else {
            // Anything else (an existing descriptive value, an ingredient not known yet) stays unknown in the catalog; nothing is overwritten.
            await mark(fact.id, { verification: 'UNVERIFIED', decidedBy: 'AUTO', decisionRule: rule('NOT_APPLIED'), conflictReason: reason.slice(0, 500) });
            result.unverified.push(fact.field);
          }
        }
      } else if (verdict.kind === 'KEEP_UNVERIFIED') {
        await mark(fact.id, { verification: 'UNVERIFIED', decidedBy: 'AUTO', decisionRule: rule(verdict.rule), conflictReason: verdict.reason });
        result.unverified.push(fact.field);
      } else if (verdict.kind === 'REJECT') {
        await mark(fact.id, { status: ProductFactStatus.REJECTED, verification: 'REJECTED', decidedBy: 'AUTO', decisionRule: rule(verdict.rule), conflictReason: verdict.reason });
        result.rejected.push(fact.field);
      } else {
        await mark(fact.id, { status: ProductFactStatus.CONFLICT, verification: 'CONFLICT', decidedBy: 'AUTO', decisionRule: rule(verdict.rule), conflictReason: verdict.reason });
        const key = `${fact.field}:${verdict.hold.reasonCode}`;
        const existing = holdByKey.get(key);
        if (existing) existing.factIds.push(fact.id);
        else holdByKey.set(key, { ...verdict.hold, factIds: [fact.id] });
      }
    }
    result.holds = [...holdByKey.values()];
    const latest = await this.listFacts(skuId);
    for (const field of ALL_FACT_FIELDS) {
      const rows = latest.filter(fact => fact.field === field);
      result.coverage[field] = rows.some(fact => fact.status === ProductFactStatus.CONFLICT) ? 'CONFLICT'
        : rows.some(fact => fact.status === ProductFactStatus.APPLIED) ? 'VERIFIED'
        : rows.some(fact => fact.status === ProductFactStatus.PROPOSED) ? 'UNVERIFIED' : 'UNKNOWN';
    }
    const run = await this.prisma.productResearchRun.findFirst({ where: { skuId }, orderBy: { startedAt: 'desc' } });
    if (run) await this.prisma.productResearchRun.update({ where: { id: run.id }, data: { fieldCoverage: result.coverage } });
    return result;
  }

  /** Rejects every open reading of one field: the field stays unknown. Used when a person settles a conflict by rejecting all sides. */
  /**
   * A fallback source is read only for what the primary sources left missing. Its readings of fields the primary sources already covered are rejected
   * with that reason (a regional site's other formula is not a conflict with this product's page). Returns how many readings were set aside.
   */
  async keepOnlyMissingFields(skuId: string, runId: string, coveredFields: string[]): Promise<number> {
    if (!coveredFields.length) return 0;
    const result = await this.prisma.productFactProposal.updateMany({
      where: { skuId, runId, field: { in: coveredFields }, status: { in: [ProductFactStatus.PROPOSED, ProductFactStatus.CONFLICT] } },
      data: { status: ProductFactStatus.REJECTED, verification: 'REJECTED', decidedBy: 'AUTO', decisionRule: `${DECISION_RULE_VERSION}:FALLBACK_ONLY_FOR_MISSING`,
        conflictReason: 'Read from a fallback source for a field the primary source already states' },
    });
    return result.count;
  }

  async rejectField(skuId: string, field: string, note: string, actorId: string) {
    return this.prisma.productFactProposal.updateMany({ where: { skuId, field, status: { in: [ProductFactStatus.PROPOSED, ProductFactStatus.CONFLICT] } },
      data: { status: ProductFactStatus.REJECTED, verification: 'REJECTED', decidedBy: 'ADMIN', reviewedBy: actorId, reviewedAt: new Date(), reviewNote: note } });
  }

  /** Images a SKU's verified sources show, best source first, for automatic media preparation. */
  async sourceImages(skuId: string): Promise<Array<{ factId: string; imageUrl: string; pageUrl: string; tier: SourceTier }>> {
    const facts = await this.prisma.productFactProposal.findMany({ where: { skuId, field: 'media.sourceImages', status: { not: ProductFactStatus.REJECTED } }, orderBy: { createdAt: 'asc' } });
    const rank: Record<SourceTier, number> = { OFFICIAL_MANUFACTURER: 0, TRUSTED_DISTRIBUTOR: 1, RETAILER: 2 };
    return facts.flatMap(fact => {
      const evidence = (fact.evidence as unknown as FactEvidence[])[0];
      const tier = evidence?.sourceTier ?? 'RETAILER';
      return (fact.value as string[]).map(imageUrl => ({ factId: fact.id, imageUrl, pageUrl: evidence?.sourceUrl ?? '', tier }));
    }).sort((a, b) => rank[a.tier] - rank[b.tier]);
  }

  /** Re-reads only what failed for a transient reason. Facts already found stay; nothing is lost or duplicated. */
  async resume(runId: string): Promise<ProductResearchRun> {
    const run = await this.prisma.productResearchRun.findUnique({ where: { id: runId } });
    if (!run) throw new NotFoundException('Research run not found');
    if (run.status === ResearchRunStatus.RUNNING) throw new ConflictException('This run is still in progress');
    await this.prisma.productResearchRun.update({ where: { id: runId }, data: { status: ResearchRunStatus.RUNNING, attempts: { increment: 1 }, completedAt: null } });
    return this.execute(runId, false);
  }

  private async execute(runId: string, useProviders: boolean): Promise<ProductResearchRun> {
    const run = await this.prisma.productResearchRun.findUniqueOrThrow({ where: { id: runId } });
    const sku = await this.skuContext(run.skuId);
    const expected = await this.expectation(sku);
    const sources = (run.sources as unknown as RunSource[]).map(source => ({ ...source }));
    const rejected = [...(run.rejected as unknown as Array<Record<string, unknown>>)];
    let providerStatuses: Record<string, unknown> | null = (run.providerStatuses as Record<string, unknown> | null) ?? null;
    const isApproved = this.approvedHost(sku);

    try {
      const collected: Array<{ fact: ExtractedFact; evidence: FactEvidence }> = [];
      for (const source of sources) {
        if (source.outcome !== 'PENDING' && !RETRYABLE_OUTCOMES.has(source.outcome as FetchedSource['outcome'])) continue;
        const fetched = await this.fetcher.fetch(source.url, { kind: 'page', isApprovedHost: isApproved, bypassCache: source.outcome !== 'PENDING' });
        Object.assign(source, { outcome: fetched.outcome, detail: fetched.detail, contentHash: fetched.contentHash, fetchedAt: fetched.fetchedAt });
        if (fetched.outcome !== 'OK' || !fetched.body) continue;
        const extraction = extractProductFacts(fetched.body.toString('utf8'), fetched.finalUrl, expected);
        rejected.push(...extraction.rejected.map(item => ({ ...item, sourceUrl: source.url })));
        source.factCount = extraction.facts.length;
        for (const fact of extraction.facts) {
          collected.push({ fact, evidence: { sourceUrl: fetched.finalUrl, sourceTier: source.tier, excerpt: fact.excerpt, observedAt: fetched.fetchedAt, contentHash: fetched.contentHash, extractor: `deterministic@${RESEARCH_SCHEMA_VERSION}` } });
        }
      }

      if (useProviders) {
        const result = await this.providers.researchProductCandidate({ candidateId: run.skuId, brand: expected.brand, name: expected.productName, barcode: expected.barcode });
        providerStatuses = result.providerStatuses as unknown as Record<string, unknown>;
        for (const page of result.discoveredSources) {
          if (!sources.some(source => source.url === page.url)) sources.push({ url: page.url, tier: page.sourceType as SourceTier, origin: 'PROVIDER', outcome: 'DISCOVERED' });
        }
        rejected.push(...(result.rejectedFacts ?? []).map(item => ({ field: item.field, reason: item.reason, value: item.value })));
        const primary = result.discoveredSources[0];
        if (primary) {
          // Provider output has already been checked word by word against the fetched page by validateExtractedFacts; a model's output never bypasses that.
          for (const fact of this.factsFromProvider(result.extractedFacts)) {
            const excerpt = result.fieldEvidences.find(item => fact.providerField === item.fieldName)?.excerpt ?? '';
            collected.push({ fact: { field: fact.field, value: fact.value, excerpt }, evidence: { sourceUrl: primary.url, sourceTier: primary.sourceType as SourceTier, excerpt, observedAt: result.researchedAt, extractor: 'provider-validated' } });
          }
        }
      }

      await this.persist(run.id, run.skuId, collected);
      const anyTransient = sources.some(source => RETRYABLE_OUTCOMES.has(source.outcome as FetchedSource['outcome']));
      const anyFacts = await this.prisma.productFactProposal.count({ where: { skuId: run.skuId, runId: run.id } });
      const providerDown = providerStatuses !== null && Object.values(providerStatuses).every(status => status !== 'LIVE') && sources.every(source => source.outcome !== 'OK');
      const status = anyTransient || providerDown ? ResearchRunStatus.PROVIDER_UNAVAILABLE : anyFacts ? ResearchRunStatus.COMPLETE : ResearchRunStatus.NO_EVIDENCE;
      return await this.prisma.productResearchRun.update({ where: { id: run.id }, data: { status, sources: sources as unknown as Prisma.InputJsonValue, rejected: rejected as unknown as Prisma.InputJsonValue,
        providerStatuses: (providerStatuses ?? undefined) as Prisma.InputJsonValue | undefined, completedAt: new Date(), errorReason: null } });
    } catch (error) {
      const reason = error instanceof Error ? error.message.slice(0, 500) : 'RESEARCH_FAILED';
      this.logger.error(`Research run ${run.id} failed: ${reason}`);
      return this.prisma.productResearchRun.update({ where: { id: run.id }, data: { status: ResearchRunStatus.FAILED, errorReason: reason, sources: sources as unknown as Prisma.InputJsonValue, completedAt: new Date() } });
    }
  }

  private factsFromProvider(facts: ValidatedFacts): Array<{ field: FactField; value: unknown; providerField: string }> {
    const out: Array<{ field: FactField; value: unknown; providerField: string }> = [];
    if (facts.ingredients?.length) out.push({ field: 'composition.inci', value: facts.ingredients, providerField: 'ingredients' });
    if (facts.concentrations?.length) out.push({ field: 'composition.activeConcentrations', value: facts.concentrations, providerField: 'concentrations' });
    if (facts.size) out.push({ field: 'identity.size', value: facts.size, providerField: 'size' });
    if (facts.usage?.length) out.push({ field: 'usage.instructions', value: facts.usage, providerField: 'usage' });
    if (facts.warnings?.length) out.push({ field: 'safety.warnings', value: facts.warnings, providerField: 'warnings' });
    if (facts.skinTypes?.length) out.push({ field: 'suitability.skinTypes', value: facts.skinTypes, providerField: 'skinTypes' });
    if (facts.hairTypes?.length) out.push({ field: 'suitability.hairTypes', value: facts.hairTypes, providerField: 'hairTypes' });
    if (facts.description) out.push({ field: 'marketing.description', value: facts.description, providerField: 'description' });
    if (facts.benefits?.length) out.push({ field: 'claims.manufacturerStated', value: facts.benefits, providerField: 'benefits' });
    return out;
  }

  /** Dedupes by value, merges evidence, and marks disagreeing values CONFLICT so a person decides. */
  private async persist(runId: string, skuId: string, collected: Array<{ fact: ExtractedFact; evidence: FactEvidence }>) {
    await this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`research:${skuId}`}))`;
      for (const { fact, evidence } of collected) {
        const valueHash = hashFactValue(fact.field, fact.value);
        const existing = await tx.productFactProposal.findUnique({ where: { skuId_field_valueHash: { skuId, field: fact.field, valueHash } } });
        const confidence = CONFIDENCE[evidence.sourceTier];
        if (existing) {
          const known = existing.evidence as unknown as FactEvidence[];
          if (!known.some(item => item.sourceUrl === evidence.sourceUrl && item.contentHash === evidence.contentHash)) {
            await tx.productFactProposal.update({ where: { id: existing.id }, data: { evidence: [...known, evidence] as unknown as Prisma.InputJsonValue, confidence: Math.max(existing.confidence, confidence) } });
          }
          continue;
        }
        await tx.productFactProposal.create({ data: { skuId, runId, field: fact.field, value: fact.value as Prisma.InputJsonValue, valueHash, evidence: [evidence] as unknown as Prisma.InputJsonValue, confidence, schemaVersion: RESEARCH_SCHEMA_VERSION } });
      }

      for (const field of SINGLE_VALUE_FIELDS) {
        const rows = await tx.productFactProposal.findMany({ where: { skuId, field, status: { in: [ProductFactStatus.PROPOSED, ProductFactStatus.CONFLICT] } } });
        if (rows.length < 2) continue;
        if (field === 'composition.inci' && rows.every((row, _i, all) => sameFormula(row.value as string[], all[0].value as string[]))) {
          // Same formula read from two pages: the official reading stands, the other merges its evidence into it.
          const [keep, ...others] = [...rows].sort((a, b) => b.confidence - a.confidence);
          const merged = [...(keep.evidence as unknown as FactEvidence[]), ...others.flatMap(row => row.evidence as unknown as FactEvidence[])];
          await tx.productFactProposal.update({ where: { id: keep.id }, data: { evidence: merged as unknown as Prisma.InputJsonValue, status: ProductFactStatus.PROPOSED } });
          await tx.productFactProposal.updateMany({ where: { id: { in: others.map(row => row.id) } }, data: { status: ProductFactStatus.REJECTED, reviewNote: `Same formula as proposal ${keep.id}` } });
          continue;
        }
        await tx.productFactProposal.updateMany({ where: { id: { in: rows.map(row => row.id) } }, data: { status: ProductFactStatus.CONFLICT } });
      }
    }, { timeout: 30000 });
  }

  async listRuns(skuId: string) {
    return this.prisma.productResearchRun.findMany({ where: { skuId }, orderBy: { startedAt: 'desc' }, take: 20 });
  }

  async listFacts(skuId: string) {
    return this.prisma.productFactProposal.findMany({ where: { skuId }, orderBy: [{ field: 'asc' }, { createdAt: 'asc' }] });
  }

  /** What the owner must still settle before this SKU's facts can be trusted, grouped for the publication check. */
  async factSummary(skuId: string) {
    const facts = await this.listFacts(skuId);
    return {
      total: facts.length,
      applied: facts.filter(fact => fact.status === ProductFactStatus.APPLIED).map(fact => fact.field),
      pending: facts.filter(fact => fact.status === ProductFactStatus.PROPOSED && fact.verification === null).map(fact => fact.field),
      unverified: [...new Set(facts.filter(fact => fact.status === ProductFactStatus.PROPOSED && fact.verification === 'UNVERIFIED').map(fact => fact.field))],
      conflicts: [...new Set(facts.filter(fact => fact.status === ProductFactStatus.CONFLICT).map(fact => fact.field))],
    };
  }

  /** Reject, or approve and write through Catalog. Approving one side of a conflict rejects the others. Repeating the same decision is harmless. */
  async review(factId: string, input: { decision: 'APPROVED' | 'REJECTED'; note: string; overwrite?: boolean }, actorId: string): Promise<ProductFactProposal> {
    const note = input.note.trim();
    if (note.length < 5) throw new BadRequestException('A meaningful review note is required');
    const fact = await this.prisma.productFactProposal.findUnique({ where: { id: factId } });
    if (!fact) throw new NotFoundException('Fact proposal not found');
    if (fact.status === ProductFactStatus.APPLIED && input.decision === 'APPROVED') return fact;
    if (fact.status === ProductFactStatus.APPLIED) throw new ConflictException('This fact is already in the catalog; change it through a new reviewed fact');
    if (input.decision === 'REJECTED') {
      return this.prisma.productFactProposal.update({ where: { id: factId }, data: { status: ProductFactStatus.REJECTED, reviewedBy: actorId, reviewedAt: new Date(), reviewNote: note, verification: 'REJECTED', decidedBy: 'ADMIN' } });
    }
    const evidence = fact.evidence as unknown as FactEvidence[];
    if (!evidence.length) throw new ConflictException('A fact without a source cannot be approved');
    await this.apply(fact, evidence, actorId, input.overwrite ?? false);
    return this.prisma.$transaction(async tx => {
      if (SINGLE_VALUE_FIELDS.has(fact.field as FactField)) {
        await tx.productFactProposal.updateMany({ where: { skuId: fact.skuId, field: fact.field, id: { not: factId }, status: { in: [ProductFactStatus.PROPOSED, ProductFactStatus.CONFLICT] } },
          data: { status: ProductFactStatus.REJECTED, reviewedBy: actorId, reviewedAt: new Date(), reviewNote: `Superseded by reviewed fact ${factId}` } });
      }
      return tx.productFactProposal.update({ where: { id: factId }, data: { status: ProductFactStatus.APPLIED, reviewedBy: actorId, reviewedAt: new Date(), reviewNote: note, appliedAt: new Date(), verification: 'VERIFIED', decidedBy: 'ADMIN', conflictReason: null } });
    });
  }

  /** Every write goes through the Catalog owner. A value already there that differs is refused unless the reviewer explicitly replaces it; identity is never replaced here. */
  private async apply(fact: ProductFactProposal, evidence: FactEvidence[], actorId: string, overwrite: boolean) {
    const sku = await this.skuContext(fact.skuId);
    const product = sku.product;
    const field = fact.field as FactField;
    const best = [...evidence].sort((a, b) => CONFIDENCE[b.sourceTier] - CONFIDENCE[a.sourceTier])[0];
    const refuseOverwrite = (current: unknown, label: string) => {
      if (current === null || current === undefined || current === '' || (Array.isArray(current) && !current.length)) return;
      if (!overwrite || SAFE_OVERWRITE_NEVER.has(field)) throw new ConflictException({ code: 'CATALOG_VALUE_EXISTS', message: `${label} already has a value; approve with an explicit overwrite if this should replace it`, current });
    };
    const update = (dto: UpdateProductDto) => this.catalog.updateProduct(product.id, { ...dto, lastReviewedAt: new Date().toISOString(), lastReviewedBy: actorId, factVersion: product.factVersion + 1 });
    /** The claim's provenance beside the value, as for fragrance: the page and the words that state it. */
    const claimed = (key: string) => ({ ...(product.claimsEvidence as Record<string, unknown> | null ?? {}),
      [key]: { value: fact.value, sourceUrl: best.sourceUrl, sourceTier: best.sourceTier, excerpt: best.excerpt, reviewedBy: actorId, appliedAt: new Date().toISOString() } });

    switch (field) {
      case 'identity.name':
      case 'identity.brand':
      case 'claims.manufacturerStated':
      case 'media.sourceImages':
        return; // Evidence only: identity is confirmed by people at intake, claims stay marked as the manufacturer's words, and images enter through media review.
      case 'identity.gtin': {
        const gtin = fact.value as string;
        if (sku.barcode === gtin) return;
        if (sku.barcode) throw new ConflictException({ code: 'CATALOG_VALUE_EXISTS', message: 'This SKU has a different barcode; resolve the identity by hand', current: sku.barcode });
        await this.catalog.updateSku(sku.id, { barcode: gtin });
        // Only a manufacturer's own statement verifies a barcode; anything else is recorded as an Admin assertion.
        await this.prisma.sku.update({ where: { id: sku.id }, data: { barcodeStatus: best.sourceTier === 'OFFICIAL_MANUFACTURER' ? 'VERIFIED' : 'ADMIN_ASSERTED' } });
        return;
      }
      case 'identity.size': {
        const size = fact.value as { value: number; unit: string };
        if (sku.size !== null && (sku.size.toNumber() !== size.value || sku.sizeUnit?.toLowerCase() !== size.unit)) {
          throw new ConflictException({ code: 'CATALOG_VALUE_EXISTS', message: `This SKU is recorded as ${sku.size.toNumber()} ${sku.sizeUnit}; a different size is a different SKU`, current: `${sku.size.toNumber()} ${sku.sizeUnit}` });
        }
        if (sku.size === null) await this.catalog.updateSku(sku.id, { size: size.value, sizeUnit: size.unit });
        return;
      }
      case 'composition.inci': {
        const ids: string[] = [];
        for (const inci of fact.value as string[]) ids.push((await this.ingredients.ensureReviewedIngredient(inci)).id);
        await this.catalog.addReviewedProductIngredients(product.id, ids, sku.id);
        return;
      }
      case 'composition.activeConcentrations': {
        const entries = [];
        for (const row of fact.value as Array<{ ingredient: string; percent: number }>) {
          const ingredient = await this.ingredients.findByInciOrAlias(row.ingredient);
          if (!ingredient) throw new ConflictException({ code: 'INGREDIENT_UNKNOWN', message: `${row.ingredient} is not on this product's reviewed ingredient list yet; approve the INCI list first` });
          entries.push({ ingredientId: ingredient.id, value: row.percent, unit: '%', evidence: { sourceUrl: best.sourceUrl, sourceType: best.sourceTier, evidenceText: best.excerpt, reviewedBy: actorId, reviewedAt: new Date().toISOString() } });
        }
        await this.catalog.setStatedConcentrations(product.id, entries);
        return;
      }
      case 'composition.fragrance': {
        const free = fact.value === 'FREE';
        if (product.isFragranceFree !== null && product.isFragranceFree !== free) refuseOverwrite(product.isFragranceFree, 'Fragrance status');
        const claims = { ...(product.claimsEvidence as Record<string, unknown> | null ?? {}), fragrance: { value: fact.value, sourceUrl: best.sourceUrl, excerpt: best.excerpt, reviewedBy: actorId } };
        await update({ isFragranceFree: free, claimsEvidence: claims });
        return;
      }
      case 'attributes.texture':
        refuseOverwrite(product.texture === fact.value ? null : product.texture, 'Texture');
        await update({ texture: fact.value as UpdateProductDto['texture'] });
        return;
      case 'usage.targetArea':
        refuseOverwrite(product.targetArea === fact.value ? null : product.targetArea, 'Target area');
        await update({ targetArea: fact.value as UpdateProductDto['targetArea'] });
        return;
      case 'usage.routinePeriod':
        await this.catalog.addReviewedUsageRules(product.id, sku.id, [{ targetArea: product.targetArea, routinePeriod: fact.value as 'AM' | 'PM' | 'BOTH', rinseMode: 'UNKNOWN', frequencyUnit: 'UNKNOWN', usesMin: null, usesMax: null, contactMinutes: null, condition: null,
          evidenceText: best.excerpt, sourceUrl: best.sourceUrl, sourceType: best.sourceTier, retrievedAt: new Date(best.observedAt), reviewedBy: actorId, reviewedAt: new Date(), sourceCandidateId: null }]);
        return;
      case 'usage.instructions': {
        const text = (fact.value as string[]).join('\n');
        refuseOverwrite(product.usage === text ? null : product.usage, 'Usage');
        await update({ usage: text });
        return;
      }
      case 'suitability.skinTypes':
        await update({ suitableSkinTypes: [...new Set([...product.suitableSkinTypes, ...(fact.value as string[])])] });
        return;
      case 'suitability.hairTypes':
        await update({ suitableHairTypes: [...new Set([...product.suitableHairTypes, ...(fact.value as string[])])] });
        return;
      case 'safety.warnings': {
        const list = fact.value as string[];
        for (const description of list) {
          await this.catalog.addProductSafetyWarning(product.id, { skuId: sku.id, kind: 'PRECAUTION', descriptionEn: description, sourceType: best.sourceTier, sourceUrl: best.sourceUrl, reviewedBy: actorId });
        }
        if (!product.warnings) await update({ warnings: list.join('\n') });
        return;
      }
      case 'composition.keyIngredients': {
        // What the manufacturer names as key ingredients, with what it says each does. Stated claims, not a formula: never written as INCI, and treatment
        // wording is withheld from the stated function.
        const items = (fact.value as Array<{ name: string; function: string | null }>).map(item => (item.function && hasMedicalClaim(item.function)
          ? { name: item.name, function: null, functionWithheld: 'MEDICAL_CLAIM' } : item));
        const claims = { ...(product.claimsEvidence as Record<string, unknown> | null ?? {}), keyIngredients: { items, sourceUrl: best.sourceUrl, sourceTier: best.sourceTier, excerpt: best.excerpt, appliedAt: new Date().toISOString() } };
        await update({ claimsEvidence: claims });
        return;
      }
      case 'marketing.description':
        refuseOverwrite(product.description === fact.value ? null : product.description, 'Description');
        await update({ description: fact.value as string });
        return;
      case 'attributes.spf':
        refuseOverwrite(product.spf === fact.value ? null : product.spf, 'SPF');
        await update({ spf: fact.value as number, claimsEvidence: claimed('spf') });
        return;
      case 'attributes.broadSpectrum':
        // Only ever stated as true; "not broad spectrum" is never read from silence.
        refuseOverwrite(product.broadSpectrum === true ? null : product.broadSpectrum, 'Broad spectrum');
        await update({ broadSpectrum: true, claimsEvidence: claimed('broadSpectrum') });
        return;
      case 'attributes.waterResistanceMinutes':
        refuseOverwrite(product.waterResistanceMinutes === fact.value ? null : product.waterResistanceMinutes, 'Water resistance');
        await update({ waterResistanceMinutes: fact.value as number, claimsEvidence: claimed('waterResistance') });
        return;
      case 'attributes.uvFilterType':
        refuseOverwrite(product.uvFilterType === fact.value ? null : product.uvFilterType, 'UV filter type');
        await update({ uvFilterType: fact.value as UpdateProductDto['uvFilterType'], claimsEvidence: claimed('uvFilterType') });
        return;
      case 'attributes.nonComedogenic':
        refuseOverwrite(product.isNonComedogenic === true ? null : product.isNonComedogenic, 'Non-comedogenic');
        await update({ isNonComedogenic: true, claimsEvidence: claimed('nonComedogenic') });
        return;
      case 'merchandising.productLine': {
        // A range is the brand's own naming: only a page on the brand's own site names it. A distributor's breadcrumb leaves the line unknown.
        const own = evidence.find(item => this.isBrandOwnPage(item.sourceUrl, product.brand));
        if (!own) throw new ConflictException({ code: 'LINE_NEEDS_BRAND_SITE', message: 'A product line is taken only from a page on the brand\'s own website' });
        await this.intake.assignProductLine(product.id, fact.value as string, { sourceUrl: own.sourceUrl, excerpt: own.excerpt, factId: fact.id, actorId });
        return;
      }
      default:
        throw new BadRequestException(`Unknown fact field ${String(field)}`);
    }
  }

  /** Brings an image a reviewed source shows into private storage bytes for the media workflow. Rights stay unknown until a person states them. */
  async fetchSourceImage(factId: string, imageUrl: string): Promise<{ buffer: Buffer; contentType: string; sourceUrl: string; sourceTier: SourceTier; skuId: string }> {
    const fact = await this.prisma.productFactProposal.findUnique({ where: { id: factId } });
    if (!fact || fact.field !== 'media.sourceImages') throw new NotFoundException('Image evidence not found');
    if (!(fact.value as string[]).includes(imageUrl)) throw new BadRequestException('This image is not in the evidence of this fact');
    const sku = await this.skuContext(fact.skuId);
    const evidence = (fact.evidence as unknown as FactEvidence[])[0];
    const fetched = await this.fetcher.fetch(imageUrl, { kind: 'image', isApprovedHost: host => this.approvedHost(sku)(host) || new URL(evidence.sourceUrl).hostname === host });
    if (fetched.outcome !== 'OK' || !fetched.body || !fetched.contentType) throw new ConflictException({ code: 'IMAGE_NOT_FETCHED', message: `The image could not be read: ${fetched.outcome}`, outcome: fetched.outcome });
    return { buffer: fetched.body, contentType: fetched.contentType, sourceUrl: evidence.sourceUrl, sourceTier: evidence.sourceTier, skuId: fact.skuId };
  }
}

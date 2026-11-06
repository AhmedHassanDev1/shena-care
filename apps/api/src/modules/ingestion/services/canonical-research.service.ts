import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, ProductFactProposal, ProductFactStatus, ProductResearchRun, ResearchRunStatus } from '@prisma/client';
import { CatalogService, IngredientService, UpdateProductDto } from '../../catalog/public';
import { PrismaService } from '../../../platform/database/prisma.service';
import { isTrustedMediaSource } from '../../../platform/security/media-review';
import { ALL_FACT_FIELDS, ExtractedFact, extractProductFacts, FactField, hashFactValue, RESEARCH_SCHEMA_VERSION, SkuExpectation } from './product-fact-extractor';
import { decideFacts, DECISION_RULE_VERSION, FactReading, HoldReason, SourceCheck } from './catalog-decision-engine';
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
const SINGLE_VALUE_FIELDS: ReadonlySet<FactField> = new Set(['identity.gtin', 'identity.size', 'composition.inci', 'composition.fragrance', 'attributes.texture', 'usage.targetArea', 'usage.routinePeriod']);
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
  ) {}

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
    return { ...base, identityMatched: extraction.identityMatched, sizeConfirmed, rejectedReasons: reasons, pageGtin: gtin ?? null };
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
  async rejectField(skuId: string, field: string, note: string, actorId: string) {
    return this.prisma.productFactProposal.updateMany({ where: { skuId, field, status: { in: [ProductFactStatus.PROPOSED, ProductFactStatus.CONFLICT] } },
      data: { status: ProductFactStatus.REJECTED, verification: 'REJECTED', decidedBy: 'ADMIN', reviewedBy: actorId, reviewedAt: new Date(), reviewNote: note } });
  }

  /** Images a SKU's verified sources show, best source first, for automatic media preparation. */
  async sourceImages(skuId: string): Promise<Array<{ factId: string; imageUrl: string; tier: SourceTier }>> {
    const facts = await this.prisma.productFactProposal.findMany({ where: { skuId, field: 'media.sourceImages', status: { not: ProductFactStatus.REJECTED } }, orderBy: { createdAt: 'asc' } });
    const rank: Record<SourceTier, number> = { OFFICIAL_MANUFACTURER: 0, TRUSTED_DISTRIBUTOR: 1, RETAILER: 2 };
    return facts.flatMap(fact => {
      const tier = (fact.evidence as unknown as FactEvidence[])[0]?.sourceTier ?? 'RETAILER';
      return (fact.value as string[]).map(imageUrl => ({ factId: fact.id, imageUrl, tier }));
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
      case 'marketing.description':
        refuseOverwrite(product.description === fact.value ? null : product.description, 'Description');
        await update({ description: fact.value as string });
        return;
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

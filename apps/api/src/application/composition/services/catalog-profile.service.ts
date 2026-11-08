import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ProductFactStatus } from '@prisma/client';
import { CatalogIntakeService, ProductMediaService } from '../../../modules/catalog/public';
import {
  BrandResearchService, buildRoutineProfile, CanonicalResearchService, CatalogDecisionLogService, IngestionEligibilityService, isInstructionLine, PRODUCT_TYPE_RULE_VERSION, readProductType, RoutinePlacementService,
  RoutineProfile, ROUTINE_RULE_VERSION, orderRoutine,
} from '../../../modules/ingestion/public';
import type { BrandEnrichment, PlacementConstraint, RoutineRole, RoutineStepInput } from '../../../modules/ingestion/public';
import { CatalogPublicationService } from './catalog-publication.service';

type Evidence = { sourceUrl: string; sourceTier: string; excerpt: string; observedAt: string };
type Fact = Awaited<ReturnType<CanonicalResearchService['listFacts']>>[number];

/** Every structured field a SKU profile reports, grouped as the Admin reads them. */
const FIELD_GROUPS: Record<string, string[]> = {
  identity: ['identity.name', 'identity.brand', 'identity.size', 'identity.gtin'],
  composition: ['composition.inci', 'composition.activeConcentrations', 'composition.fragrance', 'attributes.texture'],
  usage: ['usage.instructions', 'usage.routinePeriod', 'usage.targetArea'],
  suitability: ['suitability.skinTypes', 'suitability.hairTypes'],
  safety: ['safety.warnings'],
  marketing: ['marketing.description', 'claims.manufacturerStated'],
};
/** Fields a product cannot be published without, versus fields that only make it richer. Missing optional fields never open a review task. */
const REQUIRED_FOR_PUBLICATION = new Set(['identity.size']);

/**
 * Brand and SKU profiles: deterministic classification, routine-ready metadata and an honest field-coverage view, built only from verified catalog facts and the
 * system's own rules. Reads every owner through its public services and writes only through Catalog. Never touches commercial data.
 */
@Injectable()
export class CatalogProfileService {
  constructor(
    private readonly catalog: CatalogIntakeService,
    private readonly research: CanonicalResearchService,
    private readonly decisions: CatalogDecisionLogService,
    private readonly placement: RoutinePlacementService,
    private readonly eligibility: IngestionEligibilityService,
    private readonly media: ProductMediaService,
    private readonly publication: CatalogPublicationService,
    private readonly brandResearch: BrandResearchService,
  ) {}

  /** Recomputes classification and routine profile for one SKU, then its brand profile. Safe to repeat; derived data only. */
  /** Invalidates usage an older rule applied from description text, with an audit record. Never touches a verified instruction. */
  async repairUsage(skuId: string, actorId: string) {
    const changes = await this.research.invalidateNonInstructionUsage(skuId, actorId);
    if (changes.length) {
      await this.decisions.record({ subjectType: 'SKU', subjectId: skuId, skuId, decision: 'USAGE_TEXT_INVALIDATED', reasonCode: 'NOT_AN_INSTRUCTION', evidence: { changes }, actorType: 'SYSTEM' });
    }
    return changes;
  }

  async refresh(skuId: string, actorId: string, categoryResolution?: unknown) {
    await this.repairUsage(skuId, actorId);
    const sku = await this.catalog.getSkuDetail(skuId);
    const reading = readProductType(sku.product.name, sku.product.category?.name);
    const type = reading.types.length === 1 ? reading.types[0] : null;
    const prior = (sku.product.classification as Record<string, unknown> | null) ?? {};
    await this.catalog.setProductClassification(sku.productId, {
      productType: type?.key ?? null, productSubtype: type?.subtype ?? null,
      classification: { rule: PRODUCT_TYPE_RULE_VERSION, status: type ? 'RULE_DERIVED' : reading.types.length > 1 ? 'CONFLICT' : 'UNKNOWN', matched: type?.matched ?? null,
        readings: reading.types.map(t => t.key), areas: reading.areas, category: sku.product.category?.name ?? null,
        categoryResolution: categoryResolution ?? prior.categoryResolution ?? null, at: new Date().toISOString(), actorId },
    });
    const profile = await this.routineProfile(skuId, type?.key ?? null, type?.subtype ?? null);
    await this.catalog.saveRoutineProfile(skuId, this.columns(sku.productId, profile));
    // A product type its own instructions contradict is a safety-relevant identity question: one critical exception, never a silent role.
    const critical = profile.conflicts.find(c => c.field === 'routine.role');
    if (critical) {
      await this.decisions.open({ subjectType: 'SKU', subjectId: skuId, skuId, evidence: { profile: { rinseMode: profile.rinseMode, expected: profile.expectedRinseMode, productType: profile.productType } },
        hold: { reasonCode: 'APPLICATION_MODE_CONTRADICTS_PRODUCT_TYPE', severity: 'CRITICAL', field: 'usage.instructions', summary: critical.reason,
          recommended: { action: 'RESOLVE', label: 'Confirm the product type or reject the instruction' } } });
    }
    await this.refreshBrand(sku.product.brandId);
    return profile;
  }

  /** Rebuilds every verified SKU's profiles (e.g. after a rule version change). */
  async refreshAll(actorId: string) {
    const ids = await this.catalog.verifiedSkuIds();
    const results: Array<{ skuId: string; role: string | null; ok: boolean; error?: string }> = [];
    for (const skuId of ids) {
      try { const p = await this.refresh(skuId, actorId); results.push({ skuId, role: p.primaryRole.value, ok: true }); }
      catch (error) { results.push({ skuId, role: null, ok: false, error: error instanceof Error ? error.message.slice(0, 200) : String(error) }); }
    }
    return { total: ids.length, results };
  }

  private async routineProfile(skuId: string, productType: string | null, productSubtype: string | null): Promise<RoutineProfile> {
    const sku = await this.catalog.getSkuDetail(skuId);
    const product = sku.product;
    const facts = await this.research.listFacts(skuId);
    const open = await this.decisions.openForSku(skuId);
    const applied = (field: string) => facts.filter(f => f.field === field && f.status === ProductFactStatus.APPLIED);
    const conflictFields = [...new Set(facts.filter(f => f.status === ProductFactStatus.CONFLICT).map(f => f.field))];
    const instruction = applied('usage.instructions')[0];
    const lines = instruction ? (instruction.value as string[]) : [];
    const best = (fact: Fact | undefined) => (fact ? (fact.evidence as unknown as Evidence[])[0] : undefined);
    // Only lines that instruct are parsed for period, frequency and contact time.
    const instructing = lines.filter(line => isInstructionLine(line));
    const parsed = instructing.length ? this.placement.determineRoutinePlacement({ productName: product.name, brand: product.brand.name, usage: instructing }).usageRules : [];
    const claimFacts = facts.filter(f => f.field === 'claims.manufacturerStated' && f.status !== ProductFactStatus.REJECTED);
    const keyFact = applied('composition.keyIngredients')[0];
    const keyStored = ((product.claimsEvidence as { keyIngredients?: { items: Array<{ name: string; function: string | null; functionWithheld?: string }>; sourceUrl?: string } } | null)?.keyIngredients) ?? null;
    return buildRoutineProfile({
      productName: product.name, productType, productSubtype,
      instructions: instruction ? { lines, sourceUrl: best(instruction)?.sourceUrl ?? null, sourceTier: best(instruction)?.sourceTier ?? null } : null,
      instructionsConflict: conflictFields.includes('usage.instructions') || open.some(item => item.field === 'usage.instructions' || item.reasonCode === 'USAGE_INSTRUCTIONS_CONTRADICT'),
      reviewedUsageRules: product.usageRules.map(rule => ({ routinePeriod: rule.routinePeriod, rinseMode: rule.rinseMode, frequencyUnit: rule.frequencyUnit, usesMin: rule.usesMin, usesMax: rule.usesMax,
        contactMinutes: rule.contactMinutes, evidenceText: rule.evidenceText, sourceUrl: rule.sourceUrl })),
      parsedUsageRules: parsed,
      inci: product.productIngredients.map(item => ({ inci: item.ingredient.inciName || item.ingredient.name, function: item.ingredient.primaryFunction ?? null, family: item.ingredient.family ?? null,
        concentration: item.concentrationValue !== null ? { value: Number(item.concentrationValue), unit: item.concentrationUnit ?? '%' } : null, concentrationStatus: item.concentrationStatus })),
      inciConflict: conflictFields.includes('composition.inci'),
      verifiedTargetArea: applied('usage.targetArea').length ? product.targetArea : null,
      verifiedSpf: product.spf ?? null,
      warnings: product.safetyWarnings.map(w => ({ text: w.descriptionEn ?? w.descriptionAr ?? '', sourceUrl: w.sourceUrl ?? null, sourceType: w.sourceType ?? null })).filter(w => w.text),
      skinTypes: { values: product.suitableSkinTypes, verified: applied('suitability.skinTypes').length > 0 },
      hairTypes: { values: product.suitableHairTypes, verified: applied('suitability.hairTypes').length > 0 },
      claims: claimFacts.flatMap(f => f.value as string[]),
      claimsSource: best(claimFacts[0])?.sourceUrl ?? null,
      keyIngredients: keyFact && keyStored ? { items: keyStored.items, sourceUrl: keyStored.sourceUrl ?? best(keyFact)?.sourceUrl ?? null } : null,
      conflictFields,
    });
  }

  private columns(productId: string, p: RoutineProfile): Omit<Prisma.SkuRoutineProfileUncheckedCreateInput, 'id' | 'skuId' | 'computedAt'> {
    const json = (value: unknown) => value as Prisma.InputJsonValue;
    return {
      productId, ruleVersion: p.ruleVersion, productType: p.productType, primaryRole: p.primaryRole.value, primaryRoleStatus: p.primaryRole.status, secondaryRoles: json(p.secondaryRoles),
      routineDomain: p.routineDomain, stepOrder: p.stepOrder.value, routinePeriod: p.routinePeriod.value, routinePeriodStatus: p.routinePeriod.status, periodEligibility: p.periodEligibility.value,
      cadenceUnit: p.cadence.value.unit, cadenceMin: p.cadence.value.min, cadenceMax: p.cadence.value.max, cadenceStatus: p.cadence.status,
      rinseMode: p.rinseMode.value, rinseModeStatus: p.rinseMode.status, expectedRinseMode: p.expectedRinseMode, contactMinutes: p.contactMinutes.value,
      targetArea: p.targetArea.value, targetAreaStatus: p.targetArea.status, activeIngredients: json(p.activeIngredients), featuredIngredients: json(p.featuredIngredients),
      prerequisites: json(p.prerequisites), sequencingRules: json(p.sequencingRules), cautions: json(p.cautions), suitability: json(p.suitability), conflicts: json(p.conflicts),
      fieldStatus: json({ ...p.fieldStatus, inciCompleteness: p.inciCompleteness, evidence: { routinePeriod: p.routinePeriod, cadence: p.cadence, rinseMode: p.rinseMode, contactMinutes: p.contactMinutes, targetArea: p.targetArea,
        primaryRole: p.primaryRole, stepOrder: p.stepOrder, periodEligibility: p.periodEligibility } }),
    };
  }

  /**
   * Researches a brand we hold from the pages an Admin names (its site, its owner's page, pages listing its range), keeps the evidence on the brand profile, and
   * fills an empty canonical Brand field only from a VERIFIED value. One action per brand, never per product.
   */
  async enrichBrand(brandId: string, input: { websiteUrl?: string; ownerPageUrl?: string; rangeUrls?: string[] }, actorId: string) {
    const research = await this.brandResearch.enrichExisting(brandId, input, actorId);
    const verified = (field: { value: string; status: string } | null | undefined) => (field?.status === 'VERIFIED' ? field.value : undefined);
    await this.catalog.fillBrandIdentityIfEmpty(brandId, {
      websiteUrl: research.site?.verifiedOfficial ? research.site.url : undefined,
      description: verified(research.description),
      countryOfOrigin: verified(research.country) ?? verified(research.owner?.brandOrigin),
    });
    await this.decisions.record({ subjectType: 'BRAND', subjectId: brandId, decision: 'BRAND_RESEARCHED', reasonCode: research.notes.join(',').slice(0, 80) || 'OK',
      evidence: { site: research.site, owner: research.owner, rangeSources: research.range.sources }, actorType: 'ADMIN', actorId });
    return this.refreshBrand(brandId, research);
  }

  /**
   * The brand profile, in three clearly separate parts: identity (each field with status and source), the brand's range as its own or trusted sources list it
   * (never claimed complete), and what ShinaCare holds of it (verified SKUs). A brand's concerns are never projected onto its individual SKUs.
   */
  async refreshBrand(brandId: string, research?: BrandEnrichment) {
    const { brand, products } = await this.catalog.brandPortfolio(brandId);
    const prior = (brand.profile as { research?: BrandEnrichment } | null)?.research ?? null;
    const evidence = research ?? prior;
    const current = await this.eligibility.current();
    const rule = (current?.document as { brands?: Array<{ id: string; aliases?: string[]; categoryIds?: string[] }> } | undefined)?.brands?.find(b => b.id === brandId);
    const verifiedSkus = products.filter(p => p.skus.some(s => s.identityStatus === 'EVIDENCE_VERIFIED' || s.identityStatus === 'ADMIN_VERIFIED' || s.identityStatus === 'BARCODE_VERIFIED'));
    const count = <T extends string>(values: T[]) => Object.entries(values.reduce<Record<string, number>>((m, v) => ({ ...m, [v]: (m[v] ?? 0) + 1 }), {})).map(([value, n]) => ({ value, products: n }));
    const sources = [...new Set(verifiedSkus.flatMap(p => p.skus.flatMap(s => ((s.identityEvidence as { sourceUrls?: string[] } | null)?.sourceUrls ?? []))))];
    const logoMeta = (brand.logoMetadata as Record<string, unknown> | null) ?? null;
    type Field = { value: unknown; status: string; basis: string; source?: string | null; excerpt?: string | null; note?: string };
    const fromResearch = (field: { value: string; status: string; sourceUrl: string; excerpt: string; note?: string } | null | undefined, basis: string): Field | null =>
      field ? { value: field.value, status: field.status === 'VERIFIED' ? 'VERIFIED' : 'UNVERIFIED', basis, source: field.sourceUrl, excerpt: field.excerpt, ...(field.note && { note: field.note }) } : null;
    const recorded = (value: unknown, basis = 'BRAND_RECORD'): Field => (value ? { value, status: 'RECORDED', basis } : { value: null, status: 'UNKNOWN', basis: evidence ? 'NOT_STATED_ON_PAGES_READ' : 'NOT_RESEARCHED' });
    const researchedAliases = (evidence?.aliases ?? []).filter(a => a.status === 'VERIFIED').map(a => a.value);
    const profile = {
      rule: 'brand-profile@2',
      identity: {
        canonicalName: { value: brand.name, status: 'VERIFIED', basis: 'CANONICAL_BRAND_RECORD' },
        aliases: { value: [...new Set([...(rule?.aliases ?? []), ...researchedAliases])], status: rule || researchedAliases.length ? 'VERIFIED' : 'UNKNOWN', basis: 'APPROVED_POLICY_ALIASES_AND_OFFICIAL_NAMES' },
        officialWebsite: evidence?.site?.verifiedOfficial ? { value: evidence.site.url, status: 'VERIFIED', basis: 'BRAND_DOMAIN_READ', source: evidence.site.url } : recorded(brand.websiteUrl),
        parentCompany: fromResearch(evidence?.owner?.name, 'OWNER_PAGE') ?? { value: null, status: 'UNKNOWN', basis: evidence ? 'NO_OWNER_PAGE_NAMES_THE_BRAND' : 'NOT_RESEARCHED' },
        manufacturerCountry: fromResearch(evidence?.owner?.country, 'OWNER_PAGE_STATES_COMPANY_COUNTRY') ?? { value: null, status: 'UNKNOWN', basis: evidence ? 'NOT_STATED_ON_PAGES_READ' : 'NOT_RESEARCHED' },
        countryOfOrigin: fromResearch(evidence?.country, 'BRAND_SITE') ?? fromResearch(evidence?.owner?.brandOrigin, 'OWNER_PAGE_STATES_ORIGIN') ?? recorded(brand.countryOfOrigin),
        description: fromResearch(evidence?.description, 'BRAND_SITE') ?? recorded(brand.description),
        logo: brand.logoUrl ? { value: brand.logoUrl, status: 'RECORDED', basis: 'BRAND_RECORD', provenance: logoMeta } : fromResearch(evidence?.logo, 'BRAND_SITE') ?? recorded(null),
      },
      range: evidence ? {
        basis: 'SOURCES_LISTING_THE_BRAND_RANGE', complete: false, note: evidence.range.note, sources: evidence.range.sources,
        domains: evidence.range.domains, productTypes: evidence.range.productTypes, lines: evidence.range.lines, products: evidence.range.products,
      } : { basis: 'NOT_RESEARCHED', complete: false, note: 'No range page has been read for this brand.', sources: [], domains: [], productTypes: [], lines: [], products: [] },
      inShinaCare: {
        basis: 'VERIFIED_CATALOG_SKUS', note: `${verifiedSkus.length} verified product(s) in this catalog; this is what ShinaCare holds, not the brand's range.`,
        domains: [...new Set(verifiedSkus.map(p => p.category?.parent?.name ?? null).filter((v): v is string => Boolean(v)))],
        categories: count(verifiedSkus.map(p => p.category?.name).filter((v): v is string => Boolean(v))),
        productTypes: count(verifiedSkus.map(p => p.productType).filter((v): v is string => Boolean(v))),
        productLines: [...new Set([...brand.productLines.map(l => l.name), ...verifiedSkus.map(p => p.productLine?.name).filter((v): v is string => Boolean(v))])],
        allowedLeafCategories: rule?.categoryIds?.length ?? 0,
      },
      sources: [...new Set([...sources, ...(evidence?.site ? [evidence.site.url] : []), ...(evidence?.owner ? [evidence.owner.name.sourceUrl] : []), ...(evidence?.range.sources.map(s => s.url) ?? [])])],
      research: evidence,
      at: new Date().toISOString(),
    };
    const unknown = Object.entries(profile.identity).filter(([, field]) => (field as Field).status === 'UNKNOWN').map(([key]) => key);
    const coverage = { verifiedProducts: verifiedSkus.length, totalProducts: products.length, researched: Boolean(evidence), rangeProductsListed: evidence?.range.products.length ?? 0, unknown };
    await this.catalog.saveBrandProfile(brandId, { ...profile, coverage });
    return { ...profile, coverage };
  }

  async brandProfile(brandId: string) {
    const { brand } = await this.catalog.brandPortfolio(brandId);
    const stored = brand.profile as { rule?: string } | null;
    return stored?.rule === 'brand-profile@2' ? { brandId, name: brand.name, profile: stored, updatedAt: brand.profileUpdatedAt } : { brandId, name: brand.name, profile: await this.refreshBrand(brandId), updatedAt: new Date() };
  }

  /** Everything the Admin needs to judge one SKU: identity, classification, composition, usage, routine, safety, media, sources, coverage and blockers. */
  async skuProfile(skuId: string) {
    const [sku, facts, runs, routine, readiness, assets, open] = await Promise.all([
      this.catalog.getSkuDetail(skuId), this.research.listFacts(skuId), this.research.listRuns(skuId), this.catalog.getRoutineProfile(skuId),
      this.publication.readiness(skuId), this.media.listForSku(skuId), this.decisions.openForSku(skuId),
    ]);
    const field = (name: string) => {
      const rows = facts.filter(f => f.field === name);
      const appliedFact = rows.find(f => f.status === ProductFactStatus.APPLIED);
      // Usage applied by an older rule from description text is shown for what it is: not an instruction (it yields no routine metadata either).
      const descriptionAsUsage = name === 'usage.instructions' && appliedFact && !(appliedFact.value as string[]).some(line => isInstructionLine(line));
      const status = rows.some(f => f.status === ProductFactStatus.CONFLICT) ? 'CONFLICT' : descriptionAsUsage ? 'UNVERIFIED' : appliedFact ? 'VERIFIED' : rows.some(f => f.status === ProductFactStatus.PROPOSED) ? 'UNVERIFIED' : 'UNKNOWN';
      const reason = descriptionAsUsage ? 'APPLIED_TEXT_IS_A_DESCRIPTION_NOT_AN_INSTRUCTION' : status === 'UNKNOWN' ? (runs.length ? 'NOT_STATED_ON_SOURCES_READ' : 'NOT_RESEARCHED') : status === 'UNVERIFIED' ? (rows[0]?.conflictReason ?? 'RETAILER_ONLY_OR_NOT_APPLIED') : null;
      const pick = appliedFact ?? rows.find(f => f.status === ProductFactStatus.CONFLICT) ?? rows.find(f => f.status === ProductFactStatus.PROPOSED);
      return { field: name, status, reason, value: pick?.value ?? null, required: REQUIRED_FOR_PUBLICATION.has(name),
        evidence: (pick?.evidence as unknown as Evidence[] | undefined)?.map(e => ({ url: e.sourceUrl, tier: e.sourceTier, observedAt: e.observedAt, excerpt: e.excerpt.slice(0, 300) })) ?? [],
        decisionRule: pick?.decisionRule ?? null };
    };
    const coverage = Object.fromEntries(Object.entries(FIELD_GROUPS).map(([group, names]) => [group, names.map(field)]));
    const flat = Object.values(coverage).flat();
    const p = sku.product;
    const evidence = sku.identityEvidence as { sourceUrls?: string[]; history?: unknown[] } | null;
    return {
      skuId, identity: {
        brand: { id: p.brand.id, name: p.brand.name }, product: p.name, productLine: p.productLine?.name ?? null, variant: sku.variantName, code: sku.code,
        size: sku.size !== null ? Number(sku.size) : null, sizeUnit: sku.sizeUnit, packCount: sku.packCount ?? 1,
        barcode: { value: sku.barcode, status: sku.barcodeStatus }, identityStatus: sku.identityStatus, identitySources: evidence?.sourceUrls ?? [], identityHistory: evidence?.history ?? [],
        hasOuterCarton: sku.hasOuterCarton,
      },
      classification: { category: p.category, productType: p.productType, productSubtype: p.productSubtype, detail: p.classification },
      composition: {
        inci: p.productIngredients.map(item => ({ inci: item.ingredient.inciName || item.ingredient.name, function: item.ingredient.primaryFunction, family: item.ingredient.family,
          concentration: item.concentrationValue !== null ? `${Number(item.concentrationValue)}${item.concentrationUnit ?? '%'}` : null, concentrationStatus: item.concentrationStatus })),
        fragranceFree: { value: p.isFragranceFree, status: field('composition.fragrance').status }, texture: { value: p.texture, status: field('attributes.texture').status },
      },
      usage: { instructions: p.usage, targetArea: p.targetArea, rules: p.usageRules },
      suitability: { skinTypes: p.suitableSkinTypes, hairTypes: p.suitableHairTypes, concerns: p.concerns },
      safety: { warnings: p.safetyWarnings.map(w => ({ kind: w.kind, text: w.descriptionEn ?? w.descriptionAr, sourceUrl: w.sourceUrl, sourceType: w.sourceType })) },
      routine,
      context: routine ? this.contextOf(sku, routine) : null,
      media: assets.map(a => ({ id: a.id, role: a.role, parent: a.parentAssetId, review: a.reviewStatus, processing: a.processingStatus, note: a.reviewNote, error: a.processingError,
        width: a.width, height: a.height, source: a.sourceUrl, publisher: a.sourcePublisher, rights: a.rightsStatus, warnings: (a.qualityReport as { warnings?: string[] } | null)?.warnings ?? [] })),
      sources: runs.flatMap(run => ((run.sources as unknown as Array<{ url: string; tier: string; outcome: string; fetchedAt?: string }>) ?? []).map(s => ({ ...s, runId: run.id, status: run.status }))),
      coverage,
      summary: { verified: flat.filter(f => f.status === 'VERIFIED').map(f => f.field), unknown: flat.filter(f => f.status === 'UNKNOWN').map(f => f.field),
        unverified: flat.filter(f => f.status === 'UNVERIFIED').map(f => f.field), conflict: flat.filter(f => f.status === 'CONFLICT').map(f => f.field),
        requiredMissing: flat.filter(f => f.required && f.status !== 'VERIFIED' && !(f.field === 'identity.size' && sku.size !== null)).map(f => f.field) },
      openExceptions: open.map(item => ({ id: item.id, reasonCode: item.reasonCode, severity: item.severity, field: item.field, summary: item.summary })),
      publication: { ready: readiness.ready, blockers: readiness.blockers, warnings: readiness.warnings },
      ruleVersions: { productType: PRODUCT_TYPE_RULE_VERSION, routine: ROUTINE_RULE_VERSION },
    };
  }

  /** Routine profiles of live products, for the Routine Builder, Recommendation Engine and Ask Shina. Unpublished products are never exposed. */
  async publicRoutineProfile(skuId: string) {
    if (!(await this.catalog.isPublishedSku(skuId))) throw new NotFoundException('Product not found');
    return this.routineProfileWithContext(skuId);
  }

  /** The persisted routine profile plus the product facts a consumer needs, in one machine-readable object. Admin and public callers share it. */
  async routineProfileWithContext(skuId: string) {
    const profile = await this.catalog.getRoutineProfile(skuId);
    if (!profile) throw new NotFoundException('No routine profile yet');
    const sku = await this.catalog.getSkuDetail(skuId);
    return { ...profile, context: this.contextOf(sku, profile) };
  }

  /**
   * What a recommender, the Routine Builder or Ask Shina needs to know about one SKU, built only from persisted catalog data. Every value says where it stands:
   * VERIFIED facts, MANUFACTURER_CLAIM statements, RULE_DERIVED guidance, UNKNOWN. Nothing here is re-researched or inferred at read time.
   */
  private contextOf(sku: Awaited<ReturnType<CatalogIntakeService['getSkuDetail']>>, profile: NonNullable<Awaited<ReturnType<CatalogIntakeService['getRoutineProfile']>>>) {
    const p = sku.product;
    const status = (profile.fieldStatus ?? {}) as Record<string, string>;
    const suitability = (profile.suitability ?? {}) as { concerns?: unknown[]; benefits?: unknown[]; skinTypes?: unknown; hairTypes?: unknown };
    const claims = (p.claimsEvidence as { fragrance?: { value?: string }; keyIngredients?: { items?: unknown[] } } | null) ?? {};
    return {
      schema: 'shina-product-context@1',
      identity: { skuId: sku.id, brand: p.brand.name, product: p.name, variant: sku.variantName, size: sku.size !== null ? Number(sku.size) : null, sizeUnit: sku.sizeUnit,
        identityStatus: sku.identityStatus, barcodeStatus: sku.barcodeStatus, category: p.category?.name ?? null, productType: p.productType, productSubtype: p.productSubtype },
      whatItDoes: { primaryRole: profile.primaryRole, primaryRoleStatus: profile.primaryRoleStatus, secondaryRoles: profile.secondaryRoles, benefits: suitability.benefits ?? [] },
      suitability: { skinTypes: suitability.skinTypes ?? null, hairTypes: suitability.hairTypes ?? null, concerns: suitability.concerns ?? [] },
      attributes: { texture: { value: p.texture, status: p.texture ? 'VERIFIED' : 'UNKNOWN' }, fragranceFree: { value: p.isFragranceFree, status: p.isFragranceFree === null ? 'UNKNOWN' : 'VERIFIED', basis: claims.fragrance?.value ?? null },
        targetArea: { value: profile.targetArea, status: profile.targetAreaStatus }, rinseMode: { value: profile.rinseMode, status: profile.rinseModeStatus } },
      composition: { inci: { value: p.productIngredients.map(item => item.ingredient.inciName || item.ingredient.name), status: status.inci ?? 'UNKNOWN', completeness: (profile.fieldStatus as Record<string, unknown>)?.inciCompleteness ?? null },
        keyIngredients: { value: claims.keyIngredients?.items ?? [], status: claims.keyIngredients?.items?.length ? 'MANUFACTURER_CLAIM' : 'UNKNOWN' },
        actives: profile.activeIngredients, featured: profile.featuredIngredients },
      usage: { instructions: { value: p.usage, status: status.instructions ?? 'UNKNOWN' }, period: { value: profile.routinePeriod, status: profile.routinePeriodStatus },
        cadence: { unit: profile.cadenceUnit, min: profile.cadenceMin, max: profile.cadenceMax, status: profile.cadenceStatus }, contactMinutes: profile.contactMinutes },
      routine: { domain: profile.routineDomain, defaultRank: profile.stepOrder, periodEligibility: profile.periodEligibility, placement: profile.prerequisites, guidance: profile.sequencingRules },
      safety: { cautions: profile.cautions, conflicts: profile.conflicts },
      ruleVersions: { productType: PRODUCT_TYPE_RULE_VERSION, routine: profile.ruleVersion },
    };
  }

  /**
   * Orders persisted profiles into one routine for the Routine Builder (no research at read time). Admin callers may include unpublished SKUs; public callers
   * only live ones. Returns the ordered steps, the steps left out with their reason, and the placements no source settles.
   */
  async sequence(skuIds: string[], period: 'AM' | 'PM' | undefined, liveOnly: boolean) {
    const ids = [...new Set(skuIds)].slice(0, 30);
    const steps: Array<RoutineStepInput & { skuId: string; name: string }> = [];
    const missing: string[] = [];
    for (const skuId of ids) {
      if (liveOnly && !(await this.catalog.isPublishedSku(skuId))) { missing.push(skuId); continue; }
      const profile = await this.catalog.getRoutineProfile(skuId);
      if (!profile) { missing.push(skuId); continue; }
      const sku = await this.catalog.getSkuDetail(skuId);
      steps.push({ id: skuId, skuId, name: `${sku.product.brand.name} ${sku.product.name}`, role: profile.primaryRole as RoutineRole | null, domain: profile.routineDomain as RoutineStepInput['domain'],
        rank: profile.stepOrder, constraints: profile.prerequisites as unknown as PlacementConstraint[], routinePeriod: { value: profile.routinePeriod, status: profile.routinePeriodStatus },
        periodEligibility: profile.periodEligibility });
    }
    const ordered = orderRoutine(steps, period);
    return { period: period ?? null, ruleVersion: ROUTINE_RULE_VERSION,
      steps: ordered.steps.map((step, index) => ({ position: index + 1, skuId: step.skuId, name: step.name, role: step.role, placement: step.constraints })),
      excluded: ordered.excluded.map(item => ({ skuId: item.step.skuId, name: item.step.name, reason: item.reason })), notes: ordered.notes, missing };
  }
}

import { Injectable, Optional } from '@nestjs/common';
import {
  CatalogIntakeService,
  CatalogService,
  ProductContentService,
  PublicKeyIngredientClaim,
  PublicProductIngredientFact,
  PublicSafetyWarningFact,
  PublishedKeyIngredient,
} from '../../../modules/catalog/public';
import { CareService } from '../../../modules/care/public';
import { ProductViewService } from './product-view.service';
import { PromotionService } from '../../../modules/commerce/public';

export interface PublicRoutineProfileDto {
  primaryRole: string | null;
  primaryRoleStatus: string;
  secondaryRoles: unknown[];
  routineDomain: string | null;
  stepOrder: number | null;
  routinePeriod: string;
  routinePeriodStatus: string;
  periodEligibility: string | null;
  cadenceUnit: string;
  cadenceMin: number | null;
  cadenceMax: number | null;
  cadenceStatus: string;
  rinseMode: string;
  rinseModeStatus: string;
  contactMinutes: number | null;
  targetArea: string | null;
  targetAreaStatus: string;
  activeIngredients: Array<{
    inci: string;
    family?: string | null;
    function?: string | null;
    concentration?: string | null;
    concentrationStatus?: string;
    status?: string;
  }>;
  featuredIngredients: Array<{
    concept: string;
    inci?: string | null;
    function?: string | null;
    status?: string;
    kind?: string;
  }>;
  prerequisites: Array<{
    role: string;
    relation: string;
    status: string;
    basis: string;
    excerpt?: string;
  }>;
  sequencingRules: Array<{
    rule: string;
    detail: string;
    status: string;
  }>;
  cautions: Array<{
    kind: string;
    text: string;
    status: string;
    source?: string | null;
  }>;
}

export interface PublicKeyIngredientDto {
  name: string;
  nameAr: string | null;
  inciName: string | null;
  function: string | null;
  descriptionEn: string | null;
  descriptionAr: string | null;
  visualUrl: string | null;
  concentration: string | null;
  sourceType: 'MANUFACTURER_KEY_INGREDIENT' | 'INCI_ACTIVE' | 'CATALOG_INGREDIENT';
}

function projectPublicRoutineProfile(
  raw: Record<string, unknown> | null | undefined,
): PublicRoutineProfileDto | null {
  if (!raw) return null;
  const arr = (val: unknown): unknown[] => (Array.isArray(val) ? val : []);
  const str = (val: unknown, fallback: string) => (typeof val === 'string' && val ? val : fallback);
  const optStr = (val: unknown) => (typeof val === 'string' && val ? val : null);
  const optNum = (val: unknown) => (typeof val === 'number' && Number.isFinite(val) ? val : null);

  return {
    primaryRole: optStr(raw.primaryRole),
    primaryRoleStatus: str(raw.primaryRoleStatus, 'UNKNOWN'),
    secondaryRoles: arr(raw.secondaryRoles),
    routineDomain: optStr(raw.routineDomain),
    stepOrder: optNum(raw.stepOrder),
    routinePeriod: str(raw.routinePeriod, 'UNKNOWN'),
    routinePeriodStatus: str(raw.routinePeriodStatus, 'UNKNOWN'),
    periodEligibility: optStr(raw.periodEligibility),
    cadenceUnit: str(raw.cadenceUnit, 'UNKNOWN'),
    cadenceMin: optNum(raw.cadenceMin),
    cadenceMax: optNum(raw.cadenceMax),
    cadenceStatus: str(raw.cadenceStatus, 'UNKNOWN'),
    rinseMode: str(raw.rinseMode, 'UNKNOWN'),
    rinseModeStatus: str(raw.rinseModeStatus, 'UNKNOWN'),
    contactMinutes: optNum(raw.contactMinutes),
    targetArea: optStr(raw.targetArea),
    targetAreaStatus: str(raw.targetAreaStatus, 'UNKNOWN'),
    activeIngredients: arr(raw.activeIngredients).filter(
      (item): item is PublicRoutineProfileDto['activeIngredients'][number] =>
        Boolean(item && typeof item === 'object' && 'inci' in item),
    ),
    featuredIngredients: arr(raw.featuredIngredients).filter(
      (item): item is PublicRoutineProfileDto['featuredIngredients'][number] =>
        Boolean(
          item &&
            typeof item === 'object' &&
            'status' in item &&
            (item as { status?: string }).status === 'VERIFIED',
        ),
    ),
    prerequisites: arr(raw.prerequisites) as PublicRoutineProfileDto['prerequisites'],
    sequencingRules: arr(raw.sequencingRules) as PublicRoutineProfileDto['sequencingRules'],
    cautions: arr(raw.cautions).filter(
      (item): item is PublicRoutineProfileDto['cautions'][number] =>
        Boolean(
          item &&
            typeof item === 'object' &&
            'status' in item &&
            (item as { status?: string }).status === 'VERIFIED',
        ),
    ),
  };
}

function buildSkuKeyIngredients(params: {
  contentKeys: PublishedKeyIngredient[];
  claimsKeys: PublicKeyIngredientClaim[];
  skuIngredients: PublicProductIngredientFact[];
  routineProfile: PublicRoutineProfileDto | null;
}): PublicKeyIngredientDto[] {
  const byKey = new Map<string, PublicKeyIngredientDto>();
  const piLookup = new Map<string, PublicProductIngredientFact>();
  for (const pi of params.skuIngredients) {
    piLookup.set(pi.name.trim().toLowerCase(), pi);
    if (pi.inciName) piLookup.set(pi.inciName.trim().toLowerCase(), pi);
  }

  const upsert = (entry: PublicKeyIngredientDto) => {
    const key = (entry.inciName || entry.name).trim().toLowerCase();
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, entry);
      return;
    }
    byKey.set(key, {
      ...existing,
      nameAr: existing.nameAr ?? entry.nameAr,
      inciName: existing.inciName ?? entry.inciName,
      function: existing.function ?? entry.function,
      descriptionEn: existing.descriptionEn ?? entry.descriptionEn,
      descriptionAr: existing.descriptionAr ?? entry.descriptionAr,
      visualUrl: existing.visualUrl ?? entry.visualUrl,
      concentration: existing.concentration ?? entry.concentration,
    });
  };

  for (const item of [...params.contentKeys, ...params.claimsKeys]) {
    const match = piLookup.get(item.name.trim().toLowerCase());
    upsert({
      name: item.name,
      nameAr: match?.nameAr ?? null,
      inciName: match?.inciName ?? null,
      function:
        item.function ??
        (match && match.primaryFunction !== 'unclassified' ? match.primaryFunction : null),
      descriptionEn: match?.descriptionEn ?? null,
      descriptionAr: match?.descriptionAr ?? null,
      visualUrl: match?.visualUrl ?? null,
      concentration: match?.concentration ?? null,
      sourceType: 'MANUFACTURER_KEY_INGREDIENT',
    });
  }

  for (const featured of params.routineProfile?.featuredIngredients ?? []) {
    if (!featured.concept) continue;
    const match =
      piLookup.get(featured.concept.trim().toLowerCase()) ??
      (featured.inci ? piLookup.get(featured.inci.trim().toLowerCase()) : undefined);
    upsert({
      name: match?.name ?? featured.concept,
      nameAr: match?.nameAr ?? null,
      inciName: featured.inci ?? match?.inciName ?? null,
      function:
        featured.function ??
        (match && match.primaryFunction !== 'unclassified' ? match.primaryFunction : null),
      descriptionEn: match?.descriptionEn ?? null,
      descriptionAr: match?.descriptionAr ?? null,
      visualUrl: match?.visualUrl ?? null,
      concentration: match?.concentration ?? null,
      sourceType: 'MANUFACTURER_KEY_INGREDIENT',
    });
  }

  for (const active of params.routineProfile?.activeIngredients ?? []) {
    if (active.status === 'CONFLICT') continue;
    const match = piLookup.get(active.inci.trim().toLowerCase());
    upsert({
      name: match?.name ?? active.inci,
      nameAr: match?.nameAr ?? null,
      inciName: active.inci,
      function:
        active.function && active.function !== 'unclassified'
          ? active.function
          : (active.family ?? null),
      descriptionEn: match?.descriptionEn ?? null,
      descriptionAr: match?.descriptionAr ?? null,
      visualUrl: match?.visualUrl ?? null,
      concentration: active.concentration ?? match?.concentration ?? null,
      sourceType: 'INCI_ACTIVE',
    });
  }

  for (const pi of params.skuIngredients) {
    const hasQualifiedRole =
      pi.isActiveIngredient ||
      pi.concentrationStatus === 'STATED' ||
      (Boolean(pi.primaryFunction) && pi.primaryFunction !== 'unclassified');
    if (!hasQualifiedRole) continue;
    upsert({
      name: pi.name,
      nameAr: pi.nameAr,
      inciName: pi.inciName,
      function: pi.primaryFunction !== 'unclassified' ? pi.primaryFunction : null,
      descriptionEn: pi.descriptionEn,
      descriptionAr: pi.descriptionAr,
      visualUrl: pi.visualUrl,
      concentration: pi.concentration,
      sourceType: 'CATALOG_INGREDIENT',
    });
  }

  return [...byKey.values()];
}

@Injectable()
export class ProductDetailService {
  constructor(
    private readonly views: ProductViewService,
    private readonly catalog: CatalogService,
    private readonly care: CareService,
    private readonly content: ProductContentService,
    private readonly promotions: PromotionService,
    @Optional() private readonly intake?: CatalogIntakeService,
  ) {}

  async getDetail(slugOrId: string, selectedSkuId?: string) {
    const product = await this.views.getProductView(slugOrId);
    if (!product) return null;
    const selected = product.skus.find(sku => sku.id === (selectedSkuId ?? product.skus[0].id));
    if (!selected) return null;
    const skuIds = product.skus.map(s => s.id);
    const [verifiedFacts, routinePlacements, contents, promotions, usageRules, detailFacts, routineProfiles] =
      await Promise.all([
        this.catalog.getReviewedIdentityFacts(product.id, skuIds),
        this.care.getPublicProductPlacements(product.id),
        this.content.getPublishedContent(skuIds),
        this.promotions.getActivePromotions(),
        this.catalog.getReviewedUsageRules(skuIds),
        this.catalog.getProductDetailCatalogFacts(product.id),
        this.intake ? this.intake.routineProfiles(skuIds) : Promise.resolve([]),
      ]);

    const skus = await Promise.all(
      product.skus.map(async sku => {
        const skuContent = contents.get(sku.id) ?? null;
        const rawRoutine = routineProfiles.find(r => r.skuId === sku.id) as Record<string, unknown> | undefined;
        const routineProfile = projectPublicRoutineProfile(rawRoutine);
        const skuIngredients = detailFacts.productIngredients.filter(
          pi => !pi.skuId || pi.skuId === sku.id,
        );
        const skuWarnings: PublicSafetyWarningFact[] = detailFacts.safetyWarnings.filter(
          w => !w.skuId || w.skuId === sku.id,
        );
        const keyIngredients = buildSkuKeyIngredients({
          contentKeys: skuContent?.keyIngredients ?? [],
          claimsKeys: detailFacts.keyIngredientsClaim,
          skuIngredients,
          routineProfile,
        });

        return {
          ...sku,
          media: product.media.filter(m => m.skuId === sku.id),
          verifiedFacts: verifiedFacts.filter(f => f.skuId === sku.id),
          content: skuContent,
          // GLO-279: reviewer-confirmed, source-linked usage rules (empty = directions not yet reviewed, not "use daily").
          usageRules: usageRules.filter(rule => rule.skuId === sku.id),
          routineProfile,
          keyIngredients,
          inciIngredients: skuIngredients,
          safetyWarnings: skuWarnings,
          benefits: skuContent?.benefits ?? [],
          promotions: sku.price ? await this.promotions.getProductPreview(sku.id, sku.price, promotions) : null,
        };
      }),
    );

    const selectedVariant = skus.find(sku => sku.id === selected.id)!;
    const selectedContent = contents.get(selected.id);
    const warningFallback =
      selectedVariant.safetyWarnings
        .map(w => w.descriptionAr || w.descriptionEn)
        .filter(Boolean)
        .join('\n') || null;

    return {
      ...product,
      description: selectedContent?.description ?? null,
      usage: selectedContent?.usage ?? null,
      warnings: selectedContent?.warnings ?? warningFallback,
      skus,
      selectedSkuId: selected.id,
      selectedVariant,
      verifiedFacts,
      routinePlacements,
      routineProfile: selectedVariant.routineProfile,
      keyIngredients: selectedVariant.keyIngredients,
      inciIngredients: selectedVariant.inciIngredients,
      safetyWarnings: selectedVariant.safetyWarnings,
      benefits: selectedVariant.benefits,
      factVerification: {
        identity: verifiedFacts.length ? 'reviewed' : 'unavailable',
        content: contents.has(selected.id) ? 'reviewed' : 'unavailable',
      },
      evaluatedAt: new Date().toISOString(),
    };
  }
}

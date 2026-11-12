import { Injectable, Logger } from '@nestjs/common';
import { MediaAsset, MediaOriginType, MediaProcessingStatus, MediaReviewStatus, MediaRightsStatus, MediaRole } from '@prisma/client';
import sharp from 'sharp';
import {
  CanonicalResearchService, CatalogDecisionLogService, CatalogIntakeService, chooseIdentityImage, decideEditorial, identityWords, ImageCandidate, MediaTemplateService, parseIdentityTitle,
  ProductMediaService, VERIFIED_IDENTITY_STATES,
} from '../../../../modules/catalog/public';
import { CommerceService } from '../../../../modules/commerce/public';
import { OfferIntakeService } from '../../../../modules/sourcing/public';
import { MarketPriceStoreService } from '../../../../modules/intake/public';

const MAX_IMAGE_CANDIDATES = 6;
const READY_MEDIA: string[] = [MediaReviewStatus.APPROVED, 'PUBLISHED'];

/** Product JSON-LD and og:image may use opaque CDN filenames. Their exact verified product page supplies the identity proof. */
export function imageBelongsToVerifiedProductPage(imageUrl: string, pageUrl: string, verifiedPageUrls: string[]): boolean {
  try { return new URL(imageUrl).protocol === 'https:' && verifiedPageUrls.includes(pageUrl); } catch { return false; }
}

export interface MediaOutcome { primary: string; editorial: string; rejectedSources: Array<{ url: string; reason: string }> }

export interface ReadinessFlag { ready: boolean; missing: string[]; warnings?: string[] }
export interface IntakeReadiness {
  pdp: ReadinessFlag;
  chatbot: ReadinessFlag;
  routine: ReadinessFlag;
  /** Selling needs a validated supplier cost and an Admin-approved selling price; the pipeline never sets a price. */
  selling: ReadinessFlag & { purchaseCost: number | null; marketReference: unknown };
  criticalOpen: Array<{ reasonCode: string; field: string | null; summary: string }>;
}

/**
 * Enrichment steps shared by Admin intake and re-enrichment: authentic images (originals kept, editorial copy derived, both checked automatically) and the four
 * independent readiness flags. Reads each owner through its public contract; writes only through Catalog's media services.
 */
@Injectable()
export class CatalogEnrichmentService {
  private readonly logger = new Logger(CatalogEnrichmentService.name);

  constructor(
    private readonly catalog: CatalogIntakeService,
    private readonly research: CanonicalResearchService,
    private readonly media: ProductMediaService,
    private readonly templates: MediaTemplateService,
    private readonly decisions: CatalogDecisionLogService,
    private readonly commerce: CommerceService,
    private readonly offers: OfferIntakeService,
    private readonly market: MarketPriceStoreService,
  ) {}

  /**
   * Primary packshot from the SKU's verified sources (manufacturer first, never a retailer), approved automatically only when the authentic-source checks pass; then the
   * editorial copy on the active template, approved only when its quality report has no damage warning. Originals are never edited.
   */
  async prepareMedia(skuId: string, actorId: string): Promise<MediaOutcome> {
    const outcome: MediaOutcome = { primary: 'MISSING', editorial: 'MISSING', rejectedSources: [] };
    let assets = await this.media.listForSku(skuId);
    let original: MediaAsset | undefined = assets.find(asset => asset.role === MediaRole.PRIMARY_PACKSHOT && !asset.parentAssetId && asset.reviewStatus === MediaReviewStatus.APPROVED);
    if (!original) {
      const detail = await this.catalog.getSkuDetail(skuId);
      const verifiedPageUrls = ((detail.identityEvidence as { sourceUrls?: string[] } | null)?.sourceUrls ?? []);
      // Distinctive words of the product name (its own words, not brand or vocabulary), plus its stated facts' English words, and the barcode.
      const words = [...new Set([...parseIdentityTitle(detail.product.name, [detail.product.brand.name]).descriptors, ...identityWords(detail.product.name)])]
        .filter(word => word.length >= 4 && /[a-z]/.test(word) && word !== detail.product.brand.name.toLowerCase());
      const relevant = (imageUrl: string) => {
        let path = '';
        try { path = decodeURIComponent(new URL(imageUrl).pathname).toLowerCase().replace(/[^a-z0-9]+/g, ''); } catch { return false; }
        return (detail.barcode ? path.includes(detail.barcode.replace(/^0+/, '')) : false) || words.some(word => path.includes(word.replace(/[^a-z0-9]/g, '')));
      };
      const seen = new Set<string>();
      const candidates: Array<ImageCandidate & { buffer: Buffer; contentType: string; pageUrl: string }> = [];
      for (const source of await this.research.sourceImages(skuId)) {
        if (seen.has(source.imageUrl) || candidates.length >= MAX_IMAGE_CANDIDATES || source.tier === 'RETAILER') continue;
        if (!imageBelongsToVerifiedProductPage(source.imageUrl, source.pageUrl, verifiedPageUrls) && !relevant(source.imageUrl)) {
          seen.add(source.imageUrl); outcome.rejectedSources.push({ url: source.imageUrl, reason: 'NOT_THIS_PRODUCT_IMAGE' }); continue;
        }
        seen.add(source.imageUrl);
        try {
          const image = await this.research.fetchSourceImage(source.factId, source.imageUrl);
          const meta = await sharp(image.buffer).metadata();
          candidates.push({ url: source.imageUrl, width: meta.width ?? 0, height: meta.height ?? 0, tier: image.sourceTier, reusedBySku: null, buffer: image.buffer,
            contentType: image.contentType, pageUrl: image.sourceUrl });
        } catch (error) {
          outcome.rejectedSources.push({ url: source.imageUrl, reason: error instanceof Error ? error.message.slice(0, 120) : 'FETCH_FAILED' });
        }
      }
      const { rejected } = chooseIdentityImage(candidates);
      outcome.rejectedSources.push(...rejected);
      const usable = candidates.filter(candidate => candidate.tier !== 'RETAILER' && !rejected.some(item => item.url === candidate.url))
        .sort((a, b) => (a.tier === b.tier ? 0 : a.tier === 'OFFICIAL_MANUFACTURER' ? -1 : 1) || Math.min(b.width, b.height) - Math.min(a.width, a.height));
      for (const candidate of usable) {
        const extension = candidate.contentType.includes('png') ? 'png' : candidate.contentType.includes('webp') ? 'webp' : 'jpg';
        try {
          const asset = await this.media.registerOriginal({ skuId, role: MediaRole.PRIMARY_PACKSHOT, originType: MediaOriginType.verified, sourceUrl: candidate.pageUrl,
            sourcePublisher: new URL(candidate.pageUrl).hostname, sourceType: candidate.tier as 'OFFICIAL_MANUFACTURER' | 'TRUSTED_DISTRIBUTOR',
            rightsStatus: candidate.tier === 'OFFICIAL_MANUFACTURER' ? MediaRightsStatus.MANUFACTURER_PUBLISHED : MediaRightsStatus.AUTHORIZED_DISTRIBUTOR, capturedAt: new Date().toISOString() },
          { buffer: candidate.buffer, mimetype: candidate.contentType.split(';')[0], originalname: `source.${extension}`, size: candidate.buffer.length, fieldname: 'file', encoding: '7bit' } as Express.Multer.File, actorId);
          original = await this.media.autoReview(asset.id, { approve: true, reason: 'AUTHENTIC_SOURCE_CHECKS_PASSED' }, actorId);
          await this.decisions.record({ subjectType: 'MEDIA', subjectId: asset.id, skuId, decision: original.reviewStatus, reasonCode: original.reviewNote ?? 'AUTO_REVIEW',
            evidence: { url: candidate.url, width: candidate.width, height: candidate.height, tier: candidate.tier }, actorType: 'SYSTEM' });
          if (original.reviewStatus === MediaReviewStatus.APPROVED) break;
          outcome.rejectedSources.push({ url: candidate.url, reason: original.reviewNote ?? 'NOT_APPROVED' });
          original = undefined;
        } catch (error) {
          outcome.rejectedSources.push({ url: candidate.url, reason: error instanceof Error ? error.message.slice(0, 160) : 'REGISTER_FAILED' });
        }
      }
    }
    if (!original) {
      await this.decisions.record({ subjectType: 'SKU', subjectId: skuId, skuId, decision: 'MEDIA_MISSING', reasonCode: outcome.rejectedSources.length ? 'NO_USABLE_AUTHENTIC_IMAGE' : 'NO_SOURCE_IMAGE',
        evidence: { rejectedSources: outcome.rejectedSources }, actorType: 'SYSTEM' });
      return outcome;
    }
    outcome.primary = original.reviewStatus;
    try {
      await this.templates.ensureDefaultTemplate(actorId);
      assets = await this.media.listForSku(skuId);
      let editorial = assets.find(asset => asset.parentAssetId === original!.id && asset.role === MediaRole.CATEGORY_EDITORIAL && asset.reviewStatus !== MediaReviewStatus.REJECTED
        && asset.processingStatus === MediaProcessingStatus.SUCCEEDED);
      if (!editorial) {
        editorial = await this.media.derive(original.id, { transform: 'SAHEL_EDITORIAL' }, actorId);
        if (editorial.processingStatus === MediaProcessingStatus.FAILED) editorial = await this.media.derive(original.id, { transform: 'SAHEL_EDITORIAL' }, actorId);
      }
      if (editorial.reviewStatus === MediaReviewStatus.PENDING_REVIEW && editorial.processingStatus === MediaProcessingStatus.SUCCEEDED) {
        const verdict = decideEditorial(editorial.qualityReport as { warnings: string[] } | null, editorial.processingStatus);
        editorial = await this.media.autoReview(editorial.id, verdict, actorId);
        await this.decisions.record({ subjectType: 'MEDIA', subjectId: editorial.id, skuId, decision: verdict.approve ? 'APPROVED' : 'REJECTED', reasonCode: verdict.reason,
          evidence: { qualityReport: editorial.qualityReport, templateId: editorial.templateId }, actorType: 'SYSTEM' });
      }
      outcome.editorial = editorial.processingStatus === MediaProcessingStatus.FAILED ? 'FAILED' : editorial.reviewStatus;
    } catch (error) {
      // The editorial copy is presentation, not identity: its failure is recorded, never a reason to stop.
      this.logger.warn(`Editorial image for ${skuId} failed: ${error instanceof Error ? error.message : error}`);
      outcome.editorial = 'FAILED';
    }
    return outcome;
  }

  /** Four independent answers: can the PDP show it, can the chatbot advise on it, can the routine builder place it, and can it be sold (price comes later). */
  async readiness(skuId: string): Promise<IntakeReadiness> {
    const sku = await this.catalog.getSkuDetail(skuId);
    const [media, facts, profile, open, price, costs, market] = await Promise.all([
      this.media.readiness(skuId), this.research.factSummary(skuId), this.catalog.getRoutineProfile(skuId), this.decisions.openForSku(skuId),
      this.commerce.getCurrentSellingPrice(skuId), this.offers.purchaseCosts([skuId]), this.market.latestCheck(skuId),
    ]);
    const verified = VERIFIED_IDENTITY_STATES.has(sku.identityStatus);
    const applied = new Set(facts.applied);
    const critical = open.filter(item => item.severity === 'CRITICAL');
    const flag = (missing: Array<string | false>): ReadinessFlag => { const list = missing.filter((item): item is string => Boolean(item)); return { ready: list.length === 0, missing: list }; };

    const pdp = flag([
      !verified && 'IDENTITY_NOT_VERIFIED', !sku.product.categoryId && 'CATEGORY_MISSING',
      !READY_MEDIA.includes(media.roles.PRIMARY_PACKSHOT) && 'PRIMARY_IMAGE_MISSING',
      !(applied.has('marketing.description') || applied.has('claims.manufacturerStated') || applied.has('composition.keyIngredients')) && 'NO_VERIFIED_DESCRIPTION',
      critical.length > 0 && 'CRITICAL_REVIEW_OPEN',
    ]);
    const chatbot = flag([
      !verified && 'IDENTITY_NOT_VERIFIED',
      !(applied.has('composition.inci') || applied.has('claims.manufacturerStated') || applied.has('composition.keyIngredients')) && 'NO_VERIFIED_COMPOSITION_OR_CLAIMS',
      facts.conflicts.length > 0 && 'FACT_CONFLICT_OPEN', critical.length > 0 && 'CRITICAL_REVIEW_OPEN',
    ]);
    const routine = flag([
      !verified && 'IDENTITY_NOT_VERIFIED', !profile && 'ROUTINE_PROFILE_MISSING',
      Boolean(profile) && (!profile!.primaryRole || profile!.primaryRoleStatus === 'UNKNOWN' || profile!.primaryRoleStatus === 'CONFLICT') && 'ROUTINE_ROLE_UNKNOWN',
      critical.length > 0 && 'CRITICAL_REVIEW_OPEN',
    ]);
    if (profile && profile.routinePeriod === 'UNKNOWN' && !profile.periodEligibility) routine.warnings = ['ROUTINE_PERIOD_UNKNOWN'];
    const cost = costs.get(skuId) ?? null;
    const selling = { ...flag([!cost && 'NO_SUPPLIER_COST', !price && 'SELLING_PRICE_NOT_APPROVED']), purchaseCost: cost?.purchasePrice ?? null,
      marketReference: market ? { status: market.status, reasonCode: market.reasonCode, reference: market.reference, checkedAt: market.completedAt ?? market.startedAt } : null };
    return { pdp, chatbot, routine, selling, criticalOpen: critical.map(item => ({ reasonCode: item.reasonCode, field: item.field, summary: item.summary })) };
  }
}

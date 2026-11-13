import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { MediaOriginType, MediaRightsStatus, MediaRole } from '@prisma/client';
import { MediaReviewStatus } from '@prisma/client';
import { CatalogIntakeService, ManualIntakeInput, ProductMediaService, VERIFIED_IDENTITY_STATES } from '../../../modules/catalog/public';
import { CommerceService } from '../../../modules/commerce/public';
import { CanonicalResearchService, CatalogDecisionLogService, CRITICAL_FACT_PREFIXES } from '../../../modules/catalog/public';

export type PublicationBlocker =
  | 'IDENTITY_INCOMPLETE' | 'IDENTITY_NOT_VERIFIED' | 'CATEGORY_MISSING' | 'NO_REVIEWED_FACTS' | 'FACT_CONFLICT_UNRESOLVED' | 'CRITICAL_FACT_NOT_REVIEWED'
  | 'CRITICAL_EXCEPTION_OPEN' | 'PRIMARY_PACKSHOT_NOT_APPROVED' | 'CARTON_DECISION_MISSING' | 'CARTON_PROOF_NOT_APPROVED' | 'LISTING_NOT_ACTIVE' | 'SELLING_PRICE_MISSING';
/** A missing barcode is shown honestly but does not block: identity can be verified by manufacturer evidence instead. */
export type PublicationWarning = 'BARCODE_MISSING' | 'EDITORIAL_IMAGE_NOT_APPROVED' | 'INGREDIENTS_NOT_REVIEWED' | 'USAGE_NOT_REVIEWED' | 'CARTON_UNVERIFIED';
const READY_MEDIA = ['APPROVED', 'PUBLISHED'];

/**
 * One place that answers "can this SKU go live, and if not, what is missing". It reads each owner through its public contract and writes only by asking Catalog. Nothing here
 * can publish a raw model output: only facts a person approved reach Catalog, and only Catalog-held state counts.
 */
@Injectable()
export class CatalogPublicationService {
  constructor(
    private readonly catalog: CatalogIntakeService,
    private readonly media: ProductMediaService,
    private readonly commerce: CommerceService,
    private readonly research: CanonicalResearchService,
    private readonly decisions: CatalogDecisionLogService,
  ) {}

  intake(input: ManualIntakeInput) {
    return this.catalog.intake(input);
  }

  async readiness(skuId: string) {
    const sku = await this.catalog.getSkuDetail(skuId);
    const [media, facts, listing, price, exceptions] = await Promise.all([
      this.media.readiness(skuId), this.research.factSummary(skuId), this.commerce.getListing(skuId), this.commerce.getCurrentSellingPrice(skuId), this.decisions.openForSku(skuId),
    ]);
    const blockers: PublicationBlocker[] = [];
    const warnings: PublicationWarning[] = [];
    if (sku.size === null || !sku.sizeUnit || !sku.variantName) blockers.push('IDENTITY_INCOMPLETE');
    // A recorded barcode does not establish that it belongs to this size and variant.
    if (!VERIFIED_IDENTITY_STATES.has(sku.identityStatus)) blockers.push('IDENTITY_NOT_VERIFIED');
    if (!sku.barcode) warnings.push('BARCODE_MISSING');
    if (exceptions.length) blockers.push('CRITICAL_EXCEPTION_OPEN');
    if (!sku.product.categoryId) blockers.push('CATEGORY_MISSING');
    if (!facts.applied.length) blockers.push('NO_REVIEWED_FACTS');
    if (facts.conflicts.length) blockers.push('FACT_CONFLICT_UNRESOLVED');
    if (facts.pending.some(field => CRITICAL_FACT_PREFIXES.some(prefix => field.startsWith(prefix)) && field !== 'identity.name' && field !== 'identity.brand')) blockers.push('CRITICAL_FACT_NOT_REVIEWED');
    if (!READY_MEDIA.includes(media.roles.PRIMARY_PACKSHOT)) blockers.push('PRIMARY_PACKSHOT_NOT_APPROVED');
    // Unknown is not "unboxed". A reviewed bottle can publish without promising a carton;
    // explicit boxed-pack claims and open packaging identity/safety exceptions still block below/above.
    if (sku.hasOuterCarton === null) warnings.push('CARTON_UNVERIFIED');
    if (sku.hasOuterCarton === true && !READY_MEDIA.includes(media.roles.PACKAGING_PROOF)) blockers.push('CARTON_PROOF_NOT_APPROVED');
    if (!listing?.isListed) blockers.push('LISTING_NOT_ACTIVE');
    if (!price) blockers.push('SELLING_PRICE_MISSING');
    if (!READY_MEDIA.includes(media.roles.CATEGORY_EDITORIAL)) warnings.push('EDITORIAL_IMAGE_NOT_APPROVED');
    if (!facts.applied.includes('composition.inci')) warnings.push('INGREDIENTS_NOT_REVIEWED');
    if (!facts.applied.includes('usage.instructions')) warnings.push('USAGE_NOT_REVIEWED');
    return { skuId, productId: sku.productId, isPublished: sku.product.isPublished, ready: blockers.length === 0, blockers, warnings, media: media.roles, facts,
      identity: { status: sku.identityStatus, barcodeStatus: sku.barcodeStatus, barcode: sku.barcode }, packaging: { outerCarton: sku.hasOuterCarton === null ? 'UNVERIFIED' as const : sku.hasOuterCarton }, openExceptions: exceptions.length,
      commerce: { isListed: listing?.isListed ?? false, price: price ? { amount: Number(price.amount), currency: price.currency } : null } };
  }

  async workbench(skuId: string) {
    const [sku, readiness, assets, facts, runs, decisions] = await Promise.all([
      this.catalog.getSkuDetail(skuId), this.readiness(skuId), this.media.listForSku(skuId), this.research.listFacts(skuId), this.research.listRuns(skuId), this.decisions.decisionsFor(skuId),
    ]);
    return { sku, readiness, assets, facts, runs, decisions };
  }

  /**
   * The one-time editorial sign-off: a named Admin, with every blocker cleared at this moment. Commerce only lists a published SKU, so the approved listing and price are set here,
   * in the same step: the Admin states the price, and if Commerce refuses it the product goes back to unpublished.
   */
  async publish(skuId: string, actorId: string, commercial?: { priceEgp: number; compareAtEgp?: number }) {
    const readiness = await this.readiness(skuId);
    const settledHere: PublicationBlocker[] = commercial ? ['LISTING_NOT_ACTIVE', 'SELLING_PRICE_MISSING'] : [];
    const blockers = readiness.blockers.filter(blocker => !settledHere.includes(blocker));
    if (blockers.length) throw new ConflictException({ code: 'NOT_READY_TO_PUBLISH', message: 'This product is not ready to go live', blockers });
    const wasPublished = readiness.isPublished;
    // The approved identity and editorial images go live with the product, in the same sign-off.
    for (const asset of await this.media.listForSku(skuId)) {
      if (asset.reviewStatus === MediaReviewStatus.APPROVED && !asset.publishedMediaId && !asset.supersededAt) await this.media.publish(asset.id, actorId);
    }
    await this.catalog.publishReviewed(readiness.productId, actorId);
    try {
      if (!readiness.commerce.isListed) await this.commerce.createListing(skuId, true);
      if (!readiness.commerce.price && commercial) await this.commerce.addSellingPrice({ skuId, amount: commercial.priceEgp, currency: 'EGP', ...(commercial.compareAtEgp !== undefined && { compareAtAmount: commercial.compareAtEgp }) });
    } catch (error) {
      if (!wasPublished) await this.catalog.unpublish(readiness.productId);
      throw error;
    }
    return this.readiness(skuId);
  }

  async unpublish(skuId: string) {
    const sku = await this.catalog.getSkuDetail(skuId);
    await this.catalog.unpublish(sku.productId);
    return this.readiness(skuId);
  }

  /** Imports an image a reviewed source shows. It enters as a pending original with the rights the reviewer states; nothing is approved here. */
  async importSourceImage(factId: string, input: { imageUrl: string; role: MediaRole; rightsStatus: MediaRightsStatus; sourcePublisher: string }, actorId: string) {
    const image = await this.research.fetchSourceImage(factId, input.imageUrl);
    if (image.sourceTier === 'RETAILER') throw new ConflictException({ code: 'SOURCE_NOT_AUTHENTIC_ENOUGH', message: 'Identity images come from the manufacturer or an authorized distributor, not a reseller page' });
    const extension = image.contentType.includes('png') ? 'png' : image.contentType.includes('webp') ? 'webp' : 'jpg';
    const file = { buffer: image.buffer, mimetype: image.contentType.split(';')[0], originalname: `source.${extension}`, size: image.buffer.length, fieldname: 'file', encoding: '7bit' } as Express.Multer.File;
    if (!file.buffer.length) throw new NotFoundException('Image is empty');
    return this.media.registerOriginal({ skuId: image.skuId, role: input.role, originType: MediaOriginType.verified, sourceUrl: image.sourceUrl, sourcePublisher: input.sourcePublisher,
      sourceType: image.sourceTier, rightsStatus: input.rightsStatus, capturedAt: new Date().toISOString() }, file, actorId);
  }
}

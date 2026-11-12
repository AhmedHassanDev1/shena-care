import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { MediaAsset, MediaOriginType, MediaProcessingStatus, MediaReviewStatus, MediaRightsStatus, MediaRole, Prisma } from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../../../platform/database/prisma.service';
import { isTrustedMediaSource, requireMediaReview } from '../../../platform/security/media-review';
import { BACKGROUND_REMOVAL, BackgroundRemovalPort, MEDIA_PROCESSOR, MediaProcessorPort, ProcessedImage } from '../../../platform/storage/media-processor.port';
import { StorageService } from '../../../platform/storage/storage.service';
import { DeriveMediaAssetDto, RegisterMediaAssetDto, ReviewMediaAssetDto } from '../dto/media-asset.dto';
import { MediaProcessingError, QualityReport } from '../../../platform/storage/product-compositor';
import { MediaTemplateService } from './media-template.service';
import { CatalogService } from './catalog.service';
import { usableIdentityResolution } from '../research/catalog-decision-engine';

/** Private storage owner segment for catalog media; no supplier owns these objects. */
const MEDIA_OWNER = 'catalog-media';
const MEDIA_FOLDER = 'assets';
const ALL_ROLES = [MediaRole.PRIMARY_PACKSHOT, MediaRole.TEXTURE_SENSORY, MediaRole.INGREDIENT_STORY, MediaRole.PACKAGING_PROOF] as const;
/** PDP order: the approved editorial image leads, then the identity packshot, then the real carton. Roles decide this, never file names. */
const GALLERY_ORDER: Record<MediaRole, number> = { CATEGORY_EDITORIAL: 0, PRIMARY_PACKSHOT: 1, PACKAGING_PROOF: 2, INGREDIENT_STORY: 3, TEXTURE_SENSORY: 4 };
const READINESS_ROLES = [...ALL_ROLES, MediaRole.CATEGORY_EDITORIAL] as const;
/** Roles that state what the physical product is. Their pixels are evidence, so only a genuine photograph qualifies. */
const IDENTITY_ROLES: ReadonlyArray<MediaRole> = [MediaRole.PRIMARY_PACKSHOT, MediaRole.PACKAGING_PROOF];
/** The editorial image shows the same physical pack, so it answers to the same source and rights rules as its original. */
const SOURCE_CHECKED_ROLES: ReadonlyArray<MediaRole> = [...IDENTITY_ROLES, MediaRole.CATEGORY_EDITORIAL];
/** Packaging proof must stay readable and unaltered, so it publishes as the original or an optimized copy only. */
const TRANSFORMS_ALLOWED: Record<DeriveMediaAssetDto['transform'], ReadonlyArray<MediaRole>> = {
  OPTIMIZED: ALL_ROLES,
  BACKGROUND_REMOVED: [MediaRole.PRIMARY_PACKSHOT],
  TEMPLATE_01: [MediaRole.PRIMARY_PACKSHOT],
  SAHEL_EDITORIAL: [MediaRole.PRIMARY_PACKSHOT],
};
const TRANSFORM_VERSION = 1;
const EDITORIAL_VERSION = 1;

export type MediaRoleState = 'PUBLISHED' | 'APPROVED' | 'PENDING_REVIEW' | 'REJECTED' | 'MISSING';
export interface MediaReadiness {
  skuId: string;
  roles: Record<MediaRole, MediaRoleState>;
  /** The launch gate: only a published, genuine primary packshot makes a SKU presentable. */
  hasVerifiedPrimaryPackshot: boolean;
}

/**
 * GLO-285 product media boundary. Independent of supplier ingestion: nothing here runs inside an import transaction,
 * and an image failure cannot affect a supplier offer. Originals are immutable; processed copies carry their lineage.
 */
@Injectable()
export class ProductMediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly catalog: CatalogService,
    @Inject(MEDIA_PROCESSOR) private readonly processor: MediaProcessorPort,
    @Inject(BACKGROUND_REMOVAL) private readonly backgroundRemoval: BackgroundRemovalPort,
    private readonly templates: MediaTemplateService,
  ) {}

  async registerOriginal(dto: RegisterMediaAssetDto, file: Express.Multer.File, actorId: string): Promise<MediaAsset> {
    await this.assertReviewer(actorId);
    const sku = await this.prisma.sku.findUnique({ where: { id: dto.skuId }, select: { id: true } });
    if (!sku) throw new NotFoundException('Canonical SKU not found');
    if (dto.originType === MediaOriginType.derived) throw new BadRequestException('Processed copies are created from their original, not uploaded');
    if (dto.originType === MediaOriginType.generated) {
      if (IDENTITY_ROLES.includes(dto.role)) throw new BadRequestException('Generated images can never be packaging or identity proof');
      if (process.env.ENABLE_AI_IMAGE_GENERATION !== 'true') throw new ConflictException('AI imagery is disabled');
    }

    const image = await this.processor.inspect(file.buffer);
    if (IDENTITY_ROLES.includes(dto.role) && !usableIdentityResolution(image.width, image.height)) {
      throw new BadRequestException('Identity image resolution is too low');
    }
    const contentHash = crypto.createHash('sha256').update(file.buffer).digest('hex');
    const existing = await this.prisma.mediaAsset.findFirst({ where: { skuId: dto.skuId, role: dto.role, contentHash, parentAssetId: null } });
    if (existing) return existing;
    if (IDENTITY_ROLES.includes(dto.role)) {
      // The same pixels on another SKU usually mean another size or variant's photo was reused.
      const reused = await this.prisma.mediaAsset.findFirst({ where: { contentHash, role: { in: [...IDENTITY_ROLES] }, skuId: { not: dto.skuId } }, select: { skuId: true } });
      if (reused) throw new ConflictException(`This image is already recorded as identity proof for SKU ${reused.skuId}`);
    }

    const url = await this.storage.uploadFile({ ...file, mimetype: image.mimeType }, true, MEDIA_FOLDER, MEDIA_OWNER);
    try {
      return await this.prisma.mediaAsset.create({
        data: {
          skuId: dto.skuId, role: dto.role, originType: dto.originType, storageUrl: url, mimeType: image.mimeType,
          width: image.width, height: image.height, byteSize: file.buffer.length, contentHash,
          sourceUrl: dto.sourceUrl, sourcePublisher: dto.sourcePublisher, sourceType: dto.sourceType, rightsStatus: dto.rightsStatus,
          capturedAt: dto.capturedAt ? new Date(dto.capturedAt) : null,
          processingStatus: MediaProcessingStatus.SUCCEEDED, createdBy: actorId,
        },
      });
    } catch (error) {
      await this.storage.deleteFile(url).catch(() => undefined);
      // Two uploads of one image race on the unique key; the loser returns the winner's record.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.prisma.mediaAsset.findFirstOrThrow({ where: { skuId: dto.skuId, role: dto.role, contentHash, parentAssetId: null } });
      }
      throw error;
    }
  }

  /** Creates or retries a processed copy. A processor failure is recorded on that copy; the original stays usable. */
  async derive(assetId: string, dto: DeriveMediaAssetDto, actorId: string): Promise<MediaAsset> {
    await this.assertReviewer(actorId);
    const parent = await this.getAsset(assetId);
    if (!TRANSFORMS_ALLOWED[dto.transform].includes(parent.role)) throw new BadRequestException(`${dto.transform} is not allowed for ${parent.role}`);
    if (dto.transform === 'TEMPLATE_01' && !dto.fieldColor) throw new BadRequestException('Template 01 needs a field colour');
    if (dto.transform === 'SAHEL_EDITORIAL') return this.deriveEditorial(parent, dto, actorId);
    const transformVersion = `${dto.transform}@${TRANSFORM_VERSION}${dto.fieldColor ? `:${dto.fieldColor.toLowerCase()}` : ''}`;

    const prior = await this.prisma.mediaAsset.findUnique({ where: { parentAssetId_transformVersion: { parentAssetId: parent.id, transformVersion } } });
    if (prior?.processingStatus === MediaProcessingStatus.SUCCEEDED) return prior;
    const record = prior ?? await this.prisma.mediaAsset.create({
      data: {
        skuId: parent.skuId, role: parent.role, originType: MediaOriginType.derived, parentAssetId: parent.id, transformVersion,
        sourceUrl: parent.sourceUrl, sourcePublisher: parent.sourcePublisher, sourceType: parent.sourceType, rightsStatus: parent.rightsStatus,
        capturedAt: parent.capturedAt, createdBy: actorId,
      },
    });

    try {
      const original = await this.readOriginal(parent);
      const output = await this.runTransform(dto, original);
      const contentHash = crypto.createHash('sha256').update(output.buffer).digest('hex');
      const url = await this.storage.uploadFile({
        buffer: output.buffer, mimetype: output.mimeType, originalname: `${record.id}.webp`, size: output.buffer.length, fieldname: 'file', encoding: '7bit',
      } as Express.Multer.File, true, MEDIA_FOLDER, MEDIA_OWNER);
      return await this.prisma.mediaAsset.update({
        where: { id: record.id },
        data: { storageUrl: url, mimeType: output.mimeType, width: output.width, height: output.height, byteSize: output.buffer.length, contentHash,
          processingStatus: MediaProcessingStatus.SUCCEEDED, processingError: null, processingAttempts: { increment: 1 } },
      });
    } catch (error) {
      return this.prisma.mediaAsset.update({
        where: { id: record.id },
        data: { processingStatus: MediaProcessingStatus.FAILED, processingError: error instanceof Error ? error.message.slice(0, 500) : 'PROCESSING_FAILED', processingAttempts: { increment: 1 } },
      });
    }
  }

  /**
   * Authentic packshot composited on a registered template version. Safe to retry and to repeat: the (original, template version, options) triple names exactly one
   * derivative. A new template version makes a new derivative; what is live keeps showing until the new one is approved and published.
   */
  private async deriveEditorial(parent: MediaAsset, dto: DeriveMediaAssetDto, actorId: string): Promise<MediaAsset> {
    const template = await this.templates.resolveForSku(parent.skuId, dto.templateId);
    const transformVersion = `SAHEL_EDITORIAL@${EDITORIAL_VERSION}:${template.templateKey}@${template.version}${dto.transparentPackaging ? ':clear-pack' : ''}`;
    const prior = await this.prisma.mediaAsset.findUnique({ where: { parentAssetId_transformVersion: { parentAssetId: parent.id, transformVersion } } });
    if (prior?.processingStatus === MediaProcessingStatus.SUCCEEDED) return prior;
    const record = prior ?? await this.prisma.mediaAsset.create({
      data: {
        skuId: parent.skuId, role: MediaRole.CATEGORY_EDITORIAL, originType: MediaOriginType.derived, parentAssetId: parent.id, transformVersion, templateId: template.id,
        sourceUrl: parent.sourceUrl, sourcePublisher: parent.sourcePublisher, sourceType: parent.sourceType, rightsStatus: parent.rightsStatus, capturedAt: parent.capturedAt, createdBy: actorId,
      },
    });
    try {
      const [original, scene] = await Promise.all([this.readOriginal(parent), this.templates.readFile(template)]);
      const output = await this.processor.composeOnTemplate(original, scene, this.templates.rulesOf(template), { transparentPackaging: dto.transparentPackaging });
      const contentHash = crypto.createHash('sha256').update(output.buffer).digest('hex');
      const url = await this.storage.uploadFile({
        buffer: output.buffer, mimetype: output.mimeType, originalname: `${record.id}.webp`, size: output.buffer.length, fieldname: 'file', encoding: '7bit',
      } as Express.Multer.File, true, MEDIA_FOLDER, MEDIA_OWNER);
      return await this.prisma.mediaAsset.update({
        where: { id: record.id },
        data: { storageUrl: url, mimeType: output.mimeType, width: output.width, height: output.height, byteSize: output.buffer.length, contentHash,
          qualityReport: output.report as unknown as Prisma.InputJsonValue, processingStatus: MediaProcessingStatus.SUCCEEDED, processingError: null, processingAttempts: { increment: 1 } },
      });
    } catch (error) {
      const reason = error instanceof MediaProcessingError ? error.message : error instanceof Error ? error.message.slice(0, 500) : 'PROCESSING_FAILED';
      return this.prisma.mediaAsset.update({ where: { id: record.id }, data: { processingStatus: MediaProcessingStatus.FAILED, processingError: reason, processingAttempts: { increment: 1 } } });
    }
  }

  /** Re-runs one template's editorial images on its active version. Reviewed and live images are left alone until a person approves the new result. */
  async reprocessTemplate(templateKey: string, actorId: string, limit = 50) {
    await this.assertReviewer(actorId);
    const active = await this.templates.activeVersion(templateKey);
    const outdated = await this.prisma.mediaAsset.findMany({
      where: { role: MediaRole.CATEGORY_EDITORIAL, template: { templateKey }, templateId: { not: active.id }, parentAssetId: { not: null } },
      select: { parentAssetId: true, transformVersion: true }, orderBy: { createdAt: 'asc' },
    });
    const pending = new Map<string, boolean>();
    for (const row of outdated) pending.set(row.parentAssetId!, row.transformVersion?.endsWith(':clear-pack') ?? false);
    const currentVersions = await this.prisma.mediaAsset.findMany({ where: { templateId: active.id, parentAssetId: { in: [...pending.keys()] } }, select: { parentAssetId: true } });
    for (const row of currentVersions) pending.delete(row.parentAssetId!);
    const results: Array<{ parentAssetId: string; assetId: string; processingStatus: string; processingError: string | null }> = [];
    for (const [parentAssetId, transparentPackaging] of [...pending.entries()].slice(0, limit)) {
      const asset = await this.derive(parentAssetId, { transform: 'SAHEL_EDITORIAL', templateId: active.id, ...(transparentPackaging && { transparentPackaging }) }, actorId);
      results.push({ parentAssetId, assetId: asset.id, processingStatus: asset.processingStatus, processingError: asset.processingError });
    }
    return { templateKey, activeVersion: active.version, remaining: Math.max(pending.size - limit, 0), results };
  }

  /** The stored bytes, for the Admin before/after view. Originals and derivatives both stay private until published. */
  async readAssetFile(assetId: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const asset = await this.getAsset(assetId);
    if (!asset.storageUrl || !asset.mimeType) throw new NotFoundException('This asset has no stored file');
    return { buffer: await this.storage.getFileBuffer(this.storage.privateObjectKey(asset.storageUrl, MEDIA_OWNER, MEDIA_FOLDER)), mimeType: asset.mimeType };
  }

  private async runTransform(dto: DeriveMediaAssetDto, original: Buffer): Promise<ProcessedImage> {
    if (dto.transform === 'OPTIMIZED') return this.processor.optimize(original);
    if (dto.transform === 'TEMPLATE_01') return this.processor.composeOnField(original, dto.fieldColor!);
    return this.processor.optimize(await this.backgroundRemoval.removeBackground(original));
  }

  /** The reviewer confirms this exact SKU: the image's evidence is checked against the facts recorded for it. */
  async review(assetId: string, dto: ReviewMediaAssetDto, actorId: string): Promise<MediaAsset> {
    await this.assertReviewer(actorId);
    const asset = await this.getAsset(assetId);
    if (asset.publishedMediaId) throw new ConflictException('A published asset is immutable');
    if (asset.processingStatus !== MediaProcessingStatus.SUCCEEDED) throw new ConflictException('Only a successfully processed asset can be reviewed');
    if (dto.reason.trim().length < 5) throw new BadRequestException('A meaningful review reason is required');
    let facts: Prisma.InputJsonValue = {};
    if (dto.decision === 'APPROVED') {
      if (SOURCE_CHECKED_ROLES.includes(asset.role) && asset.rightsStatus === MediaRightsStatus.UNKNOWN) {
        throw new ConflictException('Identity images need a known source and usage right');
      }
      if (SOURCE_CHECKED_ROLES.includes(asset.role) && !isTrustedMediaSource(asset.sourceUrl)) {
        throw new ConflictException('Identity images need a trusted manufacturer or distributor source');
      }
      if (asset.role === MediaRole.CATEGORY_EDITORIAL) {
        const warnings = (asset.qualityReport as unknown as QualityReport | null)?.warnings ?? [];
        // Warnings that can mean visible damage need a person to look at the result and say so; scale-only notes do not.
        const needsLook = warnings.filter(warning => ['TOUCHES_IMAGE_EDGE', 'ENCLOSED_BACKGROUND', 'LOW_EDGE_CONTRAST', 'DETACHED_PART', 'NEURAL_CUTOUT_FAILED'].includes(warning));
        if (needsLook.length && !dto.acceptQualityWarnings) {
          throw new ConflictException({ code: 'QUALITY_WARNING_UNACKNOWLEDGED', message: 'Look at the processed image and confirm it is clean: the pack may be cropped or edged in background', warnings: needsLook });
        }
      }
      if (asset.role === MediaRole.INGREDIENT_STORY) facts = { ingredientIds: await this.verifiedIngredients(asset.skuId, dto.ingredientIds) };
      if (asset.role === MediaRole.TEXTURE_SENSORY) {
        if (!dto.evidence?.textureSourceUrl?.startsWith('https://')) throw new BadRequestException('A texture image needs its verified texture source');
        facts = { textureSourceUrl: dto.evidence.textureSourceUrl };
      }
    }
    return this.prisma.mediaAsset.update({
      where: { id: assetId },
      data: { reviewStatus: dto.decision === 'APPROVED' ? MediaReviewStatus.APPROVED : MediaReviewStatus.REJECTED,
        reviewedBy: actorId, reviewedAt: new Date(), reviewNote: dto.reason, verifiedFacts: facts },
    });
  }

  /**
   * The automatic reviewer: the same guards as a person's review (trusted source, known rights, processed file, verified SKU identity for identity roles), applied
   * without a click. Only approves when every check passes; a failing check rejects with its reason. Recorded as an automatic decision, never as a person's.
   */
  async autoReview(assetId: string, input: { approve: boolean; reason: string }, actorId: string): Promise<MediaAsset> {
    const asset = await this.getAsset(assetId);
    if (asset.publishedMediaId || asset.reviewStatus !== MediaReviewStatus.PENDING_REVIEW) return asset;
    let approve = input.approve;
    let reason = input.reason;
    if (approve) {
      const sku = await this.prisma.sku.findUniqueOrThrow({ where: { id: asset.skuId }, select: { identityStatus: true, barcode: true } });
      const identityKnown = ['EVIDENCE_VERIFIED', 'BARCODE_VERIFIED', 'ADMIN_VERIFIED'].includes(sku.identityStatus);
      if (asset.processingStatus !== MediaProcessingStatus.SUCCEEDED) [approve, reason] = [false, 'PROCESSING_FAILED'];
      else if (SOURCE_CHECKED_ROLES.includes(asset.role) && asset.rightsStatus === MediaRightsStatus.UNKNOWN) [approve, reason] = [false, 'RIGHTS_UNKNOWN'];
      else if (SOURCE_CHECKED_ROLES.includes(asset.role) && !isTrustedMediaSource(asset.sourceUrl)) [approve, reason] = [false, 'SOURCE_NOT_ON_TRUSTED_LIST'];
      else if (SOURCE_CHECKED_ROLES.includes(asset.role) && !identityKnown) [approve, reason] = [false, 'SKU_IDENTITY_NOT_VERIFIED'];
      else if (IDENTITY_ROLES.includes(asset.role) && !usableIdentityResolution(asset.width ?? 0, asset.height ?? 0)) [approve, reason] = [false, 'RESOLUTION_TOO_LOW'];
      else if (asset.parentAssetId) {
        const parent = await this.getAsset(asset.parentAssetId);
        if (parent.reviewStatus !== MediaReviewStatus.APPROVED) [approve, reason] = [false, 'ORIGINAL_NOT_APPROVED'];
      }
      else if (asset.role === MediaRole.CATEGORY_EDITORIAL && ((asset.qualityReport as any)?.warnings ?? []).includes('NEURAL_CUTOUT_FAILED')) {
        [approve, reason] = [false, 'NEURAL_CUTOUT_FAILED'];
      }
    }
    if (!approve && reason === 'SOURCE_NOT_ON_TRUSTED_LIST') {
      return this.prisma.mediaAsset.update({ where: { id: assetId }, data: { reviewNote: 'Automatic: SOURCE_NOT_ON_TRUSTED_LIST (add the host to MEDIA_TRUSTED_SOURCE_HOSTS, or review by hand)' } });
    }
    return this.prisma.mediaAsset.update({ where: { id: assetId }, data: {
      reviewStatus: approve ? MediaReviewStatus.APPROVED : MediaReviewStatus.REJECTED, reviewedBy: actorId, reviewedAt: new Date(),
      reviewNote: `Automatic: ${reason}`.slice(0, 500), reviewedAutomatically: true,
    } });
  }

  private async verifiedIngredients(skuId: string, requested?: string[]): Promise<string[]> {
    if (!requested?.length) throw new BadRequestException('An ingredient visual must name its verified ingredients');
    const sku = await this.prisma.sku.findUniqueOrThrow({ where: { id: skuId }, select: { productId: true } });
    // Formula isolation (GLO-284): a sibling variant's ingredients are not this SKU's.
    const known = await this.prisma.productIngredient.findMany({
      where: { productId: sku.productId, ingredientId: { in: requested }, OR: [{ skuId }, { skuId: null }] },
      select: { ingredientId: true },
    });
    const verified = new Set(known.map(row => row.ingredientId));
    if (requested.some(id => !verified.has(id))) throw new ConflictException('Ingredient is not verified on this SKU');
    return requested;
  }

  async publish(assetId: string, actorId: string): Promise<MediaAsset> {
    await this.assertReviewer(actorId);
    const asset = await this.getAsset(assetId);
    if (asset.publishedMediaId) return asset;
    if (asset.reviewStatus !== MediaReviewStatus.APPROVED) throw new ConflictException('Only an approved asset can be published');
    if (asset.processingStatus !== MediaProcessingStatus.SUCCEEDED || !asset.storageUrl) throw new ConflictException('Asset has no processed file');
    if (asset.parentAssetId) {
      const parent = await this.getAsset(asset.parentAssetId);
      if (parent.reviewStatus === MediaReviewStatus.REJECTED) throw new ConflictException('The original of this copy was rejected');
    }
    const sku = await this.prisma.sku.findUniqueOrThrow({ where: { id: asset.skuId } });
    const review = requireMediaReview({
      sourceUrl: asset.sourceUrl, sourceType: asset.sourceType, reviewedBy: asset.reviewedBy, reviewedAt: asset.reviewedAt?.toISOString(),
      skuId: sku.id, barcode: sku.barcode, identityVerification: sku.identityStatus, size: sku.size?.toNumber(), sizeUnit: sku.sizeUnit, variantName: sku.variantName,
      ...(sku.packCount !== null && { packCount: sku.packCount }), isTest: false,
    });
    const url = await this.storage.copyToPublic(asset.storageUrl, MEDIA_OWNER, MEDIA_FOLDER);
    const media = await this.catalog.addMedia(sku.productId, {
      type: 'image', url, role: asset.role, assetId: asset.id, originType: asset.originType,
      isPrimary: asset.role === MediaRole.PRIMARY_PACKSHOT, sortOrder: GALLERY_ORDER[asset.role],
      generationMetadata: { ...review, verifiedFacts: asset.verifiedFacts, rightsStatus: asset.rightsStatus, contentHash: asset.contentHash, transformVersion: asset.transformVersion,
        ...(asset.templateId && { templateId: asset.templateId }), ...(asset.parentAssetId && { parentAssetId: asset.parentAssetId }) },
    }, actorId);
    // One live editorial image per SKU: the new version replaces the old one in the gallery; the old asset keeps its file and lineage.
    if (asset.role === MediaRole.CATEGORY_EDITORIAL) {
      const replaced = await this.prisma.mediaAsset.findMany({ where: { skuId: asset.skuId, role: asset.role, id: { not: asset.id }, publishedMediaId: { not: null } } });
      for (const old of replaced) {
        if (old.publishedMediaId) await this.catalog.deleteMedia(old.publishedMediaId);
        await this.prisma.mediaAsset.update({ where: { id: old.id }, data: { publishedMediaId: null, supersededAt: new Date() } });
      }
    }
    return this.prisma.mediaAsset.update({ where: { id: asset.id }, data: { publishedMediaId: media.id, publishedAt: new Date() } });
  }

  async listForSku(skuId: string): Promise<MediaAsset[]> {
    return this.prisma.mediaAsset.findMany({ where: { skuId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  }

  /** Truthful per-role state; a role without an image reads MISSING and is never filled with a stand-in. */
  async readiness(skuId: string): Promise<MediaReadiness> {
    const assets = await this.listForSku(skuId);
    const sku = await this.prisma.sku.findUnique({ where: { id: skuId }, select: { productId: true } });
    // Packshots approved during candidate review reach ProductMedia directly, without an asset record.
    const published = sku ? await this.prisma.productMedia.findMany({
      where: { productId: sku.productId, role: { not: null }, generationMetadata: { path: ['skuId'], equals: skuId } }, select: { role: true } }) : [];
    const stateOf = (role: MediaRole): MediaRoleState => {
      const forRole = assets.filter(asset => asset.role === role);
      if (forRole.some(asset => asset.publishedMediaId) || published.some(media => media.role === role)) return 'PUBLISHED';
      if (forRole.some(asset => asset.reviewStatus === MediaReviewStatus.APPROVED)) return 'APPROVED';
      if (forRole.some(asset => asset.reviewStatus === MediaReviewStatus.PENDING_REVIEW)) return 'PENDING_REVIEW';
      return forRole.length ? 'REJECTED' : 'MISSING';
    };
    const roles = Object.fromEntries(READINESS_ROLES.map(role => [role, stateOf(role)])) as Record<MediaRole, MediaRoleState>;
    return { skuId, roles, hasVerifiedPrimaryPackshot: roles.PRIMARY_PACKSHOT === 'PUBLISHED' };
  }

  private async readOriginal(asset: MediaAsset): Promise<Buffer> {
    if (!asset.storageUrl) throw new ConflictException('Original file is unavailable');
    const buffer = await this.storage.getFileBuffer(this.storage.privateObjectKey(asset.storageUrl, MEDIA_OWNER, MEDIA_FOLDER));
    if (crypto.createHash('sha256').update(buffer).digest('hex') !== asset.contentHash) {
      throw new ConflictException('Original file no longer matches its recorded hash');
    }
    return buffer;
  }

  private async getAsset(id: string): Promise<MediaAsset> {
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id } });
    if (!asset) throw new NotFoundException('Media asset not found');
    return asset;
  }

  private async assertReviewer(actorId: string): Promise<void> {
    const actor = await this.prisma.customer.findUnique({ where: { id: actorId }, select: { roles: true } });
    if (!actor?.roles.some(role => role === 'ADMIN' || role === 'HUB_OPERATOR')) throw new ForbiddenException('Media review requires internal staff');
  }
}

import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import {
  PublicMediaHiddenReason,
  publicMediaVisibility,
} from '../../../platform/security/media-review';
import { FILE_STORAGE_PORT, FileStoragePort } from '../../../platform/storage/storage.port';
import {
  MEDIA_STORAGE_PORT,
  MediaStoragePort,
} from '../../../platform/storage/media-storage.port';

export type CatalogItemStatusFilter = 'published' | 'draft' | 'archived';
export type CatalogItemReadinessFilter =
  | 'missing_image'
  | 'pending_image'
  | 'missing_price'
  | 'not_listed'
  | 'incomplete'
  | 'ready';

export interface CatalogItemListFilters {
  brandId?: string;
  categoryId?: string;
  status?: CatalogItemStatusFilter;
  readiness?: CatalogItemReadinessFilter;
  pricedSkuIds?: string[];
  listedSkuIds?: string[];
  pendingImageSkuIds?: string[];
}

export type SkuPrimaryMediaState =
  | 'PUBLISHED'
  | 'APPROVED'
  | 'PENDING_REVIEW'
  | 'REJECTED'
  | 'MISSING';

export type ProductMediaStatus =
  | 'PUBLISHED'
  | 'APPROVED_UNPUBLISHED'
  | 'PENDING_REVIEW'
  | 'MISSING';

const PRODUCT_LIST_SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  isPublished: true,
  archivedAt: true,
  brandId: true,
  categoryId: true,
  productLineId: true,
  brand: { select: { id: true, name: true, slug: true } },
  category: { select: { id: true, name: true, slug: true, parentId: true } },
  productLine: { select: { id: true, name: true, slug: true } },
  media: {
    orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
    take: 4,
    select: {
      id: true,
      url: true,
      altText: true,
      isPrimary: true,
      originType: true,
      generationMetadata: true,
    },
  },
  skus: {
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      code: true,
      variantName: true,
      barcode: true,
      size: true,
      sizeUnit: true,
      packCount: true,
      isActive: true,
      hasOuterCarton: true,
      identityStatus: true,
      barcodeStatus: true,
    },
  },
} satisfies Prisma.ProductSelect;

type RawListedProduct = Prisma.ProductGetPayload<{ select: typeof PRODUCT_LIST_SELECT }>;

/** Same shape the storage route serves from: /storage/public/media/<file>. */
const LOCAL_MEDIA_PATH = /\/storage\/public\/media\/([a-zA-Z0-9_-]+\.[a-zA-Z0-9]+)$/;

@Injectable()
export class CatalogItemManagementService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(MEDIA_STORAGE_PORT)
    private readonly mediaPort?: MediaStoragePort,
    @Optional()
    @Inject(FILE_STORAGE_PORT)
    private readonly files?: FileStoragePort,
  ) {}

  private resolveMediaUrl(url: string): string {
    if (!url || !this.mediaPort) return url;
    try {
      return this.mediaPort.getDeliveryUrl(url);
    } catch {
      return url;
    }
  }

  async ensureSkuEditable(skuId: string) {
    const sku = await this.prisma.sku.findUnique({ where: { id: skuId }, select: { product: { select: { archivedAt: true } } } });
    if (!sku) throw new NotFoundException('SKU not found');
    if (sku.product.archivedAt) throw new ConflictException('Restore the archived product before changing its SKU');
  }

  async getPendingImageSkuIds(): Promise<string[]> {
    if (!this.prisma.mediaAsset?.findMany) return [];
    const rows = await this.prisma.mediaAsset.findMany({
      where: {
        role: 'PRIMARY_PACKSHOT',
        reviewStatus: 'PENDING_REVIEW',
        supersededAt: null,
      },
      distinct: ['skuId'],
      select: { skuId: true },
    });
    return rows.map((r) => r.skuId);
  }

  /**
   * Admin-only: locate the stored file behind a product image so the Admin screen can show it even while the
   * public storage route refuses it (draft product, or a review that no longer matches the SKU). The public gate
   * is untouched. Returns null for images that live elsewhere (external CDN URLs).
   */
  async openMediaFile(mediaId: string): Promise<{ stream: NodeJS.ReadableStream; filename: string }> {
    const media = await this.prisma.productMedia.findUnique({ where: { id: mediaId }, select: { url: true } });
    if (!media) throw new NotFoundException('Image not found');
    const match = LOCAL_MEDIA_PATH.exec(media.url.split('?')[0]);
    if (!match || !this.files) throw new NotFoundException('This image is not stored on this server');
    const objectKey = `public/media/${match[1]}`;
    if (!(await this.files.exists(objectKey))) throw new NotFoundException('Image file is missing from storage');
    return { stream: await this.files.readStream(objectKey), filename: match[1] };
  }

  async list(
    page: number,
    limit: number,
    q?: string,
    state?: 'active' | 'archived',
    filters?: CatalogItemListFilters,
  ) {
    const andClauses: Prisma.ProductWhereInput[] = [];

    if (filters?.status === 'published') {
      andClauses.push({ archivedAt: null, isPublished: true });
    } else if (filters?.status === 'draft') {
      andClauses.push({ archivedAt: null, isPublished: false });
    } else if (filters?.status === 'archived') {
      andClauses.push({ archivedAt: { not: null } });
    } else if (state) {
      andClauses.push({ archivedAt: state === 'archived' ? { not: null } : null });
    }

    if (filters?.brandId) {
      andClauses.push({ brandId: filters.brandId });
    }

    if (filters?.categoryId) {
      andClauses.push({
        OR: [
          { categoryId: filters.categoryId },
          { category: { parentId: filters.categoryId } },
        ],
      });
    }

    if (q) {
      andClauses.push({
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { slug: { contains: q, mode: 'insensitive' } },
          { brand: { name: { contains: q, mode: 'insensitive' } } },
          { category: { name: { contains: q, mode: 'insensitive' } } },
          { skus: { some: { code: { contains: q, mode: 'insensitive' } } } },
          { skus: { some: { barcode: { contains: q, mode: 'insensitive' } } } },
          { skus: { some: { variantName: { contains: q, mode: 'insensitive' } } } },
        ],
      });
    }

    if (filters?.readiness === 'missing_image') {
      andClauses.push({ media: { none: {} } });
    } else if (filters?.readiness === 'pending_image') {
      andClauses.push({
        media: { none: {} },
        skus: { some: { id: { in: filters.pendingImageSkuIds ?? [] } } },
      });
    } else if (filters?.readiness === 'missing_price') {
      andClauses.push({
        skus: { none: { id: { in: filters.pricedSkuIds ?? [] } } },
      });
    } else if (filters?.readiness === 'not_listed') {
      andClauses.push({
        skus: { none: { id: { in: filters.listedSkuIds ?? [] } } },
      });
    } else if (filters?.readiness === 'incomplete') {
      // Catalog data that is not complete yet: no category, or a SKU without barcode, size or unit.
      andClauses.push({
        archivedAt: null,
        OR: [
          { categoryId: null },
          { skus: { some: { OR: [{ barcode: null }, { size: null }, { sizeUnit: null }] } } },
        ],
      });
    } else if (filters?.readiness === 'ready') {
      andClauses.push({
        archivedAt: null,
        media: { some: {} },
        skus: { some: { isActive: true, id: { in: filters.pricedSkuIds ?? [] } } },
      });
    }

    const where: Prisma.ProductWhereInput = andClauses.length ? { AND: andClauses } : {};

    const [total, rawItems, totalCatalog, publishedCatalog, draftCatalog, archivedCatalog, missingImageCatalog] =
      await Promise.all([
        this.prisma.product.count({ where }),
        this.prisma.product.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * limit,
          take: limit,
          select: PRODUCT_LIST_SELECT,
        }),
        this.prisma.product.count(),
        this.prisma.product.count({ where: { archivedAt: null, isPublished: true } }),
        this.prisma.product.count({ where: { archivedAt: null, isPublished: false } }),
        this.prisma.product.count({ where: { archivedAt: { not: null } } }),
        this.prisma.product.count({ where: { archivedAt: null, media: { none: {} } } }),
      ]);

    const items = await this.decorate(rawItems);

    return {
      total,
      page,
      limit,
      summary: {
        total: totalCatalog,
        published: publishedCatalog,
        draft: draftCatalog,
        archived: archivedCatalog,
        missingImage: missingImageCatalog,
      },
      items,
    };
  }

  async getOne(id: string) {
    const raw = await this.prisma.product.findUnique({ where: { id }, select: PRODUCT_LIST_SELECT });
    if (!raw) throw new NotFoundException('Product not found');
    const [item] = await this.decorate([raw]);
    return item;
  }

  /** Adds the SKU image states, the product image status and, per image, whether the storefront can serve it. */
  private async decorate(rawItems: RawListedProduct[]) {
    const skuIds = rawItems.flatMap((item) => item.skus.map((sku) => sku.id));
    const mediaAssets =
      skuIds.length && this.prisma.mediaAsset?.findMany
        ? await this.prisma.mediaAsset.findMany({
            where: {
              skuId: { in: skuIds },
              role: 'PRIMARY_PACKSHOT',
              supersededAt: null,
            },
            orderBy: { createdAt: 'desc' },
            select: { skuId: true, reviewStatus: true, publishedMediaId: true },
          })
        : [];

    const skuMediaMap = new Map<string, SkuPrimaryMediaState>();
    for (const asset of mediaAssets) {
      if (asset.publishedMediaId) {
        skuMediaMap.set(asset.skuId, 'PUBLISHED');
      } else if (!skuMediaMap.has(asset.skuId)) {
        const mapped = asset.reviewStatus as SkuPrimaryMediaState;
        skuMediaMap.set(asset.skuId, mapped);
      }
    }

    return rawItems.map((product) => {
      const resolvedMedia = product.media.map((m) => {
        const visibility = publicMediaVisibility({
          originType: m.originType,
          generationMetadata: m.generationMetadata,
          product: { isPublished: product.isPublished && !product.archivedAt, skus: product.skus },
        });
        return {
          id: m.id,
          url: this.resolveMediaUrl(m.url),
          altText: m.altText,
          isPrimary: m.isPrimary,
          /** Whether the storefront serves this image; when false, `hiddenReason` says why. The gate is never weakened for the Admin. */
          publiclyServed: visibility.live,
          hiddenReason: visibility.reason as PublicMediaHiddenReason | null,
        };
      });
      const skus = product.skus.map((sku) => {
        const assetState = skuMediaMap.get(sku.id);
        const primaryMediaState: SkuPrimaryMediaState =
          assetState ?? (resolvedMedia.length > 0 ? 'PUBLISHED' : 'MISSING');
        return {
          ...sku,
          size: sku.size !== null && sku.size !== undefined ? Number(sku.size) : null,
          primaryMediaState,
        };
      });

      let mediaStatus: ProductMediaStatus = 'MISSING';
      if (resolvedMedia.length > 0 || skus.some((s) => s.primaryMediaState === 'PUBLISHED')) {
        mediaStatus = 'PUBLISHED';
      } else if (skus.some((s) => s.primaryMediaState === 'APPROVED')) {
        mediaStatus = 'APPROVED_UNPUBLISHED';
      } else if (skus.some((s) => s.primaryMediaState === 'PENDING_REVIEW')) {
        mediaStatus = 'PENDING_REVIEW';
      }

      const { media: _rawMedia, ...rest } = product;
      return {
        ...rest,
        media: resolvedMedia,
        mediaStatus,
        skus,
      };
    });
  }

  async archive(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({ where: { id }, select: { id: true, archivedAt: true, isPublished: true } });
      if (!product) throw new NotFoundException('Product not found');
      if (product.archivedAt) return product;
      const archived = await tx.product.update({ where: { id }, data: { archivedAt: new Date(), isPublished: false }, select: { id: true, archivedAt: true, isPublished: true } });
      await tx.sku.updateMany({ where: { productId: id }, data: { isActive: false } });
      return archived;
    });
  }

  async restore(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id }, select: { id: true, archivedAt: true, isPublished: true } });
    if (!product) throw new NotFoundException('Product not found');
    if (!product.archivedAt) return product;
    return this.prisma.product.update({ where: { id }, data: { archivedAt: null }, select: { id: true, archivedAt: true, isPublished: true } });
  }

  async setSkuActive(skuId: string, isActive: boolean) {
    const updated = await this.prisma.sku.updateMany({ where: { id: skuId, product: { archivedAt: null } }, data: { isActive } });
    if (!updated.count) {
      await this.ensureSkuEditable(skuId);
      throw new ConflictException('SKU state could not be changed');
    }
    return this.prisma.sku.findUniqueOrThrow({ where: { id: skuId }, select: { id: true, isActive: true } });
  }
}

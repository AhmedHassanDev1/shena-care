import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { CatalogService } from './catalog.service';
import { ProductIdentityService } from './product-identity.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** How a file or editor names one exact variant: its id, its code, or a manufacturer barcode (primary or reviewed alias). */
export interface SkuReference { skuId?: string; skuCode?: string; barcode?: string }

export type SkuReferenceResult =
  | { status: 'resolved'; skuId: string; productId: string; via: 'sku_id' | 'sku_code' | 'barcode' }
  | { status: 'missing' }
  | { status: 'ambiguous'; skuIds: string[] }
  | { status: 'invalid' };

/** Catalog facts a routine needs about one SKU; nothing here mutates the catalog. */
export interface SkuRoutineFacts {
  skuId: string;
  productId: string;
  productName: string;
  brandName: string | null;
  skuCode: string;
  variantName: string;
  size: number | null;
  sizeUnit: string | null;
  barcode: string | null;
  isActive: boolean;
  /** Published with reviewed media — the same gate the storefront uses. */
  isPublished: boolean;
}

/**
 * Resolves product/variant references for routines (templates, personal routines, JSON import, AI proposals) to canonical
 * SKUs. Exactly one SKU or nothing: an unknown code is `missing`, a code naming two SKUs is `ambiguous`, never "first match".
 */
@Injectable()
export class SkuReferenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly identity: ProductIdentityService,
  ) {}

  async resolve(reference: SkuReference): Promise<SkuReferenceResult> {
    const given = [reference.skuId, reference.skuCode, reference.barcode].filter(value => value !== undefined && value !== '');
    if (given.length !== 1) return { status: 'invalid' };
    if (reference.skuId !== undefined) {
      if (!UUID.test(reference.skuId)) return { status: 'invalid' };
      const sku = await this.prisma.sku.findUnique({ where: { id: reference.skuId }, select: { id: true, productId: true } });
      return sku ? { status: 'resolved', skuId: sku.id, productId: sku.productId, via: 'sku_id' } : { status: 'missing' };
    }
    if (reference.skuCode !== undefined) {
      const sku = await this.prisma.sku.findUnique({ where: { code: reference.skuCode.trim() }, select: { id: true, productId: true } });
      return sku ? { status: 'resolved', skuId: sku.id, productId: sku.productId, via: 'sku_code' } : { status: 'missing' };
    }
    const resolved = await this.identity.resolveBarcode(reference.barcode!);
    if (resolved.status === 'ambiguous') return { status: 'ambiguous', skuIds: resolved.skuIds };
    if (resolved.status === 'unknown') return { status: 'missing' };
    const sku = await this.prisma.sku.findUnique({ where: { id: resolved.skuId }, select: { id: true, productId: true } });
    return sku ? { status: 'resolved', skuId: sku.id, productId: sku.productId, via: 'barcode' } : { status: 'missing' };
  }

  async facts(skuIds: string[]): Promise<Map<string, SkuRoutineFacts>> {
    const ids = [...new Set(skuIds.filter(id => UUID.test(id)))];
    if (!ids.length) return new Map();
    const [rows, validation] = await Promise.all([
      this.prisma.sku.findMany({ where: { id: { in: ids } }, select: {
        id: true, productId: true, code: true, variantName: true, size: true, sizeUnit: true, barcode: true, isActive: true,
        product: { select: { name: true, brand: { select: { name: true } } } },
      } }),
      this.catalog.getSkuValidationStatuses(ids),
    ]);
    return new Map(rows.map(sku => [sku.id, {
      skuId: sku.id, productId: sku.productId, productName: sku.product.name, brandName: sku.product.brand?.name ?? null,
      skuCode: sku.code, variantName: sku.variantName, size: sku.size ? sku.size.toNumber() : null, sizeUnit: sku.sizeUnit,
      barcode: sku.barcode, isActive: sku.isActive, isPublished: validation.get(sku.id)?.isProductPublished ?? false,
    }]));
  }
}

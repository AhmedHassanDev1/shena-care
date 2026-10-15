import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';

/** How a scanned manufacturer code resolves to the canonical SKU (GLO-242). */
export type BarcodeResolution =
  | { status: 'resolved'; skuId: string; via: 'primary_barcode' | 'barcode_alias' }
  | { status: 'unknown' }
  | { status: 'ambiguous'; skuIds: string[] };

export const BARCODE_ALIAS_SOURCES = ['packaging_revision', 'legacy_stock', 'manufacturer_list', 'other'] as const;

/**
 * Canonical product identity for physical scans (GLO-242). A code resolves through the SKU's
 * primary barcode or a reviewed, approved alias; an unknown or retired code needs review and a code
 * that points at two SKUs is ambiguous — never "first match". Aliases only say "same canonical SKU
 * in different packaging"; a changed size, variant, pack or formula is a different SKU, decided in
 * catalog review, not here. Nothing here validates physical quality (seal, damage, expiry).
 */
@Injectable()
export class ProductIdentityService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveBarcode(code: string): Promise<BarcodeResolution> {
    const barcode = code.trim();
    if (!barcode) return { status: 'unknown' };
    const [primary, aliases] = await Promise.all([
      this.prisma.sku.findMany({ where: { barcode }, select: { id: true } }),
      this.prisma.skuBarcodeAlias.findMany({ where: { barcode, status: 'approved' }, select: { skuId: true } }),
    ]);
    const skuIds = [...new Set([...primary.map(s => s.id), ...aliases.map(a => a.skuId)])];
    if (skuIds.length > 1) return { status: 'ambiguous', skuIds };
    if (!skuIds.length) return { status: 'unknown' };
    return { status: 'resolved', skuId: skuIds[0], via: primary.length ? 'primary_barcode' : 'barcode_alias' };
  }

  /** Reviewer-only: approve an extra code for one SKU, refusing anything that would be ambiguous. */
  async approveAlias(input: { barcode: string; skuId: string; source: string; evidenceRef?: string; reason: string; actorId: string }) {
    const barcode = input.barcode.trim();
    const sku = await this.prisma.sku.findUnique({ where: { id: input.skuId } });
    if (!sku) throw new NotFoundException('SKU not found');
    if (sku.barcode === barcode) throw new BadRequestException('This is already the SKU\'s primary barcode');
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(44100::int4, hashtext(${barcode})::int4)::text AS locked`;
      const other = await tx.sku.findFirst({ where: { barcode, id: { not: input.skuId } }, select: { id: true } });
      const otherAlias = await tx.skuBarcodeAlias.findFirst({ where: { barcode, status: 'approved', skuId: { not: input.skuId } } });
      if (other || otherAlias) {
        throw new ConflictException({ code: 'BARCODE_AMBIGUOUS', message: 'This code already identifies another SKU; resolve it in catalog review first' });
      }
      const existing = await tx.skuBarcodeAlias.findUnique({ where: { barcode_skuId: { barcode, skuId: input.skuId } } });
      if (existing?.status === 'approved') return existing;
      const data = { source: input.source, evidenceRef: input.evidenceRef, reason: input.reason, approvedBy: input.actorId, approvedAt: new Date(),
        status: 'approved' as const, retiredBy: null, retiredAt: null };
      return existing
        ? tx.skuBarcodeAlias.update({ where: { id: existing.id }, data })
        : tx.skuBarcodeAlias.create({ data: { barcode, skuId: input.skuId, ...data } });
    });
  }

  async retireAlias(id: string, actorId: string) {
    const alias = await this.prisma.skuBarcodeAlias.findUnique({ where: { id } });
    if (!alias) throw new NotFoundException('Barcode alias not found');
    if (alias.status === 'retired') return alias;
    return this.prisma.skuBarcodeAlias.update({ where: { id }, data: { status: 'retired', retiredBy: actorId, retiredAt: new Date() } });
  }

  listAliases(skuId: string) {
    return this.prisma.skuBarcodeAlias.findMany({ where: { skuId }, orderBy: { approvedAt: 'desc' } });
  }
}

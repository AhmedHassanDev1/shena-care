import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { CatalogService, SkuLabel } from '../../catalog/public';
import { CommerceService } from '../../commerce/public';
import {
  PurchaseAvailability, customerAvailabilityWindowMs, provisionalOrderingEnabled, resolvePurchaseAvailability,
} from './availability-policy';
import { CreateSupplierDto, UpdateSupplierDto } from '../dto/supplier.dto';
import { CreateSupplierOfferDto, UpdateSupplierOfferDto } from '../dto/supplier-offer.dto';

export interface SupplierDetail {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  closedWeekdays: number[];
  opensAt: string | null;
  closesAt: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SupplierOfferDetail {
  id: string;
  supplierId: string;
  skuId: string;
  costPrice: number;
  currency: string;
  isAvailable: boolean;
  lastObservedAt: Date;
  lastConfirmedAt: Date | null;
  availableQuantity: number | null;
  quantityUpdatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  sku?: SkuLabel;
}

@Injectable()
export class SourcingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogService: CatalogService,
    private readonly commerceService: CommerceService,
  ) {}

  private isUuid(val: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
  }

  // ---------------------------------------------------------------------------
  // Supplier Management
  // ---------------------------------------------------------------------------

  async createSupplier(dto: CreateSupplierDto): Promise<SupplierDetail> {
    const existing = await this.prisma.supplier.findFirst({
      where: {
        OR: [{ name: dto.name }, { slug: dto.slug }],
      },
    });

    if (existing) {
      throw new ConflictException(`Supplier with name or slug already exists.`);
    }

    const supplier = await this.prisma.supplier.create({
      data: {
        name: dto.name,
        slug: dto.slug,
        isActive: dto.isActive ?? true,
        ...(dto.closedWeekdays !== undefined && { closedWeekdays: dto.closedWeekdays }),
        ...(dto.opensAt !== undefined && { opensAt: dto.opensAt }),
        ...(dto.closesAt !== undefined && { closesAt: dto.closesAt }),
      },
    });

    return supplier;
  }

  async getSupplier(id: string): Promise<SupplierDetail | null> {
    if (!this.isUuid(id)) return null;
    return this.prisma.supplier.findUnique({ where: { id } });
  }

  async getSuppliers(): Promise<SupplierDetail[]> {
    return this.prisma.supplier.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateSupplier(id: string, dto: UpdateSupplierDto): Promise<SupplierDetail> {
    if (!this.isUuid(id)) throw new BadRequestException('Invalid supplier ID');

    const supplier = await this.getSupplier(id);
    if (!supplier) throw new NotFoundException(`Supplier ${id} not found`);

    if (dto.name || dto.slug) {
      const existing = await this.prisma.supplier.findFirst({
        where: {
          OR: [
            ...(dto.name ? [{ name: dto.name }] : []),
            ...(dto.slug ? [{ slug: dto.slug }] : []),
          ],
          NOT: { id },
        },
      });
      if (existing) {
        throw new ConflictException(`Supplier name or slug already in use.`);
      }
    }

    const opensAt = dto.opensAt ?? supplier.opensAt;
    const closesAt = dto.closesAt ?? supplier.closesAt;
    if ((opensAt === null) !== (closesAt === null) || (opensAt !== null && closesAt !== null && opensAt >= closesAt)) {
      throw new BadRequestException('Working hours need both opensAt and closesAt, with opensAt earlier than closesAt');
    }

    return this.prisma.supplier.update({
      where: { id },
      data: {
        ...(dto.closedWeekdays !== undefined && { closedWeekdays: dto.closedWeekdays }),
        ...(dto.opensAt !== undefined && { opensAt: dto.opensAt }),
        ...(dto.closesAt !== undefined && { closesAt: dto.closesAt }),
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.slug !== undefined && { slug: dto.slug }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }

  /**
   * For each SKU (same order as `skuIds`), the closed weekdays of every active supplier that currently offers it —
   * what the promised delivery date is computed from.
   */
  async getClosedWeekdaysBySku(skuIds: string[]): Promise<number[][][]> {
    const offers = skuIds.length ? await this.prisma.supplierOffer.findMany({
      where: { skuId: { in: skuIds }, isAvailable: true, supplier: { isActive: true } },
      select: { skuId: true, supplier: { select: { closedWeekdays: true } } },
    }) : [];
    return skuIds.map(id => offers.filter(o => o.skuId === id).map(o => o.supplier.closedWeekdays));
  }

  // ---------------------------------------------------------------------------
  // Supplier Offer Management
  // ---------------------------------------------------------------------------

  async createSupplierOffer(dto: CreateSupplierOfferDto): Promise<SupplierOfferDetail> {
    if (!this.isUuid(dto.supplierId)) throw new BadRequestException('Invalid supplier ID');
    if (!this.isUuid(dto.skuId)) throw new BadRequestException('Invalid SKU ID');

    // Validate Supplier
    const supplier = await this.getSupplier(dto.supplierId);
    if (!supplier) throw new NotFoundException(`Supplier ${dto.supplierId} not found`);

    // Validate SKU in Catalog
    const skuIdentity = await this.catalogService.getSkuIdentity(dto.skuId);
    if (!skuIdentity?.isActive) throw new NotFoundException(`SKU ${dto.skuId} not found in catalog`);

    // Validate Uniqueness
    const existing = await this.prisma.supplierOffer.findUnique({
      where: {
        supplierId_skuId: {
          supplierId: dto.supplierId,
          skuId: dto.skuId,
        },
      },
    });

    if (existing) {
      throw new ConflictException(`An offer from this supplier already exists for this SKU.`);
    }

    const offer = await this.prisma.supplierOffer.create({
      data: {
        supplierId: dto.supplierId,
        skuId: dto.skuId,
        costPrice: dto.costPrice,
        currency: dto.currency,
        isAvailable: dto.availableQuantity === 0 ? false : dto.isAvailable ?? true,
        ...(dto.availableQuantity !== undefined && { availableQuantity: dto.availableQuantity, quantityUpdatedAt: new Date() }),
      },
    });

    const labels = await this.catalogService.getSkuLabels([offer.skuId]);

    return {
      ...offer,
      costPrice: offer.costPrice.toNumber(),
      sku: labels.get(offer.skuId),
    };
  }

  async getSupplierOffers(filters?: {
    supplierId?: string;
    skuId?: string;
  }): Promise<SupplierOfferDetail[]> {
    const where: Record<string, string> = {};
    if (filters?.supplierId) {
      if (!this.isUuid(filters.supplierId)) return [];
      where.supplierId = filters.supplierId;
    }
    if (filters?.skuId) {
      if (!this.isUuid(filters.skuId)) return [];
      where.skuId = filters.skuId;
    }

    const offers = await this.prisma.supplierOffer.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    const labels = await this.catalogService.getSkuLabels(offers.map((o) => o.skuId));

    return offers.map((o) => ({
      ...o,
      costPrice: o.costPrice.toNumber(),
      sku: labels.get(o.skuId),
    }));
  }

  async getSupplierOffer(id: string): Promise<SupplierOfferDetail | null> {
    if (!this.isUuid(id)) return null;
    const offer = await this.prisma.supplierOffer.findUnique({ where: { id } });
    if (!offer) return null;
    const labels = await this.catalogService.getSkuLabels([offer.skuId]);
    return {
      ...offer,
      costPrice: offer.costPrice.toNumber(),
      sku: labels.get(offer.skuId),
    };
  }

  /**
   * GLO-280: a supplier's own direct edit gets the same anomaly policy as a file commit (currency change, >30% jump,
   * cost above the approved selling price). There is no review queue for direct edits, so those changes are refused and
   * go through a reviewed price file instead; availability-only edits and normal cost changes apply directly.
   */
  async updateSupplierOffer(id: string, dto: UpdateSupplierOfferDto, options: { supplierScoped?: boolean } = {}): Promise<SupplierOfferDetail> {
    if (!this.isUuid(id)) throw new BadRequestException('Invalid offer ID');

    const offer = await this.getSupplierOffer(id);
    if (!offer) throw new NotFoundException(`Supplier offer ${id} not found`);
    if (dto.costPrice !== undefined && dto.costPrice <= 0) throw new BadRequestException('Cost price must be positive');
    if (options.supplierScoped) {
      const reasons = await this.directEditReviewReasons(offer, dto);
      if (reasons.length) {
        throw new ConflictException(`Offer change requires review — submit it in a price file: ${reasons.join('; ')}`);
      }
    }

    const updated = await this.prisma.supplierOffer.update({
      where: { id },
      data: {
        ...(dto.costPrice !== undefined && { costPrice: dto.costPrice }),
        ...(dto.currency !== undefined && { currency: dto.currency }),
        // A reported quantity restarts the count (allocations before it are already in the supplier's number);
        // zero means out of stock, a positive count brings an out-of-stock offer back unless told otherwise.
        ...(dto.availableQuantity !== undefined && { availableQuantity: dto.availableQuantity, quantityUpdatedAt: new Date() }),
        ...((dto.isAvailable !== undefined || dto.availableQuantity !== undefined) && {
          isAvailable: dto.availableQuantity === 0 ? false : dto.isAvailable ?? true,
        }),
        lastObservedAt: new Date(), // Always update lastObservedAt on any change
        lastIngestionItemId: null,
      },
    });

    const labels = await this.catalogService.getSkuLabels([updated.skuId]);

    return {
      ...updated,
      costPrice: updated.costPrice.toNumber(),
      sku: labels.get(updated.skuId),
    };
  }

  private async directEditReviewReasons(offer: SupplierOfferDetail, dto: UpdateSupplierOfferDto): Promise<string[]> {
    const reasons: string[] = [];
    const currency = dto.currency ?? offer.currency;
    if (currency !== offer.currency) reasons.push('currency_change_requires_review');
    if (dto.costPrice === undefined || dto.costPrice === offer.costPrice) return reasons;
    const change = offer.costPrice > 0 ? (dto.costPrice - offer.costPrice) / offer.costPrice : 0;
    if (Math.abs(change) > 0.3) reasons.push(`large_price_jump: ${(change * 100).toFixed(1)}% exceeds 30% anomaly threshold`);
    const price = await this.commerceService.getCurrentSellingPrice(offer.skuId);
    if (price?.currency === currency && dto.costPrice > price.amount) {
      reasons.push(`financial_hold: purchase cost ${dto.costPrice} exceeds approved selling price ${price.amount}`);
    }
    return reasons;
  }

  /**
   * Confirms availability without necessarily changing the price.
   */
  async confirmSupplierOfferAvailability(id: string, isAvailable: boolean): Promise<SupplierOfferDetail> {
    if (!this.isUuid(id)) throw new BadRequestException('Invalid offer ID');

    const offer = await this.prisma.supplierOffer.findUnique({ where: { id } });
    if (!offer) throw new NotFoundException(`Supplier offer ${id} not found`);

    const updated = await this.prisma.supplierOffer.update({
      where: { id },
      data: {
        isAvailable,
        lastObservedAt: new Date(),
        lastIngestionItemId: null,
        lastConfirmedAt: isAvailable ? new Date() : offer.lastConfirmedAt,
      },
    });

    return {
      ...updated,
      costPrice: updated.costPrice.toNumber(),
    };
  }

  // ---------------------------------------------------------------------------
  // Availability Resolution (GLO-106)
  // ---------------------------------------------------------------------------

  /**
   * THE customer-facing availability answer (see availability-policy.ts). A supplier feed row is a signal, never a
   * confirmation (it does not set `lastConfirmedAt`), and the quantity a supplier commits is confirmed per purchase
   * order. Whether a signal alone is orderable is one owner-controlled switch, not per-surface logic.
   */
  async getPurchaseAvailability(skuId: string, at = new Date()): Promise<PurchaseAvailability> {
    const offers = this.isUuid(skuId) ? await this.prisma.supplierOffer.findMany({
      where: { skuId, isAvailable: true, supplier: { isActive: true } },
      select: { lastConfirmedAt: true, lastObservedAt: true },
    }) : [];
    return resolvePurchaseAvailability(offers, at, customerAvailabilityWindowMs(), provisionalOrderingEnabled());
  }

  /** Cart / checkout / substitute gate: same answer as the product page. */
  async checkAvailability(skuId: string): Promise<boolean> {
    return (await this.getPurchaseAvailability(skuId)).orderable;
  }

  /** Public projection deliberately excludes supplier identity and procurement cost. */
  async getPublicAvailability(skuId: string, at = new Date()) {
    const availability = await this.getPurchaseAvailability(skuId, at);
    return {
      isAvailable: availability.orderable,
      isFresh: availability.state === 'CONFIRMED',
      state: availability.state,
      confirmedAt: availability.confirmedAt,
      observedAt: availability.observedAt,
      validUntil: availability.validUntil,
    };
  }
}

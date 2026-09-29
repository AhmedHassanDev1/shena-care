import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { CatalogService } from '../../catalog/public';
import { CreateSupplierDto, UpdateSupplierDto } from '../dto/supplier.dto';
import { CreateSupplierOfferDto, UpdateSupplierOfferDto } from '../dto/supplier-offer.dto';

export interface SupplierDetail {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
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
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class SourcingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogService: CatalogService,
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

    return this.prisma.supplier.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.slug !== undefined && { slug: dto.slug }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
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
    const isSkuValid = await this.catalogService.validateSku(dto.skuId);
    if (!isSkuValid) throw new NotFoundException(`SKU ${dto.skuId} not found in catalog`);

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
        isAvailable: dto.isAvailable ?? true,
      },
    });

    return {
      ...offer,
      costPrice: offer.costPrice.toNumber(),
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

    return offers.map((o) => ({
      ...o,
      costPrice: o.costPrice.toNumber(),
    }));
  }

  async getSupplierOffer(id: string): Promise<SupplierOfferDetail | null> {
    if (!this.isUuid(id)) return null;
    const offer = await this.prisma.supplierOffer.findUnique({ where: { id } });
    if (!offer) return null;
    return { ...offer, costPrice: offer.costPrice.toNumber() };
  }

  async updateSupplierOffer(id: string, dto: UpdateSupplierOfferDto): Promise<SupplierOfferDetail> {
    if (!this.isUuid(id)) throw new BadRequestException('Invalid offer ID');

    const offer = await this.getSupplierOffer(id);
    if (!offer) throw new NotFoundException(`Supplier offer ${id} not found`);

    const updated = await this.prisma.supplierOffer.update({
      where: { id },
      data: {
        ...(dto.costPrice !== undefined && { costPrice: dto.costPrice }),
        ...(dto.currency !== undefined && { currency: dto.currency }),
        ...(dto.isAvailable !== undefined && { isAvailable: dto.isAvailable }),
        lastObservedAt: new Date(), // Always update lastObservedAt on any change
      },
    });

    return {
      ...updated,
      costPrice: updated.costPrice.toNumber(),
    };
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
   * Resolves whether a SKU is currently available based on active supplier offers.
   * Returns true if there is at least one available offer from an active supplier.
   */
  async checkAvailability(skuId: string): Promise<boolean> {
    if (!this.isUuid(skuId)) return false;

    const offer = await this.prisma.supplierOffer.findFirst({
      where: {
        skuId,
        isAvailable: true,
        supplier: {
          isActive: true,
        },
      },
    });

    return !!offer;
  }
}

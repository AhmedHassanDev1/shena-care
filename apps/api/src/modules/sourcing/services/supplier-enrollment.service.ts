import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CatalogService } from '../../catalog/public';
import { PrismaService } from '../../../platform/database/prisma.service';
import { RegisterSupplierEnrollmentDto, UpdateSupplierEnrollmentDto } from '../dto/supplier-enrollment.dto';
import { RfqService } from './rfq.service';
import { SourcingService } from './sourcing.service';

const OPEN_COMMITMENT_STATUSES = ['confirmed', 'partial', 'ready'] as const;
const ALL_WEEKDAYS = 7;

export type EnrollmentBlocker = 'INACTIVE' | 'NOT_ENROLLED' | 'NO_SUPPLIER_ACCOUNT' | 'NO_WORKING_DAYS';

/**
 * Admin control of who takes part in BROADCAST_ON_DEMAND. A change applies to future RFQ distribution: open recipients of a withdrawn supplier
 * are timed out through the normal recovery path, and purchase orders already awarded to it stay binding and untouched.
 */
@Injectable()
export class SupplierEnrollmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sourcing: SourcingService,
    private readonly rfq: RfqService,
    private readonly catalog: CatalogService,
  ) {}

  private async resolveScope(codes: string[] | undefined): Promise<string[] | undefined> {
    if (codes === undefined) return undefined;
    const wanted = [...new Set(codes.map(code => code.trim()).filter(Boolean))];
    if (!wanted.length) return [];
    const skus = await this.prisma.sku.findMany({ where: { OR: [{ code: { in: wanted } }, { barcode: { in: wanted } }] }, select: { id: true, code: true, barcode: true } });
    const found = new Set(skus.flatMap(sku => [sku.code, sku.barcode]));
    const unknown = wanted.filter(code => !found.has(code));
    if (unknown.length) throw new BadRequestException(`Unknown SKU code or barcode: ${unknown.join(', ')}`);
    return [...new Set(skus.map(sku => sku.id))];
  }

  async list() {
    const suppliers = await this.prisma.supplier.findMany({ orderBy: { name: 'asc' } });
    const ids = suppliers.map(s => s.id);
    const [accounts, recipients, commitments] = await Promise.all([
      this.prisma.customer.groupBy({ by: ['supplierId'], where: { supplierId: { in: ids }, isActive: true }, _count: { _all: true } }),
      this.prisma.rfqRecipient.groupBy({ by: ['supplierId'], where: { supplierId: { in: ids }, status: 'pending', rfq: { status: 'open' } }, _count: { _all: true } }),
      this.prisma.supplierPurchaseOrder.groupBy({ by: ['supplierId'], where: { supplierId: { in: ids }, status: { in: [...OPEN_COMMITMENT_STATUSES] } }, _count: { _all: true } }),
    ]);
    const count = (rows: Array<{ supplierId: string | null; _count: { _all: number } }>, id: string) => rows.find(row => row.supplierId === id)?._count._all ?? 0;
    const labels = await this.catalog.getSkuLabels(suppliers.flatMap(s => s.rfqScopeSkuIds));
    return suppliers.map(supplier => {
      const accountCount = count(accounts, supplier.id);
      const blockers: EnrollmentBlocker[] = [];
      if (!supplier.isActive) blockers.push('INACTIVE');
      if (!supplier.rfqEnrolledAt) blockers.push('NOT_ENROLLED');
      if (accountCount === 0) blockers.push('NO_SUPPLIER_ACCOUNT');
      if (supplier.closedWeekdays.length >= ALL_WEEKDAYS) blockers.push('NO_WORKING_DAYS');
      return {
        id: supplier.id, name: supplier.name, slug: supplier.slug, isActive: supplier.isActive, rfqEnrolledAt: supplier.rfqEnrolledAt,
        closedWeekdays: supplier.closedWeekdays, closedDates: supplier.closedDates, opensAt: supplier.opensAt, closesAt: supplier.closesAt, pickupLeadMinutes: supplier.pickupLeadMinutes,
        scope: supplier.rfqScopeSkuIds.map(id => ({ skuId: id, label: labels.get(id) ?? null })),
        accountCount, openRequestCount: count(recipients, supplier.id), openCommitmentCount: count(commitments, supplier.id),
        readiness: { ready: blockers.length === 0, blockers }, updatedAt: supplier.updatedAt,
      };
    });
  }

  async register(dto: RegisterSupplierEnrollmentDto, actorId: string) {
    const supplier = await this.sourcing.createSupplier({
      name: dto.name, slug: dto.slug, isActive: true, rfqEnrolled: dto.enroll ?? false, rfqScopeSkuIds: await this.resolveScope(dto.scopeSkuCodes),
      closedWeekdays: dto.closedWeekdays, closedDates: dto.closedDates, opensAt: dto.opensAt, closesAt: dto.closesAt, crossesMidnight: dto.crossesMidnight, pickupLeadMinutes: dto.pickupLeadMinutes,
    }, { actorId, reason: dto.reason });
    return supplier;
  }

  async update(id: string, dto: UpdateSupplierEnrollmentDto, actorId: string) {
    const rfqScopeSkuIds = await this.resolveScope(dto.scopeSkuCodes);
    const { scopeSkuCodes: _codes, reason, ...rest } = dto;
    const supplier = await this.sourcing.updateSupplier(id, { ...rest, ...(rfqScopeSkuIds !== undefined && { rfqScopeSkuIds }) }, { actorId, reason });
    // Withdrawal takes effect now: its pending requests time out and recovery offers the demand to whoever is left.
    if (dto.rfqEnrolled === false || dto.isActive === false || rfqScopeSkuIds !== undefined) {
      const open = await this.prisma.rfqRecipient.findMany({ where: { supplierId: id, status: 'pending', rfq: { status: 'open' } }, select: { rfqId: true } });
      for (const { rfqId } of open) await this.rfq.evaluateRfq(rfqId);
    }
    return supplier;
  }

  async audit(id: string) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id }, select: { id: true } });
    if (!supplier) throw new NotFoundException('Supplier not found');
    return this.prisma.supplierEnrollmentEvent.findMany({ where: { supplierId: id }, orderBy: { createdAt: 'desc' }, take: 100 });
  }
}

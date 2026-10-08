import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SourceConfirmationResult, SupplyPlanStatus } from '@prisma/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import { RankingService } from './ranking.service';
import { OutboxService } from '../../operations/services/outbox.service';

type Tx = Prisma.TransactionClient;
type Confirmation = Exclude<SourceConfirmationResult, 'pending'>;

export interface CustomerAvailabilityProjection {
  status: 'CONFIRMING_PRODUCTS' | 'CONFIRMED' | 'ACTION_REQUIRED';
  lines: Array<{ orderItemId: string; coveredQuantity: number; unresolvedQuantity: number; status: 'checking' | 'confirmed' | 'action-required' }>;
  actionRequired: { category: 'availability'; affectedItemIds: string[]; allowedActions: string[];
    issues: Array<{ orderItemId: string; category: 'unavailable'; unresolvedQuantity: number; occurredAt: Date }> } | null;
  timeline: Array<{ status: 'CONFIRMING_PRODUCTS' | 'CONFIRMED' | 'ACTION_REQUIRED'; occurredAt: Date }>;
}

export interface ReceivableSupplyAllocation {
  allocationId: string;
  supplyRequestId: string;
  orderId: string;
  orderItemId: string;
  skuId: string;
  confirmedQuantity: number;
}

@Injectable()
export class SupplyPlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ranking: RankingService,
    private readonly outbox: OutboxService,
  ) {}

  private async lock(tx: Tx, orderId: string) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(44071, hashtext(${orderId}))::text AS locked`;
  }

  async initiateForOrder(orderId: string) {
    await this.prisma.$transaction(async tx => {
      await this.lock(tx, orderId);
      const existing = await tx.supplyRequest.findUnique({ where: { orderId } });
      if (existing) return;
      const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: { where: { lineState: 'active' } } } });
      if (!order) throw new NotFoundException('Order not found');
      if (!order.items.length) throw new BadRequestException('Order has no items');
      const request = await tx.supplyRequest.create({
        data: { orderId, requirements: { create: order.items.map(item => ({
          orderItemId: item.id, skuId: item.skuId, requiredQuantity: item.quantity,
          orderSnapshotRef: item.id,
        })) } },
      });
      await tx.supplyPlanEvent.create({ data: { supplyRequestId: request.id, status: 'CONFIRMING' } });
    });
    return this.advance(orderId);
  }

  async advance(orderId: string) {
    return this.prisma.$transaction(async tx => {
      await this.lock(tx, orderId);
      const request = await tx.supplyRequest.findUnique({ where: { orderId }, include: {
        requirements: { where: { releasedAt: null }, include: { allocations: true, actionRequirement: true } },
      } });
      if (!request) throw new NotFoundException('Supply request not found');

      for (const requirement of request.requirements) {
        const confirmed = requirement.allocations.reduce((sum, a) => sum + a.confirmedQuantity, 0);
        const remaining = requirement.requiredQuantity - confirmed;
        if (remaining <= 0) continue;
        const pending = requirement.allocations.find(a => a.result === 'pending');
        if (pending) {
          const offer = await tx.supplierOffer.findUnique({ where: { id: pending.supplierOfferId }, include: { supplier: true } });
          const stale = !offer || Date.now() - offer.lastObservedAt.getTime() > 7 * 24 * 3600 * 1000;
          if (offer?.isAvailable && offer.supplier.isActive && !stale &&
              offer.costPrice.equals(pending.selectedCost) && offer.currency === pending.selectedCurrency) continue;
          await tx.sourceAllocation.update({ where: { id: pending.id }, data: {
            result: offer && (!offer.costPrice.equals(pending.selectedCost) || offer.currency !== pending.selectedCurrency)
              ? 'price_changed' : 'unavailable', confirmedAt: new Date(),
          } });
        }

        const attempted = requirement.allocations.map(a => a.supplierOfferId);
        let ranked;
        try {
          ranked = await this.ranking.rankOffersForSku(requirement.skuId, remaining);
        } catch (error) {
          if (!(error instanceof NotFoundException)) throw error;
        }
        let allocated = false;
        for (const candidate of ranked?.rankedOffers ?? []) {
          if (attempted.includes(candidate.id)) continue;
          // Ranking owns selection; verify the winning offer again under the order lock.
          const offer = await tx.supplierOffer.findUnique({ where: { id: candidate.id }, include: { supplier: true } });
          if (!offer?.isAvailable || !offer.supplier.isActive ||
              Date.now() - offer.lastObservedAt.getTime() > 7 * 24 * 3600 * 1000 ||
              !offer.costPrice.equals(candidate.costPrice) || offer.currency !== candidate.currency) continue;
          await tx.sourceAllocation.create({ data: {
            requirementId: requirement.id, supplierOfferId: offer.id, requestedQuantity: remaining,
            allocatedQuantity: remaining, selectedCost: offer.costPrice, selectedCurrency: offer.currency,
            rankingDecisionId: ranked!.decisionLogId,
          } });
          if (requirement.actionRequirement) await tx.availabilityActionRequirement.delete({ where: { requirementId: requirement.id } });
          allocated = true;
          break;
        }
        if (!allocated) await tx.availabilityActionRequirement.upsert({
          where: { requirementId: requirement.id },
          create: { requirementId: requirement.id, category: 'SOURCE_EXHAUSTED', unresolvedQuantity: remaining },
          update: { unresolvedQuantity: remaining },
        });
      }

      const refreshed = await tx.supplyRequest.findUniqueOrThrow({ where: { id: request.id }, include: {
        requirements: { where: { releasedAt: null }, include: { allocations: true, actionRequirement: true } },
      } });
      const allCovered = refreshed.requirements.every(r =>
        r.allocations.reduce((sum, a) => sum + a.confirmedQuantity, 0) === r.requiredQuantity);
      const anyPending = refreshed.requirements.some(r => r.allocations.some(a => a.result === 'pending'));
      const anyConfirmed = refreshed.requirements.some(r => r.allocations.some(a => a.confirmedQuantity > 0));
      const status: SupplyPlanStatus = allCovered ? 'COVERED' : anyPending ? 'CONFIRMING'
        : anyConfirmed ? 'PARTIALLY_UNAVAILABLE' : 'UNAVAILABLE';
      if (status !== refreshed.status) {
        await tx.supplyRequest.update({ where: { id: request.id }, data: { status } });
        await tx.supplyPlanEvent.create({ data: { supplyRequestId: request.id, status } });

        if (status === 'COVERED') {
          const order = await tx.order.findUnique({ where: { id: request.orderId } });
          if (order) {
            await this.outbox.enqueue(tx, {
              eventType: 'availability.confirmed',
              aggregateId: request.orderId,
              aggregateType: 'Order',
              customerId: order.customerId || undefined,
              payload: { orderId: order.id, orderNumber: order.orderNumber },
              channelIntent: 'whatsapp',
              templateId: 'availability_confirmed_v1',
              deduplicationKey: `availability.confirmed:${request.id}:${refreshed.requirements.map(r => r.id).join('-')}`,
            });
          }
        }
      }
      return this.present(refreshed, status);
    }, { timeout: 30000 });
  }

  async confirmAllocation(allocationId: string, input: {
    result: Confirmation; confirmedQuantity: number; evidenceRef?: string;
  }) {
    const initial = await this.prisma.sourceAllocation.findUnique({ where: { id: allocationId },
      include: { requirement: { include: { supplyRequest: true } } } });
    if (!initial) throw new NotFoundException('Allocation not found');
    const orderId = initial.requirement.supplyRequest.orderId;
    await this.prisma.$transaction(async tx => {
      await this.lock(tx, orderId);
      const allocation = await tx.sourceAllocation.findUniqueOrThrow({ where: { id: allocationId },
        include: { supplierOffer: { include: { supplier: true } } } });
      if (allocation.result !== 'pending') {
        if ((allocation.reportedResult ?? allocation.result) === input.result &&
            (allocation.reportedQuantity ?? allocation.confirmedQuantity) === input.confirmedQuantity &&
            (allocation.evidenceRef ?? null) === (input.evidenceRef ?? null)) return;
        throw new ConflictException('Allocation was already confirmed with a different result');
      }
      const quantity = input.confirmedQuantity;
      const valid = Number.isSafeInteger(quantity) && quantity >= 0 && quantity <= allocation.allocatedQuantity &&
        (input.result === 'confirmed_full' ? quantity === allocation.allocatedQuantity
          : input.result === 'confirmed_partial' ? quantity > 0 && quantity < allocation.allocatedQuantity
          : quantity === 0);
      if (!valid) throw new BadRequestException('Confirmation quantity does not match the result or allocation');
      const costChanged = !allocation.supplierOffer.costPrice.equals(allocation.selectedCost) ||
        allocation.supplierOffer.currency !== allocation.selectedCurrency;
      const offerUnavailable = !allocation.supplierOffer.isAvailable || !allocation.supplierOffer.supplier.isActive ||
        Date.now() - allocation.supplierOffer.lastObservedAt.getTime() > 7 * 24 * 3600 * 1000;
      if ((costChanged || offerUnavailable) &&
          (input.result === 'confirmed_full' || input.result === 'confirmed_partial')) {
        await tx.sourceAllocation.update({ where: { id: allocationId }, data: {
          result: costChanged ? 'price_changed' : 'unavailable',
          reportedResult: input.result, reportedQuantity: input.confirmedQuantity,
          confirmedQuantity: 0,
          confirmedAt: new Date(), evidenceRef: input.evidenceRef,
        } });
        return;
      }
      await tx.sourceAllocation.update({ where: { id: allocationId }, data: {
        result: input.result, reportedResult: input.result, reportedQuantity: quantity,
        confirmedQuantity: quantity, confirmedAt: new Date(), evidenceRef: input.evidenceRef,
      } });
    }, { timeout: 30000 });
    return this.advance(orderId);
  }

  async getPlan(orderId: string) {
    const request = await this.prisma.supplyRequest.findUnique({ where: { orderId }, include: {
      requirements: { where: { releasedAt: null }, include: { allocations: true, actionRequirement: true } },
    } });
    if (!request) throw new NotFoundException('Supply request not found');
    return this.present(request, request.status);
  }

  /** Read-only owner contract used by Fulfillment before accepting physical goods. */
  async getReceivableAllocation(allocationId: string): Promise<ReceivableSupplyAllocation> {
    const allocation = await this.prisma.sourceAllocation.findUnique({
      where: { id: allocationId },
      include: { requirement: { include: { supplyRequest: true } } },
    });
    if (!allocation) throw new NotFoundException('Supply allocation not found');
    if (allocation.requirement.releasedAt) {
      throw new ConflictException('Supply allocation belongs to a released order requirement');
    }
    if (!['confirmed_full', 'confirmed_partial'].includes(allocation.result) || allocation.confirmedQuantity <= 0) {
      throw new ConflictException('Supply allocation is not confirmed for receiving');
    }
    return {
      allocationId: allocation.id,
      supplyRequestId: allocation.requirement.supplyRequestId,
      orderId: allocation.requirement.supplyRequest.orderId,
      orderItemId: allocation.requirement.orderItemId,
      skuId: allocation.requirement.skuId,
      confirmedQuantity: allocation.confirmedQuantity,
    };
  }

  /**
   * Owner command used by Ordering after an explicit, applied customer decision. Runs inside the
   * caller's transaction (the per-order advisory lock is re-entrant within one session). The original
   * requirement/allocation evidence is kept: a released requirement is only excluded from planning.
   */
  async applyAmendment(tx: Tx, orderId: string, change: {
    releaseOrderItemIds: string[];
    add?: { orderItemId: string; skuId: string; requiredQuantity: number };
  }): Promise<void> {
    await this.lock(tx, orderId);
    const request = await tx.supplyRequest.findUnique({ where: { orderId } });
    if (!request) return; // sourcing has not started; nothing to release
    await tx.supplyRequirement.updateMany({
      where: { supplyRequestId: request.id, orderItemId: { in: change.releaseOrderItemIds }, releasedAt: null },
      data: { releasedAt: new Date() },
    });
    await tx.availabilityActionRequirement.deleteMany({
      where: { requirement: { supplyRequestId: request.id, orderItemId: { in: change.releaseOrderItemIds } } },
    });
    if (change.add) {
      await tx.supplyRequirement.create({ data: {
        supplyRequestId: request.id, orderItemId: change.add.orderItemId, skuId: change.add.skuId,
        requiredQuantity: change.add.requiredQuantity, orderSnapshotRef: change.add.orderItemId,
      } });
    }
  }

  /** Re-plan after an amendment commit (new requirement gets its own ranked allocation). */
  async replanAfterAmendment(orderId: string): Promise<void> {
    const request = await this.prisma.supplyRequest.findUnique({ where: { orderId },
      include: { requirements: { where: { releasedAt: null }, select: { id: true } } } });
    if (!request || !request.requirements.length) return;
    await this.advance(orderId);
  }

  /** Availability contract for candidate proposals: a ranked eligible source exists for this SKU/quantity. */
  async canSupply(skuId: string, quantity: number): Promise<boolean> {
    try {
      const ranked = await this.ranking.rankOffersForSku(skuId, quantity);
      return ranked.rankedOffers.length > 0;
    } catch (error) {
      if (error instanceof NotFoundException) return false;
      throw error;
    }
  }

  async getCustomerAvailability(orderId: string): Promise<CustomerAvailabilityProjection | null> {
    const request = await this.prisma.supplyRequest.findUnique({ where: { orderId }, include: {
      requirements: { where: { releasedAt: null }, include: { allocations: true, actionRequirement: true } },
      events: { orderBy: { createdAt: 'asc' } },
    } });
    if (!request) return null;
    const lines = request.requirements.map(r => {
      const coveredQuantity = r.allocations.reduce((sum, a) => sum + a.confirmedQuantity, 0);
      return { orderItemId: r.orderItemId, coveredQuantity,
        unresolvedQuantity: r.requiredQuantity - coveredQuantity,
        status: (r.actionRequirement ? 'action-required' : coveredQuantity === r.requiredQuantity ? 'confirmed' : 'checking') as
          'action-required' | 'confirmed' | 'checking' };
    });
    const affectedItemIds = lines.filter(l => l.status === 'action-required').map(l => l.orderItemId);
    return {
      status: affectedItemIds.length ? 'ACTION_REQUIRED'
        : request.status === 'COVERED' ? 'CONFIRMED' : 'CONFIRMING_PRODUCTS',
      lines,
      actionRequired: affectedItemIds.length ? { category: 'availability', affectedItemIds, allowedActions: [],
        issues: request.requirements.filter(r => r.actionRequirement).map(r => ({
          orderItemId: r.orderItemId, category: 'unavailable' as const,
          unresolvedQuantity: r.actionRequirement!.unresolvedQuantity,
          occurredAt: r.actionRequirement!.createdAt,
        })),
      } : null,
      timeline: request.events.map(event => ({
        status: (event.status === 'CONFIRMING' ? 'CONFIRMING_PRODUCTS'
          : event.status === 'COVERED' ? 'CONFIRMED' : 'ACTION_REQUIRED') as
            'CONFIRMING_PRODUCTS' | 'CONFIRMED' | 'ACTION_REQUIRED',
        occurredAt: event.createdAt,
      })),
    };
  }

  private present(request: { id: string; orderId: string; requirements: Array<{
    orderItemId: string; skuId: string; requiredQuantity: number; allocations: Array<{
      id: string; supplierOfferId: string; allocatedQuantity: number; confirmedQuantity: number;
      result: SourceConfirmationResult; selectedCost: Prisma.Decimal; selectedCurrency: string;
      reportedResult: SourceConfirmationResult | null;
      reportedQuantity: number | null;
      selectedAt: Date; confirmedAt: Date | null; evidenceRef: string | null; rankingDecisionId: string;
    }>; actionRequirement: { category: string; unresolvedQuantity: number; createdAt: Date } | null;
  }> }, status: SupplyPlanStatus) {
    return { id: request.id, orderId: request.orderId, status,
      lines: request.requirements.map(r => {
        const coveredQuantity = r.allocations.reduce((sum, a) => sum + a.confirmedQuantity, 0);
        return { orderItemId: r.orderItemId, skuId: r.skuId, requiredQuantity: r.requiredQuantity,
          coveredQuantity, unresolvedQuantity: r.requiredQuantity - coveredQuantity,
          status: r.actionRequirement ? 'ACTION_REQUIRED' : coveredQuantity === r.requiredQuantity ? 'COVERED' : 'CONFIRMING',
          actionRequirement: r.actionRequirement,
          allocations: r.allocations.map(a => ({ ...a, selectedCost: Number(a.selectedCost) })),
        };
      }),
    };
  }
}

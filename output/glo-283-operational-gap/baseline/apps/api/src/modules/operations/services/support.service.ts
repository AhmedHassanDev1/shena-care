import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role, SupportCaseCategory, SupportCasePriority, SupportCaseStatus, OrderStatus } from '@prisma/client';
import { CreateSupportCaseDto, UpdateSupportCaseDto } from '../dto/operations.dto';
import { OutboxService } from './outbox.service';
import { PrismaService } from '../../../platform/database/prisma.service';

export interface SupportActor { id: string; roles: Role[]; supplierId?: string | null }

@Injectable()
export class SupportService {
  constructor(private readonly prisma: PrismaService, private readonly outbox: OutboxService) {}

  /**
   * Who a case is about comes from the session, not the body (GLO-206 W24 F-06): staff may file on
   * anyone's behalf; customers only for themselves and their own orders; suppliers only for their
   * own supplier; other roles cannot attach a customer, order or supplier.
   */
  async createCaseAs(dto: CreateSupportCaseDto, actor: SupportActor) {
    if (actor.roles.some(role => role === Role.ADMIN || role === Role.HUB_OPERATOR)) return this.createCase(dto);
    const isCustomer = actor.roles.includes(Role.CUSTOMER);
    const ownSupplier = actor.roles.includes(Role.SUPPLIER) ? actor.supplierId ?? undefined : undefined;
    if (dto.customerId && (!isCustomer || dto.customerId !== actor.id)) {
      throw new ForbiddenException('Cannot open a case on behalf of another customer');
    }
    if (dto.supplierId && dto.supplierId !== ownSupplier) {
      throw new ForbiddenException('Cannot open a case on behalf of another supplier');
    }
    if (dto.orderId) {
      const own = isCustomer && await this.prisma.order.findFirst({ where: { id: dto.orderId, customerId: actor.id }, select: { id: true } });
      if (!own) throw new NotFoundException('Order not found');
    }
    return this.createCase({ ...dto, customerId: isCustomer ? actor.id : undefined, supplierId: ownSupplier });
  }

  async createCase(dto: CreateSupportCaseDto) {
    const supportCase = await this.prisma.supportCase.create({
      data: {
        title: dto.title,
        description: dto.description,
        category: dto.category as any || 'other',
        priority: dto.priority as any || 'medium',
        customerId: dto.customerId,
        orderId: dto.orderId,
        supplierId: dto.supplierId,
      }
    });

    await this.outbox.enqueue(null, {
      eventType: 'SUPPORT_CASE_CREATED',
      aggregateId: supportCase.id,
      aggregateType: 'SupportCase',
      payload: {
        caseId: supportCase.id,
        title: supportCase.title,
        priority: supportCase.priority
      },
      deduplicationKey: `support.created:${supportCase.id}`,
    });

    return supportCase;
  }

  /**
   * A reported possible adverse reaction (GLO-216 / GLO-215 F-03) becomes a critical human safety case
   * plus a staff notification, inside the caller's transaction so a report can never exist without its
   * case. Nothing here judges the reaction; triage, owner and any regulatory step are human decisions.
   */
  async openSafetyCase(tx: Prisma.TransactionClient, input: {
    orderId: string; orderNumber: string; customerId: string | null; resolutionId: string;
    product: string; description?: string; batchOrLot?: string; expiry?: string;
  }) {
    const details = [
      `Product: ${input.product}`,
      input.batchOrLot ? `Batch/lot: ${input.batchOrLot}` : null,
      input.expiry ? `Expiry: ${input.expiry}` : null,
      `Customer report: ${input.description?.trim() || '(no description given)'}`,
      `Return/resolution: ${input.resolutionId}`,
    ].filter(Boolean).join('\n');
    const supportCase = await tx.supportCase.create({
      data: {
        title: `Possible adverse reaction — ${input.orderNumber}`,
        description: details,
        category: 'safety_concern',
        priority: 'critical',
        customerId: input.customerId,
        orderId: input.orderId,
        internalNotes: 'Requires human safety review. Do not close without a recorded decision.',
      },
    });
    await this.outbox.enqueue(tx, {
      eventType: 'safety.escalated',
      aggregateId: supportCase.id,
      aggregateType: 'SupportCase',
      payload: { caseId: supportCase.id, orderNumber: input.orderNumber, resolutionId: input.resolutionId },
      channelIntent: 'internal',
      templateId: 'safety_escalation_v1',
      deduplicationKey: `safety.escalated:${input.resolutionId}`,
    });
    return supportCase;
  }

  /**
   * An operational exception that needs a human owner (returned parcel, cancelled order with goods
   * or supplier commitments in flight), opened inside the caller's transaction and deduplicated per
   * cause. Support records the decision; it never mutates orders, stock or money itself (GLO-240).
   */
  async openOperationalException(tx: Prisma.TransactionClient, input: {
    dedupKey: string; title: string; description: string;
    category: 'delivery' | 'cancellation' | 'sourcing' | 'return' | 'payment';
    priority: 'medium' | 'high' | 'critical'; orderId?: string; supplierId?: string;
  }) {
    const notice = await this.outbox.enqueue(tx, {
      eventType: 'operations.exception_opened', aggregateType: 'SupportCase', payload: { title: input.title, orderId: input.orderId ?? null },
      channelIntent: 'internal', templateId: 'operational_exception_v1', deduplicationKey: `operations.exception:${input.dedupKey}`,
    });
    if (notice.aggregateId) return tx.supportCase.findUniqueOrThrow({ where: { id: notice.aggregateId } });
    const supportCase = await tx.supportCase.create({ data: {
      title: input.title, description: input.description, category: input.category, priority: input.priority,
      orderId: input.orderId, supplierId: input.supplierId,
      internalNotes: 'Operational exception: record the decision here; canonical state changes go through the owning workflow.',
    } });
    await tx.notificationOutbox.update({ where: { id: notice.id }, data: { aggregateId: supportCase.id } });
    return supportCase;
  }

  async getCases(status?: string, filter: { category?: SupportCaseCategory; priority?: SupportCasePriority; orderId?: string; take?: number; skip?: number } = {}) {
    return this.prisma.supportCase.findMany({
      where: {
        ...(status ? { status: status as SupportCaseStatus } : {}),
        ...(filter.category ? { category: filter.category } : {}),
        ...(filter.priority ? { priority: filter.priority } : {}),
        ...(filter.orderId ? { orderId: filter.orderId } : {}),
      },
      // Critical cases (safety) lead the queue; enum order is low < medium < high < critical.
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      take: Math.min(filter.take ?? 50, 200),
      skip: filter.skip ?? 0,
    });
  }

  /** Open operational exceptions/cases count and the oldest few, for the admin attention queue. */
  async openCaseSummary(take: number) {
    const where = { status: { in: ['open', 'in_progress'] as SupportCaseStatus[] } };
    const [total, items] = await Promise.all([
      this.prisma.supportCase.count({ where }),
      this.prisma.supportCase.findMany({ where, orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }], take,
        select: { id: true, title: true, category: true, priority: true, status: true, orderId: true, createdAt: true } }),
    ]);
    return { total, items };
  }

  async getCaseById(id: string, customerId?: string) {
    const c = await this.prisma.supportCase.findUnique({ where: { id } });
    if (!c || (customerId && c.customerId !== customerId)) {
      throw new NotFoundException('Support case not found');
    }
    return c;
  }

  async updateCase(id: string, dto: UpdateSupportCaseDto, actorId: string) {
    return this.prisma.$transaction(async tx => {
      // Serialize concurrent resolution attempts for this specific case
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`support-case:${id}`}))`;

      const existing = await tx.supportCase.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException('Support case not found');

      const isResolving = dto.status && ['resolved', 'closed'].includes(dto.status);
      const wasOpen = ['open', 'in_progress'].includes(existing.status);

      // Idempotent duplicate: if case is already resolved/closed with this exact status, return existing
      if (['resolved', 'closed'].includes(existing.status) && isResolving && existing.status === dto.status) {
        return existing;
      }

      if (isResolving && wasOpen) {
        // 1. Mandatory audit notes
        if (!dto.internalNotes || dto.internalNotes.trim().length < 10) {
          throw new BadRequestException('Closing or resolving an operational case requires documented internal notes (at least 10 characters).');
        }

        // 2. Cancellation outcome verification
        if (existing.category === 'cancellation') {
          if (!existing.orderId) {
            throw new BadRequestException('Cannot close cancellation exception: case must be linked to an order with verified domain outcome.');
          }
          const order = await tx.order.findUnique({ where: { id: existing.orderId } });
          if (!order) throw new NotFoundException('Linked order not found');
          if (order.status !== OrderStatus.cancelled) {
            throw new BadRequestException(`Cannot close cancellation exception for order ${order.orderNumber}: order is not cancelled in the ordering domain (current status: ${order.status}). Cancel the order first.`);
          }
          const shipment = await tx.shipment.findUnique({ where: { orderId: existing.orderId } });
          if (shipment && ['dispatched', 'out_for_delivery', 'preparing', 'prepared', 'packing', 'packed', 'ready_to_pack', 'ready_to_prepare'].includes(shipment.status)) {
            throw new BadRequestException(`Cannot close cancellation exception for order ${order.orderNumber}: shipment ${shipment.id} is still in active transit/preparation (${shipment.status}). Reconcile physical shipment custody first.`);
          }
        }

        // 3. Delivery outcome verification
        if (existing.category === 'delivery') {
          if (!existing.orderId) {
            throw new BadRequestException('Cannot close delivery exception: case must be linked to an order with verified domain outcome.');
          }
          const order = await tx.order.findUnique({ where: { id: existing.orderId } });
          if (!order) throw new NotFoundException('Linked order not found');
          if (!['delivered', 'returned', 'cancelled'].includes(order.status)) {
            throw new BadRequestException(`Cannot close delivery exception for order ${order.orderNumber}: order status is ${order.status}. Order must be in a terminal disposition (delivered, returned, or cancelled).`);
          }
          const shipment = await tx.shipment.findUnique({ where: { orderId: existing.orderId } });
          if (shipment && ['dispatched', 'out_for_delivery', 'preparing', 'prepared', 'packing', 'packed', 'ready_to_pack', 'ready_to_prepare'].includes(shipment.status)) {
            throw new BadRequestException(`Cannot close delivery exception for order ${order.orderNumber}: shipment ${shipment.id} is still in active transit (${shipment.status}). Settle physical delivery status first.`);
          }
        }

        // 4. Return / Refund outcome verification
        if (existing.category === 'return') {
          if (!existing.orderId) {
            throw new BadRequestException('Cannot close return exception: case must be linked to an order with verified domain outcome.');
          }
          const order = await tx.order.findUnique({ where: { id: existing.orderId } });
          if (!order) throw new NotFoundException('Linked order not found');
          const resolutions = await tx.orderResolution.findMany({ where: { orderId: existing.orderId } });
          const pendingResolution = resolutions.find(r => ['requested', 'approved', 'in_transit', 'received'].includes(r.status));
          if (pendingResolution) {
            throw new BadRequestException(`Cannot close return exception for order ${order.orderNumber}: return resolution ${pendingResolution.id} is still pending (${pendingResolution.status}). Settle or reject the return workflow first.`);
          }
          if (resolutions.length === 0 && !['returned', 'cancelled'].includes(order.status)) {
            throw new BadRequestException(`Cannot close return exception for order ${order.orderNumber}: no processed return resolution exists and order is ${order.status}. Record a return resolution or return the order first.`);
          }
        }

        // 5. Payment / COD discrepancy outcome verification
        if (existing.category === 'payment') {
          if (!existing.orderId) {
            throw new BadRequestException('Cannot close payment exception: case must be linked to an order with verified domain outcome.');
          }
          const order = await tx.order.findUnique({ where: { id: existing.orderId } });
          if (!order) throw new NotFoundException('Linked order not found');
          const collection = await tx.paymentCollection.findUnique({ where: { orderId: existing.orderId } });
          if (collection && ['expected', 'disputed'].includes(collection.status)) {
            throw new BadRequestException(`Cannot close payment exception for order ${order.orderNumber}: cash collection is still ${collection.status}. Settle or void the collection through cash reconciliation first.`);
          }
        }

        // 6. Sourcing outcome verification
        if (existing.category === 'sourcing') {
          if (!existing.orderId && !existing.supplierId) {
            throw new BadRequestException('Cannot close sourcing exception: case must be linked to an order or supplier with verified domain outcome.');
          }
          if (existing.orderId) {
            const order = await tx.order.findUnique({ where: { id: existing.orderId } });
            if (!order) throw new NotFoundException('Linked order not found');
            const actionReqs = await tx.availabilityActionRequirement.findMany({
              where: { requirement: { supplyRequest: { orderId: existing.orderId } }, unresolvedQuantity: { gt: 0 } },
            });
            if (actionReqs.length > 0) {
              throw new BadRequestException(`Cannot close sourcing exception for order ${order.orderNumber}: ${actionReqs.length} unresolved supply requirement(s) still exist. Allocate alternative supply or amend order first.`);
            }
          }
          if (existing.supplierId) {
            const pendingDistribution = await tx.purchaseOrderLine.findFirst({
              where: { purchaseOrder: { supplierId: existing.supplierId }, distributionRequired: true },
            });
            if (pendingDistribution) {
              throw new BadRequestException(`Cannot close sourcing exception for supplier ${existing.supplierId}: PO line ${pendingDistribution.id} has scarce stock awaiting manual distribution.`);
            }
          }
        }
      }

      const updated = await tx.supportCase.update({
        where: { id },
        data: {
          status: dto.status as SupportCaseStatus,
          internalNotes: dto.internalNotes !== undefined ? dto.internalNotes : existing.internalNotes,
          assigneeId: dto.assigneeId !== undefined ? dto.assigneeId : existing.assigneeId,
        },
      });

      if (isResolving && wasOpen) {
        await this.outbox.enqueue(tx, {
          eventType: 'support.case_resolved',
          aggregateId: existing.id,
          aggregateType: 'SupportCase',
          payload: {
            caseId: existing.id,
            status: dto.status,
            category: existing.category,
            resolvedBy: actorId,
            internalNotes: dto.internalNotes,
          },
          deduplicationKey: `support.resolved:${existing.id}:${dto.status}`,
        });
      }

      return updated;
    });
  }
}

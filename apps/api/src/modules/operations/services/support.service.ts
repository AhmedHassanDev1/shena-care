import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
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

  async getCases(status?: string) {
    return this.prisma.supportCase.findMany({
      where: status ? { status: status as any } : undefined,
      // Critical cases (safety) lead the queue; enum order is low < medium < high < critical.
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async getCaseById(id: string, customerId?: string) {
    const c = await this.prisma.supportCase.findUnique({ where: { id } });
    if (!c || (customerId && c.customerId !== customerId)) {
      throw new NotFoundException('Support case not found');
    }
    return c;
  }

  async updateCase(id: string, dto: UpdateSupportCaseDto, actorId: string) {
    const existing = await this.getCaseById(id);
    return this.prisma.supportCase.update({
      where: { id },
      data: {
        status: dto.status as any,
        internalNotes: dto.internalNotes,
        assigneeId: dto.assigneeId
      }
    });
  }
}

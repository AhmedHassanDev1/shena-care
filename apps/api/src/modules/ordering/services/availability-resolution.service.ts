import {
  BadRequestException, ConflictException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { AvailabilityDecision, Prisma } from '@prisma/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import { CatalogService } from '../../catalog/public';
import { CommerceService } from '../../commerce/public';
import { SupplyPlanService } from '../../sourcing/public';
import {
  AvailabilityActionName, AvailabilityCandidateDto, AvailabilityDecisionDto, AvailabilityReceiptDto,
  SubmitAvailabilityDecisionDto,
} from '../dto/availability-decision.dto';
import { OutboxService } from '../../operations/services/outbox.service';

export type DecisionOwner =
  | { customerId: string }
  | { guestOrderNumber: string; guestToken: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CANDIDATES = 3;
const AMENDABLE = ['placed', 'confirmed'];
const cents = (value: unknown) => Math.round(Number(value) * 100);
const money = (c: number) => c / 100;
const REVIEW_REQUIRED = {
  code: 'REVIEW_REQUIRED',
  message: 'Your order or availability changed. Please review the updated options before deciding.',
};

interface Snapshot {
  productId: string | null; productName: string | null; skuId: string; skuCode: string | null;
  variantName: string | null; quantity: number; unitPrice: number; lineTotal: number; currency: string;
}
interface StoredCandidate {
  skuId: string; skuCode: string; variantName: string; size: number | null; sizeUnit: string | null;
  unitPrice: number; compareAtAmount: number | null; currency: string;
}

/**
 * Ordering owns the customer decision and the resulting amendment. Sourcing only reports the
 * shortage (action requirement) and executes its own requirement changes via an owner command.
 * The historical order lines are never rewritten: lines change lifecycle state and every applied
 * decision leaves an append-only OrderAmendment.
 */
@Injectable()
export class AvailabilityResolutionService {
  private readonly logger = new Logger(AvailabilityResolutionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly supplyPlan: SupplyPlanService,
    private readonly commerce: CommerceService,
    private readonly catalog: CatalogService,
    private readonly outbox: OutboxService,
  ) {}

  private async lock(tx: Prisma.TransactionClient, orderId: string) {
    // Same key space as Sourcing so amendments and supply advancement are serialized per order.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(44071, hashtext(${orderId}))::text AS locked`;
  }

  // ---- ownership -----------------------------------------------------------------------------

  private async ownedOrder(owner: DecisionOwner, ref: { id?: string; orderNumber?: string }) {
    const where: Prisma.OrderWhereInput = { ...(ref.id ? { id: ref.id } : {}), ...(ref.orderNumber ? { orderNumber: ref.orderNumber } : {}) };
    if ('customerId' in owner) where.customerId = owner.customerId;
    else {
      where.customerId = null;
      where.orderNumber = owner.guestOrderNumber;
      where.guestAccessTokenHash = createHash('sha256').update(owner.guestToken).digest('hex');
      where.guestAccessExpiresAt = { gt: new Date() };
      where.guestAccessRevokedAt = null;
    }
    const order = await this.prisma.order.findFirst({ where, select: { id: true, orderNumber: true } });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  // ---- projections ---------------------------------------------------------------------------

  private effectiveCod(order: { shippingFee: Prisma.Decimal; items: Array<{ lineState: string; lineTotal: Prisma.Decimal | null; price: Prisma.Decimal; quantity: number }> }) {
    return order.items.filter(i => i.lineState === 'active')
      .reduce((sum, i) => sum + cents(i.lineTotal ?? i.price.mul(i.quantity)), cents(order.shippingFee));
  }

  private fingerprint(order: { status: string; currency: string; items: Array<{ id: string; skuId: string; quantity: number; price: Prisma.Decimal; lineState: string }> },
    itemId: string, unresolvedQuantity: number, hasShipment: boolean) {
    const active = order.items.filter(i => i.lineState === 'active')
      .map(i => [i.id, i.skuId, i.quantity, cents(i.price)]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    return createHash('sha256').update(JSON.stringify({
      s: order.status, c: order.currency, a: active, i: itemId, u: unresolvedQuantity, h: hasShipment,
    })).digest('hex');
  }

  private present(decision: AvailabilityDecision, order: { shippingFee: Prisma.Decimal;
    items: Array<{ lineState: string; lineTotal: Prisma.Decimal | null; price: Prisma.Decimal; quantity: number }> }): AvailabilityDecisionDto {
    const original = decision.originalSnapshot as unknown as Snapshot;
    const candidates = decision.candidates as unknown as StoredCandidate[];
    const codBefore = this.effectiveCod(order);
    const originalLine = cents(original.lineTotal);
    const actions = decision.availableActions as unknown as AvailabilityActionName[];
    return {
      id: decision.id, orderItemId: decision.orderItemId, version: decision.version, status: decision.status,
      reason: 'unavailable', unresolvedQuantity: decision.unresolvedQuantity,
      original: {
        productName: original.productName, skuCode: original.skuCode, variantName: original.variantName,
        quantity: original.quantity, unitPrice: original.unitPrice, lineTotal: original.lineTotal, currency: original.currency,
      },
      availableActions: actions,
      candidates: candidates.map((c): AvailabilityCandidateDto => {
        const lineTotal = cents(c.unitPrice * original.quantity);
        return {
          skuId: c.skuId, skuCode: c.skuCode, variantName: c.variantName, size: c.size, sizeUnit: c.sizeUnit,
          unitPrice: c.unitPrice, lineTotal: money(lineTotal), currency: c.currency,
          preview: { codBefore: money(codBefore), codAfter: money(codBefore - originalLine + lineTotal), priceDelta: money(lineTotal - originalLine) },
        };
      }),
      previews: {
        continueWithoutItem: actions.includes('CONTINUE_WITHOUT_ITEM')
          ? { codBefore: money(codBefore), codAfter: money(codBefore - originalLine) } : null,
        cancelOrder: { codBefore: money(codBefore), codAfter: 0 },
      },
      expiresAt: decision.expiresAt,
      decision: decision.decidedAction ? {
        action: decision.decidedAction, skuId: decision.decidedSkuId, channel: decision.decidedChannel, decidedAt: decision.decidedAt,
      } : null,
      receipt: (decision.receipt as unknown as AvailabilityReceiptDto) ?? null,
    };
  }

  // ---- decision lifecycle --------------------------------------------------------------------

  private async buildCandidates(orderCurrency: string, item: { productId: string | null; skuId: string; quantity: number }) {
    if (!item.productId) return [] as StoredCandidate[];
    let skus: Awaited<ReturnType<CatalogService['getSkus']>> = [];
    try { skus = await this.catalog.getSkus(item.productId); } catch (error) {
      if (!(error instanceof NotFoundException)) throw error;
    }
    const result: StoredCandidate[] = [];
    for (const sku of skus) {
      if (result.length >= MAX_CANDIDATES) break;
      if (sku.id === item.skuId || !sku.isActive) continue;
      const terms = await this.commerce.getSellingTerms(sku.id);
      if (!terms?.canOrder || !terms.price || terms.price.currency !== orderCurrency) continue;
      if (!(await this.supplyPlan.canSupply(sku.id, item.quantity))) continue;
      result.push({
        skuId: sku.id, skuCode: sku.code, variantName: sku.variantName, size: sku.size, sizeUnit: sku.sizeUnit,
        unitPrice: terms.price.amount, compareAtAmount: terms.price.compareAtAmount, currency: terms.price.currency,
      });
    }
    return result;
  }

  /** Creates/refreshes one pending decision per short order line; idempotent and race-safe. */
  async ensureDecisions(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order) return;
    const shipment = await this.prisma.shipment.findUnique({ where: { orderId } });
    const availability = await this.supplyPlan.getCustomerAvailability(orderId);
    const issues = AMENDABLE.includes(order.status) && !shipment ? availability?.actionRequired?.issues ?? [] : [];
    const issueItemIds = new Set(issues.map(i => i.orderItemId));

    const pending = await this.prisma.availabilityDecision.findMany({ where: { orderId, status: 'pending' } });
    for (const stale of pending.filter(p => !issueItemIds.has(p.orderItemId))) {
      await this.prisma.availabilityDecision.updateMany({ where: { id: stale.id, status: 'pending' }, data: { status: 'superseded' } });
    }
    for (const issue of issues) {
      const item = order.items.find(i => i.id === issue.orderItemId && i.lineState === 'active');
      if (!item) continue;
      const fingerprint = this.fingerprint(order, item.id, issue.unresolvedQuantity, !!shipment);
      const existing = pending.find(p => p.orderItemId === item.id);
      if (existing?.stateFingerprint === fingerprint) continue;
      if (existing) await this.prisma.availabilityDecision.updateMany({ where: { id: existing.id, status: 'pending' }, data: { status: 'superseded' } });

      const candidates = await this.buildCandidates(order.currency, item);
      const activeCount = order.items.filter(i => i.lineState === 'active').length;
      const actions: AvailabilityActionName[] = [
        ...(candidates.length ? ['REPLACE_WITH' as const] : []),
        ...(activeCount > 1 ? ['CONTINUE_WITHOUT_ITEM' as const] : []),
        'CANCEL_ORDER',
      ];
      const latest = await this.prisma.availabilityDecision.aggregate({ where: { orderItemId: item.id }, _max: { version: true } });
      const snapshot: Snapshot = {
        productId: item.productId, productName: item.productName, skuId: item.skuId, skuCode: item.skuCode,
        variantName: item.variantName, quantity: item.quantity, unitPrice: Number(item.price),
        lineTotal: Number(item.lineTotal ?? item.price.mul(item.quantity)), currency: item.currency,
      };
      try {
        const createdDecision = await this.prisma.availabilityDecision.create({ data: {
          orderId, orderItemId: item.id, version: (latest._max.version ?? 0) + 1,
          reasonCategory: 'unavailable', unresolvedQuantity: issue.unresolvedQuantity,
          originalSnapshot: snapshot as unknown as Prisma.InputJsonValue,
          candidates: candidates as unknown as Prisma.InputJsonValue,
          availableActions: actions as unknown as Prisma.InputJsonValue, stateFingerprint: fingerprint,
        } });
        
        await this.outbox.enqueue(this.prisma, {
          eventType: 'availability.action_required',
          aggregateId: createdDecision.id,
          aggregateType: 'AvailabilityDecision',
          customerId: order.customerId || undefined,
          payload: { orderId: order.id, orderNumber: order.orderNumber, decisionId: createdDecision.id },
          channelIntent: 'whatsapp',
          templateId: 'action_required_v1',
          deduplicationKey: `availability.action_required:${createdDecision.id}`
        });
      } catch (error: any) {
        if (error?.code !== 'P2002') throw error; // a concurrent request created the same decision
      }
    }
  }

  async listForOrder(owner: DecisionOwner, ref: { idOrOrderNumber?: string; orderNumber?: string }) {
    const key = ref.idOrOrderNumber;
    const owned = await this.ownedOrder(owner, key
      ? (UUID_RE.test(key) ? { id: key } : { orderNumber: key }) : { orderNumber: ref.orderNumber });
    await this.ensureDecisions(owned.id);
    return this.openDecisions(owned.id);
  }

  async openDecisions(orderId: string): Promise<AvailabilityDecisionDto[]> {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
    const decisions = await this.prisma.availabilityDecision.findMany({
      where: { orderId, status: { in: ['pending', 'resolved'] } }, orderBy: { createdAt: 'asc' },
    });
    return decisions.map(d => this.present(d, order));
  }

  async decide(owner: DecisionOwner, decisionId: string, dto: SubmitAvailabilityDecisionDto,
    scope?: { orderNumber?: string }) {
    const decision = await this.prisma.availabilityDecision.findUnique({ where: { id: decisionId } });
    if (!decision) throw new NotFoundException('Decision not found');
    const owned = await this.ownedOrder(owner, { id: decision.orderId, orderNumber: scope?.orderNumber });
    const actor = 'customerId' in owner ? 'customer:' + owner.customerId : 'guest:' + owned.id;
    const hash = createHash('sha256').update(JSON.stringify({
      d: decisionId, a: dto.action, s: dto.candidateSkuId ?? null, v: dto.version,
    })).digest('hex');

    const keyOwner = await this.prisma.availabilityDecision.findUnique({ where: { decisionKey: dto.idempotencyKey } });
    if (keyOwner && (keyOwner.id !== decisionId || keyOwner.decisionHash !== hash)) {
      throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REUSED', message: 'Idempotency key was used for another decision.' });
    }

    if (dto.action === 'REPLACE_WITH' && !dto.candidateSkuId) throw new BadRequestException('candidateSkuId is required for REPLACE_WITH');
    if (dto.action !== 'REPLACE_WITH' && dto.candidateSkuId) throw new BadRequestException('candidateSkuId is only valid for REPLACE_WITH');

    const outcome = await this.prisma.$transaction(async tx => {
      await this.lock(tx, owned.id);
      const fresh = await tx.availabilityDecision.findUniqueOrThrow({ where: { id: decisionId } });
      if (fresh.status === 'resolved') {
        if (fresh.decisionKey === dto.idempotencyKey && fresh.decisionHash === hash) return { kind: 'replay' as const, receipt: fresh.receipt as unknown as AvailabilityReceiptDto };
        return { kind: 'already' as const };
      }
      if (fresh.status !== 'pending' || fresh.version !== dto.version) return { kind: 'review' as const };

      const order = await tx.order.findUniqueOrThrow({ where: { id: owned.id }, include: { items: true } });
      const shipment = await tx.shipment.findUnique({ where: { orderId: order.id } });
      const item = order.items.find(i => i.id === fresh.orderItemId && i.lineState === 'active');
      const availability = await this.supplyPlan.getCustomerAvailability(order.id);
      const issue = availability?.actionRequired?.issues.find(i => i.orderItemId === fresh.orderItemId);
      const stale = !item || !issue || shipment || !AMENDABLE.includes(order.status) ||
        this.fingerprint(order, item.id, issue.unresolvedQuantity, false) !== fresh.stateFingerprint;
      if (stale) {
        await tx.availabilityDecision.update({ where: { id: fresh.id }, data: { status: 'review_required' } });
        return { kind: 'review' as const };
      }
      const allowed = fresh.availableActions as unknown as AvailabilityActionName[];
      if (!allowed.includes(dto.action)) throw new BadRequestException('Action is not available for this decision');

      const original = fresh.originalSnapshot as unknown as Snapshot;
      const codBefore = this.effectiveCod(order);
      const originalLine = cents(original.lineTotal);
      const decidedAt = new Date();
      let codAfter = codBefore - originalLine;
      let replacement: AvailabilityReceiptDto['replacement'] = null;
      let newItemId: string | null = null;

      if (dto.action === 'REPLACE_WITH') {
        const candidate = (fresh.candidates as unknown as StoredCandidate[]).find(c => c.skuId === dto.candidateSkuId);
        if (!candidate) throw new BadRequestException('Candidate was not proposed for this decision');
        const terms = await this.commerce.getSellingTerms(candidate.skuId);
        if (!terms?.canOrder || !terms.price || terms.price.amount !== candidate.unitPrice ||
            terms.price.currency !== candidate.currency || !(await this.supplyPlan.canSupply(candidate.skuId, item.quantity))) {
          await tx.availabilityDecision.update({ where: { id: fresh.id }, data: { status: 'review_required' } });
          return { kind: 'review' as const };
        }
        const lineTotal = cents(candidate.unitPrice * item.quantity);
        const discount = Math.round(Math.max((candidate.compareAtAmount ?? candidate.unitPrice) - candidate.unitPrice, 0) * item.quantity * 100) / 100;
        newItemId = randomUUID();
        await tx.orderItem.create({ data: {
          id: newItemId, orderId: order.id, skuId: candidate.skuId, quantity: item.quantity,
          price: candidate.unitPrice, productId: item.productId, productName: item.productName,
          skuCode: candidate.skuCode, variantName: candidate.variantName, discountAmount: discount,
          lineTotal: money(lineTotal), currency: item.currency, replacesItemId: item.id,
        } });
        await tx.orderItem.update({ where: { id: item.id }, data: { lineState: 'replaced' } });
        codAfter += lineTotal;
        replacement = {
          orderItemId: newItemId, skuId: candidate.skuId, productName: item.productName, variantName: candidate.variantName,
          quantity: item.quantity, unitPrice: candidate.unitPrice, lineTotal: money(lineTotal), priceDelta: money(lineTotal - originalLine),
        };
        await this.supplyPlan.applyAmendment(tx, order.id, {
          releaseOrderItemIds: [item.id], add: { orderItemId: newItemId, skuId: candidate.skuId, requiredQuantity: item.quantity },
        });
      } else if (dto.action === 'CONTINUE_WITHOUT_ITEM') {
        await tx.orderItem.update({ where: { id: item.id }, data: { lineState: 'removed' } });
        await this.supplyPlan.applyAmendment(tx, order.id, { releaseOrderItemIds: [item.id] });
      } else {
        codAfter = 0;
        const active = order.items.filter(i => i.lineState === 'active');
        await this.supplyPlan.applyAmendment(tx, order.id, { releaseOrderItemIds: active.map(i => i.id) });
        await tx.order.update({ where: { id: order.id }, data: { status: 'cancelled' } });
        await tx.orderStatusEvent.create({ data: { orderId: order.id, status: 'cancelled' } });
        const resolution = await tx.orderResolution.create({ data: {
          orderId: order.id, type: 'cancellation', status: 'resolved', actorId: actor,
          reasonCode: 'AVAILABILITY_DECISION', notes: 'Customer cancelled after availability shortage',
          items: { create: active.map(i => ({ orderItemId: i.id, quantity: i.quantity })) },
        } });
        await tx.orderResolutionEvent.create({ data: {
          resolutionId: resolution.id, status: 'resolved', actorId: actor, notes: 'Availability decision',
        } });
        await tx.availabilityDecision.updateMany({
          where: { orderId: order.id, status: 'pending', id: { not: fresh.id } }, data: { status: 'superseded' },
        });
      }

      // COD expectation follows the amended order; collected/settled money is never rewritten.
      const collection = await tx.paymentCollection.findUnique({ where: { orderId: order.id } });
      if (collection && collection.status !== 'expected') {
        await tx.availabilityDecision.update({ where: { id: fresh.id }, data: { status: 'review_required' } });
        throw new ConflictException(REVIEW_REQUIRED); // rolls back every amendment write above
      }
      await tx.paymentCollection.upsert({
        where: { orderId: order.id },
        create: { orderId: order.id, expectedAmount: money(codAfter), currency: order.currency },
        update: { expectedAmount: money(codAfter), currency: order.currency },
      });

      const receipt: AvailabilityReceiptDto = {
        decisionId: fresh.id, action: dto.action, orderNumber: order.orderNumber,
        removedItem: { orderItemId: item.id, productName: item.productName, variantName: item.variantName,
          quantity: item.quantity, unitPrice: original.unitPrice, lineTotal: original.lineTotal },
        replacement,
        amounts: { codBefore: money(codBefore), codAfter: money(codAfter), delta: money(codAfter - codBefore), currency: order.currency },
        nextOrderState: dto.action === 'CANCEL_ORDER' ? 'CANCELLED' : 'CONFIRMING_PRODUCTS',
        decidedAt: decidedAt.toISOString(),
      };
      await tx.availabilityDecision.update({ where: { id: fresh.id }, data: {
        status: 'resolved', decidedAction: dto.action, decidedSkuId: dto.candidateSkuId ?? null, decidedBy: actor,
        decidedChannel: dto.channel ?? 'web', decidedAt, decisionKey: dto.idempotencyKey, decisionHash: hash,
        receipt: receipt as unknown as Prisma.InputJsonValue,
      } });
      await tx.orderAmendment.create({ data: {
        orderId: order.id, decisionId: fresh.id, type: dto.action,
        before: { item: original } as unknown as Prisma.InputJsonValue,
        after: { replacement, removed: dto.action !== 'REPLACE_WITH' } as unknown as Prisma.InputJsonValue,
        codBefore: money(codBefore), codAfter: money(codAfter), currency: order.currency,
      } });
      return { kind: 'applied' as const, receipt };
    }, { timeout: 30000 });

    if (outcome.kind === 'already') {
      throw new ConflictException({ code: 'DECISION_ALREADY_RESOLVED', message: 'This decision was already resolved differently.' });
    }
    if (outcome.kind === 'review') {
      await this.ensureDecisions(owned.id);
      throw new ConflictException({ ...REVIEW_REQUIRED });
    }
    if (outcome.kind === 'applied') {
      this.logger.log('[AUDIT] Availability decision applied: ' + JSON.stringify({
        orderId: owned.id, decisionId, action: dto.action, channel: dto.channel ?? 'web',
      }));
      if (dto.action !== 'CANCEL_ORDER') {
        try { await this.supplyPlan.replanAfterAmendment(owned.id); } catch (error: any) {
          this.logger.error('Replan after amendment failed for order ' + owned.id + ': ' + error?.message);
        }
        await this.ensureDecisions(owned.id);
      }
    }
    return {
      receipt: outcome.receipt, replayed: outcome.kind === 'replay',
      nextDecisions: (await this.openDecisions(owned.id)).filter(d => d.status === 'pending'),
    };
  }
}

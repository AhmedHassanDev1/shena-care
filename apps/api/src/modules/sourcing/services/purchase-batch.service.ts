import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import { isInternalBuyListMode } from '../config/procurement-batch.config';
import { BuyListService } from './buy-list.service';
import type { PurchaseCostDto } from '../dto/buy-list.dto';
import {
  DEFAULT_SCHEDULE, latestSlotAtOrBefore, nextSlotAfter, ScheduleSettings, slotKeyOf, validateSchedule,
} from './purchase-batch-schedule';

type Tx = Prisma.TransactionClient;

export type PurchaseBatchStatus = 'ready' | 'sent' | 'closed';
export type PurchaseBatchAction = 'send' | 'receive' | 'close' | null;
export type BatchOrderState = 'received' | 'pending' | 'unavailable' | 'cancelled';

export interface PurchaseBatchSummary {
  id: string; number: number; kind: string; status: PurchaseBatchStatus; cutoffAt: Date; createdAt: Date;
  sentAt: Date | null; sentBy: string | null; expectedAt: Date | null; note: string | null; closedAt: Date | null; closeReason: string | null;
  skus: number; orders: number; units: number; received: number; remaining: number;
  /** The one thing staff should do with this batch next. */
  nextAction: PurchaseBatchAction;
}

export interface PurchaseBatchLineView {
  id: string; skuId: string; productName: string | null; skuCode: string | null; variantName: string | null;
  required: number; received: number; remaining: number;
  /** Units that will not arrive in this batch: resolved as unavailable by staff, or their order was cancelled. */
  closedOut: number;
  orders: Array<{ orderId: string; orderNumber: string; orderItemId: string; quantity: number; received: number; remaining: number; state: BatchOrderState }>;
  receipts: Array<{ quantity: number; receivedAt: Date; receivedBy: string }>;
}

export interface PurchaseBatchDetail extends PurchaseBatchSummary {
  lines: PurchaseBatchLineView[];
  events: Array<{ type: string; actorId: string | null; createdAt: Date; data: unknown }>;
}

interface LiveItem { state: 'to_buy' | 'unavailable' | 'covered'; outstanding: number }
type BatchWithLines = Prisma.PurchaseBatchGetPayload<{ include: { lines: { include: { links: true; receipts: true } } } }>;

const ACTIVE_STATUSES = ['ready', 'sent'];
// Advisory lock key spaces: 44090 = per-SKU Buy List counts (BuyListService), 44091 = batch creation (1) and schedule changes (2). The literals
// stay inside each query because the two-key form needs int arguments.

/**
 * Scheduled purchase batches over the internal Buy List. At every cutoff the demand that no batch has claimed yet (open COD order lines
 * of orders placed before the cutoff, per exact SKU) is cut into one numbered batch. A batch line's links are the claim on each order
 * line, so the same demand can never appear in two batches. Staff order the batch outside the system and mark it sent; goods only count
 * once staff record physical quantities, which go through the existing Buy List count (allocation → Hub receiving → preparation →
 * actual acquisition cost). Nothing here contacts a supplier.
 */
@Injectable()
export class PurchaseBatchService {
  private readonly logger = new Logger(PurchaseBatchService.name);

  constructor(private readonly prisma: PrismaService, private readonly buyList: BuyListService) {}

  private assertActive() {
    if (!isInternalBuyListMode()) {
      throw new ConflictException({ code: 'SOURCING_MODE_INACTIVE', message: 'Purchase batches are only active in sourcing mode INTERNAL_BUY_LIST' });
    }
  }

  // ---------------------------------------------------------------- settings & schedule

  async getSettings() {
    const row = await this.prisma.purchaseBatchSettings.findUnique({ where: { id: 'default' } });
    return row
      ? { intervalMinutes: row.intervalMinutes, startTime: row.startTime, timeZone: row.timeZone, version: row.version, updatedBy: row.updatedBy, updatedAt: row.updatedAt, isDefault: false }
      : { ...DEFAULT_SCHEDULE, version: 0, updatedBy: null, updatedAt: null as Date | null, isDefault: true };
  }

  /**
   * Changes how future cutoffs fall. Existing batches keep their own cutoff and the claims on their order lines, so a new schedule can
   * neither duplicate nor lose demand: whatever no batch holds is simply cut at the next cutoff of the new schedule.
   */
  async updateSettings(input: ScheduleSettings & { expectedVersion?: number }, actorId: string) {
    const problems = validateSchedule(input);
    if (problems.length) throw new BadRequestException({ code: 'INVALID_SCHEDULE', message: problems.join('. '), problems });
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(44091, 2)::text AS locked`;
      const current = await tx.purchaseBatchSettings.findUnique({ where: { id: 'default' } });
      if (input.expectedVersion !== undefined && input.expectedVersion !== (current?.version ?? 0)) {
        throw new ConflictException({ code: 'SETTINGS_STALE', message: 'The schedule changed since you opened it; reload and try again', currentVersion: current?.version ?? 0 });
      }
      const data = { intervalMinutes: input.intervalMinutes, startTime: input.startTime, timeZone: input.timeZone, updatedBy: actorId };
      const saved = current
        ? await tx.purchaseBatchSettings.update({ where: { id: 'default' }, data: { ...data, version: { increment: 1 } } })
        : await tx.purchaseBatchSettings.create({ data: { id: 'default', ...data, version: 1 } });
      this.logger.log(`Purchase batch schedule v${saved.version}: every ${saved.intervalMinutes} min from ${saved.startTime} (${saved.timeZone}) by ${actorId}`);
      return { intervalMinutes: saved.intervalMinutes, startTime: saved.startTime, timeZone: saved.timeZone, version: saved.version, updatedBy: saved.updatedBy, updatedAt: saved.updatedAt, isDefault: false };
    });
  }

  async schedule(now = new Date()) {
    const settings = await this.getSettings();
    return { settings, nextCutoffAt: nextSlotAfter(now, settings), lastCutoffAt: latestSlotAtOrBefore(now, settings) };
  }

  // ---------------------------------------------------------------- demand

  /** Open order lines still to buy that no batch holds, optionally only from orders placed at or before the cutoff. */
  private async unbatchedDemand(db: Tx | PrismaService, cutoff?: Date) {
    const lines = (await this.buyList.demandLines(db)).filter(line => line.state === 'to_buy' && line.outstanding > 0 && (!cutoff || line.placedAt <= cutoff));
    if (!lines.length) return [];
    const links = await db.purchaseBatchLink.findMany({
      where: { orderItemId: { in: lines.map(line => line.orderItemId) }, line: { batch: { status: { in: ACTIVE_STATUSES } } } },
      select: { orderItemId: true, quantity: true, receivedQuantity: true, unavailableQuantity: true },
    });
    const claimed = new Map<string, number>();
    for (const link of links) {
      claimed.set(link.orderItemId, (claimed.get(link.orderItemId) ?? 0) + Math.max(link.quantity - link.receivedQuantity - link.unavailableQuantity, 0));
    }
    return lines
      .map(line => ({ ...line, free: line.outstanding - Math.min(line.outstanding, claimed.get(line.orderItemId) ?? 0) }))
      .filter(line => line.free > 0);
  }

  /** Demand waiting for the next cutoff (nothing claimed yet). */
  async pending() {
    const lines = await this.unbatchedDemand(this.prisma);
    return {
      skus: new Set(lines.map(line => line.skuId)).size,
      units: lines.reduce((sum, line) => sum + line.free, 0),
      orders: new Set(lines.map(line => line.orderId)).size,
    };
  }

  // ---------------------------------------------------------------- cutting

  /**
   * Cuts one batch for the cutoff. Idempotent per slot key: concurrent API instances, a retry or a restart all end with exactly one batch
   * for the slot. Returns null when no demand was waiting (no empty batches), and `replayed: true` when the slot already has its batch.
   */
  async cut(input: { slotKey: string; cutoffAt: Date; kind: 'scheduled' | 'manual'; actorId: string | null }) {
    this.assertActive();
    const existing = await this.prisma.purchaseBatch.findUnique({ where: { slotKey: input.slotKey } });
    if (existing) return { batchId: existing.id, number: existing.number, replayed: true };

    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(44091, 1)::text AS locked`;
      const again = await tx.purchaseBatch.findUnique({ where: { slotKey: input.slotKey } });
      if (again) return { batchId: again.id, number: again.number, replayed: true };

      const demand = await this.unbatchedDemand(tx, input.cutoffAt);
      if (!demand.length) return null;

      const bySku = new Map<string, typeof demand>();
      for (const line of demand) bySku.set(line.skuId, [...(bySku.get(line.skuId) ?? []), line]);
      const last = await tx.purchaseBatch.aggregate({ _max: { number: true } });
      const number = (last._max.number ?? 0) + 1;

      const batch = await tx.purchaseBatch.create({
        data: {
          number, slotKey: input.slotKey, kind: input.kind, cutoffAt: input.cutoffAt, createdBy: input.actorId,
          lines: {
            create: [...bySku.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([skuId, rows]) => ({
              skuId, productName: rows[0].productName, skuCode: rows[0].skuCode, variantName: rows[0].variantName,
              requiredQuantity: rows.reduce((sum, row) => sum + row.free, 0),
              links: { create: rows.map(row => ({ orderId: row.orderId, orderNumber: row.orderNumber, orderItemId: row.orderItemId, quantity: row.free })) },
            })),
          },
          events: { create: { type: 'created', actorId: input.actorId, data: { kind: input.kind, cutoffAt: input.cutoffAt.toISOString(), skus: bySku.size,
            units: demand.reduce((sum, row) => sum + row.free, 0) } } },
        },
      });
      this.logger.log(`Purchase batch #${number} cut at ${input.cutoffAt.toISOString()} (${input.kind}): ${bySku.size} SKU(s), ${demand.reduce((s, r) => s + r.free, 0)} unit(s)`);
      return { batchId: batch.id, number, replayed: false };
    }, { timeout: 30000 });
  }

  /** The scheduler tick: make sure the most recent cutoff has its batch, then close batches that have nothing left. Safe to call at any time. */
  async runDue(now = new Date()) {
    if (!isInternalBuyListMode()) return null;
    const settings = await this.getSettings();
    const slot = latestSlotAtOrBefore(now, settings);
    const created = await this.cut({ slotKey: slotKeyOf(slot), cutoffAt: slot, kind: 'scheduled', actorId: null });
    await this.sweepFinished();
    return created;
  }

  /** Staff cut a batch now (early close of the current window). */
  cutNow(idempotencyKey: string, actorId: string, now = new Date()) {
    return this.cut({ slotKey: `manual:${idempotencyKey}`, cutoffAt: now, kind: 'manual', actorId });
  }

  // ---------------------------------------------------------------- reading

  private async liveItems(db: Tx | PrismaService): Promise<Map<string, LiveItem>> {
    const lines = await this.buyList.demandLines(db);
    return new Map(lines.map(line => [line.orderItemId, { state: line.state, outstanding: line.outstanding }]));
  }

  /** What a link can still bring in: its own unreceived share, never more than the order line still needs, and nothing once the order is gone. */
  private linkRemaining(link: { orderItemId: string; quantity: number; receivedQuantity: number; unavailableQuantity: number }, live: Map<string, LiveItem>) {
    const item = live.get(link.orderItemId);
    const own = Math.max(link.quantity - link.receivedQuantity - link.unavailableQuantity, 0);
    return item && item.state === 'to_buy' ? Math.min(own, item.outstanding) : 0;
  }

  private present(batch: BatchWithLines, live: Map<string, LiveItem>): { summary: PurchaseBatchSummary; lines: PurchaseBatchLineView[] } {
    const lines: PurchaseBatchLineView[] = batch.lines.map(line => {
      const orders = line.links
        .map(link => {
          const remaining = this.linkRemaining(link, live);
          const item = live.get(link.orderItemId);
          const finished = link.receivedQuantity >= link.quantity;
          const state: BatchOrderState = finished ? 'received'
            : remaining > 0 ? 'pending'
              : link.unavailableQuantity > 0 || item?.state === 'unavailable' ? 'unavailable'
                : !item ? 'cancelled' : 'pending';
          return { orderId: link.orderId, orderNumber: link.orderNumber, orderItemId: link.orderItemId, quantity: link.quantity, received: link.receivedQuantity, remaining, state };
        })
        .sort((a, b) => a.orderNumber.localeCompare(b.orderNumber));
      const received = orders.reduce((sum, row) => sum + row.received, 0);
      const remaining = orders.reduce((sum, row) => sum + row.remaining, 0);
      return {
        id: line.id, skuId: line.skuId, productName: line.productName, skuCode: line.skuCode, variantName: line.variantName,
        required: line.requiredQuantity, received, remaining, closedOut: Math.max(line.requiredQuantity - received - remaining, 0),
        orders,
        receipts: [...line.receipts].sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime()).map(r => ({ quantity: r.quantity, receivedAt: r.receivedAt, receivedBy: r.receivedBy })),
      };
    });
    const units = lines.reduce((sum, line) => sum + line.required, 0);
    const received = lines.reduce((sum, line) => sum + line.received, 0);
    const remaining = lines.reduce((sum, line) => sum + line.remaining, 0);
    const status = batch.status as PurchaseBatchStatus;
    const summary: PurchaseBatchSummary = {
      id: batch.id, number: batch.number, kind: batch.kind, status, cutoffAt: batch.cutoffAt, createdAt: batch.createdAt,
      sentAt: batch.sentAt, sentBy: batch.sentBy, expectedAt: batch.expectedAt, note: batch.note, closedAt: batch.closedAt, closeReason: batch.closeReason,
      skus: lines.length, orders: new Set(lines.flatMap(line => line.orders.map(order => order.orderId))).size, units, received, remaining,
      nextAction: status === 'closed' ? null : status === 'ready' ? (remaining > 0 ? 'send' : 'close') : remaining > 0 ? 'receive' : 'close',
    };
    return { summary, lines };
  }

  async list(filter: 'active' | 'closed' | 'all' = 'active', take = 50) {
    const batches = await this.prisma.purchaseBatch.findMany({
      where: filter === 'all' ? {} : filter === 'closed' ? { status: 'closed' } : { status: { in: ACTIVE_STATUSES } },
      orderBy: { number: 'desc' }, take: Math.min(Math.max(take, 1), 200),
      include: { lines: { include: { links: true, receipts: true } } },
    });
    const live = await this.liveItems(this.prisma);
    return batches.map(batch => this.present(batch, live).summary);
  }

  async detail(id: string): Promise<PurchaseBatchDetail> {
    const batch = await this.prisma.purchaseBatch.findUnique({
      where: { id }, include: { lines: { include: { links: true, receipts: true }, orderBy: { skuCode: 'asc' } } },
    });
    if (!batch) throw new NotFoundException({ code: 'BATCH_NOT_FOUND', message: 'Purchase batch not found' });
    const [live, events] = await Promise.all([
      this.liveItems(this.prisma),
      this.prisma.purchaseBatchEvent.findMany({ where: { batchId: id }, orderBy: { createdAt: 'asc' } }),
    ]);
    const { summary, lines } = this.present(batch, live);
    return { ...summary, lines, events: events.map(e => ({ type: e.type, actorId: e.actorId, createdAt: e.createdAt, data: e.data })) };
  }

  // ---------------------------------------------------------------- actions

  private async load(id: string) {
    const batch = await this.prisma.purchaseBatch.findUnique({ where: { id }, include: { lines: { include: { links: true, receipts: true } } } });
    if (!batch) throw new NotFoundException({ code: 'BATCH_NOT_FOUND', message: 'Purchase batch not found' });
    return batch;
  }

  private parseExpected(value: string | null | undefined, now = new Date()): Date | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const date = new Date(value);
    const t = date.getTime();
    if (Number.isNaN(t) || t < now.getTime() - 24 * 3_600_000 || t > now.getTime() + 60 * 24 * 3_600_000) {
      throw new BadRequestException({ code: 'INVALID_EXPECTED_AT', message: 'The expected arrival must be a date within the next 60 days' });
    }
    return date;
  }

  /** Staff confirm they ordered the batch outside the system. Records who and when; retries replay. */
  async send(id: string, input: { expectedAt?: string; note?: string }, actorId: string) {
    this.assertActive();
    const expectedAt = this.parseExpected(input.expectedAt);
    const batch = await this.load(id);
    if (batch.status === 'closed') throw new ConflictException({ code: 'BATCH_CLOSED', message: 'This batch is closed' });
    if (batch.status === 'sent') return { replayed: true, batch: await this.detail(id) };
    const { summary } = this.present(batch, await this.liveItems(this.prisma));
    if (summary.remaining === 0) throw new ConflictException({ code: 'NOTHING_TO_ORDER', message: 'Every order in this batch was cancelled or resolved; there is nothing left to order' });

    const sentAt = new Date();
    const moved = await this.prisma.$transaction(async tx => {
      const updated = await tx.purchaseBatch.updateMany({
        where: { id, status: 'ready' },
        data: { status: 'sent', sentAt, sentBy: actorId, ...(expectedAt !== undefined ? { expectedAt } : {}), ...(input.note !== undefined ? { note: input.note.trim() || null } : {}) },
      });
      if (updated.count === 1) {
        await tx.purchaseBatchEvent.create({ data: { batchId: id, type: 'sent', actorId, data: { expectedAt: expectedAt?.toISOString() ?? null, note: input.note?.trim() || null } } });
      }
      return updated.count === 1;
    });
    return { replayed: !moved, batch: await this.detail(id) };
  }

  /** ETA and note can be corrected until the batch is closed. */
  async updateDetails(id: string, input: { expectedAt?: string | null; note?: string | null }, actorId: string) {
    const expectedAt = this.parseExpected(input.expectedAt);
    const batch = await this.load(id);
    if (batch.status === 'closed') throw new ConflictException({ code: 'BATCH_CLOSED', message: 'This batch is closed' });
    await this.prisma.$transaction(async tx => {
      await tx.purchaseBatch.update({ where: { id }, data: {
        ...(expectedAt !== undefined ? { expectedAt } : {}),
        ...(input.note !== undefined ? { note: input.note === null ? null : input.note.trim() || null } : {}),
      } });
      await tx.purchaseBatchEvent.create({ data: { batchId: id, type: 'details', actorId, data: {
        expectedAt: expectedAt === undefined ? undefined : expectedAt?.toISOString() ?? null, note: input.note?.trim() ?? input.note ?? undefined } } });
    });
    return this.detail(id);
  }

  /**
   * Staff physically hold `quantity` units of one line. This is the existing Buy List count, limited to this line's order lines (oldest
   * first, never more than each line's own remaining share): it creates the allocations the Hub receives by barcode, and its optional
   * cost is the same list price / discount record Finance already reads.
   */
  async receive(input: { batchId: string; lineId: string; quantity: number; idempotencyKey: string; actorId: string; cost?: PurchaseCostDto }) {
    this.assertActive();
    const batch = await this.load(input.batchId);
    const line = batch.lines.find(row => row.id === input.lineId);
    if (!line) throw new NotFoundException({ code: 'BATCH_LINE_NOT_FOUND', message: 'This product is not part of the batch' });
    // A retry of a receipt that already went through (even the one that closed the batch) is a replay, never an error.
    const earlier = await this.prisma.purchaseBatchReceipt.findUnique({ where: { acquireKey: input.idempotencyKey } });
    if (earlier) {
      if (earlier.lineId !== line.id || earlier.quantity !== input.quantity) {
        throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REUSED', message: 'This request key was already used for a different count' });
      }
      return { replayed: true, allocations: [] as Array<{ orderId: string; orderNumber: string; orderItemId: string; allocationId: string; quantity: number }>, batch: await this.detail(batch.id) };
    }
    if (batch.status === 'closed') throw new ConflictException({ code: 'BATCH_CLOSED', message: 'This batch is closed' });
    if (batch.status !== 'sent') throw new ConflictException({ code: 'BATCH_NOT_SENT', message: 'Mark the batch as sent before recording what arrived' });

    const result = await this.buyList.acquire({
      skuId: line.skuId, quantity: input.quantity, idempotencyKey: input.idempotencyKey, actorId: input.actorId, cost: input.cost,
      scope: {
        limits: async tx => {
          const links = await tx.purchaseBatchLink.findMany({ where: { lineId: line.id } });
          return new Map(links.map(link => [link.orderItemId, Math.max(link.quantity - link.receivedQuantity - link.unavailableQuantity, 0)]));
        },
        onCreated: async (tx, created) => {
          for (const row of created) {
            await tx.purchaseBatchLink.update({ where: { lineId_orderItemId: { lineId: line.id, orderItemId: row.orderItemId } }, data: { receivedQuantity: { increment: row.quantity } } });
          }
          await tx.purchaseBatchReceipt.create({ data: { lineId: line.id, quantity: input.quantity, acquireKey: input.idempotencyKey, receivedBy: input.actorId } });
          await tx.purchaseBatchEvent.create({ data: { batchId: batch.id, type: 'received', actorId: input.actorId,
            data: { lineId: line.id, skuId: line.skuId, quantity: input.quantity, costRecorded: !!input.cost } } });
        },
      },
    });
    if (result.replayed) {
      // The key must belong to a receipt of this very line; a key from another count (or line) is a different request.
      const receipt = await this.prisma.purchaseBatchReceipt.findUnique({ where: { acquireKey: input.idempotencyKey } });
      if (!receipt || receipt.lineId !== line.id) throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REUSED', message: 'This request key was already used for a different count' });
    }
    await this.closeIfFinished(batch.id, input.actorId);
    return { replayed: result.replayed, allocations: result.allocations, batch: await this.detail(batch.id) };
  }

  /**
   * The product of this line cannot be found. The units that are still to come are flagged for the customer decision flow (replace /
   * continue without / cancel) through the existing Buy List marker and counted as resolved here. Repeating it changes nothing.
   */
  async resolveUnavailable(input: { batchId: string; lineId: string; actorId: string; note?: string }) {
    this.assertActive();
    const batch = await this.load(input.batchId);
    const line = batch.lines.find(row => row.id === input.lineId);
    if (!line) throw new NotFoundException({ code: 'BATCH_LINE_NOT_FOUND', message: 'This product is not part of the batch' });
    // A closed batch has nothing left to resolve, so repeating the resolution (a retry) just shows the final state.
    if (batch.status === 'closed') return this.detail(batch.id);

    const live = await this.liveItems(this.prisma);
    const open = line.links.filter(link => this.linkRemaining(link, live) > 0);
    if (open.length) {
      try {
        // Flag first: if the link bookkeeping below is interrupted, the demand is still safely parked with the customer decision flow.
        await this.buyList.markUnavailable({ skuId: line.skuId, orderIds: open.map(link => link.orderId), actorId: input.actorId, note: input.note });
      } catch (error) {
        if (!(error instanceof NotFoundException)) throw error;
      }
      await this.prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(44090, hashtext(${line.skuId}))::text AS locked`;
        const fresh = await tx.purchaseBatchLink.findMany({ where: { lineId: line.id, orderItemId: { in: open.map(link => link.orderItemId) } } });
        const state = await this.liveItems(tx);
        let units = 0;
        for (const link of fresh) {
          const rest = Math.max(link.quantity - link.receivedQuantity - link.unavailableQuantity, 0);
          if (rest > 0 && state.get(link.orderItemId)?.state === 'unavailable') {
            await tx.purchaseBatchLink.update({ where: { id: link.id }, data: { unavailableQuantity: { increment: rest } } });
            units += rest;
          }
        }
        if (units > 0) await tx.purchaseBatchEvent.create({ data: { batchId: batch.id, type: 'unavailable', actorId: input.actorId, data: { lineId: line.id, skuId: line.skuId, units, note: input.note?.trim() || null } } });
      }, { timeout: 30000 });
    }
    await this.closeIfFinished(batch.id, input.actorId);
    return this.detail(batch.id);
  }

  /** Closing needs every unit received or resolved. Idempotent. */
  async close(id: string, actorId: string) {
    const batch = await this.load(id);
    if (batch.status === 'closed') return this.detail(id);
    const { summary } = this.present(batch, await this.liveItems(this.prisma));
    if (summary.remaining > 0) {
      throw new ConflictException({ code: 'BATCH_HAS_REMAINING', remaining: summary.remaining,
        message: `${summary.remaining} unit(s) are still expected; receive them or mark them unavailable first` });
    }
    await this.closeIfFinished(id, actorId);
    return this.detail(id);
  }

  /** Closes the batch when nothing is left to arrive. Guarded by the status so concurrent callers close it once. */
  private async closeIfFinished(id: string, actorId: string | null) {
    const batch = await this.load(id);
    if (batch.status === 'closed') return false;
    const { summary } = this.present(batch, await this.liveItems(this.prisma));
    if (summary.remaining > 0) return false;
    // A batch nobody has marked sent is only finished when it never had anything to receive (all its orders went away).
    if (batch.status === 'ready' && summary.received > 0) return false;
    const reason = summary.received > 0 ? 'completed' : 'cancelled';
    return this.prisma.$transaction(async tx => {
      const closed = await tx.purchaseBatch.updateMany({ where: { id, status: { in: ACTIVE_STATUSES } }, data: { status: 'closed', closedAt: new Date(), closedBy: actorId, closeReason: reason } });
      if (closed.count === 1) await tx.purchaseBatchEvent.create({ data: { batchId: id, type: 'closed', actorId, data: { reason, received: summary.received, units: summary.units } } });
      return closed.count === 1;
    });
  }

  /** Restart/cancellation recovery: batches whose remaining demand disappeared (cancelled orders) are closed without anyone clicking. */
  async sweepFinished() {
    const active = await this.prisma.purchaseBatch.findMany({ where: { status: { in: ACTIVE_STATUSES } }, select: { id: true } });
    let closed = 0;
    for (const row of active) if (await this.closeIfFinished(row.id, null)) closed++;
    return closed;
  }
}

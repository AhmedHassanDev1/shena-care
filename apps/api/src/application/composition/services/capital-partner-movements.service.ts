import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import { PurchaseCostService } from '../../../modules/sourcing/public';
import { FinanceExpenseService } from '../../../modules/operations/services/finance-expense.service';
import { addDays, cairoDayStartUtc, cairoYmd, resolveRange } from './finance-dates';
import { ProfitService } from './profit.service';

/**
 * The capital partner's statement of account: ONE list of movements assembled from the records the platform already keeps (Buy List
 * purchases, supplier invoice lots, approved direct costs, per-order delivery / packaging costs, hub return inspections, confirmed damages,
 * cancelled orders, courier cash settlements) plus the Admin-recorded payments to the partner. Nothing is copied into a second ledger and
 * every source record yields exactly ONE movement with a stable id (`<source>:<record id>`), so a movement can never be counted twice.
 * An amount that cannot be known (a unit with no recorded cost) stays `null` with the status COST_MISSING: it is never estimated.
 */

export const MOVEMENT_TYPES = [
  'PURCHASE', 'DIRECT_EXPENSE', 'DELIVERY_COST', 'PACKAGING_COST', 'CAPITAL_RETURN', 'PROFIT_PAYOUT',
  'SOUND_RETURN', 'DAMAGED_RETURN', 'DAMAGE', 'CANCELLED_ORDER', 'CASH_SETTLEMENT', 'CASH_PENDING',
] as const;
export type MovementType = typeof MOVEMENT_TYPES[number];

export type MovementStatus =
  | 'FUNDED' | 'APPROVED' | 'PENDING_APPROVAL' | 'PAID' | 'VOIDED' | 'RESTOCKED' | 'COUNTED_IN_COST' | 'CONFIRMED'
  | 'RECOVERABLE' | 'COST_MISSING' | 'SETTLED' | 'SHORT' | 'OVER' | 'UNSETTLED' | 'DISPUTED';

/** FUNDED = money the partner put into purchases and costs · RETURNED = money paid back to the partner · INFO = shown, never summed. */
export type MovementEffect = 'FUNDED' | 'RETURNED' | 'INFO';
export type MovementSource = 'BUY_LIST' | 'SUPPLIER_INVOICE' | 'FINANCE_EXPENSE' | 'ORDER_COST' | 'HUB_RETURN' | 'ORDER_LIFECYCLE' | 'PARTNER_LEDGER' | 'COD_SETTLEMENT';

export interface Movement {
  id: string;
  /** ISO instant of the event. */
  date: string;
  type: MovementType;
  effect: MovementEffect;
  /** EGP, always positive; null when the amount cannot be known yet. */
  amount: number | null;
  status: MovementStatus;
  reference: string;
  orderNumber: string | null;
  source: MovementSource;
  details: Record<string, unknown>;
}

/** The money-in-the-partner's-hands types: what the partner funded. */
export const FUNDED_TYPES: MovementType[] = ['PURCHASE', 'DIRECT_EXPENSE', 'DELIVERY_COST', 'PACKAGING_COST'];
export const PAID_TYPES: MovementType[] = ['CAPITAL_RETURN', 'PROFIT_PAYOUT'];

export interface Window { start: Date; end: Date; from: string; to: string }

export const windowOf = (from: string, to: string): Window => ({ start: cairoDayStartUtc(from), end: cairoDayStartUtc(addDays(to, 1)), from, to });

const CAP = 1000;
const cents = (value: unknown) => Math.round(Number(value ?? 0) * 100);
const money = (valueInCents: number) => valueInCents / 100;
const dateOnly = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const iso = (date: Date) => date.toISOString();

@Injectable()
export class CapitalPartnerMovementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly purchaseCosts: PurchaseCostService,
    private readonly expenses: FinanceExpenseService,
    private readonly profit: ProfitService,
  ) {}

  private async orderNumbers(orderIds: string[]): Promise<Map<string, string>> {
    const ids = [...new Set(orderIds)];
    if (!ids.length) return new Map();
    const rows = await this.prisma.order.findMany({ where: { id: { in: ids } }, select: { id: true, orderNumber: true } });
    return new Map(rows.map(row => [row.id, row.orderNumber]));
  }

  // ---------------------------------------------------------------------------------------------------------------- purchases
  private async purchases(window: Window | null, id?: string): Promise<Movement[]> {
    const [batches, lots] = await Promise.all([
      this.prisma.purchaseCostBatch.findMany({ where: id ? { id } : { recordedAt: { gte: window!.start, lt: window!.end } }, orderBy: { recordedAt: 'desc' }, take: CAP }),
      this.prisma.acquisitionCostLot.findMany({ where: id ? { id } : { capturedAt: { gte: window!.start, lt: window!.end } }, orderBy: { capturedAt: 'desc' }, take: CAP }),
    ]);
    const receipts = batches.length
      ? await this.prisma.purchaseBatchReceipt.findMany({ where: { acquireKey: { in: batches.map(batch => batch.acquireKey) } }, include: { line: { include: { batch: { select: { number: true } } } } } })
      : [];
    const receiptOf = new Map(receipts.map(receipt => [receipt.acquireKey, receipt]));
    const skuIds = [...new Set([...batches.map(batch => batch.skuId), ...lots.map(lot => lot.skuId)])];
    const skus = skuIds.length ? await this.prisma.sku.findMany({ where: { id: { in: skuIds } }, select: { id: true, code: true, variantName: true } }) : [];
    const skuOf = new Map(skus.map(sku => [sku.id, sku]));

    const fromBatches = batches.map((batch): Movement => {
      const receipt = receiptOf.get(batch.acquireKey);
      const sku = skuOf.get(batch.skuId);
      const code = receipt?.line.skuCode ?? sku?.code ?? batch.skuId.slice(0, 8);
      return {
        id: `purchase:${batch.id}`, date: iso(batch.recordedAt), type: 'PURCHASE', effect: 'FUNDED', status: 'FUNDED', source: 'BUY_LIST', orderNumber: null,
        amount: money(cents(batch.finalUnitCost) * batch.quantity),
        reference: receipt ? `Batch #${receipt.line.batch.number} · ${code}` : code,
        details: {
          sku: code, product: receipt?.line.productName ?? null, variant: receipt?.line.variantName ?? sku?.variantName ?? null, batchNumber: receipt?.line.batch.number ?? null,
          quantity: batch.quantity, listUnitPrice: Number(batch.listUnitPrice), discountPerUnit: Number(batch.discountPerUnit), finalUnitCost: Number(batch.finalUnitCost), costVersion: batch.version,
        },
      };
    });
    const fromLots = lots.map((lot): Movement => {
      const sku = skuOf.get(lot.skuId);
      return {
        id: `lot:${lot.id}`, date: iso(lot.capturedAt), type: 'PURCHASE', effect: 'FUNDED', status: 'FUNDED', source: 'SUPPLIER_INVOICE', orderNumber: null,
        amount: money(cents(lot.unitCost) * lot.quantity), reference: `${lot.invoiceRef} · ${sku?.code ?? lot.skuId.slice(0, 8)}`,
        details: { sku: sku?.code ?? null, variant: sku?.variantName ?? null, invoiceRef: lot.invoiceRef, quantity: lot.quantity, unitCost: Number(lot.unitCost), costVersion: lot.version },
      };
    });
    return [...fromBatches, ...fromLots];
  }

  // ---------------------------------------------------------------------------------------------------------- direct expenses
  private async directExpenses(window: Window | null, id?: string): Promise<Movement[]> {
    // id = `expense:<uuid>:<YYYY-MM-DD>`: a recurring expense has one movement per due date.
    let from = window?.from; let to = window?.to; let expenseId: string | undefined;
    if (id) { const [, uuid, day] = id.split(':'); expenseId = uuid; from = day; to = day; }
    if (!from || !to) return [];
    const rows = (await this.expenses.occurrencesBetween(from, to)).filter(row => row.kind === 'DIRECT' && (!expenseId || row.expenseId === expenseId));
    return rows.map((row): Movement => ({
      id: `expense:${row.expenseId}:${row.date}`, date: `${row.date}T00:00:00.000Z`, type: 'DIRECT_EXPENSE', effect: row.approved ? 'FUNDED' : 'INFO',
      amount: money(cents(row.amount)), status: row.approved ? 'APPROVED' : 'PENDING_APPROVAL', reference: `${row.category} · ${row.description}`, orderNumber: null, source: 'FINANCE_EXPENSE',
      details: { category: row.category, description: row.description, approved: row.approved, note: row.approved ? 'Counted as funded capital and deducted from the distributable profit.' : 'Waiting for Admin approval: not counted anywhere until approved.' },
    }));
  }

  // ----------------------------------------------------------------------------------------------- per-order costs and damages
  private async orderCosts(window: Window | null, wanted: Set<MovementType>, id?: string): Promise<Movement[]> {
    const inWindow = (field: string): Prisma.OrderCostRecordWhereInput => ({ [field]: { gte: window!.start, lt: window!.end } });
    let where: Prisma.OrderCostRecordWhereInput;
    if (id) where = { orderId: id.split(':')[1] };
    else {
      const or: Prisma.OrderCostRecordWhereInput[] = [];
      if (wanted.has('DELIVERY_COST')) or.push(inWindow('courierRecordedAt'));
      if (wanted.has('PACKAGING_COST')) or.push(inWindow('packagingRecordedAt'));
      if (wanted.has('DAMAGE')) or.push(inWindow('damageConfirmedAt'));
      if (!or.length) return [];
      where = { OR: or };
    }
    const rows = await this.prisma.orderCostRecord.findMany({ where, take: CAP });
    const numbers = await this.orderNumbers(rows.map(row => row.orderId));
    const within = (at: Date | null) => !!at && (!window || (at >= window.start && at < window.end));
    const out: Movement[] = [];
    for (const row of rows) {
      const orderNumber = numbers.get(row.orderId) ?? null;
      if (row.courierCost !== null && row.courierRecordedAt && within(row.courierRecordedAt) && (!id || id.startsWith('delivery:')) && (id || wanted.has('DELIVERY_COST'))) {
        out.push({ id: `delivery:${row.orderId}`, date: iso(row.courierRecordedAt), type: 'DELIVERY_COST', effect: 'FUNDED', status: 'FUNDED', amount: Number(row.courierCost), reference: orderNumber ?? row.orderId.slice(0, 8), orderNumber, source: 'ORDER_COST', details: { kind: 'Actual courier cost recorded for the order', corrections: Array.isArray(row.corrections) ? row.corrections.length : 0 } });
      }
      if (row.packagingCost !== null && row.packagingRecordedAt && within(row.packagingRecordedAt) && (!id || id.startsWith('packaging:')) && (id || wanted.has('PACKAGING_COST'))) {
        out.push({ id: `packaging:${row.orderId}`, date: iso(row.packagingRecordedAt), type: 'PACKAGING_COST', effect: 'FUNDED', status: 'FUNDED', amount: Number(row.packagingCost), reference: orderNumber ?? row.orderId.slice(0, 8), orderNumber, source: 'ORDER_COST', details: { packagingType: row.packagingType, kind: 'Packaging used for the order' } });
      }
      if (row.damagedAmount !== null && row.damageConfirmedAt && within(row.damageConfirmedAt) && (!id || id.startsWith('damage:')) && (id || wanted.has('DAMAGE'))) {
        out.push({ id: `damage:${row.orderId}`, date: iso(row.damageConfirmedAt), type: 'DAMAGE', effect: 'INFO', status: 'CONFIRMED', amount: Number(row.damagedAmount), reference: orderNumber ?? row.orderId.slice(0, 8), orderNumber, source: 'ORDER_COST', details: { reason: row.damageReason, kind: 'Loss confirmed by an Admin; deducted from the distributable profit' } });
      }
    }
    return out;
  }

  // ------------------------------------------------------------------------------------------------------------ hub returns
  private async hubReturns(window: Window | null, id?: string): Promise<Movement[]> {
    const rows = await this.prisma.returnReceipt.findMany({ where: id ? { id } : { receivedAt: { gte: window!.start, lt: window!.end }, correction: null }, orderBy: { receivedAt: 'desc' }, take: CAP });
    if (!rows.length) return [];
    const [numbers, skus, costs] = await Promise.all([
      this.orderNumbers(rows.map(row => row.orderId)),
      this.prisma.sku.findMany({ where: { id: { in: [...new Set(rows.map(row => row.skuId))] } }, select: { id: true, code: true, variantName: true } }),
      this.purchaseCosts.costForOrderItems([...new Set(rows.map(row => row.orderItemId))]),
    ]);
    const skuOf = new Map(skus.map(sku => [sku.id, sku]));
    return rows.map((row): Movement => {
      const bought = costs.get(row.orderItemId);
      const known = !!bought && bought.units > 0 && bought.costedUnits === bought.units;
      const amount = known ? money(Math.round((cents(bought!.cost) / bought!.units) * row.quantity)) : null;
      const sound = row.inspectionResult === 'SEALED_INTACT';
      const orderNumber = numbers.get(row.orderId) ?? null;
      return {
        id: `return:${row.id}`, date: iso(row.receivedAt), type: sound ? 'SOUND_RETURN' : 'DAMAGED_RETURN', effect: 'INFO', amount,
        status: amount === null ? 'COST_MISSING' : sound ? 'RESTOCKED' : 'COUNTED_IN_COST',
        reference: `${orderNumber ?? row.orderId.slice(0, 8)} · ${skuOf.get(row.skuId)?.code ?? row.skuId.slice(0, 8)}`, orderNumber, source: 'HUB_RETURN',
        details: {
          sku: skuOf.get(row.skuId)?.code ?? null, variant: skuOf.get(row.skuId)?.variantName ?? null, quantity: row.quantity, inspectionResult: row.inspectionResult, disposition: row.disposition,
          note: sound ? 'Returned sealed and intact: back in stock for resale, its cost leaves the cost of goods sold.' : 'Returned damaged or unusable: its purchase cost stays counted once, in the cost of goods sold.',
        },
      };
    });
  }

  // ------------------------------------------------------------------------------------------------- cancelled / returned orders
  private async endedOrders(window: Window, id?: string): Promise<Movement[]> {
    let range = resolveRange(window.from, window.to);
    if (id) {
      const orderId = id.split(':')[1];
      const event = await this.prisma.orderStatusEvent.findFirst({ where: { orderId, status: { in: ['cancelled', 'returned'] } }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } });
      if (!event) return [];
      const day = cairoYmd(event.createdAt);
      range = resolveRange(day, day);
    }
    const [{ detail }, dates] = await Promise.all([this.profit.compute(range, this.profit.currentPercent()), this.profit.firstEventDates(['cancelled', 'returned'], range)]);
    const numbers = await this.orderNumbers(detail.ended.map(order => order.orderId));
    return detail.ended.filter(order => !id || order.orderId === id.split(':')[1]).map((order): Movement => ({
      id: `ended:${order.orderId}`, date: iso(dates.get(order.orderId) ?? range.start), type: 'CANCELLED_ORDER', effect: 'INFO',
      amount: order.recoverableCost === null ? null : money(order.recoverableCost), status: order.recoverableCost === null ? 'COST_MISSING' : 'RECOVERABLE',
      reference: numbers.get(order.orderId) ?? order.orderId.slice(0, 8), orderNumber: numbers.get(order.orderId) ?? null, source: 'ORDER_LIFECYCLE',
      details: {
        recoverableGoods: order.recoverableCost === null ? null : money(order.recoverableCost), courierCost: money(order.courier), packagingCost: money(order.packaging),
        note: 'Goods bought for an order that was cancelled or returned stay recoverable: they are capital tied up in stock, not a loss. Only an Admin-confirmed damage is a loss.',
      },
    }));
  }

  // ------------------------------------------------------------------------------------------------------ partner ledger entries
  private async entries(partnerId: string, window: Window | null, id?: string): Promise<Movement[]> {
    const rows = await this.prisma.capitalPartnerEntry.findMany({
      where: { partnerId, ...(id ? { id } : { paidOn: { gte: dateOnly(window!.from), lte: dateOnly(window!.to) } }) }, orderBy: [{ paidOn: 'desc' }, { createdAt: 'desc' }], take: CAP,
    });
    return rows.map((row): Movement => {
      const isReturn = row.kind === 'CAPITAL_RETURN';
      const voided = !!row.voidedAt;
      return {
        id: `${isReturn ? 'capital-return' : 'profit-payout'}:${row.id}`, date: `${row.paidOn.toISOString().slice(0, 10)}T00:00:00.000Z`, type: isReturn ? 'CAPITAL_RETURN' : 'PROFIT_PAYOUT',
        effect: voided ? 'INFO' : 'RETURNED', amount: Number(row.amount), status: voided ? 'VOIDED' : 'PAID', reference: row.reference, orderNumber: null, source: 'PARTNER_LEDGER',
        details: {
          kind: isReturn ? 'Capital returned to the partner: not profit' : 'Share of the distributable profit paid to the partner: not a capital return',
          period: row.period, note: row.note, recordedAt: iso(row.createdAt), ...(voided ? { voidedAt: iso(row.voidedAt!), voidReason: row.voidReason } : {}),
        },
      };
    });
  }

  // ---------------------------------------------------------------------------------------------------------------- cash
  private async cash(window: Window | null, wanted: Set<MovementType>, id?: string): Promise<Movement[]> {
    const out: Movement[] = [];
    if (wanted.has('CASH_SETTLEMENT') || id?.startsWith('settlement:')) {
      const batches = await this.prisma.courierSettlementBatch.findMany({
        where: id ? { id: id.split(':')[1] } : { settledAt: { gte: window!.start, lt: window!.end } }, orderBy: { settledAt: 'desc' }, take: CAP,
        include: { collections: { select: { collectedAmount: true, expectedAmount: true, order: { select: { orderNumber: true } } } } },
      });
      for (const batch of batches) {
        const variance = batch.variance !== null ? cents(batch.variance) : cents(batch.totalCollected) - cents(batch.totalExpected);
        out.push({
          id: `settlement:${batch.id}`, date: iso(batch.settledAt), type: 'CASH_SETTLEMENT', effect: 'INFO', amount: Number(batch.totalCollected),
          status: variance < 0 ? 'SHORT' : variance > 0 ? 'OVER' : 'SETTLED', reference: batch.reference, orderNumber: null, source: 'COD_SETTLEMENT',
          details: {
            counted: Number(batch.totalCollected), declared: batch.totalDeclared === null ? null : Number(batch.totalDeclared), expected: Number(batch.totalExpected),
            variance: money(variance), fees: Number(batch.fees), netSettled: Number(batch.netSettled), orders: batch.collections.length,
            orderNumbers: batch.collections.map(collection => collection.order.orderNumber).slice(0, 100),
            note: 'Cash the hub physically counted. A shortage or surplus belongs to the settlement and is never spread over single orders.',
          },
        });
      }
    }
    if (wanted.has('CASH_PENDING') || id?.startsWith('pending:')) {
      const rows = await this.prisma.paymentCollection.findMany({
        where: id ? { id: id.split(':')[1] } : { OR: [{ status: 'collected', declaredAt: { gte: window!.start, lt: window!.end } }, { status: 'disputed', updatedAt: { gte: window!.start, lt: window!.end } }] }, orderBy: { updatedAt: 'desc' }, take: CAP,
        include: { order: { select: { orderNumber: true } } },
      });
      for (const row of rows) {
        if (row.status !== 'collected' && row.status !== 'disputed') continue;
        const declared = row.status === 'collected';
        out.push({
          id: `pending:${row.id}`, date: iso(declared ? row.declaredAt ?? row.updatedAt : row.updatedAt), type: 'CASH_PENDING', effect: 'INFO',
          amount: Number(declared ? row.declaredAmount ?? row.expectedAmount : row.expectedAmount), status: declared ? 'UNSETTLED' : 'DISPUTED', reference: row.order.orderNumber, orderNumber: row.order.orderNumber, source: 'COD_SETTLEMENT',
          details: { expected: Number(row.expectedAmount), declared: row.declaredAmount === null ? null : Number(row.declaredAmount), note: declared ? 'The courier declared this cash at the door; the hub has not counted it yet.' : 'The collection is disputed and waits for resolution.' },
        });
      }
    }
    return out;
  }

  // -------------------------------------------------------------------------------------------------------------- public API
  /** Every movement of a window for the types asked (default: all), newest first. `partnerId` scopes the partner's own payments. */
  async load(partnerId: string, window: Window, types: readonly MovementType[] = MOVEMENT_TYPES): Promise<Movement[]> {
    const wanted = new Set(types);
    const has = (...candidates: MovementType[]) => candidates.some(type => wanted.has(type));
    const parts = await Promise.all([
      has('PURCHASE') ? this.purchases(window) : [],
      has('DIRECT_EXPENSE') ? this.directExpenses(window) : [],
      has('DELIVERY_COST', 'PACKAGING_COST', 'DAMAGE') ? this.orderCosts(window, wanted) : [],
      has('SOUND_RETURN', 'DAMAGED_RETURN') ? this.hubReturns(window) : [],
      has('CANCELLED_ORDER') ? this.endedOrders(window) : [],
      has('CAPITAL_RETURN', 'PROFIT_PAYOUT') ? this.entries(partnerId, window) : [],
      has('CASH_SETTLEMENT', 'CASH_PENDING') ? this.cash(window, wanted) : [],
    ]);
    return parts.flat().filter(movement => wanted.has(movement.type)).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  }

  /** One movement by id, with its full details; null source records are a 404 (an id that is not this partner's never resolves). */
  async detail(partnerId: string, id: string): Promise<Movement> {
    const [kind, key] = [id.split(':')[0], id.split(':')[1]];
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!key || !uuid.test(key)) throw new NotFoundException({ code: 'MOVEMENT_NOT_FOUND', message: 'No such movement' });
    let found: Movement[] = [];
    const none = new Set<MovementType>();
    switch (kind) {
      case 'purchase': case 'lot': found = await this.purchases(null, key); break;
      case 'expense': found = await this.directExpenses(null, id); break;
      case 'delivery': case 'packaging': case 'damage': found = await this.orderCosts(null, none, id); break;
      case 'return': found = await this.hubReturns(null, key); break;
      case 'ended': found = await this.endedOrders(windowOf('2000-01-01', '2000-01-01'), id); break;
      case 'capital-return': case 'profit-payout': found = await this.entries(partnerId, null, key); break;
      case 'settlement': case 'pending': found = await this.cash(null, none, id); break;
      default: break;
    }
    const movement = found.find(candidate => candidate.id === id || candidate.id === `${kind}:${key}`);
    if (!movement) throw new NotFoundException({ code: 'MOVEMENT_NOT_FOUND', message: 'No such movement' });
    return movement;
  }
}

import { Injectable, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { PayableStatus, Prisma, PurchaseOrderStatus, SupplierPayable } from '@prisma/client';

type Tx = Prisma.TransactionClient;

/** Payable basis per PO line: what we actually accepted, at the approved cost — never the live offer. */
export interface PayableBasisLine {
  lineId: string;
  skuId: string;
  quantity: number;
  quantitySource: 'received_at_hub' | 'supplier_confirmed';
  unitCost: string;
  lineAmount: string;
}

const PAYABLE_PO_STATUSES: PurchaseOrderStatus[] = [
  PurchaseOrderStatus.confirmed, PurchaseOrderStatus.partial, PurchaseOrderStatus.ready, PurchaseOrderStatus.received_at_hub,
];
const PAYABLE_OPEN: PayableStatus[] = ['open', 'ready_to_pay', 'adjusted'];

@Injectable()
export class PayablesService {
  constructor(private readonly prisma: PrismaService) {}

  private isUuid(id: string) {
    const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    return uuidRegex.test(id);
  }

  /**
   * One payable per PO (unique), in the PO's currency with exact Decimal money (GLO-238 F3):
   * lines issued against orders pay for quantity physically received at the Hub, legacy manual lines
   * for the supplier-confirmed quantity; zero accepted quantity is a zero payable; the unit cost is
   * the PO's approved snapshot. A PO still awaiting goods for its order lines cannot be invoiced.
   * Replays return the existing payable.
   */
  async createPayableFromPO(purchaseOrderId: string) {
    if (!this.isUuid(purchaseOrderId)) throw new BadRequestException('Invalid PO ID');
    try {
      return await this.prisma.$transaction(tx => this.createInTx(tx, purchaseOrderId));
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.prisma.supplierPayable.findUniqueOrThrow({ where: { purchaseOrderId } });
      }
      throw error;
    }
  }

  private async createInTx(tx: Tx, purchaseOrderId: string) {
    const existing = await tx.supplierPayable.findUnique({ where: { purchaseOrderId } });
    if (existing) return existing;

    const po = await tx.supplierPurchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      include: { lines: { include: { allocations: true }, orderBy: { createdAt: 'asc' } } },
    });
    if (!po) throw new NotFoundException('PO not found');
    if (!PAYABLE_PO_STATUSES.includes(po.status)) {
      throw new ConflictException(`A ${po.status} purchase order has no accepted quantity to pay yet`);
    }

    const basis: PayableBasisLine[] = [];
    let amount = new Prisma.Decimal(0);
    const currencies = new Set<string>();
    for (const line of po.lines) {
      const linked = line.allocations.length > 0;
      const confirmed = line.confirmedQuantity ?? 0;
      if (linked) {
        const awaited = line.allocations.some(link => link.receivedQuantity + link.shortQuantity < (link.confirmedQuantity ?? 0));
        if (awaited) {
          throw new ConflictException({ code: 'GOODS_NOT_RECEIVED',
            message: 'Confirmed goods on this purchase order have not all been received at the Hub' });
        }
      }
      const quantity = linked ? line.allocations.reduce((sum, link) => sum + link.receivedQuantity, 0) : confirmed;
      if (quantity > 0 && line.unitCost === null) {
        throw new ConflictException({ code: 'MISSING_COST_SNAPSHOT', message: `Line ${line.id} has no approved unit cost` });
      }
      if (line.currency) currencies.add(line.currency);
      const unitCost = line.unitCost ?? new Prisma.Decimal(0);
      const lineAmount = unitCost.mul(quantity);
      amount = amount.plus(lineAmount);
      basis.push({
        lineId: line.id, skuId: line.skuId, quantity, quantitySource: linked ? 'received_at_hub' : 'supplier_confirmed',
        unitCost: unitCost.toFixed(2), lineAmount: lineAmount.toFixed(2),
      });
    }
    if (currencies.size > 1) throw new ConflictException('Purchase order lines are in more than one currency');
    const currency = [...currencies][0];
    if (!currency) throw new ConflictException({ code: 'MISSING_COST_SNAPSHOT', message: 'Purchase order has no currency snapshot' });

    return tx.supplierPayable.create({
      data: {
        supplierId: po.supplierId,
        purchaseOrderId: po.id,
        amount: amount.toDecimalPlaces(2),
        currency,
        status: 'open',
        basis: basis as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /** Audited signed adjustment in exact Decimal; never below zero, never after payment. */
  /** Admin payables ledger: newest first, optional status / purchase-order filter. */
  async listPayables(filter: { status?: PayableStatus; purchaseOrderIds?: string[]; take: number; skip: number }) {
    const where: Prisma.SupplierPayableWhereInput = {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.purchaseOrderIds ? { purchaseOrderId: { in: filter.purchaseOrderIds } } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.supplierPayable.count({ where }),
      this.prisma.supplierPayable.findMany({ where, orderBy: { createdAt: 'desc' }, take: filter.take, skip: filter.skip, include: { supplier: { select: { name: true } } } }),
    ]);
    return { total, items: rows.map(p => ({
      id: p.id, supplierId: p.supplierId, supplierName: p.supplier.name, purchaseOrderId: p.purchaseOrderId,
      amount: Number(p.amount), currency: p.currency, status: p.status, paidAt: p.paidAt, paymentRef: p.paymentRef, createdAt: p.createdAt,
    })) };
  }

  async adjustPayable(payableId: string, dto: {
    amount: number;
    reason: string;
    actorId: string;
  }) {
    if (!this.isUuid(payableId)) throw new BadRequestException('Invalid payable ID');
    const delta = new Prisma.Decimal(dto.amount);
    if (delta.isZero()) throw new BadRequestException('Adjustment amount must not be zero');

    return this.prisma.$transaction(async (tx) => {
      const payable = await tx.supplierPayable.findUnique({ where: { id: payableId } });
      if (!payable) throw new NotFoundException('Payable not found');
      if (!PAYABLE_OPEN.includes(payable.status)) throw new ConflictException(`A ${payable.status} payable cannot be adjusted`);
      const next = payable.amount.plus(delta);
      if (next.isNegative()) throw new BadRequestException('Adjustment would make the payable negative');

      const claimed = await tx.supplierPayable.updateMany({
        where: { id: payableId, status: payable.status, amount: payable.amount },
        data: { amount: next, status: 'adjusted' },
      });
      if (claimed.count !== 1) throw new ConflictException('Payable changed concurrently; retry');
      const adjustment = await tx.payableAdjustment.create({
        data: { payableId, amount: delta, reason: dto.reason, actorId: dto.actorId },
      });
      return { payable: await tx.supplierPayable.findUniqueOrThrow({ where: { id: payableId } }), adjustment };
    });
  }

  /** Paid once, with the operator's payment proof; a replay with the same reference is harmless. */
  async markAsPaid(payableId: string, paymentRef: string): Promise<SupplierPayable> {
    if (!this.isUuid(payableId)) throw new BadRequestException('Invalid payable ID');
    const payable = await this.prisma.supplierPayable.findUnique({ where: { id: payableId } });
    if (!payable) throw new NotFoundException('Payable not found');
    if (payable.status === 'paid') {
      if (payable.paymentRef === paymentRef) return payable;
      throw new ConflictException('Payable was already paid with a different reference');
    }
    if (!PAYABLE_OPEN.includes(payable.status)) throw new ConflictException(`A ${payable.status} payable cannot be paid`);
    const claimed = await this.prisma.supplierPayable.updateMany({
      where: { id: payableId, status: payable.status },
      data: { status: 'paid', paidAt: new Date(), paymentRef },
    });
    if (claimed.count !== 1) return this.markAsPaid(payableId, paymentRef);
    return this.prisma.supplierPayable.findUniqueOrThrow({ where: { id: payableId } });
  }
}

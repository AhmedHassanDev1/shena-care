import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { OrderingService, ReconciliationService } from '../../../modules/ordering/public';
import { FulfillmentService } from '../../../modules/fulfillment/public';
import { SupplyPlanService } from '../../../modules/sourcing/public';
import { SupportService } from '../../../modules/operations/services/support.service';

/**
 * Staff cancellation (GLO-240) composes each owner's command in ONE transaction: the order is
 * cancelled with an audited resolution, a not-yet-dispatched shipment is cancelled, open supply
 * requirements are released, and an undeclared COD expectation is voided. Late cancellation (parcel
 * with a driver or delivered) is refused. Goods already received or supplier commitments in flight
 * open an operational exception for a human decision instead of being silently undone.
 */
@Injectable()
export class OrderCancellationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ordering: OrderingService,
    private readonly fulfillment: FulfillmentService,
    private readonly supplyPlan: SupplyPlanService,
    private readonly reconciliation: ReconciliationService,
    private readonly support: SupportService,
  ) {}

  async cancel(orderId: string, actorId: string, input: { reasonCode: string; notes?: string }) {
    const result = await this.prisma.$transaction(async tx => {
      const current = await tx.order.findUnique({ where: { id: orderId } });
      if (current?.status === 'cancelled') {
        // Idempotent replay of a completed cancellation.
        return { orderId, alreadyCancelled: true, goodsReceived: false, supplierCommitments: [], boughtUnits: 0, exceptionCaseId: null as string | null, releasedFromBatchIds: [] as string[] };
      }
      // Parcel first, then order: the lock order the dispatch path uses, so racing commands queue instead of deadlocking.
      await this.fulfillment.lockShipmentForOrder(tx, orderId);
      const { order, alreadyCancelled } = await this.ordering.cancelInTx(tx, orderId, { actorId, ...input });
      if (alreadyCancelled) return { orderId, alreadyCancelled: true, goodsReceived: false, supplierCommitments: [], boughtUnits: 0, exceptionCaseId: null as string | null, releasedFromBatchIds: [] as string[] };
      const { goodsReceived, releasedFromBatchIds } = await this.fulfillment.cancelShipmentForOrder(tx, orderId, actorId);
      const { supplierCommitments, boughtUnits } = await this.supplyPlan.releaseForCancelledOrder(tx, orderId);
      await this.reconciliation.voidExpectedCollection(tx, orderId);

      let exceptionCaseId: string | null = null;
      if (goodsReceived || supplierCommitments.length || boughtUnits > 0) {
        const details = [
          goodsReceived ? 'Goods for this order were already received at the hub: decide restock or return to supplier.' : null,
          boughtUnits > 0 ? `${boughtUnits} unit(s) were already bought on the Buy List for this order: decide whether they cover another order or go back to the store.` : null,
          supplierCommitments.length ? `Supplier commitments still open on PO(s): ${[...new Set(supplierCommitments.map(c => c.purchaseOrderId))].join(', ')}.` : null,
        ].filter(Boolean).join('\n');
        exceptionCaseId = (await this.support.openOperationalException(tx, {
          dedupKey: `cancelled:${orderId}`, category: 'cancellation', priority: 'high', orderId,
          title: `Cancelled with goods in flight — ${order.orderNumber}`, description: details,
        })).id;
      }
      return { orderId, alreadyCancelled: false, goodsReceived, supplierCommitments, boughtUnits, exceptionCaseId, releasedFromBatchIds };
    }, { timeout: 30000 });
    // The run this parcel left may now be complete: every remaining parcel was already scanned into the courier's hands.
    for (const batchId of result.releasedFromBatchIds) await this.fulfillment.releaseRunIfCustodyComplete(batchId);
    return {
      orderId: result.orderId, alreadyCancelled: result.alreadyCancelled, goodsReceived: result.goodsReceived,
      supplierCommitments: result.supplierCommitments, boughtUnits: result.boughtUnits, exceptionCaseId: result.exceptionCaseId,
      order: await this.ordering.getOrder(orderId),
    };
  }
}

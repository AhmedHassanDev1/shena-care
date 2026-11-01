import { randomUUID } from 'crypto';
import { PrismaService } from '../../src/platform/database/prisma.service';

/** Portal fixtures represent an issued customer commitment, rather than the blocked manual workflow. */
export async function attachPurchaseOrderLineage(prisma: PrismaService, purchaseOrderId: string) {
  const po = await prisma.supplierPurchaseOrder.findUniqueOrThrow({ where: { id: purchaseOrderId }, include: { lines: true } });
  const orderIds: string[] = [];
  const requestIds: string[] = [];
  for (const line of po.lines) {
    const sku = await prisma.sku.findUniqueOrThrow({ where: { id: line.skuId } });
    const offer = await prisma.supplierOffer.upsert({ where: { supplierId_skuId: { supplierId: po.supplierId, skuId: line.skuId } },
      create: { supplierId: po.supplierId, skuId: line.skuId, costPrice: line.unitCost ?? 1, currency: line.currency ?? 'EGP',
        isAvailable: false, lastObservedAt: new Date(Date.now() - 86_400_000) }, update: {} });
    const order = await prisma.order.create({ data: {
      orderNumber: 'ORD-' + randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase(), status: 'placed',
      customerName: 'Portal fixture', customerPhone: '01012345678', shippingAddress: 'Local fixture', currency: 'EGP',
      subtotal: 1000 * line.requestedQuantity, shippingFee: 30, totalAmount: 1000 * line.requestedQuantity + 30,
      codAmount: 1000 * line.requestedQuantity + 30,
      items: { create: [{ skuId: sku.id, productId: sku.productId, quantity: line.requestedQuantity,
        price: 1000, lineTotal: 1000 * line.requestedQuantity, currency: 'EGP', productName: 'Portal fixture',
        skuCode: sku.code, variantName: sku.variantName }] },
    }, include: { items: true } });
    orderIds.push(order.id);
    const request = await prisma.supplyRequest.create({ data: { orderId: order.id, requirements: { create: [{
      orderItemId: order.items[0].id, skuId: sku.id, requiredQuantity: line.requestedQuantity, orderSnapshotRef: order.id,
      allocations: { create: [{ supplierOfferId: offer.id, requestedQuantity: line.requestedQuantity,
        allocatedQuantity: line.requestedQuantity, selectedCost: line.unitCost ?? offer.costPrice,
        selectedCurrency: line.currency ?? offer.currency, rankingDecisionId: randomUUID(),
        poLink: { create: { purchaseOrderLineId: line.id, orderId: order.id, orderItemId: order.items[0].id, quantity: line.requestedQuantity } },
      }] },
    }] } } });
    requestIds.push(request.id);
    await prisma.purchaseOrderLine.update({ where: { id: line.id }, data: { supplierOfferId: offer.id } });
  }
  return async () => {
    await prisma.purchaseOrderLineAllocation.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.supplyRequest.deleteMany({ where: { id: { in: requestIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  };
}

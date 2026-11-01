import { BadRequestException, ConflictException } from '@nestjs/common';
import { OrderResolutionStatus, Prisma } from '@prisma/client';

const OPEN: OrderResolutionStatus[] = ['requested', 'approved', 'in_transit', 'received'];

/**
 * Bounds a cancellation/return claim on an order line (GLO-206 W23 F-01): the line must belong to
 * the order, at most one claim may be open per line, and claimed quantities (open or completed)
 * never exceed what was purchased. Locks the line row so concurrent claims serialize.
 */
export async function assertClaimableQuantity(
  tx: Prisma.TransactionClient, orderId: string, orderItemId: string, quantity: number,
): Promise<void> {
  if (!Number.isInteger(quantity) || quantity < 1) throw new BadRequestException('Quantity must be a positive integer');
  await tx.$queryRaw`SELECT id FROM "ordering"."order_items" WHERE id = ${orderItemId}::uuid FOR UPDATE`;
  const item = await tx.orderItem.findFirst({ where: { id: orderItemId, orderId } });
  if (!item) throw new BadRequestException(`Order item ${orderItemId} does not belong to this order`);

  const claims = await tx.orderResolutionItem.findMany({
    where: { orderItemId, resolution: { status: { not: 'rejected' } } },
    include: { resolution: { select: { status: true } } },
  });
  if (claims.some(claim => OPEN.includes(claim.resolution.status))) {
    throw new ConflictException('A cancellation or return is already open for this item');
  }
  const remaining = item.quantity - claims.reduce((sum, claim) => sum + claim.quantity, 0);
  if (quantity > remaining) {
    throw new BadRequestException(`At most ${Math.max(remaining, 0)} of this item can still be returned or cancelled`);
  }
}

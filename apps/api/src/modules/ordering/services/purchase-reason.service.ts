import { createHash } from 'crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import { SetPurchaseReasonDto } from '../dto/purchase-reason.dto';

export type PurchaseReasonOwner = { customerId: string } | { guestToken: string; orderNumber: string };

export interface PurchaseReasonLine {
  orderItemId: string; productName: string | null; skuCode: string | null; variantName: string | null; quantity: number
  /** SPECIFIED only when the customer said something; skipping stays UNSPECIFIED and is never inferred. */
  status: 'SPECIFIED' | 'UNSPECIFIED'
  reason: { reasons: string[]; note: string | null; source: string | null; updatedAt: Date } | null
}

/**
 * «Why I bought it» (GLO-314). Ordering owns it because it belongs to a purchased line. The row is the customer's own words,
 * optional, per line (the same SKU bought twice has two independent rows), and separate from the immutable price/quantity
 * snapshot. Only the order's account owner or its guest-token holder can read or change it; there is no staff route.
 */
@Injectable()
export class PurchaseReasonService {
  constructor(private readonly prisma: PrismaService) {}

  /** Another person's order is indistinguishable from a missing one. */
  private async ownedOrder(owner: PurchaseReasonOwner, ref: { idOrOrderNumber?: string }) {
    const where: Prisma.OrderWhereInput = {};
    if ('customerId' in owner) {
      const key = ref.idOrOrderNumber ?? '';
      Object.assign(where, /^ORD-/.test(key) ? { orderNumber: key } : { id: key }, { customerId: owner.customerId });
    } else {
      Object.assign(where, {
        customerId: null, orderNumber: owner.orderNumber, guestAccessTokenHash: createHash('sha256').update(owner.guestToken).digest('hex'),
        guestAccessExpiresAt: { gt: new Date() }, guestAccessRevokedAt: null,
      });
    }
    const order = await this.prisma.order.findFirst({ where, select: { id: true } });
    if (!order) throw new NotFoundException('Order not found');
    return order.id;
  }

  async list(owner: PurchaseReasonOwner, ref: { idOrOrderNumber?: string }): Promise<{ items: PurchaseReasonLine[] }> {
    const orderId = await this.ownedOrder(owner, ref);
    const items = await this.prisma.orderItem.findMany({
      where: { orderId, lineState: 'active' }, orderBy: { createdAt: 'asc' }, include: { purchaseReason: true },
    });
    return { items: items.map(item => this.present(item)) };
  }

  async set(owner: PurchaseReasonOwner, ref: { idOrOrderNumber?: string }, orderItemId: string, dto: SetPurchaseReasonDto): Promise<PurchaseReasonLine> {
    const orderId = await this.ownedOrder(owner, ref);
    const item = await this.prisma.orderItem.findFirst({ where: { id: orderItemId, orderId, lineState: 'active' }, select: { id: true } });
    if (!item) throw new NotFoundException('Order item not found');
    // Plain text only: markup and control characters are stripped before the customer's words are stored.
    // eslint-disable-next-line no-control-regex
    const note = dto.note ? dto.note.replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) || null : null;
    const reasons = [...new Set(dto.reasons)];
    await this.prisma.orderItemPurchaseReason.upsert({
      where: { orderItemId },
      create: { orderItemId, reasonCodes: reasons, note, source: dto.source ?? null },
      update: { reasonCodes: reasons, note, source: dto.source ?? null },
    });
    return this.one(orderItemId);
  }

  /** Clearing the reason returns the line to UNSPECIFIED. */
  async clear(owner: PurchaseReasonOwner, ref: { idOrOrderNumber?: string }, orderItemId: string): Promise<PurchaseReasonLine> {
    const orderId = await this.ownedOrder(owner, ref);
    const item = await this.prisma.orderItem.findFirst({ where: { id: orderItemId, orderId }, select: { id: true } });
    if (!item) throw new NotFoundException('Order item not found');
    await this.prisma.orderItemPurchaseReason.deleteMany({ where: { orderItemId } });
    return this.one(orderItemId);
  }

  private async one(orderItemId: string): Promise<PurchaseReasonLine> {
    return this.present(await this.prisma.orderItem.findUniqueOrThrow({ where: { id: orderItemId }, include: { purchaseReason: true } }));
  }

  private present(item: { id: string; productName: string | null; skuCode: string | null; variantName: string | null; quantity: number;
    purchaseReason: { reasonCodes: string[]; note: string | null; source: string | null; updatedAt: Date } | null }): PurchaseReasonLine {
    const row = item.purchaseReason;
    return {
      orderItemId: item.id, productName: item.productName, skuCode: item.skuCode, variantName: item.variantName, quantity: item.quantity,
      status: row ? 'SPECIFIED' : 'UNSPECIFIED',
      reason: row ? { reasons: row.reasonCodes, note: row.note, source: row.source, updatedAt: row.updatedAt } : null,
    };
  }
}

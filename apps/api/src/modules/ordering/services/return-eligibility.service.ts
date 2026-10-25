import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { ReturnEligibilityProjectionDto, ReturnReason, SubmitReturnDto } from '../dto/return.dto';
import { OrderResolutionType, OrderResolutionStatus, OrderStatus } from '@prisma/client';
import { OutboxService } from '../../operations/services/outbox.service';
import { SupportService } from '../../operations/services/support.service';
import { assertClaimableQuantity } from './resolution-claims';

const positiveDays = (raw: string | undefined, fallback: number) => (Number(raw) > 0 && Number.isFinite(Number(raw)) ? Number(raw) : fallback);

@Injectable()
export class ReturnEligibilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly support: SupportService,
  ) {}

  async getEligibility(idOrOrderNumber: string, orderItemId: string, customerId?: string, guestTokenHash?: string): Promise<ReturnEligibilityProjectionDto> {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const order = await this.prisma.order.findFirst({
      where: { 
        ...(UUID_RE.test(idOrOrderNumber) ? { id: idOrOrderNumber } : { orderNumber: idOrOrderNumber }),
        ...(customerId ? { customerId } : {}),
        ...(guestTokenHash ? { guestAccessTokenHash: guestTokenHash, guestAccessExpiresAt: { gt: new Date() }, guestAccessRevokedAt: null } : {})
      },
      include: {
        items: true,
        statusEvents: true,
        resolutions: {
          include: { items: true }
        }
      }
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }
    const orderId = order.id;

    const item = order.items.find(i => i.id === orderItemId);
    if (!item) {
      throw new NotFoundException('Order item not found');
    }

    // Check if item is already fully resolved or has active resolution
    const activeResolutions = order.resolutions.filter(r => 
      ['requested', 'approved', 'in_transit', 'received'].includes(r.status) &&
      r.items.some(ri => ri.orderItemId === orderItemId)
    );

    if (activeResolutions.length > 0 || item.lineState !== 'active') {
      return {
        orderItemId,
        isEligible: false,
        normalWindowEndsAt: null,
        defectWindowEndsAt: null,
        allowedReasons: [],
        policyReviewRequired: false,
        conditionReviewRequired: false
      };
    }

    const deliveryEvent = order.statusEvents.find(e => e.status === OrderStatus.delivered);
    const deliveredAt = deliveryEvent?.createdAt;

    const now = new Date();
    
    // Owner policy (2026-10-25): change of mind 7 days, sealed and unused only; wrong, missing, damaged, defective or
    // expired products 14 days even when opened.
    const normalWindowDays = positiveDays(process.env.RETURN_CHANGE_OF_MIND_DAYS, 7);
    const defectWindowDays = positiveDays(process.env.RETURN_DEFECT_DAYS, 14);

    let normalWindowEndsAt: Date | null = null;
    let defectWindowEndsAt: Date | null = null;
    let allowedReasons: ReturnReason[] = [];
    let isEligible = false;

    if (!deliveredAt) {
      // Pre-delivery: allow cancellation or delivery problem
      allowedReasons = [ReturnReason.CHANGE_OF_MIND, ReturnReason.DELIVERY_PROBLEM];
      isEligible = true;
    } else {
      normalWindowEndsAt = new Date(deliveredAt.getTime() + normalWindowDays * 24 * 60 * 60 * 1000);
      defectWindowEndsAt = new Date(deliveredAt.getTime() + defectWindowDays * 24 * 60 * 60 * 1000);

      const normalOpen = now <= normalWindowEndsAt;
      const defectOpen = now <= defectWindowEndsAt;

      if (normalOpen) allowedReasons.push(ReturnReason.CHANGE_OF_MIND);
      if (defectOpen) {
        allowedReasons.push(
          ReturnReason.WRONG_ITEM,
          ReturnReason.MISSING_ITEM,
          ReturnReason.DAMAGED_OR_LEAKING,
          ReturnReason.DEFECT_OR_QUALITY_CONCERN,
          ReturnReason.EXPIRED_PRODUCT,
        );
      }

      // Safety and other always available (though policy might restrict, we allow submission for review)
      allowedReasons.push(ReturnReason.POSSIBLE_ADVERSE_EVENT, ReturnReason.OTHER);
      
      isEligible = allowedReasons.length > 0;
    }

    return {
      orderItemId,
      isEligible,
      normalWindowEndsAt,
      defectWindowEndsAt,
      allowedReasons,
      policyReviewRequired: true, // Requires human/policy review
      conditionReviewRequired: true // E.g., for CHANGE_OF_MIND
    };
  }

  async submitReturn(
    idOrOrderNumber: string,
    orderItemId: string,
    actorId: string,
    dto: SubmitReturnDto,
    customerAction: boolean = true,
    customerId?: string,
    guestTokenHash?: string
  ) {
    const eligibility = await this.getEligibility(idOrOrderNumber, orderItemId, customerId, guestTokenHash);
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const order = await this.prisma.order.findFirst({
      where: { 
        ...(UUID_RE.test(idOrOrderNumber) ? { id: idOrOrderNumber } : { orderNumber: idOrOrderNumber }),
        ...(customerId ? { customerId } : {}),
        ...(guestTokenHash ? { guestAccessTokenHash: guestTokenHash, guestAccessExpiresAt: { gt: new Date() }, guestAccessRevokedAt: null } : {})
      }
    });
    if (!order) throw new NotFoundException('Order not found');

    if (customerAction && !eligibility.isEligible) {
      throw new BadRequestException('Item is not eligible for return or cancellation at this time.');
    }
    
    if (customerAction && !eligibility.allowedReasons.includes(dto.reasonCode)) {
      throw new BadRequestException(`Reason ${dto.reasonCode} is not allowed for this item currently.`);
    }
    if (customerAction && dto.reasonCode === ReturnReason.CHANGE_OF_MIND && dto.sealedAndUnused !== true) {
      throw new BadRequestException({ code: 'SEALED_AND_UNUSED_REQUIRED', message: 'A change of mind is accepted only for a sealed, unused product.' });
    }

    return this.prisma.$transaction(async (tx) => {
      await assertClaimableQuantity(tx, order.id, orderItemId, dto.quantity);
      const resolutionDetails = {
        description: dto.description,
        mediaRefs: dto.mediaRefs,
        batchOrLot: dto.batchOrLot,
        expiry: dto.expiry,
        sealedAndUnused: dto.sealedAndUnused,
        escalateToSafety: dto.reasonCode === ReturnReason.POSSIBLE_ADVERSE_EVENT,
        requiresPhysicalReturn: dto.reasonCode !== ReturnReason.MISSING_ITEM
      };

      const resolution = await tx.orderResolution.create({
        data: {
          orderId: order.id,
          type: OrderResolutionType.return,
          status: OrderResolutionStatus.requested,
          actorId,
          reasonCode: dto.reasonCode,
          resolutionDetails,
          items: {
            create: [{
              orderItemId,
              quantity: dto.quantity
            }]
          }
        }
      });

      await tx.orderResolutionEvent.create({
        data: {
          resolutionId: resolution.id,
          status: OrderResolutionStatus.requested,
          actorId,
          notes: dto.reasonCode === ReturnReason.POSSIBLE_ADVERSE_EVENT 
            ? 'HIGH_PRIORITY: Possible adverse event reported by customer.' 
            : 'Customer initiated return/cancellation'
        }
      });

      if (dto.reasonCode === ReturnReason.POSSIBLE_ADVERSE_EVENT) {
        const item = await tx.orderItem.findUniqueOrThrow({ where: { id: orderItemId } });
        const safetyCase = await this.support.openSafetyCase(tx, {
          orderId: order.id, orderNumber: order.orderNumber, customerId: order.customerId, resolutionId: resolution.id,
          product: [item.productName ?? item.skuCode ?? item.skuId, item.variantName].filter(Boolean).join(' — '),
          description: dto.description, batchOrLot: dto.batchOrLot, expiry: dto.expiry,
        });
        await tx.orderResolution.update({
          where: { id: resolution.id },
          data: { resolutionDetails: { ...resolutionDetails, supportCaseId: safetyCase.id } },
        });
      }

      await this.outbox.enqueue(tx, {
        eventType: 'resolution.submitted',
        aggregateId: resolution.id,
        aggregateType: 'OrderResolution',
        customerId: order.customerId || undefined,
        payload: { orderId: order.id, orderNumber: order.orderNumber, resolutionId: resolution.id, reason: dto.reasonCode },
        channelIntent: 'email',
        templateId: 'return_requested_v1',
        deduplicationKey: `resolution.submitted:${resolution.id}`,
      });

      return resolution;
    });
  }
}

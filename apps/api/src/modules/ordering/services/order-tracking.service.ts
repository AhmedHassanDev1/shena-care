import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { OrderStatus, Prisma, ShipmentStatus } from '@prisma/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import { SupplyPlanService, CustomerAvailabilityProjection } from '../../sourcing/public';
import {
  CustomerOrderTrackingDto, CustomerStage, CustomerTimelineEventDto,
  CustomerResolutionDto, CustomerItemStatus,
} from '../dto/order-tracking.dto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const orderInclude = Prisma.validator<Prisma.OrderInclude>()({
  items: true,
  statusEvents: { orderBy: { createdAt: 'asc' } },
  paymentCollection: true,
  resolutions: { include: { items: true, events: { orderBy: { createdAt: 'asc' } } }, orderBy: { createdAt: 'asc' } },
});
type TrackingOrder = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

const shipmentInclude = Prisma.validator<Prisma.ShipmentInclude>()({
  events: { orderBy: { createdAt: 'asc' } },
});
type TrackingShipment = Prisma.ShipmentGetPayload<{ include: typeof shipmentInclude }>;

function orderStage(status: OrderStatus): CustomerStage {
  switch (status) {
    case 'placed': return 'RECEIVED';
    case 'confirmed': return 'CONFIRMED';
    case 'packing': return 'PREPARING';
    case 'shipped': return 'OUT_FOR_DELIVERY';
    case 'delivered': return 'DELIVERED';
    case 'cancelled': return 'CANCELLED';
  }
}

function shipmentStage(status: ShipmentStatus): CustomerStage | null {
  switch (status) {
    case 'preparing':
    case 'prepared':
    case 'ready_to_pack':
    case 'packing':
    case 'packed':
      return 'PREPARING';
    case 'dispatched':
    case 'out_for_delivery':
      return 'OUT_FOR_DELIVERY';
    case 'delivered':
      return 'DELIVERED';
    case 'failed':
    case 'returned':
      return 'DELIVERY_ISSUE';
    default:
      return null;
  }
}

@Injectable()
export class OrderTrackingService {
  constructor(private readonly prisma: PrismaService, private readonly supplyPlan: SupplyPlanService) {}

  async forCustomer(idOrOrderNumber: string, customerId: string): Promise<CustomerOrderTrackingDto> {
    const order = await this.prisma.order.findFirst({
      where: { customerId, ...(UUID_RE.test(idOrOrderNumber) ? { id: idOrOrderNumber } : { orderNumber: idOrOrderNumber }) },
      include: orderInclude,
    });
    if (!order) throw new NotFoundException('Order not found');
    return this.project(order);
  }

  async forGuest(orderNumber: string, token: string): Promise<CustomerOrderTrackingDto> {
    const order = await this.prisma.order.findFirst({
      where: {
        orderNumber, customerId: null,
        guestAccessTokenHash: createHash('sha256').update(token).digest('hex'),
        guestAccessExpiresAt: { gt: new Date() },
        guestAccessRevokedAt: null,
      },
      include: orderInclude,
    });
    if (!order) throw new NotFoundException('Order not found');
    return this.project(order);
  }

  private async project(order: TrackingOrder): Promise<CustomerOrderTrackingDto> {
    const availability = await this.supplyPlan.getCustomerAvailability(order.id);
    const shipment = await this.prisma.shipment.findUnique({
      where: { orderId: order.id },
      include: shipmentInclude,
    });
    const activeCancellation = [...order.resolutions].reverse().find(r =>
      r.type === 'cancellation' && !['rejected', 'resolved'].includes(r.status),
    );
    const baseStage = this.currentStage(order, shipment, !!activeCancellation);
    const stage = availability && (baseStage === 'RECEIVED' || availability.status === 'ACTION_REQUIRED' && baseStage === 'CONFIRMED')
      ? availability.status : baseStage;
    const availabilityConfirmed = availability?.status === 'ACTION_REQUIRED' ? false :
      availability?.status === 'CONFIRMED' || order.statusEvents.some(event => event.status === 'confirmed') ||
      ['confirmed', 'shipped', 'delivered'].includes(order.status) ||
      !!shipment && ['prepared', 'ready_to_pack', 'packing', 'packed', 'dispatched', 'out_for_delivery', 'delivered'].includes(shipment.status);
    const originalCodAmount = Number(order.codAmount ?? order.totalAmount);
    const currentCodAmount = order.paymentCollection?.currency === order.currency
      ? Number(order.paymentCollection.expectedAmount)
      : originalCodAmount;
    const resolutions: CustomerResolutionDto[] = order.resolutions.map(resolution => ({
      category: resolution.type,
      status: resolution.status === 'rejected' ? 'rejected'
        : resolution.status === 'resolved' ? 'resolved'
        : resolution.status === 'requested' ? 'requested' : 'in_progress',
      affectedItemIds: resolution.items.map(item => item.orderItemId),
      allowedActions: [],
    }));
    return {
      orderNumber: order.orderNumber,
      createdAt: order.createdAt,
      status: stage,
      orderReceived: true,
      availabilityConfirmed,
      customerName: order.customerName,
      deliveryAddress: {
        governorate: order.governorate, area: order.area, address: order.shippingAddress,
        latitude: order.latitude, longitude: order.longitude, locationSource: order.locationSource,
      },
      amounts: {
        originalCodAmount, currentCodAmount,
        subtotal: Number(order.subtotal ?? order.totalAmount.minus(order.shippingFee)),
        shippingFee: Number(order.shippingFee), currency: order.currency,
      },
      items: order.items.map(item => {
        const resolved = order.status === 'cancelled' || order.resolutions.some(resolution =>
          resolution.status === 'resolved' && resolution.items.some(ri => ri.orderItemId === item.id),
        );
        const sourcingLine = availability?.lines.find(line => line.orderItemId === item.id);
        const status: CustomerItemStatus = resolved ? 'resolved'
          : sourcingLine?.status === 'action-required' ? 'action-required'
          : availabilityConfirmed ? 'confirmed' : sourcingLine?.status ?? 'checking';
        return {
          id: item.id, skuId: item.skuId, productName: item.productName,
          skuCode: item.skuCode, variantName: item.variantName, quantity: item.quantity,
          unitPrice: Number(item.price), discountAmount: Number(item.discountAmount ?? 0),
          lineTotal: Number(item.lineTotal ?? item.price.mul(item.quantity)),
          currency: item.currency, status,
        };
      }),
      timeline: this.timeline(order, shipment, availability),
      delivery: {
        certainty: stage === 'DELIVERED' ? 'confirmed' : 'unknown',
        estimatedDate: null,
        deliveredAt: shipment?.deliveredAt ?? null,
        source: shipment?.deliveredAt ? 'fulfillment' : stage === 'DELIVERED' ? 'order_status' : null,
        nextUpdateBy: null,
        promise: order.deliveryPromise,
      },
      actionRequired: availability?.actionRequired ?? null,
      resolutions,
    };
  }

  private currentStage(order: TrackingOrder, shipment: TrackingShipment | null, cancellationRequested: boolean): CustomerStage {
    if (order.status === 'cancelled') return 'CANCELLED';
    if (cancellationRequested) return 'CANCELLATION_REQUESTED';
    const shipmentStatus = shipment ? shipmentStage(shipment.status) : null;
    if (shipment) {
      if (shipmentStatus) return shipmentStatus;
      return order.status === 'confirmed' || order.statusEvents.some(event => event.status === 'confirmed')
        ? 'CONFIRMED' : 'RECEIVED';
    }
    if (order.status === 'packing') {
      return order.statusEvents.some(event => event.status === 'confirmed') ? 'CONFIRMED' : 'RECEIVED';
    }
    return orderStage(order.status);
  }

  private timeline(order: TrackingOrder, shipment: TrackingShipment | null,
    availability: CustomerAvailabilityProjection | null): CustomerTimelineEventDto[] {
    const events: CustomerTimelineEventDto[] = [{ status: 'RECEIVED', occurredAt: order.createdAt }];
    for (const event of availability?.timeline ?? []) events.push(event);
    for (const event of order.statusEvents) {
      if (event.status !== 'placed' && event.status !== 'packing' &&
          !(shipment && (event.status === 'shipped' || event.status === 'delivered'))) {
        events.push({ status: orderStage(event.status), occurredAt: event.createdAt });
      }
    }
    if (shipment) {
      for (const event of shipment.events) {
        const status = event.type === 'PREPARATION_STARTED' || event.type === 'PACKED' ? 'PREPARING'
          : event.type === 'OUT_FOR_DELIVERY' ? 'OUT_FOR_DELIVERY'
          : event.type === 'DELIVERED' ? 'DELIVERED' : null;
        if (status) events.push({ status, occurredAt: event.createdAt });
      }
      if (shipment.dispatchedAt) events.push({ status: 'OUT_FOR_DELIVERY', occurredAt: shipment.dispatchedAt });
      if (shipment.deliveredAt) events.push({ status: 'DELIVERED', occurredAt: shipment.deliveredAt });
    }
    for (const resolution of order.resolutions) {
      if (resolution.type !== 'cancellation') continue;
      for (const event of resolution.events) {
        if (event.status === 'requested') events.push({ status: 'CANCELLATION_REQUESTED', occurredAt: event.createdAt });
      }
    }
    events.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    return events.filter((event, index) => index === 0 || event.status !== events[index - 1].status);
  }
}

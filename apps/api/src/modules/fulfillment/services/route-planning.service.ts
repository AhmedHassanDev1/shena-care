import {
  Injectable,
  Inject,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import { OrderingService } from '../../ordering/public';
import { assertDeliverablePin } from '../../ordering/services/service-area';
import {
  ROUTING_PROVIDER,
  RoutingProvider,
  RouteWaypoint,
  PlannedRoute,
} from '../routing/routing.provider';
import { PlanRouteDto } from '../dto/routing.dto';
import { getDeliveryHubCoordinates } from './hub-location';
import { FulfillmentActor } from './fulfillment.service';

export interface PlannedBatchRoute {
  batchId: string;
  batchStatus: string;
  driverId: string | null;
  locationId: string | null;
  hubOrigin: RouteWaypoint;
  stopCount: number;
  route: PlannedRoute;
}

@Injectable()
export class RoutePlanningService {
  constructor(
    @Inject(ROUTING_PROVIDER) private readonly routingProvider: RoutingProvider,
    private readonly prisma: PrismaService,
    private readonly orderingService: OrderingService,
  ) {}

  /**
   * Calculates a drivable route between an origin (defaulting to the ShinaCare Fulfillment Hub)
   * and one or more delivery stops in the exact sequence requested.
   */
  async planRoute(dto: PlanRouteDto): Promise<PlannedRoute> {
    const hub = getDeliveryHubCoordinates();

    const origin: RouteWaypoint = dto.origin
      ? {
          id: dto.origin.id,
          name: dto.origin.name || 'Origin',
          address: dto.origin.address,
          latitude: dto.origin.latitude,
          longitude: dto.origin.longitude,
        }
      : {
          id: 'hub-main',
          name: hub.name,
          address: 'Giza / Cairo Fulfillment Hub',
          latitude: hub.latitude,
          longitude: hub.longitude,
        };

    this.validateCoordinatePair(origin.latitude, origin.longitude, 'origin');

    if (!dto.destinations || dto.destinations.length === 0) {
      throw new BadRequestException('At least one destination stop is required');
    }

    if (dto.destinations.length > 24) {
      throw new BadRequestException('A maximum of 24 destination stops can be routed in one request');
    }

    // Validate destinations against Cairo/Giza deliverable pin bounds and rules
    const destinations: RouteWaypoint[] = dto.destinations.map((dest, idx) => {
      this.validateCoordinatePair(dest.latitude, dest.longitude, `destination ${idx + 1}`);
      assertDeliverablePin({ latitude: dest.latitude, longitude: dest.longitude });

      return {
        id: dest.id,
        name: dest.name || `Stop ${idx + 1}`,
        address: dest.address,
        latitude: dest.latitude,
        longitude: dest.longitude,
      };
    });

    return this.routingProvider.calculateRoute(origin, destinations, {
      profile: dto.profile,
    });
  }

  /**
   * Plans a route for an existing delivery batch run, loading its stops in planned sequence
   * from the database and using the assigned fulfillment hub as the route origin.
   */
  async planBatchRoute(batchId: string, actor: FulfillmentActor): Promise<PlannedBatchRoute> {
    if (!this.isUuid(batchId)) {
      throw new BadRequestException('Invalid batch ID');
    }

    const batch = await this.prisma.deliveryBatch.findUnique({
      where: { id: batchId },
      include: {
        location: true,
        stops: {
          orderBy: { sequence: 'asc' },
          include: {
            shipment: true,
          },
        },
      },
    });

    if (!batch) {
      throw new NotFoundException('Delivery batch not found');
    }

    await this.assertBatchAccess(batch, actor);

    if (batch.stops.length === 0) {
      throw new BadRequestException('Cannot calculate route: delivery batch has no stops assigned');
    }

    const hub = getDeliveryHubCoordinates();
    const hubOrigin: RouteWaypoint = {
      id: batch.locationId || 'hub-main',
      name: batch.location?.name || hub.name,
      address: batch.location?.address || 'Giza / Cairo Central Fulfillment Hub',
      latitude: hub.latitude,
      longitude: hub.longitude,
    };

    const destinations: RouteWaypoint[] = [];

    for (const stop of batch.stops) {
      const order = await this.orderingService.getOrder(stop.shipment.orderId);
      if (!order) {
        throw new NotFoundException(`Order for shipment ${stop.shipmentId} not found`);
      }

      if (
        order.latitude === null ||
        order.latitude === undefined ||
        order.longitude === null ||
        order.longitude === undefined
      ) {
        throw new BadRequestException({
          code: 'LOCATION_REQUIRED',
          message: `Stop sequence ${stop.sequence} (order ${order.orderNumber}) is missing confirmed delivery coordinates`,
        });
      }

      assertDeliverablePin({ latitude: order.latitude, longitude: order.longitude });

      destinations.push({
        id: stop.id,
        name: order.customerName,
        address: [order.shippingAddress, order.area, order.governorate].filter(Boolean).join(', '),
        latitude: order.latitude,
        longitude: order.longitude,
      });
    }

    const route = await this.routingProvider.calculateRoute(hubOrigin, destinations);

    return {
      batchId: batch.id,
      batchStatus: batch.status,
      driverId: batch.driverId,
      locationId: batch.locationId,
      hubOrigin,
      stopCount: batch.stops.length,
      route,
    };
  }

  private validateCoordinatePair(latitude: number, longitude: number, label: string) {
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      throw new BadRequestException(`Invalid latitude for ${label}: must be a finite number between -90 and 90`);
    }
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new BadRequestException(`Invalid longitude for ${label}: must be a finite number between -180 and 180`);
    }
  }

  private async assertBatchAccess(
    batch: { locationId: string | null; driverId: string | null },
    actor: FulfillmentActor,
  ) {
    if (actor.roles.includes(Role.ADMIN)) return;

    if (actor.roles.includes(Role.DRIVER) && batch.driverId === actor.id) {
      return;
    }

    if (batch.locationId && actor.roles.includes(Role.HUB_OPERATOR)) {
      const isAssigned = await this.prisma.fulfillmentLocationOperator.findUnique({
        where: {
          locationId_operatorId: {
            locationId: batch.locationId,
            operatorId: actor.id,
          },
        },
      });
      if (isAssigned) return;
    }

    throw new ForbiddenException('You do not have access to this delivery batch');
  }

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  }
}

import {
  Injectable,
  Inject,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  ConflictException,
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
import {
  ROUTE_OPTIMIZATION_PROVIDER,
  RouteOptimizationProvider,
  MAX_MAPBOX_OPTIMIZATION_STOPS,
} from '../routing/route-optimization.provider';
import { getDeliveryHubCoordinates } from './hub-location';
import { FulfillmentActor } from './fulfillment.service';
import { ApplyOptimizationDto, OptimizationOptionsDto } from '../dto/optimization.dto';

export interface BatchStopSummary {
  stopId: string;
  shipmentId: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  sequence: number;
  address: string;
  latitude: number;
  longitude: number;
}

export interface OptimizedBatchStopSummary extends BatchStopSummary {
  originalSequence: number;
  optimizedSequence: number;
}

export interface OptimizationMetricsSummary {
  originalDistanceMeters: number;
  optimizedDistanceMeters: number;
  distanceSavingsMeters: number;
  distanceSavingsPercent: number;
  originalDurationSeconds: number;
  optimizedDurationSeconds: number;
  durationSavingsSeconds: number;
  durationSavingsPercent: number;
}

export interface BatchOptimizationPreview {
  batchId: string;
  batchStatus: string;
  driverId: string | null;
  locationId: string | null;
  hubOrigin: RouteWaypoint;
  stopCount: number;
  applied: boolean;
  isOptimized: boolean;
  provider: string;
  roundtrip: boolean;
  fixedFinalStopId?: string;
  previewToken: string;
  batchUpdatedAt: string;
  summary: OptimizationMetricsSummary;
  originalStops: BatchStopSummary[];
  optimizedStops: OptimizedBatchStopSummary[];
  originalRoute: PlannedRoute;
  optimizedRoute: PlannedRoute;
}

export interface BatchOptimizationApplyResult {
  success: boolean;
  applied: boolean;
  batchId: string;
  batchStatus: string;
  isOptimized: boolean;
  provider: string;
  roundtrip: boolean;
  fixedFinalStopId?: string;
  summary: OptimizationMetricsSummary;
  stops: any[];
  optimizedRoute: PlannedRoute;
}

@Injectable()
export class RouteOptimizationService {
  constructor(
    @Inject(ROUTE_OPTIMIZATION_PROVIDER)
    private readonly optimizationProvider: RouteOptimizationProvider,
    @Inject(ROUTING_PROVIDER)
    private readonly routingProvider: RoutingProvider,
    private readonly prisma: PrismaService,
    private readonly orderingService: OrderingService,
  ) {}

  /**
   * Generates a preview comparison between the original batch delivery order
   * and the optimized delivery stop order without persisting any changes.
   */
  async previewBatchOptimization(
    batchId: string,
    actor: FulfillmentActor,
    options?: OptimizationOptionsDto,
  ): Promise<BatchOptimizationPreview> {
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

    if (batch.status !== 'planning') {
      throw new BadRequestException('Cannot optimize a dispatched or completed delivery batch');
    }

    if (batch.stops.length === 0) {
      throw new BadRequestException('Cannot optimize route: delivery batch has no stops assigned');
    }

    if (batch.stops.length > MAX_MAPBOX_OPTIMIZATION_STOPS) {
      throw new BadRequestException(
        `Route optimization supports a maximum of ${MAX_MAPBOX_OPTIMIZATION_STOPS} delivery stops per batch (12 coordinates total including hub origin). Batch has ${batch.stops.length} stops.`,
      );
    }

    const hub = getDeliveryHubCoordinates();
    const hubOrigin: RouteWaypoint = {
      id: batch.locationId || 'hub-main',
      name: batch.location?.name || hub.name,
      address: batch.location?.address || 'Giza / Cairo Fulfillment Hub',
      latitude: hub.latitude,
      longitude: hub.longitude,
    };

    const isRoundtrip = options?.roundtrip === true;
    const originalStops: BatchStopSummary[] = [];
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

      const address = [order.shippingAddress, order.area, order.governorate]
        .filter(Boolean)
        .join(', ');

      originalStops.push({
        stopId: stop.id,
        shipmentId: stop.shipmentId,
        orderId: order.id,
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        sequence: stop.sequence,
        address,
        latitude: order.latitude,
        longitude: order.longitude,
      });

      destinations.push({
        id: stop.id,
        name: order.customerName,
        address,
        latitude: order.latitude,
        longitude: order.longitude,
      });
    }

    // Baseline calculation using original sequence
    // For roundtrip, append hubOrigin as the return leg destination to reflect the full closed loop
    const baselineWaypoints = isRoundtrip ? [...destinations, hubOrigin] : destinations;
    const originalRoute = await this.routingProvider.calculateRoute(hubOrigin, baselineWaypoints);

    const previewToken = this.generateBatchFingerprint(batch);
    const batchUpdatedAt = batch.updatedAt.toISOString();

    // Single stop: stop order is trivial, avoid unnecessary third-party optimization call
    if (batch.stops.length === 1) {
      const singleStop = originalStops[0];
      const optimizedSingleStop: OptimizedBatchStopSummary = {
        ...singleStop,
        originalSequence: singleStop.sequence,
        optimizedSequence: 1,
      };

      return {
        batchId: batch.id,
        batchStatus: batch.status,
        driverId: batch.driverId,
        locationId: batch.locationId,
        hubOrigin,
        stopCount: 1,
        applied: false,
        isOptimized: false,
        provider: this.optimizationProvider.providerName,
        roundtrip: isRoundtrip,
        fixedFinalStopId: singleStop.stopId,
        previewToken,
        batchUpdatedAt,
        summary: {
          originalDistanceMeters: originalRoute.totalDistanceMeters,
          optimizedDistanceMeters: originalRoute.totalDistanceMeters,
          distanceSavingsMeters: 0,
          distanceSavingsPercent: 0,
          originalDurationSeconds: originalRoute.totalDurationSeconds,
          optimizedDurationSeconds: originalRoute.totalDurationSeconds,
          durationSavingsSeconds: 0,
          durationSavingsPercent: 0,
        },
        originalStops,
        optimizedStops: [optimizedSingleStop],
        originalRoute,
        optimizedRoute: originalRoute,
      };
    }

    // Multiple stops: calculate optimal visit order via provider
    const optimizationResult = await this.optimizationProvider.optimizeRoute(
      hubOrigin,
      destinations,
      {
        profile: 'driving',
        roundtrip: isRoundtrip,
        fixedFinalStopId: options?.fixedFinalStopId,
      },
    );

    const optimizedStops: OptimizedBatchStopSummary[] = optimizationResult.optimizedStops.map(
      (opt) => {
        const orig = originalStops[opt.originalIndex];
        return {
          ...orig,
          originalSequence: orig.sequence,
          optimizedSequence: opt.sequence,
        };
      },
    );

    const isSequenceChanged = optimizedStops.some(
      (stop) => stop.originalSequence !== stop.optimizedSequence,
    );

    let optimizedRoute: PlannedRoute;
    if (isSequenceChanged) {
      const reorderedDestinations = optimizationResult.optimizedStops.map(
        (opt) => destinations[opt.originalIndex],
      );
      const optimizedWaypoints = isRoundtrip
        ? [...reorderedDestinations, hubOrigin]
        : reorderedDestinations;

      optimizedRoute = await this.routingProvider.calculateRoute(
        hubOrigin,
        optimizedWaypoints,
      );
    } else {
      optimizedRoute = originalRoute;
    }

    const distanceSavingsMeters = Math.max(
      0,
      originalRoute.totalDistanceMeters - optimizedRoute.totalDistanceMeters,
    );
    const durationSavingsSeconds = Math.max(
      0,
      originalRoute.totalDurationSeconds - optimizedRoute.totalDurationSeconds,
    );

    const distanceSavingsPercent =
      originalRoute.totalDistanceMeters > 0
        ? Number(((distanceSavingsMeters / originalRoute.totalDistanceMeters) * 100).toFixed(1))
        : 0;
    const durationSavingsPercent =
      originalRoute.totalDurationSeconds > 0
        ? Number(((durationSavingsSeconds / originalRoute.totalDurationSeconds) * 100).toFixed(1))
        : 0;

    return {
      batchId: batch.id,
      batchStatus: batch.status,
      driverId: batch.driverId,
      locationId: batch.locationId,
      hubOrigin,
      stopCount: batch.stops.length,
      applied: false,
      isOptimized: isSequenceChanged,
      provider: optimizationResult.provider,
      roundtrip: isRoundtrip,
      fixedFinalStopId: optimizationResult.fixedFinalStopId,
      previewToken,
      batchUpdatedAt,
      summary: {
        originalDistanceMeters: originalRoute.totalDistanceMeters,
        optimizedDistanceMeters: optimizedRoute.totalDistanceMeters,
        distanceSavingsMeters,
        distanceSavingsPercent,
        originalDurationSeconds: originalRoute.totalDurationSeconds,
        optimizedDurationSeconds: optimizedRoute.totalDurationSeconds,
        durationSavingsSeconds,
        durationSavingsPercent,
      },
      originalStops,
      optimizedStops,
      originalRoute,
      optimizedRoute,
    };
  }

  /**
   * Explicitly applies the optimized sequence to an existing batch in 'planning' status.
   * Restricts route reordering approval to authorized dispatch operators (Admin and assigned Hub Operators).
   * Prevents stale optimization previews from overwriting concurrently modified batches.
   */
  async applyBatchOptimization(
    batchId: string,
    actor: FulfillmentActor,
    dto?: ApplyOptimizationDto,
  ): Promise<BatchOptimizationApplyResult> {
    if (!this.isUuid(batchId)) {
      throw new BadRequestException('Invalid batch ID');
    }

    // Restrict reordering approval to dispatch operators; drivers may not mutate planned routes
    if (
      actor.roles.includes(Role.DRIVER) &&
      !actor.roles.includes(Role.ADMIN) &&
      !actor.roles.includes(Role.HUB_OPERATOR)
    ) {
      throw new ForbiddenException(
        'Drivers are not permitted to approve or apply route reordering. Hub operator or admin dispatch authorization is required.',
      );
    }

    // 1. Calculate the preview (includes authorization, batch existence, and status validation)
    const preview = await this.previewBatchOptimization(batchId, actor, dto);

    // 2. Resolve target sequence updates
    let targetUpdates: Array<{ shipmentId: string; sequence: number }>;

    if (dto?.stops && dto.stops.length > 0) {
      if (dto.stops.length !== preview.optimizedStops.length) {
        throw new BadRequestException(
          `Supplied stop sequence count (${dto.stops.length}) does not match batch stop count (${preview.optimizedStops.length})`,
        );
      }

      const existingShipmentIds = new Set(preview.originalStops.map((s) => s.shipmentId));
      for (const stop of dto.stops) {
        if (!existingShipmentIds.has(stop.shipmentId)) {
          throw new BadRequestException(
            `Shipment ${stop.shipmentId} does not belong to this delivery batch`,
          );
        }
      }

      const uniqueSeqs = new Set(dto.stops.map((s) => s.sequence));
      if (uniqueSeqs.size !== dto.stops.length) {
        throw new BadRequestException('Duplicate sequences provided');
      }

      targetUpdates = dto.stops.map((s) => ({
        shipmentId: s.shipmentId,
        sequence: s.sequence,
      }));
    } else {
      targetUpdates = preview.optimizedStops.map((s) => ({
        shipmentId: s.shipmentId,
        sequence: s.optimizedSequence,
      }));
    }

    // 3. Persist atomically in a transaction with stale preview protection
    await this.prisma.$transaction(async (tx) => {
      const currentBatch = await tx.deliveryBatch.findUnique({
        where: { id: batchId },
        include: { stops: { orderBy: { sequence: 'asc' } } },
      });

      if (!currentBatch) {
        throw new NotFoundException('Delivery batch not found');
      }

      if (currentBatch.status !== 'planning') {
        throw new BadRequestException('Cannot modify a dispatched or completed delivery batch');
      }

      // Check stale preview token if provided
      if (dto?.previewToken) {
        const currentToken = this.generateBatchFingerprint(currentBatch);
        if (currentToken !== dto.previewToken) {
          throw new ConflictException(
            'Delivery batch has been modified since the optimization preview was generated. Please refresh the preview before applying.',
          );
        }
      }

      // Check expectedBatchUpdatedAt if provided
      if (dto?.expectedBatchUpdatedAt) {
        if (currentBatch.updatedAt.toISOString() !== dto.expectedBatchUpdatedAt) {
          throw new ConflictException(
            'Delivery batch was modified concurrently. Please refresh the optimization preview before applying.',
          );
        }
      }

      // Verify that batch stop count and composition haven't changed concurrently
      if (currentBatch.stops.length !== preview.optimizedStops.length) {
        throw new ConflictException(
          'Delivery batch stop count has changed concurrently. Optimization preview is stale.',
        );
      }

      const currentShipmentIds = new Set(currentBatch.stops.map((s) => s.shipmentId));
      for (const update of targetUpdates) {
        if (!currentShipmentIds.has(update.shipmentId)) {
          throw new ConflictException(
            `Shipment ${update.shipmentId} is no longer present in this delivery batch. Optimization preview is stale.`,
          );
        }
      }

      // Phase 1: Set temporary negative sequences to prevent @@unique([batchId, sequence]) violation
      for (const update of targetUpdates) {
        await tx.deliveryStop.updateMany({
          where: { batchId, shipmentId: update.shipmentId },
          data: { sequence: -update.sequence },
        });
      }

      // Phase 2: Set final positive sequences
      for (const update of targetUpdates) {
        await tx.deliveryStop.updateMany({
          where: { batchId, shipmentId: update.shipmentId },
          data: { sequence: update.sequence },
        });
      }
    });

    // 4. Retrieve updated batch with resequenced stops
    const updatedBatch = await this.prisma.deliveryBatch.findUnique({
      where: { id: batchId },
      include: {
        stops: {
          orderBy: { sequence: 'asc' },
          include: {
            shipment: true,
          },
        },
      },
    });

    return {
      success: true,
      applied: true,
      batchId: preview.batchId,
      batchStatus: preview.batchStatus,
      isOptimized: preview.isOptimized,
      provider: preview.provider,
      roundtrip: preview.roundtrip,
      fixedFinalStopId: preview.fixedFinalStopId,
      summary: preview.summary,
      stops: updatedBatch?.stops ?? [],
      optimizedRoute: preview.optimizedRoute,
    };
  }

  private generateBatchFingerprint(batch: {
    id: string;
    status: string;
    updatedAt: Date;
    stops: Array<{ shipmentId: string; sequence: number }>;
  }): string {
    const stopsDigest = batch.stops.map((s) => `${s.shipmentId}:${s.sequence}`).join(',');
    const payload = `${batch.id}|${batch.status}|${batch.updatedAt.getTime()}|${stopsDigest}`;
    return Buffer.from(payload).toString('base64');
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

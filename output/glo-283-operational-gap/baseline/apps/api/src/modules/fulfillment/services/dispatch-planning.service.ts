import {
  Injectable,
  Inject,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { Role, Prisma } from '@prisma/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import { OrderingService } from '../../ordering/public';
import { assertDeliverablePin } from '../../ordering/services/service-area';
import {
  ROUTING_PROVIDER,
  RoutingProvider,
  RouteWaypoint,
} from '../routing/routing.provider';
import {
  ROUTE_OPTIMIZATION_PROVIDER,
  RouteOptimizationProvider,
  MAX_MAPBOX_OPTIMIZATION_STOPS,
} from '../routing/route-optimization.provider';
import { getDeliveryHubCoordinates } from './hub-location';
import { FulfillmentActor } from './fulfillment.service';
import {
  PlanDispatchDto,
  DispatchPlanResult,
  ProposedTrip,
  PlannedTripStop,
  PlannedTripMetrics,
  UnassignedDispatchOrder,
  DispatchPlanningDiagnostics,
  DriverAvailabilityDto,
  ApproveDispatchPlanDto,
  ApproveTripDto,
  ApprovedBatchSummary,
  DispatchPlanApprovalResult,
} from '../dto/dispatch-planning.dto';

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

export function computeDispatchPlanFingerprint(params: {
  hubId: string;
  trips: Array<{
    driverId: string | null;
    tripSequenceForDriver?: number;
    stops: Array<{ shipmentId: string; sequence: number }>;
  }>;
  shipments: Array<{ id: string; status: string; updatedAt: Date | string }>;
}): string {
  const canonicalTrips = [...params.trips]
    .map((t) => ({
      driverId: t.driverId ?? 'unassigned',
      tripSeq: t.tripSequenceForDriver ?? 1,
      stops: [...t.stops]
        .map((s) => ({ shipmentId: s.shipmentId, sequence: s.sequence }))
        .sort((a, b) => a.sequence - b.sequence),
    }))
    .sort((a, b) => {
      const dCmp = a.driverId.localeCompare(b.driverId);
      if (dCmp !== 0) return dCmp;
      return a.tripSeq - b.tripSeq;
    });

  const canonicalShipments = [...params.shipments]
    .map((s) => ({
      id: s.id,
      status: s.status,
      updatedAt: s.updatedAt instanceof Date ? s.updatedAt.toISOString() : String(s.updatedAt),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const payload = JSON.stringify({
    hubId: params.hubId,
    trips: canonicalTrips,
    shipments: canonicalShipments,
  });

  return crypto.createHash('sha256').update(payload).digest('hex');
}

interface CandidateOrder {
  shipmentId: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  address: string;
  latitude: number;
  longitude: number;
  bearing: number;
  distanceFromHubMeters: number;
}

interface DispatchCluster {
  clusterId: string;
  centroidLat: number;
  centroidLng: number;
  orders: CandidateOrder[];
}

@Injectable()
export class DispatchPlanningService {
  constructor(
    @Inject(ROUTE_OPTIMIZATION_PROVIDER)
    private readonly optimizationProvider: RouteOptimizationProvider,
    @Inject(ROUTING_PROVIDER)
    private readonly routingProvider: RoutingProvider,
    private readonly prisma: PrismaService,
    private readonly orderingService: OrderingService,
  ) {}

  /**
   * Generates a preview-only adaptive multi-driver dispatch plan.
   * Performs spatial clustering, dynamic cluster merging/splitting,
   * multi-trip driver scheduling, and stop optimization without mutating the database.
   */
  async planDispatch(dto: PlanDispatchDto, actor: FulfillmentActor): Promise<DispatchPlanResult> {
    this.assertDispatchPermission(actor);

    const warnings: string[] = [];
    let mapboxCallsMade = 0;

    // 1. Resolve Hub Coordinates & Details
    const defaultHub = getDeliveryHubCoordinates();
    let hubLocationId = dto.hubId;
    let hubName = defaultHub.name;
    let hubLatitude = defaultHub.latitude;
    let hubLongitude = defaultHub.longitude;

    if (dto.hubId) {
      if (!this.isUuid(dto.hubId)) {
        throw new BadRequestException('Invalid hub ID');
      }
      const location = await this.prisma.fulfillmentLocation.findUnique({
        where: { id: dto.hubId },
      });
      if (!location) {
        throw new NotFoundException(`Fulfillment location '${dto.hubId}' not found`);
      }
      hubLocationId = location.id;
      hubName = location.name;
    }

    const hubOrigin: RouteWaypoint = {
      id: hubLocationId || 'hub-main',
      name: hubName,
      latitude: hubLatitude,
      longitude: hubLongitude,
    };

    // 2. Query and Filter Candidate Shipments
    const unassignedOrders: UnassignedDispatchOrder[] = [];
    const candidateOrders: CandidateOrder[] = [];

    const maxStopsPerTrip = dto.maxStopsPerTrip ?? 10;
    const maxTripsPerDriver = dto.maxTripsPerDriver ?? 3;
    const serviceMinutesPerStop = dto.serviceMinutesPerStop ?? 5;
    const clusterRadiusKm = dto.clusterRadiusKm ?? 5.0;
    const isRoundtrip = dto.roundtrip !== false; // default true

    let rawShipments: Array<{
      id: string;
      orderId: string;
      locationId: string;
      status: string;
      updatedAt: Date;
      deliveryStops: Array<{ status: string }>;
    }> = [];

    if (dto.shipmentIds && dto.shipmentIds.length > 0) {
      // Deduplicate shipment IDs preserving order
      const uniqueIds = Array.from(new Set(dto.shipmentIds));
      const foundShipments = await this.prisma.shipment.findMany({
        where: { id: { in: uniqueIds } },
        include: { deliveryStops: { where: { status: 'active' } } },
      });

      const foundMap = new Map(foundShipments.map((s) => [s.id, s]));

      for (const id of uniqueIds) {
        const found = foundMap.get(id);
        if (!found) {
          unassignedOrders.push({
            shipmentId: id,
            orderId: 'unknown',
            orderNumber: 'UNKNOWN',
            reasonCode: 'ORDER_NOT_FOUND',
            reasonMessage: `Shipment ID '${id}' was not found in the database`,
          });
        } else {
          rawShipments.push(found);
        }
      }
    } else {
      rawShipments = await this.prisma.shipment.findMany({
        where: {
          ...(hubLocationId ? { locationId: hubLocationId } : {}),
          status: 'packed',
          deliveryStops: { none: { status: 'active' } },
        },
        include: { deliveryStops: { where: { status: 'active' } } },
        orderBy: { createdAt: 'asc' },
      });
    }

    // Inspect orders and validate coordinates
    for (const shipment of rawShipments) {
      if (hubLocationId && shipment.locationId !== hubLocationId) {
        unassignedOrders.push({
          shipmentId: shipment.id,
          orderId: shipment.orderId,
          orderNumber: 'N/A',
          reasonCode: 'INCORRECT_HUB',
          reasonMessage: `Shipment belongs to location '${shipment.locationId}' instead of target hub '${hubLocationId}'`,
        });
        continue;
      }

      if (shipment.status !== 'packed') {
        unassignedOrders.push({
          shipmentId: shipment.id,
          orderId: shipment.orderId,
          orderNumber: 'N/A',
          reasonCode: 'NOT_PACKED',
          reasonMessage: `Shipment status is '${shipment.status}', but only 'packed' shipments are ready for dispatch`,
        });
        continue;
      }

      if (shipment.deliveryStops.length > 0) {
        unassignedOrders.push({
          shipmentId: shipment.id,
          orderId: shipment.orderId,
          orderNumber: 'N/A',
          reasonCode: 'ALREADY_ASSIGNED',
          reasonMessage: 'Shipment is already assigned to an active delivery run',
        });
        continue;
      }

      const order = await this.orderingService.getOrder(shipment.orderId);
      if (!order) {
        unassignedOrders.push({
          shipmentId: shipment.id,
          orderId: shipment.orderId,
          orderNumber: 'N/A',
          reasonCode: 'ORDER_NOT_FOUND',
          reasonMessage: `Associated order '${shipment.orderId}' was not found`,
        });
        continue;
      }

      if (
        order.latitude === null ||
        order.latitude === undefined ||
        order.longitude === null ||
        order.longitude === undefined
      ) {
        unassignedOrders.push({
          shipmentId: shipment.id,
          orderId: order.id,
          orderNumber: order.orderNumber,
          customerName: order.customerName,
          reasonCode: 'MISSING_COORDINATES',
          reasonMessage: 'Order lacks confirmed delivery GPS coordinates',
        });
        continue;
      }

      try {
        assertDeliverablePin({ latitude: order.latitude, longitude: order.longitude });
      } catch (err: any) {
        unassignedOrders.push({
          shipmentId: shipment.id,
          orderId: order.id,
          orderNumber: order.orderNumber,
          customerName: order.customerName,
          reasonCode: 'OUT_OF_SERVICE_AREA',
          reasonMessage: `Delivery coordinates are outside Cairo/Giza service area: ${err.message}`,
        });
        continue;
      }

      const address = [order.shippingAddress, order.area, order.governorate]
        .filter(Boolean)
        .join(', ');

      const bearing = this.calculateBearing(
        hubLatitude,
        hubLongitude,
        order.latitude,
        order.longitude,
      );

      const distanceFromHub = this.haversineDistance(
        hubLatitude,
        hubLongitude,
        order.latitude,
        order.longitude,
      );

      candidateOrders.push({
        shipmentId: shipment.id,
        orderId: order.id,
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        address,
        latitude: order.latitude,
        longitude: order.longitude,
        bearing,
        distanceFromHubMeters: distanceFromHub,
      });
    }

    // 3. Resolve Available Drivers
    let availableDrivers: DriverAvailabilityDto[] = [];
    if (dto.drivers && dto.drivers.length > 0) {
      availableDrivers = dto.drivers;
    } else {
      const dbDrivers = await this.prisma.customer.findMany({
        where: { roles: { has: Role.DRIVER } },
        select: { id: true, name: true },
      });
      availableDrivers = dbDrivers.map((d) => ({
        id: d.id,
        name: d.name,
        maxTrips: maxTripsPerDriver,
      }));
    }

    // If 0 drivers available, all candidates become unassigned
    if (availableDrivers.length === 0) {
      for (const order of candidateOrders) {
        unassignedOrders.push({
          shipmentId: order.shipmentId,
          orderId: order.orderId,
          orderNumber: order.orderNumber,
          customerName: order.customerName,
          reasonCode: 'INSUFFICIENT_DRIVERS',
          reasonMessage: 'No delivery drivers are available for dispatch assignment',
        });
      }

      return {
        hubId: hubLocationId || 'hub-main',
        hubName,
        hubCoordinates: { latitude: hubLatitude, longitude: hubLongitude },
        plannedAt: new Date().toISOString(),
        planFingerprint: computeDispatchPlanFingerprint({
          hubId: hubLocationId || 'hub-main',
          trips: [],
          shipments: [],
        }),
        trips: [],
        unassignedOrders,
        diagnostics: {
          totalCandidateOrders: rawShipments.length,
          eligibleOrders: candidateOrders.length,
          assignedOrders: 0,
          unassignedOrdersCount: unassignedOrders.length,
          availableDriverCount: 0,
          tripsGenerated: 0,
          clusteringMethod: 'none',
          mapboxCallsMade: 0,
          warnings: ['No available drivers provided or found; 0 trips planned.'],
        },
      };
    }

    // 4. Deterministic Geographic Clustering & Balancing
    const clusters = this.clusterAndBalanceOrders(
      candidateOrders,
      clusterRadiusKm,
      maxStopsPerTrip,
    );

    // 5. Driver Assignment: Multi-Driver & Sequential Trips
    const { assignedTrips, unassignedClusterOrders } = this.assignClustersToDrivers(
      clusters,
      availableDrivers,
      maxTripsPerDriver,
    );

    unassignedOrders.push(...unassignedClusterOrders);

    // 6. Stop Optimization and Metric Calculation per Trip
    const proposedTrips: ProposedTrip[] = [];

    for (let i = 0; i < assignedTrips.length; i++) {
      const rawTrip = assignedTrips[i];
      const tripId = `trip-${i + 1}`;

      const { orderedStops, metrics, geometry } = await this.optimizeAndEvaluateTrip(
        tripId,
        hubOrigin,
        rawTrip.orders,
        rawTrip.driverId,
        rawTrip.driverName,
        rawTrip.tripSequence,
        dto.useRoadOptimization === true,
        isRoundtrip,
        serviceMinutesPerStop,
        warnings,
      );

      if (metrics.isRoadBased) {
        mapboxCallsMade++;
      }

      proposedTrips.push({
        tripId,
        clusterId: rawTrip.clusterId,
        driverId: rawTrip.driverId,
        driverName: rawTrip.driverName,
        tripSequenceForDriver: rawTrip.tripSequence,
        stops: orderedStops,
        metrics,
        routeGeometry: geometry,
      });
    }

    const assignedOrdersCount = proposedTrips.reduce((sum, t) => sum + t.stops.length, 0);

    const assignedShipmentIds = new Set(
      proposedTrips.flatMap((t) => t.stops.map((s) => s.shipmentId)),
    );
    const assignedShipmentStates = rawShipments
      .filter((s) => assignedShipmentIds.has(s.id))
      .map((s) => ({
        id: s.id,
        status: s.status,
        updatedAt: s.updatedAt,
      }));

    const planFingerprint = computeDispatchPlanFingerprint({
      hubId: hubLocationId || 'hub-main',
      trips: proposedTrips,
      shipments: assignedShipmentStates,
    });

    return {
      hubId: hubLocationId || 'hub-main',
      hubName,
      hubCoordinates: { latitude: hubLatitude, longitude: hubLongitude },
      plannedAt: new Date().toISOString(),
      planFingerprint,
      trips: proposedTrips,
      unassignedOrders,
      diagnostics: {
        totalCandidateOrders: rawShipments.length,
        eligibleOrders: candidateOrders.length,
        assignedOrders: assignedOrdersCount,
        unassignedOrdersCount: unassignedOrders.length,
        availableDriverCount: availableDrivers.length,
        tripsGenerated: proposedTrips.length,
        clusteringMethod: 'sweep_agglomerative_balance',
        mapboxCallsMade,
        warnings,
      },
    };
  }

  /**
   * Deterministic spatial clustering algorithm:
   * 1. Polar sweep ordering relative to Hub
   * 2. Distance-based agglomeration
   * 3. Adaptive split for clusters > maxStopsPerTrip
   * 4. Adaptive merge for underfilled adjacent clusters
   * 5. Boundary rebalance for route efficiency
   */
  private clusterAndBalanceOrders(
    orders: CandidateOrder[],
    clusterRadiusKm: number,
    maxStopsPerTrip: number,
  ): DispatchCluster[] {
    if (orders.length === 0) return [];

    // Deterministic sort: bearing ascending, distance ascending, shipmentId lexicographical
    const sorted = [...orders].sort((a, b) => {
      if (Math.abs(a.bearing - b.bearing) > 0.001) {
        return a.bearing - b.bearing;
      }
      if (Math.abs(a.distanceFromHubMeters - b.distanceFromHubMeters) > 10) {
        return a.distanceFromHubMeters - b.distanceFromHubMeters;
      }
      return a.shipmentId.localeCompare(b.shipmentId);
    });

    const maxRadiusMeters = clusterRadiusKm * 1000;
    const initialClusters: DispatchCluster[] = [];
    let currentClusterOrders: CandidateOrder[] = [];

    for (const order of sorted) {
      if (currentClusterOrders.length === 0) {
        currentClusterOrders.push(order);
      } else {
        const centroid = this.calculateCentroid(currentClusterOrders);
        const distToCentroid = this.haversineDistance(
          centroid.lat,
          centroid.lng,
          order.latitude,
          order.longitude,
        );

        if (
          distToCentroid <= maxRadiusMeters &&
          currentClusterOrders.length < maxStopsPerTrip
        ) {
          currentClusterOrders.push(order);
        } else {
          const centroidNow = this.calculateCentroid(currentClusterOrders);
          initialClusters.push({
            clusterId: `c-${initialClusters.length + 1}`,
            centroidLat: centroidNow.lat,
            centroidLng: centroidNow.lng,
            orders: currentClusterOrders,
          });
          currentClusterOrders = [order];
        }
      }
    }

    if (currentClusterOrders.length > 0) {
      const centroidNow = this.calculateCentroid(currentClusterOrders);
      initialClusters.push({
        clusterId: `c-${initialClusters.length + 1}`,
        centroidLat: centroidNow.lat,
        centroidLng: centroidNow.lng,
        orders: currentClusterOrders,
      });
    }

    // Dynamic Merge Phase: Merge tiny adjacent clusters under capacity limit
    const mergedClusters: DispatchCluster[] = [];
    let skipIndices = new Set<number>();

    for (let i = 0; i < initialClusters.length; i++) {
      if (skipIndices.has(i)) continue;

      let base = initialClusters[i];

      for (let j = i + 1; j < initialClusters.length; j++) {
        if (skipIndices.has(j)) continue;

        const candidate = initialClusters[j];
        const combinedCount = base.orders.length + candidate.orders.length;

        if (combinedCount <= maxStopsPerTrip) {
          const distBetweenCentroids = this.haversineDistance(
            base.centroidLat,
            base.centroidLng,
            candidate.centroidLat,
            candidate.centroidLng,
          );

          if (distBetweenCentroids <= maxRadiusMeters * 1.5) {
            const combinedOrders = [...base.orders, ...candidate.orders];
            const newCentroid = this.calculateCentroid(combinedOrders);
            base = {
              clusterId: base.clusterId,
              centroidLat: newCentroid.lat,
              centroidLng: newCentroid.lng,
              orders: combinedOrders,
            };
            skipIndices.add(j);
          }
        }
      }

      mergedClusters.push(base);
    }

    // Dynamic Split Phase: Ensure strict adherence to maxStopsPerTrip
    const finalClusters: DispatchCluster[] = [];
    for (const cluster of mergedClusters) {
      if (cluster.orders.length <= maxStopsPerTrip) {
        finalClusters.push(cluster);
      } else {
        // Split along order bearing
        const sortedInCluster = [...cluster.orders].sort((a, b) => a.bearing - b.bearing);
        for (let i = 0; i < sortedInCluster.length; i += maxStopsPerTrip) {
          const chunk = sortedInCluster.slice(i, i + maxStopsPerTrip);
          const c = this.calculateCentroid(chunk);
          finalClusters.push({
            clusterId: `${cluster.clusterId}-s${Math.floor(i / maxStopsPerTrip) + 1}`,
            centroidLat: c.lat,
            centroidLng: c.lng,
            orders: chunk,
          });
        }
      }
    }

    // Boundary Rebalance: Relocate borderline stops to adjacent cluster if closer to its centroid
    if (finalClusters.length > 1) {
      for (let cIdx = 0; cIdx < finalClusters.length; cIdx++) {
        const cluster = finalClusters[cIdx];
        if (cluster.orders.length <= 1) continue;

        for (let oIdx = cluster.orders.length - 1; oIdx >= 0; oIdx--) {
          const order = cluster.orders[oIdx];
          const distToOwnCentroid = this.haversineDistance(
            cluster.centroidLat,
            cluster.centroidLng,
            order.latitude,
            order.longitude,
          );

          for (let otherIdx = 0; otherIdx < finalClusters.length; otherIdx++) {
            if (otherIdx === cIdx) continue;
            const otherCluster = finalClusters[otherIdx];

            if (otherCluster.orders.length < maxStopsPerTrip) {
              const distToOtherCentroid = this.haversineDistance(
                otherCluster.centroidLat,
                otherCluster.centroidLng,
                order.latitude,
                order.longitude,
              );

              // Relocate if significantly closer (at least 20% closer)
              if (distToOtherCentroid < distToOwnCentroid * 0.8) {
                cluster.orders.splice(oIdx, 1);
                otherCluster.orders.push(order);
                const newOwn = this.calculateCentroid(cluster.orders);
                cluster.centroidLat = newOwn.lat;
                cluster.centroidLng = newOwn.lng;
                const newOther = this.calculateCentroid(otherCluster.orders);
                otherCluster.centroidLat = newOther.lat;
                otherCluster.centroidLng = newOther.lng;
                break;
              }
            }
          }
        }
      }
    }

    return finalClusters.filter((c) => c.orders.length > 0);
  }

  /**
   * Assigns geographic clusters to available drivers.
   * Supports:
   * - 1 driver handling multiple sequential trips (Trip 1, Trip 2, ...)
   * - Multiple drivers handling geographically balanced clusters
   * - Never assumes clusters == drivers
   * - Drops excess clusters to unassignedOrders with EXCEEDS_DRIVER_SHIFT_CAPACITY
   */
  private assignClustersToDrivers(
    clusters: DispatchCluster[],
    drivers: DriverAvailabilityDto[],
    defaultMaxTripsPerDriver: number,
  ): {
    assignedTrips: Array<{
      clusterId: string;
      driverId: string;
      driverName: string | null;
      tripSequence: number;
      orders: CandidateOrder[];
    }>;
    unassignedClusterOrders: UnassignedDispatchOrder[];
  } {
    const assignedTrips: Array<{
      clusterId: string;
      driverId: string;
      driverName: string | null;
      tripSequence: number;
      orders: CandidateOrder[];
    }> = [];
    const unassignedClusterOrders: UnassignedDispatchOrder[] = [];

    // Track capacity utilization per driver
    const driverState = drivers.map((d) => ({
      id: d.id,
      name: d.name || null,
      maxTrips: d.maxTrips ?? defaultMaxTripsPerDriver,
      maxStops: d.maxStops ?? Infinity,
      currentTrips: 0,
      currentStops: 0,
      lastAssignedCentroid: null as { lat: number; lng: number } | null,
    }));

    // Sort clusters by bearing around Hub for coherent spatial dispatch
    const sortedClusters = [...clusters].sort((a, b) => {
      const bearingA = this.calculateBearing(0, 0, a.centroidLat, a.centroidLng);
      const bearingB = this.calculateBearing(0, 0, b.centroidLat, b.centroidLng);
      return bearingA - bearingB;
    });

    for (const cluster of sortedClusters) {
      // Find best available driver who has capacity
      let bestDriverIdx = -1;
      let minDistance = Infinity;

      for (let i = 0; i < driverState.length; i++) {
        const state = driverState[i];

        if (state.currentTrips >= state.maxTrips) continue;
        if (state.currentStops + cluster.orders.length > state.maxStops) continue;

        // If driver already has a trip, prefer cluster nearest to their previous territory
        let distanceMetric = 0;
        if (state.lastAssignedCentroid) {
          distanceMetric = this.haversineDistance(
            state.lastAssignedCentroid.lat,
            state.lastAssignedCentroid.lng,
            cluster.centroidLat,
            cluster.centroidLng,
          );
        } else {
          // New driver: prefer driver with least assigned trips for balance
          distanceMetric = state.currentTrips * 10000;
        }

        if (distanceMetric < minDistance) {
          minDistance = distanceMetric;
          bestDriverIdx = i;
        }
      }

      if (bestDriverIdx !== -1) {
        const driver = driverState[bestDriverIdx];
        driver.currentTrips++;
        driver.currentStops += cluster.orders.length;
        driver.lastAssignedCentroid = { lat: cluster.centroidLat, lng: cluster.centroidLng };

        assignedTrips.push({
          clusterId: cluster.clusterId,
          driverId: driver.id,
          driverName: driver.name,
          tripSequence: driver.currentTrips,
          orders: cluster.orders,
        });
      } else {
        // Driver shift capacity exceeded
        for (const order of cluster.orders) {
          unassignedClusterOrders.push({
            shipmentId: order.shipmentId,
            orderId: order.orderId,
            orderNumber: order.orderNumber,
            customerName: order.customerName,
            reasonCode: 'EXCEEDS_DRIVER_SHIFT_CAPACITY',
            reasonMessage: `Cluster '${cluster.clusterId}' exceeds available driver shift/trip limits`,
          });
        }
      }
    }

    return { assignedTrips, unassignedClusterOrders };
  }

  /**
   * Optimizes stop sequence within a trip and evaluates driving + service duration metrics.
   * If stops <= 11 and road-based optimization is requested, calls RouteOptimizationProvider.
   * For larger batches (> 11 stops) or when road optimization is disabled, applies a fast,
   * deterministic local Nearest-Neighbor + 2-Opt TSP heuristic.
   */
  private async optimizeAndEvaluateTrip(
    tripId: string,
    hubOrigin: RouteWaypoint,
    orders: CandidateOrder[],
    driverId: string,
    driverName: string | null,
    tripSequence: number,
    useRoadOptimization: boolean,
    isRoundtrip: boolean,
    serviceMinutesPerStop: number,
    warnings: string[],
  ): Promise<{
    orderedStops: PlannedTripStop[];
    metrics: PlannedTripMetrics;
    geometry?: any;
  }> {
    if (orders.length === 1) {
      const singleOrder = orders[0];
      const directDist = singleOrder.distanceFromHubMeters;
      // Roundtrip distance: to stop and back
      const drivingDistanceMeters = isRoundtrip ? Math.round(directDist * 2 * 1.35) : Math.round(directDist * 1.35);
      const drivingSeconds = Math.round((drivingDistanceMeters / 6.94)); // ~25 km/h urban speed
      const serviceSeconds = serviceMinutesPerStop * 60;

      const stop: PlannedTripStop = {
        shipmentId: singleOrder.shipmentId,
        orderId: singleOrder.orderId,
        orderNumber: singleOrder.orderNumber,
        customerName: singleOrder.customerName,
        address: singleOrder.address,
        latitude: singleOrder.latitude,
        longitude: singleOrder.longitude,
        sequence: 1,
        estimatedArrivalMinutes: Math.round(drivingSeconds / 60 / (isRoundtrip ? 2 : 1)),
      };

      return {
        orderedStops: [stop],
        metrics: {
          stopCount: 1,
          estimatedDistanceMeters: drivingDistanceMeters,
          estimatedDrivingSeconds: drivingSeconds,
          serviceDurationSeconds: serviceSeconds,
          totalEstimatedDurationSeconds: drivingSeconds + serviceSeconds,
          isRoadBased: false,
          optimizationMethod: 'trivial_single_stop',
        },
      };
    }

    let sequencedOrders: CandidateOrder[];
    let optimizationMethod: 'mapbox_v1' | 'local_2opt' = 'local_2opt';
    let isRoadBased = false;
    let roadGeometry: any = undefined;
    let distanceMeters = 0;
    let drivingSeconds = 0;

    // Road optimization attempt when <= 11 stops and enabled
    if (useRoadOptimization && orders.length <= MAX_MAPBOX_OPTIMIZATION_STOPS) {
      try {
        const waypoints: RouteWaypoint[] = orders.map((o) => ({
          id: o.shipmentId,
          name: o.customerName,
          address: o.address,
          latitude: o.latitude,
          longitude: o.longitude,
        }));

        const result = await this.optimizationProvider.optimizeRoute(hubOrigin, waypoints, {
          roundtrip: isRoundtrip,
        });

        sequencedOrders = result.optimizedStops.map((s) => orders[s.originalIndex]);
        optimizationMethod = 'mapbox_v1';
        isRoadBased = true;
        distanceMeters = result.distanceMeters ?? 0;
        drivingSeconds = result.durationSeconds ?? 0;
        roadGeometry = result.geometry;
      } catch (err: any) {
        warnings.push(
          `Mapbox optimization failed for trip '${tripId}' (${err.message}); smoothly fell back to local 2-Opt heuristic.`,
        );
        sequencedOrders = this.nearestNeighbor2Opt(hubOrigin, orders, isRoundtrip);
        optimizationMethod = 'local_2opt';
      }
    } else {
      // Local Nearest-Neighbor + 2-Opt TSP heuristic (handles any number of stops, e.g. 15-25 stops)
      sequencedOrders = this.nearestNeighbor2Opt(hubOrigin, orders, isRoundtrip);
      optimizationMethod = 'local_2opt';
    }

    // If approximate metrics needed (when not road-based)
    if (!isRoadBased || distanceMeters === 0) {
      let approxDist = 0;
      let prevLat = hubOrigin.latitude;
      let prevLng = hubOrigin.longitude;

      for (const order of sequencedOrders) {
        approxDist += this.haversineDistance(prevLat, prevLng, order.latitude, order.longitude);
        prevLat = order.latitude;
        prevLng = order.longitude;
      }

      if (isRoundtrip) {
        approxDist += this.haversineDistance(prevLat, prevLng, hubOrigin.latitude, hubOrigin.longitude);
      }

      // Urban circuity factor of 1.35
      distanceMeters = Math.round(approxDist * 1.35);
      drivingSeconds = Math.round(distanceMeters / 6.94); // ~25 km/h urban speed
    }

    const serviceDurationSeconds = sequencedOrders.length * serviceMinutesPerStop * 60;
    const totalEstimatedDurationSeconds = drivingSeconds + serviceDurationSeconds;

    // Cumulative arrival minutes per stop
    let cumulativeSeconds = 0;
    let prevLat = hubOrigin.latitude;
    let prevLng = hubOrigin.longitude;
    const legDurationFactor = drivingSeconds / Math.max(1, distanceMeters);

    const orderedStops: PlannedTripStop[] = sequencedOrders.map((order, idx) => {
      const legDist = Math.round(
        this.haversineDistance(prevLat, prevLng, order.latitude, order.longitude) * 1.35,
      );
      const legSeconds = Math.round(legDist * legDurationFactor);
      cumulativeSeconds += legSeconds;
      const arrivalMin = Math.round(cumulativeSeconds / 60);

      // Add service time after arriving
      cumulativeSeconds += serviceMinutesPerStop * 60;
      prevLat = order.latitude;
      prevLng = order.longitude;

      return {
        shipmentId: order.shipmentId,
        orderId: order.orderId,
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        address: order.address,
        latitude: order.latitude,
        longitude: order.longitude,
        sequence: idx + 1,
        estimatedArrivalMinutes: arrivalMin,
      };
    });

    return {
      orderedStops,
      metrics: {
        stopCount: orderedStops.length,
        estimatedDistanceMeters: distanceMeters,
        estimatedDrivingSeconds: drivingSeconds,
        serviceDurationSeconds,
        totalEstimatedDurationSeconds,
        isRoadBased,
        optimizationMethod,
      },
      geometry: roadGeometry,
    };
  }

  /**
   * Deterministic Local Nearest Neighbor + 2-Opt TSP Heuristic.
   * Runs in O(V^2), operates entirely in memory, handles batches > 11 stops without loss.
   */
  private nearestNeighbor2Opt(
    hubOrigin: RouteWaypoint,
    orders: CandidateOrder[],
    isRoundtrip: boolean,
  ): CandidateOrder[] {
    if (orders.length <= 1) return [...orders];

    // 1. Nearest Neighbor Tour Construction
    const unvisited = [...orders];
    const tour: CandidateOrder[] = [];
    let currentLat = hubOrigin.latitude;
    let currentLng = hubOrigin.longitude;

    while (unvisited.length > 0) {
      let nearestIdx = 0;
      let minDistance = Infinity;

      for (let i = 0; i < unvisited.length; i++) {
        const d = this.haversineDistance(currentLat, currentLng, unvisited[i].latitude, unvisited[i].longitude);
        if (d < minDistance) {
          minDistance = d;
          nearestIdx = i;
        } else if (Math.abs(d - minDistance) < 0.1) {
          // Tie-break by shipmentId for 100% determinism
          if (unvisited[i].shipmentId.localeCompare(unvisited[nearestIdx].shipmentId) < 0) {
            nearestIdx = i;
          }
        }
      }

      const next = unvisited.splice(nearestIdx, 1)[0];
      tour.push(next);
      currentLat = next.latitude;
      currentLng = next.longitude;
    }

    // 2. 2-Opt Iterative Improvement
    let improved = true;
    let iterations = 0;
    const maxIterations = 50;

    const computeTourCost = (candidateTour: CandidateOrder[]): number => {
      let cost = this.haversineDistance(hubOrigin.latitude, hubOrigin.longitude, candidateTour[0].latitude, candidateTour[0].longitude);
      for (let i = 0; i < candidateTour.length - 1; i++) {
        cost += this.haversineDistance(candidateTour[i].latitude, candidateTour[i].longitude, candidateTour[i + 1].latitude, candidateTour[i + 1].longitude);
      }
      if (isRoundtrip) {
        cost += this.haversineDistance(candidateTour[candidateTour.length - 1].latitude, candidateTour[candidateTour.length - 1].longitude, hubOrigin.latitude, hubOrigin.longitude);
      }
      return cost;
    };

    while (improved && iterations < maxIterations) {
      improved = false;
      iterations++;

      for (let i = 0; i < tour.length - 1; i++) {
        for (let j = i + 1; j < tour.length; j++) {
          const currentCost = computeTourCost(tour);
          // Reverse subpath i to j
          const reversedSubpath = tour.slice(i, j + 1).reverse();
          const candidateTour = [...tour.slice(0, i), ...reversedSubpath, ...tour.slice(j + 1)];
          const newCost = computeTourCost(candidateTour);

          if (newCost < currentCost - 1.0) {
            tour.splice(i, j - i + 1, ...reversedSubpath);
            improved = true;
            break;
          }
        }
        if (improved) break;
      }
    }

    return tour;
  }

  // --- Geometry & Spatial Helpers ---

  private haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000;
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c);
  }

  private calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
    const x =
      Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
      Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
    const brng = (Math.atan2(y, x) * 180) / Math.PI;
    return (brng + 360) % 360;
  }

  private calculateCentroid(orders: CandidateOrder[]): { lat: number; lng: number } {
    if (orders.length === 0) return { lat: 0, lng: 0 };
    const sumLat = orders.reduce((sum, o) => sum + o.latitude, 0);
    const sumLng = orders.reduce((sum, o) => sum + o.longitude, 0);
    return {
      lat: sumLat / orders.length,
      lng: sumLng / orders.length,
    };
  }

  private assertDispatchPermission(actor: FulfillmentActor) {
    if (actor.roles.includes(Role.ADMIN) || actor.roles.includes(Role.HUB_OPERATOR)) {
      return;
    }
    throw new ForbiddenException(
      'Dispatch planning is restricted to administrators and authorized hub operators',
    );
  }

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  }

  /**
   * Authoritatively approves and persists a dispatch plan preview into real DeliveryBatch
   * and DeliveryStop records.
   *
   * Enforces:
   * 1. Dispatch operator authorization (Admin or assigned Hub Operator)
   * 2. Server-verifiable cryptographic plan fingerprint (stale preview rejection with HTTP 409)
   * 3. Driver eligibility and active DRIVER role verification
   * 4. Multi-trip driver support and atomic batch/stop creation
   * 5. Idempotent retries without duplicate batch creation
   * 6. Audit logging via ShipmentEvent
   * 7. Preservation of shipment 'packed' status (never falsely marked as dispatched)
   */
  async approveDispatchPlan(
    dto: ApproveDispatchPlanDto,
    actor: FulfillmentActor,
  ): Promise<DispatchPlanApprovalResult> {
    this.assertDispatchPermission(actor);

    if (!dto.planFingerprint || typeof dto.planFingerprint !== 'string') {
      throw new BadRequestException('planFingerprint is required');
    }

    if (!dto.trips || !Array.isArray(dto.trips) || dto.trips.length === 0) {
      throw new BadRequestException('Dispatch plan must contain at least one trip');
    }

    const defaultHub = getDeliveryHubCoordinates();
    let hubLocationId: string | null = null;
    let hubName = defaultHub.name;
    const targetHubId = dto.hubId || 'hub-main';

    if (dto.hubId) {
      if (!this.isUuid(dto.hubId)) {
        throw new BadRequestException('Invalid hub ID');
      }
      const location = await this.prisma.fulfillmentLocation.findUnique({
        where: { id: dto.hubId },
      });
      if (!location) {
        throw new NotFoundException(`Fulfillment location '${dto.hubId}' not found`);
      }
      hubLocationId = location.id;
      hubName = location.name;

      // Object-level location access for HUB_OPERATOR
      if (!actor.roles.includes(Role.ADMIN) && actor.roles.includes(Role.HUB_OPERATOR)) {
        const isAssigned = await this.prisma.fulfillmentLocationOperator.findUnique({
          where: {
            locationId_operatorId: {
              locationId: hubLocationId,
              operatorId: actor.id,
            },
          },
        });
        if (!isAssigned) {
          throw new ForbiddenException(
            `Operator is not assigned to fulfillment location '${hubLocationId}'`,
          );
        }
      }
    } else {
      const defaultLocation = await this.prisma.fulfillmentLocation.findFirst({
        where: { isActive: true },
      });
      if (defaultLocation) {
        hubLocationId = defaultLocation.id;
        hubName = defaultLocation.name;
      }
    }

    // 1. Validate Trips & Stops Structure
    const allShipmentIds: string[] = [];
    const seenShipmentIds = new Set<string>();

    for (let tIdx = 0; tIdx < dto.trips.length; tIdx++) {
      const trip = dto.trips[tIdx];
      if (!trip.driverId) {
        throw new BadRequestException(`Trip at index ${tIdx} is missing driverId`);
      }
      if (!trip.stops || trip.stops.length === 0) {
        throw new BadRequestException(
          `Trip for driver '${trip.driverId}' must contain at least one stop`,
        );
      }

      const seenSequences = new Set<number>();
      for (const stop of trip.stops) {
        if (!this.isUuid(stop.shipmentId)) {
          throw new BadRequestException(`Invalid shipment ID format '${stop.shipmentId}'`);
        }
        if (seenShipmentIds.has(stop.shipmentId)) {
          throw new BadRequestException(
            `Duplicate shipment assignment: '${stop.shipmentId}' appears more than once across trips`,
          );
        }
        seenShipmentIds.add(stop.shipmentId);
        allShipmentIds.push(stop.shipmentId);

        if (stop.sequence < 1 || seenSequences.has(stop.sequence)) {
          throw new BadRequestException(
            `Trip for driver '${trip.driverId}' has duplicate or invalid stop sequence ${stop.sequence}`,
          );
        }
        seenSequences.add(stop.sequence);
      }
    }

    // 2. Validate Driver Eligibility
    const uniqueDriverIds = Array.from(new Set(dto.trips.map((t) => t.driverId)));
    for (const dId of uniqueDriverIds) {
      if (!this.isUuid(dId)) {
        throw new BadRequestException(`Invalid driver ID format: '${dId}'`);
      }
    }

    const drivers = await this.prisma.customer.findMany({
      where: { id: { in: uniqueDriverIds } },
      select: { id: true, name: true, roles: true },
    });
    const driverMap = new Map(drivers.map((d) => [d.id, d]));

    for (const dId of uniqueDriverIds) {
      const driver = driverMap.get(dId);
      if (!driver) {
        throw new BadRequestException(`Driver account '${dId}' not found`);
      }
      if (!driver.roles.includes(Role.DRIVER)) {
        throw new BadRequestException(
          `Account '${dId}' is not eligible for dispatch or lacks DRIVER role`,
        );
      }
    }

    // 3. Load Shipments & Check Idempotent Retry
    const shipments = await this.prisma.shipment.findMany({
      where: { id: { in: allShipmentIds } },
      include: {
        deliveryStops: {
          where: { status: 'active' },
          include: { batch: true },
        },
      },
    });

    if (shipments.length !== allShipmentIds.length) {
      const foundIds = new Set(shipments.map((s) => s.id));
      const missing = allShipmentIds.filter((id) => !foundIds.has(id));
      throw new NotFoundException(`Shipments not found: ${missing.join(', ')}`);
    }

    // Check for idempotent retry
    const allHaveActiveStops = shipments.every((s) => s.deliveryStops.length > 0);
    if (allHaveActiveStops) {
      const isIdempotentMatch = this.checkIdempotentTripsMatch(dto.trips, shipments);
      if (isIdempotentMatch) {
        const existingBatchesSummary = this.buildExistingBatchesSummary(
          dto.trips,
          shipments,
          driverMap,
        );
        return {
          success: true,
          idempotentRetry: true,
          hubId: targetHubId,
          hubName,
          planFingerprint: dto.planFingerprint,
          batches: existingBatchesSummary,
          totalBatchesCreated: existingBatchesSummary.length,
          totalStopsCreated: existingBatchesSummary.reduce((sum, b) => sum + b.stopCount, 0),
          rejectedAssignments: [],
          approvedAt: new Date().toISOString(),
        };
      }
    }

    // 4. Verify Shipment Eligibility & Stale Plan Fingerprint
    for (const s of shipments) {
      if (hubLocationId && s.locationId && s.locationId !== hubLocationId) {
        throw new BadRequestException(
          `Shipment '${s.id}' belongs to location '${s.locationId}', not target hub '${hubLocationId}'`,
        );
      }
      if (s.status !== 'packed') {
        throw new ConflictException(
          `Shipment '${s.id}' is in status '${s.status}', but only 'packed' shipments can be approved for dispatch`,
        );
      }
      if (s.deliveryStops.length > 0) {
        throw new ConflictException(
          `Shipment '${s.id}' is already assigned to an active delivery run`,
        );
      }
    }

    const expectedFingerprint = computeDispatchPlanFingerprint({
      hubId: targetHubId,
      trips: dto.trips,
      shipments: shipments.map((s) => ({
        id: s.id,
        status: s.status,
        updatedAt: s.updatedAt,
      })),
    });

    if (expectedFingerprint !== dto.planFingerprint) {
      throw new ConflictException(
        'Dispatch plan fingerprint mismatch or underlying shipment states have changed concurrently. Please refresh the dispatch plan preview before approving.',
      );
    }

    // 5. Atomic Batch and Stop Creation in Transaction
    try {
      const createdBatches = await this.prisma.$transaction(async (tx) => {
        const batches: ApprovedBatchSummary[] = [];

        for (const trip of dto.trips) {
          const driver = driverMap.get(trip.driverId);
          const batchId = crypto.randomUUID();

          const batch = await tx.deliveryBatch.create({
            data: {
              id: batchId,
              status: 'planning',
              locationId: hubLocationId,
              driverId: trip.driverId,
              plannedAt: new Date(),
            },
          });

          const stops: Array<{ stopId: string; shipmentId: string; sequence: number }> = [];

          for (const stop of trip.stops) {
            const stopId = crypto.randomUUID();
            await tx.deliveryStop.create({
              data: {
                id: stopId,
                batchId: batch.id,
                shipmentId: stop.shipmentId,
                sequence: stop.sequence,
                status: 'active',
              },
            });

            stops.push({
              stopId,
              shipmentId: stop.shipmentId,
              sequence: stop.sequence,
            });

            // Audit event for traceability
            await tx.shipmentEvent.create({
              data: {
                id: crypto.randomUUID(),
                shipmentId: stop.shipmentId,
                type: 'BATCH_ASSIGNED',
                actorId: actor.id,
                notes: `Assigned to delivery batch ${batch.id} at stop sequence ${stop.sequence} (driver: ${driver?.name || trip.driverId})`,
              },
            });
          }

          batches.push({
            batchId: batch.id,
            driverId: trip.driverId,
            driverName: driver?.name ?? null,
            status: 'planning',
            stopCount: stops.length,
            stops,
          });
        }

        return batches;
      });

      return {
        success: true,
        idempotentRetry: false,
        hubId: targetHubId,
        hubName,
        planFingerprint: dto.planFingerprint,
        batches: createdBatches,
        totalBatchesCreated: createdBatches.length,
        totalStopsCreated: createdBatches.reduce((sum, b) => sum + b.stopCount, 0),
        rejectedAssignments: [],
        approvedAt: new Date().toISOString(),
      };
    } catch (error: any) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          'Concurrent dispatch approval conflict: one or more shipments were already assigned or duplicate stop sequence detected',
        );
      }
      throw error;
    }
  }

  private checkIdempotentTripsMatch(
    trips: ApproveTripDto[],
    shipments: Array<{
      id: string;
      locationId: string;
      deliveryStops: Array<{
        id: string;
        batchId: string;
        sequence: number;
        status: string;
        batch: { id: string; status: string; driverId: string | null; locationId: string | null };
      }>;
    }>,
  ): boolean {
    const shipmentMap = new Map(shipments.map((s) => [s.id, s]));

    for (const trip of trips) {
      if (!trip.stops || trip.stops.length === 0) return false;

      const firstShipment = shipmentMap.get(trip.stops[0].shipmentId);
      const firstActiveStop = firstShipment?.deliveryStops.find((st) => st.status === 'active');
      if (!firstActiveStop) return false;

      const batch = firstActiveStop.batch;
      if (!batch || batch.status !== 'planning' || batch.driverId !== trip.driverId) {
        return false;
      }

      const batchId = batch.id;

      for (const stop of trip.stops) {
        const sh = shipmentMap.get(stop.shipmentId);
        if (!sh) return false;
        const activeStop = sh.deliveryStops.find((st) => st.status === 'active');
        if (!activeStop) return false;
        if (activeStop.batchId !== batchId) return false;
        if (activeStop.sequence !== stop.sequence) return false;
      }
    }

    return true;
  }

  private buildExistingBatchesSummary(
    trips: ApproveTripDto[],
    shipments: Array<{
      id: string;
      deliveryStops: Array<{
        id: string;
        batchId: string;
        sequence: number;
        status: string;
        batch: { id: string; status: string; driverId: string | null; locationId: string | null };
      }>;
    }>,
    driverMap: Map<string, { id: string; name: string }>,
  ): ApprovedBatchSummary[] {
    const shipmentMap = new Map(shipments.map((s) => [s.id, s]));
    const result: ApprovedBatchSummary[] = [];

    for (const trip of trips) {
      const firstShipment = shipmentMap.get(trip.stops[0].shipmentId)!;
      const firstActiveStop = firstShipment.deliveryStops.find((st) => st.status === 'active')!;
      const batchId = firstActiveStop.batchId;
      const driver = driverMap.get(trip.driverId);

      const stops = trip.stops.map((stop) => {
        const sh = shipmentMap.get(stop.shipmentId)!;
        const activeStop = sh.deliveryStops.find((st) => st.status === 'active')!;
        return {
          stopId: activeStop.id,
          shipmentId: stop.shipmentId,
          sequence: stop.sequence,
        };
      });

      result.push({
        batchId,
        driverId: trip.driverId,
        driverName: driver?.name ?? null,
        status: 'planning',
        stopCount: stops.length,
        stops,
      });
    }

    return result;
  }
}

import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { Role, Prisma } from '@prisma/client';
import {
  ROUTING_PROVIDER,
  RoutingProvider,
  RouteWaypoint,
} from '../../src/modules/fulfillment/routing/routing.provider';
import {
  ROUTE_OPTIMIZATION_PROVIDER,
  RouteOptimizationProvider,
} from '../../src/modules/fulfillment/routing/route-optimization.provider';
import {
  DispatchPlanningService,
  computeDispatchPlanFingerprint,
} from '../../src/modules/fulfillment/services/dispatch-planning.service';
import { getDeliveryHubCoordinates } from '../../src/modules/fulfillment/services/hub-location';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { OrderingService } from '../../src/modules/ordering/public';

describe('ShinaCare Maps Phase 3.3A — Adaptive Multi-Driver Dispatch Planner', () => {
  const hubCoords = getDeliveryHubCoordinates();
  const validHubId = '00000000-0000-0000-0000-000000000001';

  // Sample Cairo/Giza order coordinates
  // Dokki (West Giza)
  const dokki1 = { latitude: 30.0386, longitude: 31.2122, name: 'Dokki Customer 1' };
  const dokki2 = { latitude: 30.0395, longitude: 31.2145, name: 'Dokki Customer 2' };
  const dokki3 = { latitude: 30.0370, longitude: 31.2100, name: 'Dokki Customer 3' };

  // Maadi (South Cairo)
  const maadi1 = { latitude: 29.9602, longitude: 31.2569, name: 'Maadi Customer 1' };
  const maadi2 = { latitude: 29.9620, longitude: 31.2590, name: 'Maadi Customer 2' };

  // Nasr City (East Cairo)
  const nasr1 = { latitude: 30.0571, longitude: 31.3412, name: 'Nasr City Customer 1' };
  const nasr2 = { latitude: 30.0590, longitude: 31.3430, name: 'Nasr City Customer 2' };

  const mockAdminActor = { id: 'admin-1', roles: [Role.ADMIN] };
  const mockHubOperatorActor = { id: 'operator-1', roles: [Role.HUB_OPERATOR] };
  const mockDriverActor = { id: 'driver-1', roles: [Role.DRIVER] };

  let service: DispatchPlanningService;
  let mockRoutingProvider: jest.Mocked<RoutingProvider>;
  let mockOptimizationProvider: jest.Mocked<RouteOptimizationProvider>;
  let mockPrisma: any;
  let mockOrderingService: any;

  beforeEach(async () => {
    mockRoutingProvider = {
      providerName: 'mock-directions',
      calculateRoute: jest.fn().mockImplementation(async (origin, destinations) => ({
        origin,
        destinations,
        waypoints: [origin, ...destinations],
        totalDistanceMeters: 15000,
        totalDurationSeconds: 1800,
        geometry: { type: 'LineString', coordinates: [] },
        legs: [],
        provider: 'mock-directions',
      })),
    };

    mockOptimizationProvider = {
      providerName: 'mock-optimizer',
      optimizeRoute: jest.fn().mockImplementation(async (origin, destinations) => ({
        provider: 'mock-optimizer',
        roundtrip: true,
        optimizedStops: destinations.map((d: RouteWaypoint, idx: number) => ({
          originalIndex: idx,
          optimizedIndex: idx,
          sequence: idx + 1,
          waypoint: d,
        })),
        distanceMeters: 14000,
        durationSeconds: 1600,
      })),
    };

    mockPrisma = {
      fulfillmentLocation: {
        findUnique: jest.fn().mockResolvedValue({
          id: validHubId,
          name: 'Central Giza Hub',
          isActive: true,
        }),
        findFirst: jest.fn().mockResolvedValue({
          id: validHubId,
          name: 'Central Giza Hub',
          isActive: true,
        }),
      },
      fulfillmentLocationOperator: {
        findUnique: jest.fn(),
      },
      shipment: {
        findMany: jest.fn(),
      },
      customer: {
        findMany: jest.fn(),
      },
      deliveryBatch: {
        create: jest.fn(),
      },
      deliveryStop: {
        create: jest.fn(),
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
      },
      shipmentEvent: {
        create: jest.fn(),
      },
      $transaction: jest.fn().mockImplementation(async (cb) => {
        if (typeof cb === 'function') {
          return cb(mockPrisma);
        }
        return cb;
      }),
    };

    mockOrderingService = {
      getOrder: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DispatchPlanningService,
        { provide: ROUTING_PROVIDER, useValue: mockRoutingProvider },
        { provide: ROUTE_OPTIMIZATION_PROVIDER, useValue: mockOptimizationProvider },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: OrderingService, useValue: mockOrderingService },
      ],
    }).compile();

    service = module.get<DispatchPlanningService>(DispatchPlanningService);
  });

  describe('Authorization & Permissions', () => {
    it('restricts dispatch planning to administrators and hub operators', async () => {
      await expect(
        service.planDispatch({}, mockDriverActor),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows administrators and hub operators to run planning preview', async () => {
      mockPrisma.shipment.findMany.mockResolvedValue([]);
      mockPrisma.customer.findMany.mockResolvedValue([{ id: 'driver-1', name: 'Driver Ahmed' }]);

      const result = await service.planDispatch({ hubId: validHubId }, mockHubOperatorActor);
      expect(result).toBeDefined();
      expect(result.hubId).toBe(validHubId);
    });
  });

  describe('Driver Availability Scenarios', () => {
    const makeSampleShipments = () => [
      { id: 'ship-1', orderId: 'ord-1', locationId: validHubId, status: 'packed', deliveryStops: [] },
      { id: 'ship-2', orderId: 'ord-2', locationId: validHubId, status: 'packed', deliveryStops: [] },
    ];

    beforeEach(() => {
      mockPrisma.shipment.findMany.mockResolvedValue(makeSampleShipments());
      mockOrderingService.getOrder.mockImplementation(async (orderId: string) => {
        if (orderId === 'ord-1') {
          return {
            id: 'ord-1',
            orderNumber: 'ORD-1',
            customerName: dokki1.name,
            shippingAddress: 'Dokki',
            area: 'Dokki',
            governorate: 'Giza',
            latitude: dokki1.latitude,
            longitude: dokki1.longitude,
          };
        }
        return {
          id: 'ord-2',
          orderNumber: 'ORD-2',
          customerName: dokki2.name,
          shippingAddress: 'Dokki',
          area: 'Dokki',
          governorate: 'Giza',
          latitude: dokki2.latitude,
          longitude: dokki2.longitude,
        };
      });
    });

    it('marks all orders as unassigned with NO_AVAILABLE_DRIVERS when 0 drivers are available', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([]); // No drivers in DB

      const plan = await service.planDispatch({ hubId: validHubId, drivers: [] }, mockAdminActor);

      expect(plan.trips).toHaveLength(0);
      expect(plan.unassignedOrders).toHaveLength(2);
      expect(plan.unassignedOrders[0].reasonCode).toBe('INSUFFICIENT_DRIVERS');
      expect(plan.diagnostics.availableDriverCount).toBe(0);
      expect(plan.diagnostics.assignedOrders).toBe(0);
    });

    it('supports 1 driver handling multiple sequential trips (Trip 1 and Trip 2)', async () => {
      // 4 shipments in 2 geographically distinct areas (2 in Dokki, 2 in Maadi)
      mockPrisma.shipment.findMany.mockResolvedValue([
        { id: 'ship-1', orderId: 'ord-1', locationId: validHubId, status: 'packed', deliveryStops: [] },
        { id: 'ship-2', orderId: 'ord-2', locationId: validHubId, status: 'packed', deliveryStops: [] },
        { id: 'ship-3', orderId: 'ord-3', locationId: validHubId, status: 'packed', deliveryStops: [] },
        { id: 'ship-4', orderId: 'ord-4', locationId: validHubId, status: 'packed', deliveryStops: [] },
      ]);

      mockOrderingService.getOrder.mockImplementation(async (orderId: string) => {
        if (orderId === 'ord-1') return { id: 'ord-1', orderNumber: 'ORD-1', customerName: dokki1.name, latitude: dokki1.latitude, longitude: dokki1.longitude };
        if (orderId === 'ord-2') return { id: 'ord-2', orderNumber: 'ORD-2', customerName: dokki2.name, latitude: dokki2.latitude, longitude: dokki2.longitude };
        if (orderId === 'ord-3') return { id: 'ord-3', orderNumber: 'ORD-3', customerName: maadi1.name, latitude: maadi1.latitude, longitude: maadi1.longitude };
        return { id: 'ord-4', orderNumber: 'ORD-4', customerName: maadi2.name, latitude: maadi2.latitude, longitude: maadi2.longitude };
      });

      const plan = await service.planDispatch(
        {
          hubId: validHubId,
          drivers: [{ id: 'driver-solo', name: 'Solo Driver', maxTrips: 3 }],
          maxStopsPerTrip: 2,
        },
        mockAdminActor,
      );

      expect(plan.trips.length).toBeGreaterThanOrEqual(2);
      // Both trips assigned to the same single driver in sequence
      expect(plan.trips[0].driverId).toBe('driver-solo');
      expect(plan.trips[0].tripSequenceForDriver).toBe(1);
      expect(plan.trips[1].driverId).toBe('driver-solo');
      expect(plan.trips[1].tripSequenceForDriver).toBe(2);
      expect(plan.unassignedOrders).toHaveLength(0);
    });

    it('supports 2 drivers with geographically balanced cluster distribution', async () => {
      mockPrisma.shipment.findMany.mockResolvedValue([
        { id: 'ship-1', orderId: 'ord-1', locationId: validHubId, status: 'packed', deliveryStops: [] },
        { id: 'ship-2', orderId: 'ord-2', locationId: validHubId, status: 'packed', deliveryStops: [] },
        { id: 'ship-3', orderId: 'ord-3', locationId: validHubId, status: 'packed', deliveryStops: [] },
        { id: 'ship-4', orderId: 'ord-4', locationId: validHubId, status: 'packed', deliveryStops: [] },
      ]);

      mockOrderingService.getOrder.mockImplementation(async (orderId: string) => {
        if (orderId === 'ord-1') return { id: 'ord-1', orderNumber: 'ORD-1', customerName: dokki1.name, latitude: dokki1.latitude, longitude: dokki1.longitude };
        if (orderId === 'ord-2') return { id: 'ord-2', orderNumber: 'ORD-2', customerName: dokki2.name, latitude: dokki2.latitude, longitude: dokki2.longitude };
        if (orderId === 'ord-3') return { id: 'ord-3', orderNumber: 'ORD-3', customerName: maadi1.name, latitude: maadi1.latitude, longitude: maadi1.longitude };
        return { id: 'ord-4', orderNumber: 'ORD-4', customerName: maadi2.name, latitude: maadi2.latitude, longitude: maadi2.longitude };
      });

      const plan = await service.planDispatch(
        {
          hubId: validHubId,
          drivers: [
            { id: 'driver-1', name: 'Driver 1' },
            { id: 'driver-2', name: 'Driver 2' },
          ],
          maxStopsPerTrip: 2,
        },
        mockAdminActor,
      );

      expect(plan.trips).toHaveLength(2);
      const assignedDriverIds = plan.trips.map((t) => t.driverId);
      expect(assignedDriverIds).toContain('driver-1');
      expect(assignedDriverIds).toContain('driver-2');
    });

    it('marks excess clusters unassigned with EXCEEDS_DRIVER_SHIFT_CAPACITY when drivers are overloaded', async () => {
      // 4 shipments in 2 clusters, but driver only has capacity for 1 trip (maxTrips = 1)
      mockPrisma.shipment.findMany.mockResolvedValue([
        { id: 'ship-1', orderId: 'ord-1', locationId: validHubId, status: 'packed', deliveryStops: [] },
        { id: 'ship-2', orderId: 'ord-2', locationId: validHubId, status: 'packed', deliveryStops: [] },
        { id: 'ship-3', orderId: 'ord-3', locationId: validHubId, status: 'packed', deliveryStops: [] },
        { id: 'ship-4', orderId: 'ord-4', locationId: validHubId, status: 'packed', deliveryStops: [] },
      ]);

      mockOrderingService.getOrder.mockImplementation(async (orderId: string) => {
        if (orderId === 'ord-1') return { id: 'ord-1', orderNumber: 'ORD-1', customerName: dokki1.name, latitude: dokki1.latitude, longitude: dokki1.longitude };
        if (orderId === 'ord-2') return { id: 'ord-2', orderNumber: 'ORD-2', customerName: dokki2.name, latitude: dokki2.latitude, longitude: dokki2.longitude };
        if (orderId === 'ord-3') return { id: 'ord-3', orderNumber: 'ORD-3', customerName: maadi1.name, latitude: maadi1.latitude, longitude: maadi1.longitude };
        return { id: 'ord-4', orderNumber: 'ORD-4', customerName: maadi2.name, latitude: maadi2.latitude, longitude: maadi2.longitude };
      });

      const plan = await service.planDispatch(
        {
          hubId: validHubId,
          drivers: [{ id: 'driver-limited', name: 'Limited Driver', maxTrips: 1 }],
          maxStopsPerTrip: 2,
        },
        mockAdminActor,
      );

      expect(plan.trips).toHaveLength(1); // Exactly 1 trip accommodated
      expect(plan.unassignedOrders.length).toBeGreaterThan(0);
      expect(plan.unassignedOrders[0].reasonCode).toBe('EXCEEDS_DRIVER_SHIFT_CAPACITY');
    });
  });

  describe('Adaptive Spatial Clustering & Rebalancing', () => {
    it('groups geographically separated orders into distinct clusters', async () => {
      mockPrisma.shipment.findMany.mockResolvedValue([
        { id: 'ship-1', orderId: 'ord-1', locationId: validHubId, status: 'packed', deliveryStops: [] },
        { id: 'ship-2', orderId: 'ord-2', locationId: validHubId, status: 'packed', deliveryStops: [] },
        { id: 'ship-3', orderId: 'ord-3', locationId: validHubId, status: 'packed', deliveryStops: [] },
      ]);

      mockOrderingService.getOrder.mockImplementation(async (orderId: string) => {
        if (orderId === 'ord-1') return { id: 'ord-1', orderNumber: 'ORD-1', customerName: dokki1.name, latitude: dokki1.latitude, longitude: dokki1.longitude };
        if (orderId === 'ord-2') return { id: 'ord-2', orderNumber: 'ORD-2', customerName: maadi1.name, latitude: maadi1.latitude, longitude: maadi1.longitude };
        return { id: 'ord-3', orderNumber: 'ORD-3', customerName: nasr1.name, latitude: nasr1.latitude, longitude: nasr1.longitude };
      });

      const plan = await service.planDispatch(
        {
          hubId: validHubId,
          drivers: [{ id: 'driver-1', maxTrips: 5 }],
          clusterRadiusKm: 3.0,
          maxStopsPerTrip: 5,
        },
        mockAdminActor,
      );

      // 3 geographically far orders (Dokki, Maadi, Nasr City > 10km apart) should form 3 distinct clusters
      expect(plan.trips).toHaveLength(3);
    });

    it('merges small nearby clusters when total stops remain under capacity limit', async () => {
      // 3 orders in Dokki within 500m of each other
      mockPrisma.shipment.findMany.mockResolvedValue([
        { id: 'ship-1', orderId: 'ord-1', locationId: validHubId, status: 'packed', deliveryStops: [] },
        { id: 'ship-2', orderId: 'ord-2', locationId: validHubId, status: 'packed', deliveryStops: [] },
        { id: 'ship-3', orderId: 'ord-3', locationId: validHubId, status: 'packed', deliveryStops: [] },
      ]);

      mockOrderingService.getOrder.mockImplementation(async (orderId: string) => {
        if (orderId === 'ord-1') return { id: 'ord-1', orderNumber: 'ORD-1', customerName: dokki1.name, latitude: dokki1.latitude, longitude: dokki1.longitude };
        if (orderId === 'ord-2') return { id: 'ord-2', orderNumber: 'ORD-2', customerName: dokki2.name, latitude: dokki2.latitude, longitude: dokki2.longitude };
        return { id: 'ord-3', orderNumber: 'ORD-3', customerName: dokki3.name, latitude: dokki3.latitude, longitude: dokki3.longitude };
      });

      const plan = await service.planDispatch(
        {
          hubId: validHubId,
          drivers: [{ id: 'driver-1', maxTrips: 5 }],
          clusterRadiusKm: 5.0,
          maxStopsPerTrip: 10,
        },
        mockAdminActor,
      );

      // Nearby orders should merge into a single efficient trip
      expect(plan.trips).toHaveLength(1);
      expect(plan.trips[0].stops).toHaveLength(3);
    });

    it('splits a large cluster exceeding maxStopsPerTrip without dropping any stops', async () => {
      // 5 orders in Dokki with maxStopsPerTrip = 2
      const shipments = Array.from({ length: 5 }, (_, i) => ({
        id: `ship-${i + 1}`,
        orderId: `ord-${i + 1}`,
        locationId: validHubId,
        status: 'packed',
        deliveryStops: [],
      }));

      mockPrisma.shipment.findMany.mockResolvedValue(shipments);
      mockOrderingService.getOrder.mockImplementation(async (orderId: string) => ({
        id: orderId,
        orderNumber: orderId.toUpperCase(),
        customerName: 'Customer',
        latitude: 30.0386 + Math.random() * 0.005,
        longitude: 31.2122 + Math.random() * 0.005,
      }));

      const plan = await service.planDispatch(
        {
          hubId: validHubId,
          drivers: [{ id: 'driver-1', maxTrips: 5 }],
          maxStopsPerTrip: 2,
        },
        mockAdminActor,
      );

      // 5 orders with maxStopsPerTrip = 2 -> 3 trips (2, 2, 1)
      expect(plan.trips).toHaveLength(3);
      const totalAssignedStops = plan.trips.reduce((sum, t) => sum + t.stops.length, 0);
      expect(totalAssignedStops).toBe(5);
      expect(plan.unassignedOrders).toHaveLength(0);
    });
  });

  describe('Large Batches (> 11 Stops) & Local 2-Opt TSP Heuristic', () => {
    it('handles batches exceeding Mapbox v1 11-stop limit (e.g. 15 stops) using local 2-Opt heuristic', async () => {
      const shipments = Array.from({ length: 15 }, (_, i) => ({
        id: `ship-${i + 1}`,
        orderId: `ord-${i + 1}`,
        locationId: validHubId,
        status: 'packed',
        deliveryStops: [],
      }));

      mockPrisma.shipment.findMany.mockResolvedValue(shipments);
      mockOrderingService.getOrder.mockImplementation(async (orderId: string) => {
        const idx = parseInt(orderId.replace('ord-', ''), 10);
        return {
          id: orderId,
          orderNumber: orderId.toUpperCase(),
          customerName: `Customer ${idx}`,
          latitude: 30.0386 + (idx * 0.001),
          longitude: 31.2122 + (idx * 0.001),
        };
      });

      const plan = await service.planDispatch(
        {
          hubId: validHubId,
          drivers: [{ id: 'driver-1', maxTrips: 5, maxStops: 50 }],
          maxStopsPerTrip: 20, // allows single large trip
          useRoadOptimization: false,
        },
        mockAdminActor,
      );

      expect(plan.trips).toHaveLength(1);
      const trip = plan.trips[0];
      expect(trip.stops).toHaveLength(15);
      expect(trip.metrics.optimizationMethod).toBe('local_2opt');
      expect(trip.metrics.isRoadBased).toBe(false);
      expect(mockOptimizationProvider.optimizeRoute).not.toHaveBeenCalled();

      // Ensure stop sequences are 1 to 15 without gaps or duplicates
      const seqs = trip.stops.map((s) => s.sequence);
      expect(seqs).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
      expect(plan.unassignedOrders).toHaveLength(0);
    });

    it('smoothly falls back to local 2-Opt heuristic when Mapbox provider fails', async () => {
      mockPrisma.shipment.findMany.mockResolvedValue([
        { id: 'ship-1', orderId: 'ord-1', locationId: validHubId, status: 'packed', deliveryStops: [] },
        { id: 'ship-2', orderId: 'ord-2', locationId: validHubId, status: 'packed', deliveryStops: [] },
      ]);

      mockOrderingService.getOrder.mockImplementation(async (orderId: string) => ({
        id: orderId,
        orderNumber: orderId.toUpperCase(),
        customerName: 'Customer',
        latitude: 30.0386,
        longitude: 31.2122,
      }));

      // Simulate Mapbox provider failure (e.g. rate limit or timeout)
      mockOptimizationProvider.optimizeRoute.mockRejectedValue(
        new Error('Mapbox API Rate Limit Exceeded'),
      );

      const plan = await service.planDispatch(
        {
          hubId: validHubId,
          drivers: [{ id: 'driver-1' }],
          useRoadOptimization: true,
        },
        mockAdminActor,
      );

      expect(plan.trips).toHaveLength(1);
      expect(plan.trips[0].metrics.optimizationMethod).toBe('local_2opt');
      expect(plan.diagnostics.warnings.length).toBeGreaterThan(0);
      expect(plan.diagnostics.warnings[0]).toContain('smoothly fell back to local 2-Opt');
    });
  });

  describe('Data Anomalies & Unassigned Categorization', () => {
    it('categorizes orders with missing coordinates into unassignedOrders with MISSING_COORDINATES', async () => {
      mockPrisma.shipment.findMany.mockResolvedValue([
        { id: 'ship-valid', orderId: 'ord-valid', locationId: validHubId, status: 'packed', deliveryStops: [] },
        { id: 'ship-nopin', orderId: 'ord-nopin', locationId: validHubId, status: 'packed', deliveryStops: [] },
      ]);

      mockOrderingService.getOrder.mockImplementation(async (orderId: string) => {
        if (orderId === 'ord-valid') {
          return { id: 'ord-valid', orderNumber: 'V-1', customerName: 'Valid', latitude: 30.0386, longitude: 31.2122 };
        }
        return { id: 'ord-nopin', orderNumber: 'NP-1', customerName: 'No Pin', latitude: null, longitude: null };
      });

      const plan = await service.planDispatch(
        { hubId: validHubId, drivers: [{ id: 'driver-1' }] },
        mockAdminActor,
      );

      expect(plan.trips[0].stops).toHaveLength(1);
      expect(plan.unassignedOrders).toHaveLength(1);
      expect(plan.unassignedOrders[0].reasonCode).toBe('MISSING_COORDINATES');
      expect(plan.unassignedOrders[0].shipmentId).toBe('ship-nopin');
    });

    it('categorizes orders outside Cairo/Giza service area with OUT_OF_SERVICE_AREA', async () => {
      mockPrisma.shipment.findMany.mockResolvedValue([
        { id: 'ship-alex', orderId: 'ord-alex', locationId: validHubId, status: 'packed', deliveryStops: [] },
      ]);

      mockOrderingService.getOrder.mockResolvedValue({
        id: 'ord-alex',
        orderNumber: 'ALX-1',
        customerName: 'Alexandria Customer',
        latitude: 31.2001, // Alexandria is outside Cairo/Giza service area
        longitude: 29.9187,
      });

      const plan = await service.planDispatch(
        { hubId: validHubId, drivers: [{ id: 'driver-1' }] },
        mockAdminActor,
      );

      expect(plan.trips).toHaveLength(0);
      expect(plan.unassignedOrders).toHaveLength(1);
      expect(plan.unassignedOrders[0].reasonCode).toBe('OUT_OF_SERVICE_AREA');
    });

    it('rejects unpacked shipments with NOT_PACKED and already assigned shipments with ALREADY_ASSIGNED', async () => {
      mockPrisma.shipment.findMany.mockResolvedValue([
        { id: 'ship-preparing', orderId: 'ord-prep', locationId: validHubId, status: 'preparing', deliveryStops: [] },
        { id: 'ship-active-run', orderId: 'ord-run', locationId: validHubId, status: 'packed', deliveryStops: [{ status: 'active' }] },
      ]);

      const plan = await service.planDispatch(
        { hubId: validHubId, shipmentIds: ['ship-preparing', 'ship-active-run'], drivers: [{ id: 'driver-1' }] },
        mockAdminActor,
      );

      expect(plan.trips).toHaveLength(0);
      expect(plan.unassignedOrders).toHaveLength(2);
      expect(plan.unassignedOrders[0].reasonCode).toBe('NOT_PACKED');
      expect(plan.unassignedOrders[1].reasonCode).toBe('ALREADY_ASSIGNED');
    });

    it('safely deduplicates duplicate shipment IDs in input without double-counting', async () => {
      mockPrisma.shipment.findMany.mockResolvedValue([
        { id: 'ship-1', orderId: 'ord-1', locationId: validHubId, status: 'packed', deliveryStops: [] },
      ]);

      mockOrderingService.getOrder.mockResolvedValue({
        id: 'ord-1',
        orderNumber: 'ORD-1',
        customerName: 'Customer',
        latitude: 30.0386,
        longitude: 31.2122,
      });

      const plan = await service.planDispatch(
        { hubId: validHubId, shipmentIds: ['ship-1', 'ship-1', 'ship-1'], drivers: [{ id: 'driver-1' }] },
        mockAdminActor,
      );

      // Should only plan 1 stop
      expect(plan.trips[0].stops).toHaveLength(1);
      expect(plan.diagnostics.totalCandidateOrders).toBe(1);
      expect(plan.unassignedOrders).toHaveLength(0);
    });
  });

  describe('Determinism & Zero Mutation Guarantee', () => {
    it('produces 100% deterministic trip and stop sequences across multiple identical runs', async () => {
      const shipments = [
        { id: 'ship-c', orderId: 'ord-c', locationId: validHubId, status: 'packed', deliveryStops: [] },
        { id: 'ship-a', orderId: 'ord-a', locationId: validHubId, status: 'packed', deliveryStops: [] },
        { id: 'ship-b', orderId: 'ord-b', locationId: validHubId, status: 'packed', deliveryStops: [] },
      ];

      mockPrisma.shipment.findMany.mockResolvedValue(shipments);
      mockOrderingService.getOrder.mockImplementation(async (orderId: string) => ({
        id: orderId,
        orderNumber: orderId.toUpperCase(),
        customerName: 'Customer',
        latitude: 30.0386,
        longitude: 31.2122,
      }));

      const plan1 = await service.planDispatch({ hubId: validHubId, drivers: [{ id: 'd-1' }] }, mockAdminActor);
      const plan2 = await service.planDispatch({ hubId: validHubId, drivers: [{ id: 'd-1' }] }, mockAdminActor);

      expect(plan1.trips[0].stops.map((s) => s.shipmentId)).toEqual(
        plan2.trips[0].stops.map((s) => s.shipmentId),
      );
      expect(plan1.trips[0].stops.map((s) => s.sequence)).toEqual(
        plan2.trips[0].stops.map((s) => s.sequence),
      );
    });

    it('performs zero database mutations during preview planning', async () => {
      mockPrisma.shipment.findMany.mockResolvedValue([
        { id: 'ship-1', orderId: 'ord-1', locationId: validHubId, status: 'packed', deliveryStops: [] },
      ]);
      mockOrderingService.getOrder.mockResolvedValue({
        id: 'ord-1',
        orderNumber: 'ORD-1',
        customerName: 'Customer',
        latitude: 30.0386,
        longitude: 31.2122,
      });

      await service.planDispatch({ hubId: validHubId, drivers: [{ id: 'd-1' }] }, mockAdminActor);

      // Assert zero writes to database
      expect(mockPrisma.deliveryBatch.create).not.toHaveBeenCalled();
      expect(mockPrisma.deliveryStop.create).not.toHaveBeenCalled();
      expect(mockPrisma.deliveryStop.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.deliveryStop.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('Phase 3.3B — Dispatch Plan Approval & Persistence', () => {
    const validDriverId1 = '11111111-1111-1111-1111-111111111111';
    const validDriverId2 = '11111111-1111-1111-1111-111111111112';
    const validShipmentId1 = '22222222-2222-2222-2222-222222222221';
    const validShipmentId2 = '22222222-2222-2222-2222-222222222222';
    const validShipmentId3 = '22222222-2222-2222-2222-222222222223';
    const fixedUpdatedAt = new Date('2026-10-16T10:00:00.000Z');

    const makeEligibleShipments = () => [
      {
        id: validShipmentId1,
        locationId: validHubId,
        status: 'packed',
        updatedAt: fixedUpdatedAt,
        deliveryStops: [],
      },
      {
        id: validShipmentId2,
        locationId: validHubId,
        status: 'packed',
        updatedAt: fixedUpdatedAt,
        deliveryStops: [],
      },
    ];

    describe('Approval Authorization & Permissions', () => {
      it('rejects approval when actor is a DRIVER with ForbiddenException', async () => {
        await expect(
          service.approveDispatchPlan(
            {
              planFingerprint: 'fake-fingerprint',
              hubId: validHubId,
              trips: [
                {
                  driverId: validDriverId1,
                  stops: [{ shipmentId: validShipmentId1, sequence: 1 }],
                },
              ],
            },
            mockDriverActor,
          ),
        ).rejects.toThrow(ForbiddenException);
      });

      it('rejects approval when hub operator is not assigned to the hub location', async () => {
        mockPrisma.fulfillmentLocationOperator.findUnique.mockResolvedValue(null);

        await expect(
          service.approveDispatchPlan(
            {
              planFingerprint: 'fake-fingerprint',
              hubId: validHubId,
              trips: [
                {
                  driverId: validDriverId1,
                  stops: [{ shipmentId: validShipmentId1, sequence: 1 }],
                },
              ],
            },
            mockHubOperatorActor,
          ),
        ).rejects.toThrow(ForbiddenException);
      });

      it('allows assigned hub operator to approve plan', async () => {
        mockPrisma.fulfillmentLocationOperator.findUnique.mockResolvedValue({
          locationId: validHubId,
          operatorId: mockHubOperatorActor.id,
        });
        mockPrisma.customer.findMany.mockResolvedValue([
          { id: validDriverId1, name: 'Driver Ahmed', roles: [Role.DRIVER] },
        ]);
        const shipments = makeEligibleShipments();
        mockPrisma.shipment.findMany.mockResolvedValue(shipments);

        const trips = [
          {
            driverId: validDriverId1,
            tripSequenceForDriver: 1,
            stops: [
              { shipmentId: validShipmentId1, sequence: 1 },
              { shipmentId: validShipmentId2, sequence: 2 },
            ],
          },
        ];

        const fingerprint = computeDispatchPlanFingerprint({
          hubId: validHubId,
          trips,
          shipments,
        });

        mockPrisma.deliveryBatch.create.mockResolvedValue({ id: 'batch-1' });
        mockPrisma.deliveryStop.create.mockResolvedValue({ id: 'stop-1' });

        const result = await service.approveDispatchPlan(
          {
            planFingerprint: fingerprint,
            hubId: validHubId,
            trips,
          },
          mockHubOperatorActor,
        );

        expect(result.success).toBe(true);
        expect(result.idempotentRetry).toBe(false);
        expect(result.batches).toHaveLength(1);
      });
    });

    describe('Driver Eligibility & Account Validation', () => {
      it('rejects approval when driver account does not exist', async () => {
        mockPrisma.customer.findMany.mockResolvedValue([]);

        await expect(
          service.approveDispatchPlan(
            {
              planFingerprint: 'dummy-fp',
              hubId: validHubId,
              trips: [
                {
                  driverId: validDriverId1,
                  stops: [{ shipmentId: validShipmentId1, sequence: 1 }],
                },
              ],
            },
            mockAdminActor,
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it('rejects approval when driver account lacks Role.DRIVER', async () => {
        mockPrisma.customer.findMany.mockResolvedValue([
          { id: validDriverId1, name: 'Customer Not Driver', roles: [Role.CUSTOMER] },
        ]);

        await expect(
          service.approveDispatchPlan(
            {
              planFingerprint: 'dummy-fp',
              hubId: validHubId,
              trips: [
                {
                  driverId: validDriverId1,
                  stops: [{ shipmentId: validShipmentId1, sequence: 1 }],
                },
              ],
            },
            mockAdminActor,
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it('rejects approval when duplicate shipments appear across trips', async () => {
        await expect(
          service.approveDispatchPlan(
            {
              planFingerprint: 'dummy-fp',
              hubId: validHubId,
              trips: [
                {
                  driverId: validDriverId1,
                  stops: [{ shipmentId: validShipmentId1, sequence: 1 }],
                },
                {
                  driverId: validDriverId2,
                  stops: [{ shipmentId: validShipmentId1, sequence: 1 }], // Duplicate shipmentId
                },
              ],
            },
            mockAdminActor,
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it('rejects approval when stop sequence is non-positive or duplicate', async () => {
        await expect(
          service.approveDispatchPlan(
            {
              planFingerprint: 'dummy-fp',
              hubId: validHubId,
              trips: [
                {
                  driverId: validDriverId1,
                  stops: [
                    { shipmentId: validShipmentId1, sequence: 1 },
                    { shipmentId: validShipmentId2, sequence: 1 }, // Duplicate seq
                  ],
                },
              ],
            },
            mockAdminActor,
          ),
        ).rejects.toThrow(BadRequestException);
      });
    });

    describe('Server-Verifiable Fingerprint & Stale Preview Rejection (HTTP 409)', () => {
      it('rejects approval with ConflictException (409) if stop sequences were modified', async () => {
        mockPrisma.customer.findMany.mockResolvedValue([
          { id: validDriverId1, name: 'Driver Ahmed', roles: [Role.DRIVER] },
        ]);
        const shipments = makeEligibleShipments();
        mockPrisma.shipment.findMany.mockResolvedValue(shipments);

        // Preview generated fingerprint with sequence 1, 2
        const originalTrips = [
          {
            driverId: validDriverId1,
            tripSequenceForDriver: 1,
            stops: [
              { shipmentId: validShipmentId1, sequence: 1 },
              { shipmentId: validShipmentId2, sequence: 2 },
            ],
          },
        ];
        const fingerprint = computeDispatchPlanFingerprint({
          hubId: validHubId,
          trips: originalTrips,
          shipments,
        });

        // Request tampered/swapped stop sequences: 2, 1
        const tamperedTrips = [
          {
            driverId: validDriverId1,
            tripSequenceForDriver: 1,
            stops: [
              { shipmentId: validShipmentId1, sequence: 2 },
              { shipmentId: validShipmentId2, sequence: 1 },
            ],
          },
        ];

        await expect(
          service.approveDispatchPlan(
            {
              planFingerprint: fingerprint,
              hubId: validHubId,
              trips: tamperedTrips,
            },
            mockAdminActor,
          ),
        ).rejects.toThrow(ConflictException);
      });

      it('rejects approval with ConflictException (409) if shipment updatedAt changed concurrently', async () => {
        mockPrisma.customer.findMany.mockResolvedValue([
          { id: validDriverId1, name: 'Driver Ahmed', roles: [Role.DRIVER] },
        ]);

        const originalShipments = makeEligibleShipments();
        const trips = [
          {
            driverId: validDriverId1,
            tripSequenceForDriver: 1,
            stops: [
              { shipmentId: validShipmentId1, sequence: 1 },
              { shipmentId: validShipmentId2, sequence: 2 },
            ],
          },
        ];

        const fingerprint = computeDispatchPlanFingerprint({
          hubId: validHubId,
          trips,
          shipments: originalShipments,
        });

        // Concurrently modified shipment updatedAt
        const staleShipments = [
          {
            id: validShipmentId1,
            locationId: validHubId,
            status: 'packed',
            updatedAt: new Date('2026-10-16T10:05:00.000Z'), // Modified!
            deliveryStops: [],
          },
          {
            id: validShipmentId2,
            locationId: validHubId,
            status: 'packed',
            updatedAt: fixedUpdatedAt,
            deliveryStops: [],
          },
        ];
        mockPrisma.shipment.findMany.mockResolvedValue(staleShipments);

        await expect(
          service.approveDispatchPlan(
            {
              planFingerprint: fingerprint,
              hubId: validHubId,
              trips,
            },
            mockAdminActor,
          ),
        ).rejects.toThrow(ConflictException);
      });

      it('rejects approval with ConflictException (409) if shipment is no longer packed', async () => {
        mockPrisma.customer.findMany.mockResolvedValue([
          { id: validDriverId1, name: 'Driver Ahmed', roles: [Role.DRIVER] },
        ]);

        const shipments = [
          {
            id: validShipmentId1,
            locationId: validHubId,
            status: 'cancelled', // Not packed!
            updatedAt: fixedUpdatedAt,
            deliveryStops: [],
          },
        ];
        mockPrisma.shipment.findMany.mockResolvedValue(shipments);

        const trips = [
          {
            driverId: validDriverId1,
            stops: [{ shipmentId: validShipmentId1, sequence: 1 }],
          },
        ];

        await expect(
          service.approveDispatchPlan(
            {
              planFingerprint: 'any-fp',
              hubId: validHubId,
              trips,
            },
            mockAdminActor,
          ),
        ).rejects.toThrow(ConflictException);
      });
    });

    describe('Multi-Trip Driver Support & Sequential Batch Creation', () => {
      it('supports 1 driver assigned to multiple sequential trips creating separate batches', async () => {
        mockPrisma.customer.findMany.mockResolvedValue([
          { id: validDriverId1, name: 'Driver Ahmed', roles: [Role.DRIVER] },
        ]);

        const allShipments = [
          {
            id: validShipmentId1,
            locationId: validHubId,
            status: 'packed',
            updatedAt: fixedUpdatedAt,
            deliveryStops: [],
          },
          {
            id: validShipmentId2,
            locationId: validHubId,
            status: 'packed',
            updatedAt: fixedUpdatedAt,
            deliveryStops: [],
          },
          {
            id: validShipmentId3,
            locationId: validHubId,
            status: 'packed',
            updatedAt: fixedUpdatedAt,
            deliveryStops: [],
          },
        ];
        mockPrisma.shipment.findMany.mockResolvedValue(allShipments);

        // Driver has Trip 1 (Stops 1, 2) and Trip 2 (Stop 3)
        const trips = [
          {
            driverId: validDriverId1,
            tripSequenceForDriver: 1,
            stops: [
              { shipmentId: validShipmentId1, sequence: 1 },
              { shipmentId: validShipmentId2, sequence: 2 },
            ],
          },
          {
            driverId: validDriverId1,
            tripSequenceForDriver: 2,
            stops: [{ shipmentId: validShipmentId3, sequence: 1 }],
          },
        ];

        const fingerprint = computeDispatchPlanFingerprint({
          hubId: validHubId,
          trips,
          shipments: allShipments,
        });

        mockPrisma.deliveryBatch.create
          .mockResolvedValueOnce({ id: 'batch-trip-1' })
          .mockResolvedValueOnce({ id: 'batch-trip-2' });

        mockPrisma.deliveryStop.create.mockResolvedValue({ id: 'stop-created' });

        const result = await service.approveDispatchPlan(
          {
            planFingerprint: fingerprint,
            hubId: validHubId,
            trips,
          },
          mockAdminActor,
        );

        expect(result.success).toBe(true);
        expect(result.totalBatchesCreated).toBe(2);
        expect(result.totalStopsCreated).toBe(3);
        expect(mockPrisma.deliveryBatch.create).toHaveBeenCalledTimes(2);
        expect(mockPrisma.deliveryStop.create).toHaveBeenCalledTimes(3);
        expect(mockPrisma.shipmentEvent.create).toHaveBeenCalledTimes(3);

        // Verify both batches are assigned to the same driver
        expect(result.batches[0].driverId).toBe(validDriverId1);
        expect(result.batches[0].stopCount).toBe(2);
        expect(result.batches[1].driverId).toBe(validDriverId1);
        expect(result.batches[1].stopCount).toBe(1);
      });
    });

    describe('Audit Logging & Shipment Status Preservation', () => {
      it('creates BATCH_ASSIGNED ShipmentEvent for every stop and leaves shipment status untouched', async () => {
        mockPrisma.customer.findMany.mockResolvedValue([
          { id: validDriverId1, name: 'Driver Ahmed', roles: [Role.DRIVER] },
        ]);

        const shipments = [
          {
            id: validShipmentId1,
            locationId: validHubId,
            status: 'packed',
            updatedAt: fixedUpdatedAt,
            deliveryStops: [],
          },
        ];
        mockPrisma.shipment.findMany.mockResolvedValue(shipments);

        const trips = [
          {
            driverId: validDriverId1,
            stops: [{ shipmentId: validShipmentId1, sequence: 1 }],
          },
        ];

        const fingerprint = computeDispatchPlanFingerprint({
          hubId: validHubId,
          trips,
          shipments,
        });

        mockPrisma.deliveryBatch.create.mockResolvedValue({ id: 'batch-10' });
        mockPrisma.deliveryStop.create.mockResolvedValue({ id: 'stop-10' });

        await service.approveDispatchPlan(
          {
            planFingerprint: fingerprint,
            hubId: validHubId,
            trips,
          },
          mockAdminActor,
        );

        // Audit event recorded
        expect(mockPrisma.shipmentEvent.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            shipmentId: validShipmentId1,
            type: 'BATCH_ASSIGNED',
            actorId: mockAdminActor.id,
            notes: expect.stringContaining('Assigned to delivery batch batch-10 at stop sequence 1'),
          }),
        });

        // Batch created with 'planning' status
        expect(mockPrisma.deliveryBatch.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            status: 'planning',
            driverId: validDriverId1,
          }),
        });

        // Shipment status NOT modified
        expect(mockPrisma.shipment.update).toBeUndefined();
      });
    });

    describe('Idempotency & Concurrent Approval Conflicts', () => {
      it('returns existing batches with idempotentRetry: true when retried with same plan', async () => {
        mockPrisma.customer.findMany.mockResolvedValue([
          { id: validDriverId1, name: 'Driver Ahmed', roles: [Role.DRIVER] },
        ]);

        const existingBatch = {
          id: 'existing-batch-uuid',
          status: 'planning',
          driverId: validDriverId1,
          locationId: validHubId,
        };

        const existingShipmentsWithActiveStops = [
          {
            id: validShipmentId1,
            locationId: validHubId,
            status: 'packed',
            updatedAt: fixedUpdatedAt,
            deliveryStops: [
              {
                id: 'existing-stop-1',
                batchId: existingBatch.id,
                shipmentId: validShipmentId1,
                sequence: 1,
                status: 'active',
                batch: existingBatch,
              },
            ],
          },
        ];
        mockPrisma.shipment.findMany.mockResolvedValue(existingShipmentsWithActiveStops);

        const trips = [
          {
            driverId: validDriverId1,
            stops: [{ shipmentId: validShipmentId1, sequence: 1 }],
          },
        ];

        const result = await service.approveDispatchPlan(
          {
            planFingerprint: 'any-valid-fingerprint',
            hubId: validHubId,
            idempotencyKey: 'idemp-key-1',
            trips,
          },
          mockAdminActor,
        );

        expect(result.success).toBe(true);
        expect(result.idempotentRetry).toBe(true);
        expect(result.batches[0].batchId).toBe('existing-batch-uuid');
        // No new batch or stop creation in DB
        expect(mockPrisma.deliveryBatch.create).not.toHaveBeenCalled();
        expect(mockPrisma.deliveryStop.create).not.toHaveBeenCalled();
      });

      it('rejects with ConflictException (409) when database encounters P2002 unique violation', async () => {
        mockPrisma.customer.findMany.mockResolvedValue([
          { id: validDriverId1, name: 'Driver Ahmed', roles: [Role.DRIVER] },
        ]);
        const shipments = makeEligibleShipments();
        mockPrisma.shipment.findMany.mockResolvedValue(shipments);

        const trips = [
          {
            driverId: validDriverId1,
            stops: [
              { shipmentId: validShipmentId1, sequence: 1 },
              { shipmentId: validShipmentId2, sequence: 2 },
            ],
          },
        ];

        const fingerprint = computeDispatchPlanFingerprint({
          hubId: validHubId,
          trips,
          shipments,
        });

        // Simulate concurrent insertion causing Prisma P2002 unique constraint error
        const p2002Error = new Prisma.PrismaClientKnownRequestError(
          'Unique constraint failed on the fields: (`batch_id`,`sequence`)',
          { code: 'P2002', clientVersion: '5.22.0' },
        );
        mockPrisma.deliveryBatch.create.mockRejectedValue(p2002Error);

        await expect(
          service.approveDispatchPlan(
            {
              planFingerprint: fingerprint,
              hubId: validHubId,
              trips,
            },
            mockAdminActor,
          ),
        ).rejects.toThrow(ConflictException);
      });
    });
  });
});

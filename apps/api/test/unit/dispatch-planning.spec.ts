import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import {
  ROUTING_PROVIDER,
  RoutingProvider,
  RouteWaypoint,
} from '../../src/modules/fulfillment/routing/routing.provider';
import {
  ROUTE_OPTIMIZATION_PROVIDER,
  RouteOptimizationProvider,
} from '../../src/modules/fulfillment/routing/route-optimization.provider';
import { DispatchPlanningService } from '../../src/modules/fulfillment/services/dispatch-planning.service';
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
});

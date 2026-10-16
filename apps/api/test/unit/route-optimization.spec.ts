import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  BadGatewayException,
  NotFoundException,
  ForbiddenException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import {
  ROUTING_PROVIDER,
  RoutingProvider,
  RouteWaypoint,
  PlannedRoute,
} from '../../src/modules/fulfillment/routing/routing.provider';
import {
  ROUTE_OPTIMIZATION_PROVIDER,
  RouteOptimizationProvider,
  RouteOptimizationResult,
  MAX_MAPBOX_OPTIMIZATION_STOPS,
} from '../../src/modules/fulfillment/routing/route-optimization.provider';
import { MapboxOptimizationProvider } from '../../src/modules/fulfillment/routing/mapbox-optimization.provider';
import { RouteOptimizationService } from '../../src/modules/fulfillment/services/route-optimization.service';
import { getDeliveryHubCoordinates } from '../../src/modules/fulfillment/services/hub-location';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { OrderingService } from '../../src/modules/ordering/public';

describe('ShinaCare Maps Phase 3.2 — Single-Driver Route Optimization', () => {
  const hubCoords = getDeliveryHubCoordinates();
  const validBatchId = '11111111-2222-3333-4444-555555555555';

  const stop1Coords: RouteWaypoint = {
    id: 'stop-1',
    name: 'Dokki Customer',
    address: '10 Tahrir St, Dokki, Giza',
    latitude: 30.0386,
    longitude: 31.2122,
  };

  const stop2Coords: RouteWaypoint = {
    id: 'stop-2',
    name: 'Maadi Customer',
    address: '15 Road 9, Maadi, Cairo',
    latitude: 29.9602,
    longitude: 31.2569,
  };

  const stop3Coords: RouteWaypoint = {
    id: 'stop-3',
    name: 'Nasr City Customer',
    address: 'Abbas El Akkad, Nasr City, Cairo',
    latitude: 30.0571,
    longitude: 31.3412,
  };

  describe('MapboxOptimizationProvider', () => {
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('throws ServiceUnavailableException when token is missing', async () => {
      const provider = new MapboxOptimizationProvider('', 'https://api.mapbox.test');
      const origin: RouteWaypoint = { latitude: hubCoords.latitude, longitude: hubCoords.longitude };

      await expect(
        provider.optimizeRoute(origin, [stop1Coords, stop2Coords]),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('rejects empty destinations array', async () => {
      const provider = new MapboxOptimizationProvider('pk.test-token');
      const origin: RouteWaypoint = { latitude: hubCoords.latitude, longitude: hubCoords.longitude };

      await expect(provider.optimizeRoute(origin, [])).rejects.toThrow(BadRequestException);
    });

    it('handles single destination stop trivially without calling Mapbox API', async () => {
      const provider = new MapboxOptimizationProvider('pk.test-token');
      const origin: RouteWaypoint = { latitude: hubCoords.latitude, longitude: hubCoords.longitude };

      const mockFetch = jest.fn();
      global.fetch = mockFetch;

      const result = await provider.optimizeRoute(origin, [stop1Coords]);

      expect(mockFetch).not.toHaveBeenCalled();
      expect(result.provider).toBe('mapbox');
      expect(result.optimizedStops).toHaveLength(1);
      expect(result.optimizedStops[0]).toEqual({
        originalIndex: 0,
        optimizedIndex: 0,
        sequence: 1,
        waypoint: stop1Coords,
      });
    });

    it(`rejects destinations exceeding the Mapbox Optimization limit of ${MAX_MAPBOX_OPTIMIZATION_STOPS} stops`, async () => {
      const provider = new MapboxOptimizationProvider('pk.test-token');
      const origin: RouteWaypoint = { latitude: hubCoords.latitude, longitude: hubCoords.longitude };

      const excessiveStops: RouteWaypoint[] = Array.from({ length: 12 }, (_, i) => ({
        id: `stop-${i}`,
        name: `Stop ${i}`,
        latitude: 30.0 + i * 0.001,
        longitude: 31.2 + i * 0.001,
      }));

      await expect(provider.optimizeRoute(origin, excessiveStops)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('calls Mapbox Optimized Trips v1 with source=first, roundtrip=false and maps waypoints correctly', async () => {
      const provider = new MapboxOptimizationProvider('pk.test-token', 'https://api.mapbox.test');
      const origin: RouteWaypoint = {
        name: 'Hub',
        latitude: hubCoords.latitude,
        longitude: hubCoords.longitude,
      };

      let requestedUrl = '';
      global.fetch = jest.fn().mockImplementation(async (url: string) => {
        requestedUrl = url;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            code: 'Ok',
            waypoints: [
              { waypoint_index: 0, trips_index: 0, location: [hubCoords.longitude, hubCoords.latitude] },
              // stop 1 (input index 1) is visited 2nd in trip (waypoint_index 2)
              { waypoint_index: 2, trips_index: 0, location: [stop1Coords.longitude, stop1Coords.latitude] },
              // stop 2 (input index 2) is visited 1st in trip (waypoint_index 1)
              { waypoint_index: 1, trips_index: 0, location: [stop2Coords.longitude, stop2Coords.latitude] },
            ],
            trips: [
              {
                distance: 25000,
                duration: 2100,
                geometry: { type: 'LineString', coordinates: [] },
              },
            ],
          }),
        };
      });

      const result = await provider.optimizeRoute(origin, [stop1Coords, stop2Coords]);

      expect(requestedUrl).toContain('/optimized-trips/v1/mapbox/driving/');
      expect(requestedUrl).toContain('source=first');
      expect(requestedUrl).toContain('roundtrip=false');
      expect(requestedUrl).toContain('geometries=geojson');
      expect(requestedUrl).toContain('access_token=pk.test-token');

      // Reordered stops: stop2 first (optimizedIndex 0, sequence 1), stop1 second (optimizedIndex 1, sequence 2)
      expect(result.optimizedStops).toHaveLength(2);
      expect(result.optimizedStops[0].waypoint.id).toBe('stop-2');
      expect(result.optimizedStops[0].originalIndex).toBe(1);
      expect(result.optimizedStops[0].sequence).toBe(1);

      expect(result.optimizedStops[1].waypoint.id).toBe('stop-1');
      expect(result.optimizedStops[1].originalIndex).toBe(0);
      expect(result.optimizedStops[1].sequence).toBe(2);

      expect(result.distanceMeters).toBe(25000);
      expect(result.durationSeconds).toBe(2100);
    });

    it('handles Mapbox NoTrips with UnprocessableEntityException', async () => {
      const provider = new MapboxOptimizationProvider('pk.test-token', 'https://api.mapbox.test');
      const origin: RouteWaypoint = { latitude: hubCoords.latitude, longitude: hubCoords.longitude };

      global.fetch = jest.fn().mockImplementation(async () => ({
        ok: false,
        status: 200,
        json: async () => ({ code: 'NoTrips', message: 'No trip could be found' }),
      }));

      await expect(
        provider.optimizeRoute(origin, [stop1Coords, stop2Coords]),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('handles Mapbox 401 Unauthorized with ServiceUnavailableException', async () => {
      const provider = new MapboxOptimizationProvider('pk.invalid', 'https://api.mapbox.test');
      const origin: RouteWaypoint = { latitude: hubCoords.latitude, longitude: hubCoords.longitude };

      global.fetch = jest.fn().mockImplementation(async () => ({
        ok: false,
        status: 401,
        json: async () => ({ message: 'Not Authorized' }),
      }));

      await expect(
        provider.optimizeRoute(origin, [stop1Coords, stop2Coords]),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('handles Mapbox 429 Rate Limit with ServiceUnavailableException', async () => {
      const provider = new MapboxOptimizationProvider('pk.test-token', 'https://api.mapbox.test');
      const origin: RouteWaypoint = { latitude: hubCoords.latitude, longitude: hubCoords.longitude };

      global.fetch = jest.fn().mockImplementation(async () => ({
        ok: false,
        status: 429,
        json: async () => ({ message: 'Too Many Requests' }),
      }));

      await expect(
        provider.optimizeRoute(origin, [stop1Coords, stop2Coords]),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('handles network request timeout', async () => {
      const provider = new MapboxOptimizationProvider('pk.test-token', 'https://api.mapbox.test');
      const origin: RouteWaypoint = { latitude: hubCoords.latitude, longitude: hubCoords.longitude };

      global.fetch = jest.fn().mockImplementation(async () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        throw err;
      });

      await expect(
        provider.optimizeRoute(origin, [stop1Coords, stop2Coords]),
      ).rejects.toThrow(BadGatewayException);
    });
  });

  describe('RouteOptimizationService', () => {
    let service: RouteOptimizationService;
    let mockRoutingProvider: jest.Mocked<RoutingProvider>;
    let mockOptimizationProvider: jest.Mocked<RouteOptimizationProvider>;
    let mockPrisma: any;
    let mockOrderingService: any;

    const mockAdminActor = { id: 'admin-1', roles: [Role.ADMIN] };
    const mockDriverActor = { id: 'driver-1', roles: [Role.DRIVER] };
    const mockUnauthorizedActor = { id: 'other-user', roles: [Role.CUSTOMER] };

    beforeEach(async () => {
      mockRoutingProvider = {
        providerName: 'mock-directions',
        calculateRoute: jest.fn().mockImplementation(async (origin, destinations) => {
          // If first destination is stop-2, route is shorter (optimized)
          const isOptimized = destinations[0]?.id === 'stop-2';
          const distance = isOptimized ? 20000 : 25000;
          const duration = isOptimized ? 1500 : 2000;

          return {
            origin,
            destinations,
            waypoints: [origin, ...destinations],
            totalDistanceMeters: distance,
            totalDurationSeconds: duration,
            geometry: { type: 'LineString', coordinates: [] },
            legs: destinations.map((d: RouteWaypoint, idx: number) => ({
              legIndex: idx,
              origin: idx === 0 ? origin : destinations[idx - 1],
              destination: d,
              distanceMeters: Math.round(distance / destinations.length),
              durationSeconds: Math.round(duration / destinations.length),
            })),
            provider: 'mock-directions',
          };
        }),
      };

      mockOptimizationProvider = {
        providerName: 'mock-mapbox-optimizer',
        optimizeRoute: jest.fn().mockImplementation(async (origin, destinations) => {
          // Swap first two destinations to simulate TSP optimization
          const reordered = destinations.length > 1
            ? [
                { originalIndex: 1, optimizedIndex: 0, sequence: 1, waypoint: destinations[1] },
                { originalIndex: 0, optimizedIndex: 1, sequence: 2, waypoint: destinations[0] },
                ...destinations.slice(2).map((d: RouteWaypoint, idx: number) => ({
                  originalIndex: idx + 2,
                  optimizedIndex: idx + 2,
                  sequence: idx + 3,
                  waypoint: d,
                })),
              ]
            : destinations.map((d: RouteWaypoint, idx: number) => ({
                originalIndex: idx,
                optimizedIndex: idx,
                sequence: idx + 1,
                waypoint: d,
              }));

          return {
            provider: 'mock-mapbox-optimizer',
            optimizedStops: reordered,
          };
        }),
      };

      mockPrisma = {
        deliveryBatch: {
          findUnique: jest.fn(),
        },
        deliveryStop: {
          updateMany: jest.fn(),
        },
        fulfillmentLocationOperator: {
          findUnique: jest.fn(),
        },
        $transaction: jest.fn().mockImplementation(async (fn: any) => fn(mockPrisma)),
      };

      mockOrderingService = {
        getOrder: jest.fn(),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          RouteOptimizationService,
          { provide: ROUTING_PROVIDER, useValue: mockRoutingProvider },
          { provide: ROUTE_OPTIMIZATION_PROVIDER, useValue: mockOptimizationProvider },
          { provide: PrismaService, useValue: mockPrisma },
          { provide: OrderingService, useValue: mockOrderingService },
        ],
      }).compile();

      service = module.get<RouteOptimizationService>(RouteOptimizationService);
    });

    describe('previewBatchOptimization', () => {
      it('throws BadRequestException for invalid UUID batch id', async () => {
        await expect(
          service.previewBatchOptimization('not-a-uuid', mockAdminActor),
        ).rejects.toThrow(BadRequestException);
      });

      it('throws NotFoundException when batch is not found', async () => {
        mockPrisma.deliveryBatch.findUnique.mockResolvedValue(null);

        await expect(
          service.previewBatchOptimization(validBatchId, mockAdminActor),
        ).rejects.toThrow(NotFoundException);
      });

      it('throws ForbiddenException when actor is unauthorized', async () => {
        mockPrisma.deliveryBatch.findUnique.mockResolvedValue({
          id: validBatchId,
          status: 'planning',
          locationId: 'loc-1',
          driverId: 'driver-1',
          stops: [],
        });

        await expect(
          service.previewBatchOptimization(validBatchId, mockUnauthorizedActor),
        ).rejects.toThrow(ForbiddenException);
      });

      it('throws BadRequestException when batch is already dispatched or completed', async () => {
        mockPrisma.deliveryBatch.findUnique.mockResolvedValue({
          id: validBatchId,
          status: 'dispatched',
          locationId: null,
          driverId: null,
          stops: [{ id: 'stop-1', sequence: 1, shipment: { orderId: 'ord-1' } }],
        });

        await expect(
          service.previewBatchOptimization(validBatchId, mockAdminActor),
        ).rejects.toThrow(BadRequestException);
      });

      it('throws BadRequestException when batch has no stops', async () => {
        mockPrisma.deliveryBatch.findUnique.mockResolvedValue({
          id: validBatchId,
          status: 'planning',
          locationId: null,
          driverId: null,
          stops: [],
        });

        await expect(
          service.previewBatchOptimization(validBatchId, mockAdminActor),
        ).rejects.toThrow(BadRequestException);
      });

      it(`throws BadRequestException when batch exceeds ${MAX_MAPBOX_OPTIMIZATION_STOPS} stops`, async () => {
        const stops = Array.from({ length: 12 }, (_, i) => ({
          id: `stop-${i}`,
          sequence: i + 1,
          shipment: { orderId: `ord-${i}` },
        }));

        mockPrisma.deliveryBatch.findUnique.mockResolvedValue({
          id: validBatchId,
          status: 'planning',
          locationId: null,
          driverId: null,
          stops,
        });

        await expect(
          service.previewBatchOptimization(validBatchId, mockAdminActor),
        ).rejects.toThrow(BadRequestException);
      });

      it('throws BadRequestException with LOCATION_REQUIRED when stop order lacks coordinates', async () => {
        mockPrisma.deliveryBatch.findUnique.mockResolvedValue({
          id: validBatchId,
          status: 'planning',
          locationId: null,
          driverId: null,
          stops: [
            { id: 'stop-1', shipmentId: 'ship-1', sequence: 1, shipment: { orderId: 'ord-1' } },
          ],
        });

        mockOrderingService.getOrder.mockResolvedValue({
          id: 'ord-1',
          orderNumber: 'SHN-001',
          customerName: 'Customer Missing Pin',
          latitude: null,
          longitude: null,
        });

        await expect(
          service.previewBatchOptimization(validBatchId, mockAdminActor),
        ).rejects.toMatchObject({
          response: expect.objectContaining({ code: 'LOCATION_REQUIRED' }),
        });
      });

      it('returns preview with 0 savings for single stop batch without calling optimizer', async () => {
        mockPrisma.deliveryBatch.findUnique.mockResolvedValue({
          id: validBatchId,
          status: 'planning',
          locationId: null,
          driverId: null,
          stops: [
            { id: 'stop-1', shipmentId: 'ship-1', sequence: 1, shipment: { orderId: 'ord-1' } },
          ],
        });

        mockOrderingService.getOrder.mockResolvedValue({
          id: 'ord-1',
          orderNumber: 'SHN-001',
          customerName: 'Dokki Customer',
          shippingAddress: '10 Tahrir St',
          area: 'Dokki',
          governorate: 'Giza',
          latitude: stop1Coords.latitude,
          longitude: stop1Coords.longitude,
        });

        const preview = await service.previewBatchOptimization(validBatchId, mockAdminActor);

        expect(mockOptimizationProvider.optimizeRoute).not.toHaveBeenCalled();
        expect(preview.applied).toBe(false);
        expect(preview.isOptimized).toBe(false);
        expect(preview.stopCount).toBe(1);
        expect(preview.summary.distanceSavingsMeters).toBe(0);
        expect(preview.summary.durationSavingsSeconds).toBe(0);
        expect(preview.optimizedStops).toHaveLength(1);
      });

      it('calculates preview comparison, savings metrics, and reordered stops for multi-stop batch', async () => {
        mockPrisma.deliveryBatch.findUnique.mockResolvedValue({
          id: validBatchId,
          status: 'planning',
          locationId: null,
          driverId: 'driver-1',
          stops: [
            { id: 'stop-1', shipmentId: 'ship-1', sequence: 1, shipment: { orderId: 'ord-1' } },
            { id: 'stop-2', shipmentId: 'ship-2', sequence: 2, shipment: { orderId: 'ord-2' } },
            { id: 'stop-3', shipmentId: 'ship-3', sequence: 3, shipment: { orderId: 'ord-3' } },
          ],
        });

        mockOrderingService.getOrder.mockImplementation(async (orderId: string) => {
          if (orderId === 'ord-1') {
            return {
              id: 'ord-1',
              orderNumber: 'SHN-001',
              customerName: 'Dokki Customer',
              shippingAddress: '10 Tahrir St',
              area: 'Dokki',
              governorate: 'Giza',
              latitude: stop1Coords.latitude,
              longitude: stop1Coords.longitude,
            };
          }
          if (orderId === 'ord-2') {
            return {
              id: 'ord-2',
              orderNumber: 'SHN-002',
              customerName: 'Maadi Customer',
              shippingAddress: '15 Road 9',
              area: 'Maadi',
              governorate: 'Cairo',
              latitude: stop2Coords.latitude,
              longitude: stop2Coords.longitude,
            };
          }
          return {
            id: 'ord-3',
            orderNumber: 'SHN-003',
            customerName: 'Nasr City Customer',
            shippingAddress: 'Abbas El Akkad',
            area: 'Nasr City',
            governorate: 'Cairo',
            latitude: stop3Coords.latitude,
            longitude: stop3Coords.longitude,
          };
        });

        const preview = await service.previewBatchOptimization(validBatchId, mockDriverActor);

        expect(mockOptimizationProvider.optimizeRoute).toHaveBeenCalledTimes(1);
        expect(preview.applied).toBe(false);
        expect(preview.isOptimized).toBe(true);
        expect(preview.stopCount).toBe(3);

        // Verification of savings: original 25km vs optimized 20km = 5km savings (20%)
        expect(preview.summary.originalDistanceMeters).toBe(25000);
        expect(preview.summary.optimizedDistanceMeters).toBe(20000);
        expect(preview.summary.distanceSavingsMeters).toBe(5000);
        expect(preview.summary.distanceSavingsPercent).toBe(20.0);

        // Original duration 2000s vs optimized 1500s = 500s savings (25%)
        expect(preview.summary.originalDurationSeconds).toBe(2000);
        expect(preview.summary.optimizedDurationSeconds).toBe(1500);
        expect(preview.summary.durationSavingsSeconds).toBe(500);
        expect(preview.summary.durationSavingsPercent).toBe(25.0);

        // Verify stop mapping and sequences
        expect(preview.originalStops[0].stopId).toBe('stop-1');
        expect(preview.originalStops[1].stopId).toBe('stop-2');
        expect(preview.originalStops[2].stopId).toBe('stop-3');

        expect(preview.optimizedStops[0].stopId).toBe('stop-2');
        expect(preview.optimizedStops[0].originalSequence).toBe(2);
        expect(preview.optimizedStops[0].optimizedSequence).toBe(1);

        expect(preview.optimizedStops[1].stopId).toBe('stop-1');
        expect(preview.optimizedStops[1].originalSequence).toBe(1);
        expect(preview.optimizedStops[1].optimizedSequence).toBe(2);

        expect(preview.optimizedStops[2].stopId).toBe('stop-3');
        expect(preview.optimizedStops[2].originalSequence).toBe(3);
        expect(preview.optimizedStops[2].optimizedSequence).toBe(3);

        // Database should not have been mutated in preview mode
        expect(mockPrisma.deliveryStop.updateMany).not.toHaveBeenCalled();
      });
    });

    describe('applyBatchOptimization', () => {
      beforeEach(() => {
        mockPrisma.deliveryBatch.findUnique.mockImplementation(async (args: any) => {
          return {
            id: validBatchId,
            status: 'planning',
            locationId: null,
            driverId: 'driver-1',
            stops: [
              { id: 'stop-1', shipmentId: 'ship-1', sequence: 1, shipment: { orderId: 'ord-1' } },
              { id: 'stop-2', shipmentId: 'ship-2', sequence: 2, shipment: { orderId: 'ord-2' } },
            ],
          };
        });

        mockOrderingService.getOrder.mockImplementation(async (orderId: string) => ({
          id: orderId,
          orderNumber: orderId === 'ord-1' ? 'SHN-001' : 'SHN-002',
          customerName: 'Customer',
          shippingAddress: 'Address',
          area: 'Dokki',
          governorate: 'Giza',
          latitude: orderId === 'ord-1' ? stop1Coords.latitude : stop2Coords.latitude,
          longitude: orderId === 'ord-1' ? stop1Coords.longitude : stop2Coords.longitude,
        }));
      });

      it('applies the previewed optimal sequence atomically using two-phase temporary negative sequence', async () => {
        const result = await service.applyBatchOptimization(validBatchId, mockAdminActor);

        expect(result.success).toBe(true);
        expect(result.applied).toBe(true);
        expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);

        // Two-phase sequence updates: temporary negative then final positive
        expect(mockPrisma.deliveryStop.updateMany).toHaveBeenCalledWith({
          where: { batchId: validBatchId, shipmentId: 'ship-2' },
          data: { sequence: -1 },
        });
        expect(mockPrisma.deliveryStop.updateMany).toHaveBeenCalledWith({
          where: { batchId: validBatchId, shipmentId: 'ship-1' },
          data: { sequence: -2 },
        });
        expect(mockPrisma.deliveryStop.updateMany).toHaveBeenCalledWith({
          where: { batchId: validBatchId, shipmentId: 'ship-2' },
          data: { sequence: 1 },
        });
        expect(mockPrisma.deliveryStop.updateMany).toHaveBeenCalledWith({
          where: { batchId: validBatchId, shipmentId: 'ship-1' },
          data: { sequence: 2 },
        });
      });

      it('rejects custom sequence with duplicate sequence numbers', async () => {
        await expect(
          service.applyBatchOptimization(validBatchId, mockAdminActor, {
            stops: [
              { shipmentId: 'ship-1', sequence: 1 },
              { shipmentId: 'ship-2', sequence: 1 },
            ],
          }),
        ).rejects.toThrow(BadRequestException);
      });

      it('rejects custom sequence containing shipments not in batch', async () => {
        await expect(
          service.applyBatchOptimization(validBatchId, mockAdminActor, {
            stops: [
              { shipmentId: 'ship-1', sequence: 1 },
              { shipmentId: 'unknown-shipment', sequence: 2 },
            ],
          }),
        ).rejects.toThrow(BadRequestException);
      });

      it('rejects custom sequence with mismatched stop count', async () => {
        await expect(
          service.applyBatchOptimization(validBatchId, mockAdminActor, {
            stops: [{ shipmentId: 'ship-1', sequence: 1 }],
          }),
        ).rejects.toThrow(BadRequestException);
      });
    });
  });
});

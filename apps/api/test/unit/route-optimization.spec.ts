import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  BadGatewayException,
  NotFoundException,
  ForbiddenException,
  ConflictException,
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

    it('configures open route with source=first, destination=last, and roundtrip=false', async () => {
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
              { waypoint_index: 1, trips_index: 0, location: [stop1Coords.longitude, stop1Coords.latitude] },
              { waypoint_index: 2, trips_index: 0, location: [stop2Coords.longitude, stop2Coords.latitude] },
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

      const result = await provider.optimizeRoute(origin, [stop1Coords, stop2Coords], {
        roundtrip: false,
      });

      expect(requestedUrl).toContain('source=first');
      expect(requestedUrl).toContain('destination=last');
      expect(requestedUrl).toContain('roundtrip=false');
      expect(result.roundtrip).toBe(false);
      expect(result.fixedFinalStopId).toBe('stop-2');
    });

    it('configures roundtrip route with source=first and roundtrip=true', async () => {
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
              { waypoint_index: 2, trips_index: 0, location: [stop1Coords.longitude, stop1Coords.latitude] },
              { waypoint_index: 1, trips_index: 0, location: [stop2Coords.longitude, stop2Coords.latitude] },
            ],
            trips: [
              {
                distance: 30000,
                duration: 2500,
                geometry: { type: 'LineString', coordinates: [] },
              },
            ],
          }),
        };
      });

      const result = await provider.optimizeRoute(origin, [stop1Coords, stop2Coords], {
        roundtrip: true,
      });

      expect(requestedUrl).toContain('source=first');
      expect(requestedUrl).toContain('roundtrip=true');
      expect(requestedUrl).not.toContain('destination=last');
      expect(result.roundtrip).toBe(true);
    });

    it('anchors specified fixedFinalStopId as the last coordinate sent to Mapbox in open route', async () => {
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
              // stop-2 is coordinate 1, visited 1st
              { waypoint_index: 1, trips_index: 0, location: [stop2Coords.longitude, stop2Coords.latitude] },
              // stop-3 is coordinate 2, visited 2nd
              { waypoint_index: 2, trips_index: 0, location: [stop3Coords.longitude, stop3Coords.latitude] },
              // stop-1 is coordinate 3 (fixed final), visited 3rd
              { waypoint_index: 3, trips_index: 0, location: [stop1Coords.longitude, stop1Coords.latitude] },
            ],
            trips: [
              {
                distance: 28000,
                duration: 2300,
              },
            ],
          }),
        };
      });

      // Pass stop-1 as fixedFinalStopId (it was first in input array)
      const result = await provider.optimizeRoute(origin, [stop1Coords, stop2Coords, stop3Coords], {
        roundtrip: false,
        fixedFinalStopId: 'stop-1',
      });

      // Verify stop-1 coordinates are placed at the end of coordinate string
      const coordSubstring = `${stop1Coords.longitude},${stop1Coords.latitude}`;
      expect(requestedUrl).toMatch(new RegExp(`${coordSubstring}\\?`));
      expect(result.fixedFinalStopId).toBe('stop-1');
      expect(result.optimizedStops[2].waypoint.id).toBe('stop-1');
      expect(result.optimizedStops[2].sequence).toBe(3);
    });

    it('rejects fixedFinalStopId that does not exist in batch destinations', async () => {
      const provider = new MapboxOptimizationProvider('pk.test-token', 'https://api.mapbox.test');
      const origin: RouteWaypoint = { latitude: hubCoords.latitude, longitude: hubCoords.longitude };

      await expect(
        provider.optimizeRoute(origin, [stop1Coords, stop2Coords], {
          roundtrip: false,
          fixedFinalStopId: 'non-existent-stop',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('handles Mapbox NotImplemented (HTTP 200) with BadRequestException', async () => {
      const provider = new MapboxOptimizationProvider('pk.test-token', 'https://api.mapbox.test');
      const origin: RouteWaypoint = { latitude: hubCoords.latitude, longitude: hubCoords.longitude };

      global.fetch = jest.fn().mockImplementation(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          code: 'NotImplemented',
          message: 'This request is not supported',
        }),
      }));

      await expect(
        provider.optimizeRoute(origin, [stop1Coords, stop2Coords]),
      ).rejects.toThrow(BadRequestException);
    });

    it('handles Mapbox NoTrips (HTTP 200) with UnprocessableEntityException', async () => {
      const provider = new MapboxOptimizationProvider('pk.test-token', 'https://api.mapbox.test');
      const origin: RouteWaypoint = { latitude: hubCoords.latitude, longitude: hubCoords.longitude };

      global.fetch = jest.fn().mockImplementation(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ code: 'NoTrips', message: 'No trip could be found' }),
      }));

      await expect(
        provider.optimizeRoute(origin, [stop1Coords, stop2Coords]),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('handles Mapbox NoSegment (HTTP 200) with UnprocessableEntityException', async () => {
      const provider = new MapboxOptimizationProvider('pk.test-token', 'https://api.mapbox.test');
      const origin: RouteWaypoint = { latitude: hubCoords.latitude, longitude: hubCoords.longitude };

      global.fetch = jest.fn().mockImplementation(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          code: 'NoSegment',
          message: 'Could not find a matching segment for coordinate',
        }),
      }));

      await expect(
        provider.optimizeRoute(origin, [stop1Coords, stop2Coords]),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('handles Mapbox InvalidInput (HTTP 200) with BadRequestException', async () => {
      const provider = new MapboxOptimizationProvider('pk.test-token', 'https://api.mapbox.test');
      const origin: RouteWaypoint = { latitude: hubCoords.latitude, longitude: hubCoords.longitude };

      global.fetch = jest.fn().mockImplementation(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          code: 'InvalidInput',
          message: 'Coordinates must be numbers',
        }),
      }));

      await expect(
        provider.optimizeRoute(origin, [stop1Coords, stop2Coords]),
      ).rejects.toThrow(BadRequestException);
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

    // Real API smoke test using configured demo account if available
    const liveToken = process.env.MAPBOX_ACCESS_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
    const testIfLive = liveToken && liveToken.startsWith('pk.') ? it : it.skip;

    testIfLive('live smoke test against Mapbox Optimization v1 API', async () => {
      const liveProvider = new MapboxOptimizationProvider(liveToken);
      const origin: RouteWaypoint = {
        name: 'Giza Hub',
        latitude: hubCoords.latitude,
        longitude: hubCoords.longitude,
      };

      const result = await liveProvider.optimizeRoute(origin, [stop1Coords, stop2Coords], {
        roundtrip: false,
      });

      expect(result.provider).toBe('mapbox');
      expect(result.roundtrip).toBe(false);
      expect(result.optimizedStops).toHaveLength(2);
      expect(result.optimizedStops[0].sequence).toBe(1);
      expect(result.optimizedStops[1].sequence).toBe(2);
      expect(typeof result.distanceMeters).toBe('number');
      expect(typeof result.durationSeconds).toBe('number');
    }, 15000);
  });

  describe('RouteOptimizationService', () => {
    let service: RouteOptimizationService;
    let mockRoutingProvider: jest.Mocked<RoutingProvider>;
    let mockOptimizationProvider: jest.Mocked<RouteOptimizationProvider>;
    let mockPrisma: any;
    let mockOrderingService: any;

    const mockAdminActor = { id: 'admin-1', roles: [Role.ADMIN] };
    const mockHubOperatorActor = { id: 'operator-1', roles: [Role.HUB_OPERATOR] };
    const mockDriverActor = { id: 'driver-1', roles: [Role.DRIVER] };
    const mockUnauthorizedActor = { id: 'other-user', roles: [Role.CUSTOMER] };

    const sampleDate = new Date('2026-10-16T15:00:00Z');

    beforeEach(async () => {
      mockRoutingProvider = {
        providerName: 'mock-directions',
        calculateRoute: jest.fn().mockImplementation(async (origin, destinations) => {
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
        optimizeRoute: jest.fn().mockImplementation(async (origin, destinations, options) => {
          const isRoundtrip = options?.roundtrip === true;
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
            roundtrip: isRoundtrip,
            fixedFinalStopId: isRoundtrip ? undefined : (options?.fixedFinalStopId || destinations[destinations.length - 1].id),
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
          updatedAt: sampleDate,
        });

        await expect(
          service.previewBatchOptimization(validBatchId, mockUnauthorizedActor),
        ).rejects.toThrow(ForbiddenException);
      });

      it('allows assigned driver to view read-only preview', async () => {
        mockPrisma.deliveryBatch.findUnique.mockResolvedValue({
          id: validBatchId,
          status: 'planning',
          locationId: null,
          driverId: 'driver-1',
          updatedAt: sampleDate,
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

        const preview = await service.previewBatchOptimization(validBatchId, mockDriverActor);
        expect(preview.batchId).toBe(validBatchId);
        expect(preview.applied).toBe(false);
      });

      it('throws BadRequestException when batch is already dispatched or completed', async () => {
        mockPrisma.deliveryBatch.findUnique.mockResolvedValue({
          id: validBatchId,
          status: 'dispatched',
          locationId: null,
          driverId: null,
          updatedAt: sampleDate,
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
          updatedAt: sampleDate,
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
          updatedAt: sampleDate,
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
          updatedAt: sampleDate,
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
          updatedAt: sampleDate,
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
        expect(preview.previewToken).toBeDefined();
        expect(preview.summary.distanceSavingsMeters).toBe(0);
        expect(preview.summary.durationSavingsSeconds).toBe(0);
        expect(preview.optimizedStops).toHaveLength(1);
      });

      it('calculates preview comparison, savings metrics, and returns preview token for multi-stop batch', async () => {
        mockPrisma.deliveryBatch.findUnique.mockResolvedValue({
          id: validBatchId,
          status: 'planning',
          locationId: null,
          driverId: 'driver-1',
          updatedAt: sampleDate,
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
        expect(preview.previewToken).toBeDefined();
        expect(preview.batchUpdatedAt).toBe(sampleDate.toISOString());

        // Savings: original 25km vs optimized 20km = 5km savings (20%)
        expect(preview.summary.originalDistanceMeters).toBe(25000);
        expect(preview.summary.optimizedDistanceMeters).toBe(20000);
        expect(preview.summary.distanceSavingsMeters).toBe(5000);
        expect(preview.summary.distanceSavingsPercent).toBe(20.0);

        // Verify stop mapping and sequences
        expect(preview.optimizedStops[0].stopId).toBe('stop-2');
        expect(preview.optimizedStops[0].optimizedSequence).toBe(1);

        expect(preview.optimizedStops[1].stopId).toBe('stop-1');
        expect(preview.optimizedStops[1].optimizedSequence).toBe(2);

        expect(preview.optimizedStops[2].stopId).toBe('stop-3');
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
            updatedAt: sampleDate,
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

      it('strictly forbids drivers from approving or applying route reordering', async () => {
        await expect(
          service.applyBatchOptimization(validBatchId, mockDriverActor),
        ).rejects.toThrow(ForbiddenException);
      });

      it('allows authorized admin or hub operator to apply route reordering', async () => {
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

      it('prevents stale optimization preview from applying when previewToken does not match current batch', async () => {
        await expect(
          service.applyBatchOptimization(validBatchId, mockAdminActor, {
            previewToken: 'stale-token-from-past-state',
          }),
        ).rejects.toThrow(ConflictException);
      });

      it('prevents stale optimization preview from applying when expectedBatchUpdatedAt does not match', async () => {
        await expect(
          service.applyBatchOptimization(validBatchId, mockAdminActor, {
            expectedBatchUpdatedAt: new Date('2026-10-16T14:00:00Z').toISOString(),
          }),
        ).rejects.toThrow(ConflictException);
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

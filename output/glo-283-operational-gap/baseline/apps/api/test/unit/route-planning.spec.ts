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
  PlannedRoute,
  RouteWaypoint,
} from '../../src/modules/fulfillment/routing/routing.provider';
import {
  MapboxDirectionsRoutingProvider,
  MAX_MAPBOX_STOPS,
} from '../../src/modules/fulfillment/routing/mapbox-directions.provider';
import {
  RoutePlanningService,
  PlannedBatchRoute,
} from '../../src/modules/fulfillment/services/route-planning.service';
import { getDeliveryHubCoordinates } from '../../src/modules/fulfillment/services/hub-location';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { OrderingService } from '../../src/modules/ordering/public';

describe('ShinaCare Maps Phase 3.1 — Routing Provider & Route Planning', () => {
  const hubCoords = getDeliveryHubCoordinates();

  const validCairoStop1: RouteWaypoint = {
    id: 'stop-1',
    name: 'Customer 1 - Dokki',
    address: '10 Tahrir St, Dokki, Giza',
    latitude: 30.0386,
    longitude: 31.2122,
  };

  const validCairoStop2: RouteWaypoint = {
    id: 'stop-2',
    name: 'Customer 2 - Maadi',
    address: '15 Road 9, Maadi, Cairo',
    latitude: 29.9602,
    longitude: 31.2569,
  };

  describe('MapboxDirectionsRoutingProvider', () => {
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('throws ServiceUnavailableException when token is missing', async () => {
      const provider = new MapboxDirectionsRoutingProvider('', 'https://api.mapbox.com');
      const origin: RouteWaypoint = { latitude: hubCoords.latitude, longitude: hubCoords.longitude };

      await expect(
        provider.calculateRoute(origin, [validCairoStop1]),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('rejects empty destinations array', async () => {
      const provider = new MapboxDirectionsRoutingProvider('pk.test-token');
      const origin: RouteWaypoint = { latitude: hubCoords.latitude, longitude: hubCoords.longitude };

      await expect(provider.calculateRoute(origin, [])).rejects.toThrow(BadRequestException);
    });

    it(`rejects destination lists exceeding the Mapbox maximum limit of ${MAX_MAPBOX_STOPS} stops`, async () => {
      const provider = new MapboxDirectionsRoutingProvider('pk.test-token');
      const origin: RouteWaypoint = { latitude: hubCoords.latitude, longitude: hubCoords.longitude };
      const excessiveStops = Array.from({ length: 25 }, (_, i) => ({
        id: `stop-${i}`,
        latitude: 30.0 + i * 0.001,
        longitude: 31.2 + i * 0.001,
      }));

      await expect(provider.calculateRoute(origin, excessiveStops)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('formats coordinates as lng,lat in exact order and normalizes route response', async () => {
      const provider = new MapboxDirectionsRoutingProvider('pk.valid-token', 'https://api.mapbox.test');
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
            routes: [
              {
                distance: 25400.75,
                duration: 1850.5,
                geometry: {
                  type: 'LineString',
                  coordinates: [
                    [31.149644, 29.997164],
                    [31.2122, 30.0386],
                    [31.2569, 29.9602],
                  ],
                },
                legs: [
                  { distance: 11200.2, duration: 820.0, summary: 'Ring Road' },
                  { distance: 14200.55, duration: 1030.5, summary: 'Autostrad' },
                ],
              },
            ],
            waypoints: [{}, {}, {}],
          }),
        };
      }) as any;

      const result = await provider.calculateRoute(origin, [validCairoStop1, validCairoStop2]);

      // Check URL and coordinates order: lng,lat;lng,lat;lng,lat
      expect(requestedUrl).toContain('https://api.mapbox.test/directions/v5/mapbox/driving/');
      expect(requestedUrl).toContain(
        `${origin.longitude},${origin.latitude};${validCairoStop1.longitude},${validCairoStop1.latitude};${validCairoStop2.longitude},${validCairoStop2.latitude}`,
      );
      expect(requestedUrl).toContain('geometries=geojson');
      expect(requestedUrl).toContain('access_token=pk.valid-token');

      // Check normalized outputs
      expect(result.provider).toBe('mapbox');
      expect(result.totalDistanceMeters).toBe(25401);
      expect(result.totalDurationSeconds).toBe(1851);
      expect(result.geometry.type).toBe('LineString');
      expect(result.geometry.coordinates).toHaveLength(3);

      // Check legs
      expect(result.legs).toHaveLength(2);
      expect(result.legs[0].origin.name).toBe('Hub');
      expect(result.legs[0].destination.name).toBe(validCairoStop1.name);
      expect(result.legs[0].distanceMeters).toBe(11200);
      expect(result.legs[0].durationSeconds).toBe(820);
      expect(result.legs[0].summary).toBe('Ring Road');

      expect(result.legs[1].origin.name).toBe(validCairoStop1.name);
      expect(result.legs[1].destination.name).toBe(validCairoStop2.name);
      expect(result.legs[1].distanceMeters).toBe(14201);
      expect(result.legs[1].durationSeconds).toBe(1031);
      expect(result.legs[1].summary).toBe('Autostrad');
    });

    it('handles Mapbox NoRoute error with UnprocessableEntityException', async () => {
      const provider = new MapboxDirectionsRoutingProvider('pk.valid-token');
      const origin: RouteWaypoint = { latitude: hubCoords.latitude, longitude: hubCoords.longitude };

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: async () => ({ code: 'NoRoute', message: 'No route found' }),
      } as any);

      await expect(provider.calculateRoute(origin, [validCairoStop1])).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('handles Mapbox 401 Unauthorized with ServiceUnavailableException', async () => {
      const provider = new MapboxDirectionsRoutingProvider('pk.invalid-token');
      const origin: RouteWaypoint = { latitude: hubCoords.latitude, longitude: hubCoords.longitude };

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ message: 'Not Authorized - Invalid Token' }),
      } as any);

      await expect(provider.calculateRoute(origin, [validCairoStop1])).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('handles Mapbox 429 Rate Limit with ServiceUnavailableException', async () => {
      const provider = new MapboxDirectionsRoutingProvider('pk.valid-token');
      const origin: RouteWaypoint = { latitude: hubCoords.latitude, longitude: hubCoords.longitude };

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({ message: 'Rate limit exceeded' }),
      } as any);

      await expect(provider.calculateRoute(origin, [validCairoStop1])).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('handles network request timeout', async () => {
      const provider = new MapboxDirectionsRoutingProvider('pk.valid-token');
      const origin: RouteWaypoint = { latitude: hubCoords.latitude, longitude: hubCoords.longitude };

      global.fetch = jest.fn().mockImplementation(() => {
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        throw error;
      });

      await expect(provider.calculateRoute(origin, [validCairoStop1])).rejects.toThrow(
        BadGatewayException,
      );
    });
  });

  describe('RoutePlanningService', () => {
    let service: RoutePlanningService;
    let mockRoutingProvider: jest.Mocked<RoutingProvider>;
    let mockPrisma: any;
    let mockOrderingService: any;

    const mockAdminActor = { id: 'admin-1', roles: [Role.ADMIN] };
    const mockDriverActor = { id: 'driver-1', roles: [Role.DRIVER] };
    const mockUnauthorizedActor = { id: 'other-user', roles: [Role.CUSTOMER] };

    beforeEach(async () => {
      mockRoutingProvider = {
        providerName: 'mock-provider',
        calculateRoute: jest.fn().mockImplementation(async (origin, destinations) => ({
          origin,
          destinations,
          waypoints: [origin, ...destinations],
          totalDistanceMeters: 18000,
          totalDurationSeconds: 1200,
          geometry: { type: 'LineString', coordinates: [[origin.longitude, origin.latitude]] },
          legs: destinations.map((d: RouteWaypoint, idx: number) => ({
            legIndex: idx,
            origin: idx === 0 ? origin : destinations[idx - 1],
            destination: d,
            distanceMeters: 9000,
            durationSeconds: 600,
          })),
          provider: 'mock-provider',
        })),
      };

      mockPrisma = {
        deliveryBatch: {
          findUnique: jest.fn(),
        },
        fulfillmentLocationOperator: {
          findUnique: jest.fn(),
        },
      };

      mockOrderingService = {
        getOrder: jest.fn(),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          RoutePlanningService,
          { provide: ROUTING_PROVIDER, useValue: mockRoutingProvider },
          { provide: PrismaService, useValue: mockPrisma },
          { provide: OrderingService, useValue: mockOrderingService },
        ],
      }).compile();

      service = module.get<RoutePlanningService>(RoutePlanningService);
    });

    describe('planRoute', () => {
      it('uses configured Hub coordinates as default origin when none provided', async () => {
        const result = await service.planRoute({
          destinations: [validCairoStop1, validCairoStop2],
        });

        expect(mockRoutingProvider.calculateRoute).toHaveBeenCalledTimes(1);
        const [origin, destinations] = mockRoutingProvider.calculateRoute.mock.calls[0];

        expect(origin.latitude).toBe(hubCoords.latitude);
        expect(origin.longitude).toBe(hubCoords.longitude);
        expect(destinations).toHaveLength(2);
        expect(destinations[0].latitude).toBe(validCairoStop1.latitude);
        expect(destinations[1].latitude).toBe(validCairoStop2.latitude);

        expect(result.totalDistanceMeters).toBe(18000);
      });

      it('respects explicitly provided custom origin', async () => {
        const customOrigin: RouteWaypoint = {
          name: 'Custom Depot',
          latitude: 30.0131,
          longitude: 31.2089,
        };

        await service.planRoute({
          origin: customOrigin,
          destinations: [validCairoStop1],
        });

        const [origin] = mockRoutingProvider.calculateRoute.mock.calls[0];
        expect(origin.name).toBe('Custom Depot');
        expect(origin.latitude).toBe(30.0131);
      });

      it('preserves exact supplied stop sequence without reordering', async () => {
        // Stop 2 first, then Stop 1
        await service.planRoute({
          destinations: [validCairoStop2, validCairoStop1],
        });

        const [, destinations] = mockRoutingProvider.calculateRoute.mock.calls[0];
        expect(destinations[0].id).toBe('stop-2');
        expect(destinations[1].id).toBe('stop-1');
      });

      it('rejects destinations outside Cairo/Giza service area bounds', async () => {
        const alexandriaStop: RouteWaypoint = {
          id: 'alex-1',
          name: 'Alexandria',
          latitude: 31.2001,
          longitude: 29.9187,
        };

        await expect(
          service.planRoute({ destinations: [alexandriaStop] }),
        ).rejects.toThrow(UnprocessableEntityException);
      });

      it('rejects unplaced map default centroid coordinates', async () => {
        const tahrirDefaultCenter: RouteWaypoint = {
          id: 'default-center',
          latitude: 30.0444,
          longitude: 31.2357,
        };

        await expect(
          service.planRoute({ destinations: [tahrirDefaultCenter] }),
        ).rejects.toThrow(UnprocessableEntityException);
      });

      it('rejects non-finite coordinate values', async () => {
        await expect(
          service.planRoute({
            destinations: [{ latitude: NaN, longitude: 31.2122 }],
          }),
        ).rejects.toThrow(BadRequestException);
      });
    });

    describe('planBatchRoute', () => {
      const batchId = 'a0000000-0000-0000-0000-000000000001';

      it('loads stops in sequence, resolves order pins, and delegates to routing provider', async () => {
        mockPrisma.deliveryBatch.findUnique.mockResolvedValue({
          id: batchId,
          status: 'planning',
          driverId: 'driver-1',
          locationId: 'loc-hub-1',
          location: { id: 'loc-hub-1', name: 'West Cairo Hub', address: 'Smart Village' },
          stops: [
            {
              id: 'stop-seq-1',
              sequence: 1,
              shipmentId: 'ship-1',
              shipment: { orderId: 'order-1' },
            },
            {
              id: 'stop-seq-2',
              sequence: 2,
              shipmentId: 'ship-2',
              shipment: { orderId: 'order-2' },
            },
          ],
        });

        mockOrderingService.getOrder
          .mockResolvedValueOnce({
            id: 'order-1',
            orderNumber: 'ORD-101',
            customerName: 'Fatima',
            shippingAddress: 'Dokki St',
            area: 'Dokki',
            governorate: 'Giza',
            latitude: 30.0386,
            longitude: 31.2122,
          })
          .mockResolvedValueOnce({
            id: 'order-2',
            orderNumber: 'ORD-102',
            customerName: 'Karim',
            shippingAddress: 'Road 9',
            area: 'Maadi',
            governorate: 'Cairo',
            latitude: 29.9602,
            longitude: 31.2569,
          });

        const batchRoute: PlannedBatchRoute = await service.planBatchRoute(batchId, mockAdminActor);

        expect(batchRoute.batchId).toBe(batchId);
        expect(batchRoute.stopCount).toBe(2);
        expect(batchRoute.hubOrigin.latitude).toBe(hubCoords.latitude);
        expect(batchRoute.route.destinations).toHaveLength(2);
        expect(batchRoute.route.destinations[0].name).toBe('Fatima');
        expect(batchRoute.route.destinations[1].name).toBe('Karim');
      });

      it('throws NotFoundException when batch is not found', async () => {
        mockPrisma.deliveryBatch.findUnique.mockResolvedValue(null);

        await expect(service.planBatchRoute(batchId, mockAdminActor)).rejects.toThrow(
          NotFoundException,
        );
      });

      it('throws ForbiddenException when actor has no access to batch', async () => {
        mockPrisma.deliveryBatch.findUnique.mockResolvedValue({
          id: batchId,
          status: 'planning',
          driverId: 'driver-someone-else',
          locationId: 'hub-loc-1',
          stops: [{ id: 's1', sequence: 1, shipment: { orderId: 'o1' } }],
        });

        await expect(service.planBatchRoute(batchId, mockUnauthorizedActor)).rejects.toThrow(
          ForbiddenException,
        );
      });

      it('throws BadRequestException when batch has no stops', async () => {
        mockPrisma.deliveryBatch.findUnique.mockResolvedValue({
          id: batchId,
          status: 'planning',
          driverId: 'driver-1',
          locationId: 'loc-1',
          stops: [],
        });

        await expect(service.planBatchRoute(batchId, mockAdminActor)).rejects.toThrow(
          BadRequestException,
        );
      });

      it('throws BadRequestException when any stop order is missing confirmed coordinates', async () => {
        mockPrisma.deliveryBatch.findUnique.mockResolvedValue({
          id: batchId,
          status: 'planning',
          driverId: 'driver-1',
          locationId: 'loc-1',
          stops: [
            {
              id: 'stop-seq-1',
              sequence: 1,
              shipmentId: 'ship-1',
              shipment: { orderId: 'order-missing-pin' },
            },
          ],
        });

        mockOrderingService.getOrder.mockResolvedValue({
          id: 'order-missing-pin',
          orderNumber: 'ORD-NOPIN',
          customerName: 'No Pin Customer',
          shippingAddress: 'Cairo',
          latitude: null, // missing confirmed pin
          longitude: null,
        });

        await expect(service.planBatchRoute(batchId, mockAdminActor)).rejects.toThrow(
          BadRequestException,
        );
      });
    });
  });
});

import {
  Injectable,
  BadRequestException,
  BadGatewayException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { RouteWaypoint, GeoJsonLineString } from './routing.provider';
import {
  RouteOptimizationProvider,
  RouteOptimizationResult,
  RouteOptimizationOptions,
  OptimizedStopOrder,
  MAX_MAPBOX_OPTIMIZATION_STOPS,
} from './route-optimization.provider';

@Injectable()
export class MapboxOptimizationProvider implements RouteOptimizationProvider {
  readonly providerName = 'mapbox';

  private readonly token: string | undefined;
  private readonly baseUrl: string;

  constructor(token?: string, baseUrl: string = 'https://api.mapbox.com') {
    this.token =
      token !== undefined
        ? token
        : (process.env.MAPBOX_ACCESS_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN);
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async optimizeRoute(
    origin: RouteWaypoint,
    destinations: RouteWaypoint[],
    options?: RouteOptimizationOptions,
  ): Promise<RouteOptimizationResult> {
    if (!this.token || !this.token.trim()) {
      throw new ServiceUnavailableException('Mapbox access token is not configured');
    }

    if (!destinations || destinations.length === 0) {
      throw new BadRequestException('At least one destination stop is required to optimize a route');
    }

    // Single stop: stop order is trivial, avoid unnecessary third-party API call
    if (destinations.length === 1) {
      return {
        provider: this.providerName,
        optimizedStops: [
          {
            originalIndex: 0,
            optimizedIndex: 0,
            sequence: 1,
            waypoint: destinations[0],
          },
        ],
      };
    }

    // Mapbox Optimization v1 limit: 12 coordinates maximum (1 origin + 11 destinations)
    if (destinations.length > MAX_MAPBOX_OPTIMIZATION_STOPS) {
      throw new BadRequestException(
        `Mapbox Optimization v1 supports a maximum of ${MAX_MAPBOX_OPTIMIZATION_STOPS} delivery stops per run (12 coordinates total including hub origin). Received ${destinations.length} stops.`,
      );
    }

    const allWaypoints = [origin, ...destinations];

    // Format coordinates as "lng,lat;lng,lat"
    const coordString = allWaypoints
      .map((wp) => `${wp.longitude},${wp.latitude}`)
      .join(';');

    const profile = options?.profile === 'driving-traffic' ? 'driving-traffic' : 'driving';
    const roundtrip = options?.roundtrip ? 'true' : 'false';

    const url = `${this.baseUrl}/optimized-trips/v1/mapbox/${profile}/${coordString}?source=first&roundtrip=${roundtrip}&geometries=geojson&overview=full&steps=false&access_token=${encodeURIComponent(
      this.token,
    )}`;

    let response: Response;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new BadGatewayException('Mapbox Optimization API request timed out (10s)');
      }
      throw new BadGatewayException(
        `Failed to reach Mapbox Optimization API: ${err.message || 'network error'}`,
      );
    } finally {
      clearTimeout(timeoutId);
    }

    let data: any;
    try {
      data = await response.json();
    } catch {
      throw new BadGatewayException('Invalid JSON response received from Mapbox Optimization API');
    }

    if (!response.ok || data.code !== 'Ok') {
      this.handleMapboxError(response.status, data);
    }

    if (!Array.isArray(data.waypoints) || data.waypoints.length !== allWaypoints.length) {
      throw new BadGatewayException(
        'Invalid or incomplete waypoints payload received from Mapbox Optimization API',
      );
    }

    // Map each destination back to its optimized order
    // In Mapbox Optimized Trips v1 with source=first & roundtrip=false:
    // data.waypoints[0] is origin (waypoint_index 0)
    // data.waypoints[i + 1] corresponds to destinations[i], and waypoint_index is its 1-based trip visit order
    const mappedStops: OptimizedStopOrder[] = destinations.map((waypoint, originalIndex) => {
      const wp = data.waypoints[originalIndex + 1];
      if (!wp || typeof wp.waypoint_index !== 'number') {
        throw new BadGatewayException(
          `Missing waypoint_index for destination at index ${originalIndex} in Mapbox Optimization response`,
        );
      }

      const tripPosition = wp.waypoint_index;
      return {
        originalIndex,
        optimizedIndex: tripPosition - 1,
        sequence: tripPosition,
        waypoint,
      };
    });

    // Guard against corrupted or duplicate indices
    const uniquePositions = new Set(mappedStops.map((s) => s.optimizedIndex));
    if (uniquePositions.size !== destinations.length) {
      throw new BadGatewayException(
        'Duplicate or inconsistent visit indices received from Mapbox Optimization API',
      );
    }

    // Sort destinations by optimized visit sequence
    mappedStops.sort((a, b) => a.optimizedIndex - b.optimizedIndex);

    // Renumber 1-based sequences cleanly in case of gaps
    const sequencedStops: OptimizedStopOrder[] = mappedStops.map((stop, idx) => ({
      ...stop,
      optimizedIndex: idx,
      sequence: idx + 1,
    }));

    const primaryTrip = data.trips?.[0];
    const geometry: GeoJsonLineString | undefined = primaryTrip?.geometry || undefined;

    return {
      provider: this.providerName,
      optimizedStops: sequencedStops,
      distanceMeters: primaryTrip ? Math.round(primaryTrip.distance ?? 0) : undefined,
      durationSeconds: primaryTrip ? Math.round(primaryTrip.duration ?? 0) : undefined,
      geometry,
    };
  }

  private handleMapboxError(status: number, data: any): never {
    const code = data?.code;
    const message = data?.message || 'Route optimization provider error';

    if (code === 'NoTrips') {
      throw new UnprocessableEntityException(
        'No optimized route could be found for the given stops',
      );
    }

    if (code === 'InvalidInput') {
      throw new BadRequestException(
        `Invalid optimization parameters: ${message}`,
      );
    }

    if (code === 'ProfileNotFound') {
      throw new BadRequestException(`Routing profile not supported: ${message}`);
    }

    if (status === 401 || status === 403) {
      throw new ServiceUnavailableException(
        'Mapbox API authorization failed (invalid or restricted token)',
      );
    }

    if (status === 429) {
      throw new ServiceUnavailableException('Mapbox Optimization API rate limit exceeded');
    }

    throw new BadGatewayException(
      `Mapbox Optimization API failed (${code || status}): ${message}`,
    );
  }
}

import {
  Injectable,
  BadRequestException,
  BadGatewayException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  RoutingProvider,
  RouteWaypoint,
  PlannedRoute,
  RouteLeg,
  RouteCalculationOptions,
  GeoJsonLineString,
} from './routing.provider';

export const MAX_MAPBOX_STOPS = 24; // Mapbox Directions API limit: 25 total coordinates (1 origin + 24 waypoints)

@Injectable()
export class MapboxDirectionsRoutingProvider implements RoutingProvider {
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

  async calculateRoute(
    origin: RouteWaypoint,
    destinations: RouteWaypoint[],
    options?: RouteCalculationOptions,
  ): Promise<PlannedRoute> {
    if (!this.token || !this.token.trim()) {
      throw new ServiceUnavailableException('Mapbox access token is not configured');
    }

    if (!destinations || destinations.length === 0) {
      throw new BadRequestException('At least one destination stop is required to calculate a route');
    }

    if (destinations.length > MAX_MAPBOX_STOPS) {
      throw new BadRequestException(
        `Mapbox Directions supports a maximum of ${MAX_MAPBOX_STOPS} destination stops per route (received ${destinations.length})`,
      );
    }

    const allWaypoints = [origin, ...destinations];

    // Mapbox requires coordinates in "lng,lat;lng,lat" order
    const coordString = allWaypoints
      .map((wp) => `${wp.longitude},${wp.latitude}`)
      .join(';');

    const profile = options?.profile === 'driving-traffic' ? 'driving-traffic' : 'driving';
    const overview = options?.overview || 'full';
    const geometries = options?.geometries || 'geojson';

    const url = `${this.baseUrl}/directions/v5/mapbox/${profile}/${coordString}?geometries=${geometries}&overview=${overview}&steps=false&access_token=${encodeURIComponent(
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
        throw new BadGatewayException('Mapbox Directions API request timed out (10s)');
      }
      throw new BadGatewayException(
        `Failed to reach Mapbox Directions API: ${err.message || 'network error'}`,
      );
    } finally {
      clearTimeout(timeoutId);
    }

    let data: any;
    try {
      data = await response.json();
    } catch {
      throw new BadGatewayException('Invalid JSON response received from Mapbox Directions API');
    }

    if (!response.ok || data.code !== 'Ok') {
      this.handleMapboxError(response.status, data);
    }

    const primaryRoute = data.routes?.[0];
    if (!primaryRoute) {
      throw new UnprocessableEntityException('No route returned by Mapbox for the given stops');
    }

    const legs: RouteLeg[] = (primaryRoute.legs || []).map((leg: any, idx: number) => ({
      legIndex: idx,
      origin: allWaypoints[idx],
      destination: allWaypoints[idx + 1],
      distanceMeters: Math.round(leg.distance ?? 0),
      durationSeconds: Math.round(leg.duration ?? 0),
      summary: leg.summary || undefined,
    }));

    const normalizedGeometry: GeoJsonLineString = primaryRoute.geometry || {
      type: 'LineString',
      coordinates: [],
    };

    return {
      origin,
      destinations,
      waypoints: allWaypoints,
      totalDistanceMeters: Math.round(primaryRoute.distance ?? 0),
      totalDurationSeconds: Math.round(primaryRoute.duration ?? 0),
      geometry: normalizedGeometry,
      legs,
      provider: this.providerName,
    };
  }

  private handleMapboxError(status: number, data: any): never {
    const code = data?.code;
    const message = data?.message || 'Routing provider error';

    if (code === 'NoRoute') {
      throw new UnprocessableEntityException(
        'One or more destinations are unreachable by car from the origin location',
      );
    }

    if (code === 'InvalidInput') {
      throw new BadRequestException(
        `Invalid route parameters: ${message}`,
      );
    }

    if (code === 'ProfileNotFound') {
      throw new BadRequestException(`Routing profile not supported: ${message}`);
    }

    if (status === 401 || status === 403) {
      throw new ServiceUnavailableException('Mapbox API authorization failed (invalid or restricted token)');
    }

    if (status === 429) {
      throw new ServiceUnavailableException('Mapbox Directions API rate limit exceeded');
    }

    throw new BadGatewayException(`Mapbox Directions API failed (${code || status}): ${message}`);
  }
}

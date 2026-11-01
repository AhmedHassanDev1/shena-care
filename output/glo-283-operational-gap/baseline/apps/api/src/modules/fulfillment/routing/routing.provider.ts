/**
 * Routing Provider abstraction (Maps Phase 3.1).
 *
 * Establishes a minimal, stable, provider-independent contract for route calculation
 * and turn-by-turn geometry. Decouples business logic and fulfillment dispatch
 * from third-party map providers (Mapbox, OSRM, Google Maps, etc.).
 */

export const ROUTING_PROVIDER = 'ROUTING_PROVIDER';

export interface RouteWaypoint {
  id?: string;
  name?: string;
  address?: string;
  latitude: number;
  longitude: number;
}

export interface GeoJsonLineString {
  type: 'LineString';
  coordinates: Array<[number, number]>; // [longitude, latitude] pairs in standard GeoJSON order
}

export interface RouteLeg {
  legIndex: number;
  origin: RouteWaypoint;
  destination: RouteWaypoint;
  distanceMeters: number;
  durationSeconds: number;
  summary?: string;
  geometry?: GeoJsonLineString;
}

export interface PlannedRoute {
  origin: RouteWaypoint;
  destinations: RouteWaypoint[];
  waypoints: RouteWaypoint[]; // Complete ordered sequence: [origin, ...destinations]
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  geometry: GeoJsonLineString;
  legs: RouteLeg[];
  provider: string; // Identifier of the calculating provider (e.g., 'mapbox')
}

export interface RouteCalculationOptions {
  profile?: 'driving' | 'driving-traffic';
  overview?: 'full' | 'simplified';
  geometries?: 'geojson';
  language?: string;
}

export interface RoutingProvider {
  readonly providerName: string;

  /**
   * Calculates a drivable route starting from `origin` and visiting each stop in `destinations`
   * in the exact sequence provided (preserves stop sequence; no speculative optimization).
   */
  calculateRoute(
    origin: RouteWaypoint,
    destinations: RouteWaypoint[],
    options?: RouteCalculationOptions,
  ): Promise<PlannedRoute>;
}

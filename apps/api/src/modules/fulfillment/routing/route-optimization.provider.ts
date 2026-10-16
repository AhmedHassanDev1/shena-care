import { RouteWaypoint, GeoJsonLineString } from './routing.provider';

/**
 * Route Optimization Provider abstraction (Maps Phase 3.2).
 *
 * Establishes a minimal, stable, provider-independent contract for single-driver
 * stop sequence optimization (e.g., Traveling Salesperson Problem).
 * Decouples stop reordering logic from route geometry calculation,
 * fulfillment batch state management, and business authorization.
 */

export const ROUTE_OPTIMIZATION_PROVIDER = 'ROUTE_OPTIMIZATION_PROVIDER';

/**
 * Mapbox Optimization v1 allows up to 12 coordinates per request:
 * 1 origin (the fulfillment hub) + up to 11 destination stops.
 */
export const MAX_MAPBOX_OPTIMIZATION_COORDINATES = 12;
export const MAX_MAPBOX_OPTIMIZATION_STOPS = 11;

export interface OptimizedStopOrder {
  /** 0-based index in the input destinations array */
  originalIndex: number;
  /** 0-based index in the optimized visit sequence (0 = first stop after origin) */
  optimizedIndex: number;
  /** 1-based sequence number for delivery stop assignment */
  sequence: number;
  /** Destination waypoint details */
  waypoint: RouteWaypoint;
}

export interface RouteOptimizationResult {
  /** Identifier of the optimizing provider (e.g. 'mapbox') */
  provider: string;
  /** Destination stops reordered by optimal visit sequence (ascending) */
  optimizedStops: OptimizedStopOrder[];
  /** Optional driving distance in meters reported by optimizer */
  distanceMeters?: number;
  /** Optional driving duration in seconds reported by optimizer */
  durationSeconds?: number;
  /** Optional trip geometry returned by optimizer */
  geometry?: GeoJsonLineString;
}

export interface RouteOptimizationOptions {
  profile?: 'driving' | 'driving-traffic';
  roundtrip?: boolean;
  language?: string;
}

export interface RouteOptimizationProvider {
  readonly providerName: string;

  /**
   * Calculates the optimal visiting order for multiple destination stops
   * starting from the specified route origin (Hub).
   *
   * Must never silently drop any stops or modify persistent state.
   */
  optimizeRoute(
    origin: RouteWaypoint,
    destinations: RouteWaypoint[],
    options?: RouteOptimizationOptions,
  ): Promise<RouteOptimizationResult>;
}

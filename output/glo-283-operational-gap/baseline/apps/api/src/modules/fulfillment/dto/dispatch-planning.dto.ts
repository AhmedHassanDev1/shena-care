import {
  IsArray,
  IsOptional,
  ValidateNested,
  IsString,
  IsNotEmpty,
  IsInt,
  Min,
  Max,
  IsNumber,
  IsBoolean,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { GeoJsonLineString } from '../routing/routing.provider';

export class DriverAvailabilityDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsOptional()
  @IsString()
  name?: string;

  /** Maximum number of sequential trips this driver can handle in the dispatch window. Default: 3 */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  maxTrips?: number;

  /** Maximum cumulative delivery stops for this driver across all trips. */
  @IsOptional()
  @IsInt()
  @Min(1)
  maxStops?: number;

  /** Maximum shift duration in hours (driving + per-stop service time). */
  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(24)
  maxShiftHours?: number;
}

export class PlanDispatchDto {
  /** Target fulfillment hub location ID. If omitted, uses the configured default hub. */
  @IsOptional()
  @IsString()
  hubId?: string;

  /**
   * Specific candidate shipment IDs to plan.
   * If omitted, all eligible packed shipments at the hub are considered.
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  shipmentIds?: string[];

  /**
   * Available drivers for dispatch assignment.
   * If omitted, active drivers assigned or available in the system are queried.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DriverAvailabilityDto)
  drivers?: DriverAvailabilityDto[];

  /** Maximum delivery stops allowed per single trip. Default: 10 (range: 1-25). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(25)
  maxStopsPerTrip?: number;

  /** Maximum sequential trips allowed per driver. Default: 3. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  maxTripsPerDriver?: number;

  /** Estimated service/handover time spent per stop in minutes. Default: 5. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  serviceMinutesPerStop?: number;

  /** Spatial clustering radius in kilometers. Default: 5.0 km. */
  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(50)
  clusterRadiusKm?: number;

  /**
   * If true, uses road-based routing/optimization where applicable (e.g. Mapbox for <= 11 stops).
   * Default: false (uses fast local heuristic to avoid unnecessary API consumption during preview).
   */
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  useRoadOptimization?: boolean;

  /**
   * Whether each trip loops back to the Hub at the end. Default: true.
   */
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  roundtrip?: boolean;
}

export interface PlannedTripStop {
  shipmentId: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  address: string;
  latitude: number;
  longitude: number;
  sequence: number;
  estimatedArrivalMinutes: number;
}

export interface PlannedTripMetrics {
  stopCount: number;
  estimatedDistanceMeters: number;
  estimatedDrivingSeconds: number;
  serviceDurationSeconds: number;
  totalEstimatedDurationSeconds: number;
  isRoadBased: boolean;
  optimizationMethod: 'mapbox_v1' | 'local_2opt' | 'trivial_single_stop';
}

export interface ProposedTrip {
  tripId: string;
  clusterId: string;
  driverId: string | null;
  driverName: string | null;
  tripSequenceForDriver: number;
  stops: PlannedTripStop[];
  metrics: PlannedTripMetrics;
  routeGeometry?: GeoJsonLineString;
}

export interface UnassignedDispatchOrder {
  shipmentId: string;
  orderId: string;
  orderNumber: string;
  customerName?: string;
  reasonCode:
    | 'MISSING_COORDINATES'
    | 'OUT_OF_SERVICE_AREA'
    | 'NOT_PACKED'
    | 'ALREADY_ASSIGNED'
    | 'INSUFFICIENT_DRIVERS'
    | 'EXCEEDS_DRIVER_SHIFT_CAPACITY'
    | 'INCORRECT_HUB'
    | 'ORDER_NOT_FOUND';
  reasonMessage: string;
}

export interface DispatchPlanningDiagnostics {
  totalCandidateOrders: number;
  eligibleOrders: number;
  assignedOrders: number;
  unassignedOrdersCount: number;
  availableDriverCount: number;
  tripsGenerated: number;
  clusteringMethod: string;
  mapboxCallsMade: number;
  warnings: string[];
}

export interface DispatchPlanResult {
  hubId: string;
  hubName: string;
  hubCoordinates: { latitude: number; longitude: number };
  plannedAt: string;
  /** Cryptographic server-verifiable fingerprint of this preview plan */
  planFingerprint: string;
  trips: ProposedTrip[];
  unassignedOrders: UnassignedDispatchOrder[];
  diagnostics: DispatchPlanningDiagnostics;
}

// --- Plan Approval & Persistence (Phase 3.3B) ---

export class ApproveTripStopDto {
  @IsString()
  @IsNotEmpty()
  shipmentId: string;

  @IsInt()
  @Min(1)
  sequence: number;
}

export class ApproveTripDto {
  @IsOptional()
  @IsString()
  tripId?: string;

  @IsOptional()
  @IsString()
  clusterId?: string;

  @IsString()
  @IsNotEmpty()
  driverId: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  tripSequenceForDriver?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ApproveTripStopDto)
  stops: ApproveTripStopDto[];
}

export class ApproveDispatchPlanDto {
  /** Server-verifiable fingerprint from the preview plan */
  @IsString()
  @IsNotEmpty()
  planFingerprint: string;

  /** Target fulfillment hub location ID */
  @IsOptional()
  @IsString()
  hubId?: string;

  /** Idempotency key to safely retry approval requests without creating duplicate batches */
  @IsOptional()
  @IsString()
  idempotencyKey?: string;

  /** Approved trips and driver assignments to persist */
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ApproveTripDto)
  trips: ApproveTripDto[];

  @IsOptional()
  @IsString()
  notes?: string;
}

export interface ApprovedBatchSummary {
  batchId: string;
  driverId: string;
  driverName: string | null;
  status: string; // 'planning'
  stopCount: number;
  stops: Array<{
    stopId: string;
    shipmentId: string;
    sequence: number;
  }>;
}

export interface DispatchPlanApprovalResult {
  success: boolean;
  idempotentRetry: boolean;
  hubId: string;
  hubName: string;
  planFingerprint: string;
  batches: ApprovedBatchSummary[];
  totalBatchesCreated: number;
  totalStopsCreated: number;
  rejectedAssignments: Array<{ shipmentId: string; reason: string }>;
  approvedAt: string;
}

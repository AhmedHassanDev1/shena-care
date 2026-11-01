/**
 * Procurement Batching Policy Configuration (GLO-283).
 * Approved provisional operating policy for Supplier Purchase Order batching.
 */

export const DEFAULT_BATCH_INTERVAL_MINUTES = 180; // 3 hours
export const DEFAULT_DISPATCH_CHECKPOINTS = ['09:00', '12:00', '15:00', '18:00', '21:00', '00:00'];
export const DEFAULT_SUPPLIER_OPENS_AT = '09:00';
export const DEFAULT_SUPPLIER_CLOSES_AT = '01:00'; // Following day
export const DEFAULT_SCHEDULE_TIME_ZONE = 'Africa/Cairo';

export function getSupplierResponseMinutes(expedited = false): number {
  const value = Number(process.env[expedited ? 'PO_EXPEDITED_RESPONSE_MINUTES' : 'PO_NORMAL_RESPONSE_MINUTES']);
  return Number.isSafeInteger(value) && value > 0 && value <= 10080 ? value : expedited ? 30 : 60;
}

export interface ProcurementBatchConfig {
  intervalMinutes: number;
  dispatchCheckpoints: string[];
  defaultOpensAt: string;
  defaultClosesAt: string;
  timeZone: string;
}

export function getProcurementBatchConfig(): ProcurementBatchConfig {
  const envInterval = process.env.PROCUREMENT_BATCH_INTERVAL_MINUTES;
  const intervalMinutes = envInterval !== undefined && !Number.isNaN(Number(envInterval))
    ? Number(envInterval)
    : (process.env.NODE_ENV === 'test' ? 0 : DEFAULT_BATCH_INTERVAL_MINUTES);

  const envCheckpoints = process.env.PROCUREMENT_BATCH_CHECKPOINTS;
  const dispatchCheckpoints = envCheckpoints
    ? envCheckpoints.split(',').map(s => s.trim()).filter(Boolean)
    : DEFAULT_DISPATCH_CHECKPOINTS;

  const defaultOpensAt = process.env.DEFAULT_SUPPLIER_OPENS_AT || DEFAULT_SUPPLIER_OPENS_AT;
  const defaultClosesAt = process.env.DEFAULT_SUPPLIER_CLOSES_AT || DEFAULT_SUPPLIER_CLOSES_AT;
  const timeZone = process.env.SUPPLIER_TIME_ZONE || process.env.SCHEDULE_TIME_ZONE || DEFAULT_SCHEDULE_TIME_ZONE;

  return {
    intervalMinutes,
    dispatchCheckpoints,
    defaultOpensAt,
    defaultClosesAt,
    timeZone,
  };
}

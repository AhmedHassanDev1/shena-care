/**
 * Procurement Batching Policy Configuration (GLO-283).
 * Approved provisional operating policy for Supplier Purchase Order batching.
 */

import { runtimeSetting, SETTING_KEYS } from '../../../platform/settings/runtime-settings';

export const DEFAULT_BATCH_INTERVAL_MINUTES = 180; // 3 hours
export const DEFAULT_DISPATCH_CHECKPOINTS = ['09:00', '12:00', '15:00', '18:00', '21:00', '00:00'];
export const DEFAULT_SUPPLIER_OPENS_AT = '09:00';
export const DEFAULT_SUPPLIER_CLOSES_AT = '01:00'; // Following day
export const DEFAULT_SCHEDULE_TIME_ZONE = 'Africa/Cairo';

/**
 * Active sourcing mode (GLO-283). BROADCAST_ON_DEMAND is the MVP mode: demand goes out as non-binding RFQs to every
 * enrolled supplier, with no SupplierOffer, stock signal or wholesale price needed. OFFER_BASED (offer ranking + stock
 * caps from supplier files) stays in the code, inactive. Production must set SOURCING_MODE explicitly; an unset value
 * keeps the legacy mode so no environment changes behaviour silently, and an unknown value refuses to start.
 */
export type SourcingMode = 'BROADCAST_ON_DEMAND' | 'OFFER_BASED';

export function getSourcingMode(env: NodeJS.ProcessEnv = process.env): SourcingMode {
  // The mode an Admin saved in Settings → Operations wins over the deployment variable (callers passing their own env are unaffected).
  const saved = env === process.env ? runtimeSetting<SourcingMode>(SETTING_KEYS.sourcingMode) : undefined;
  if (saved === 'BROADCAST_ON_DEMAND' || saved === 'OFFER_BASED') return saved;
  const value = env.SOURCING_MODE?.trim();
  if (!value) return 'OFFER_BASED';
  if (value === 'BROADCAST_ON_DEMAND' || value === 'OFFER_BASED') return value;
  throw new Error(`Invalid SOURCING_MODE "${value}"; use BROADCAST_ON_DEMAND or OFFER_BASED`);
}

export const isBroadcastMode = () => getSourcingMode() === 'BROADCAST_ON_DEMAND';

export function getSupplierResponseMinutes(expedited = false): number {
  const value = Number(process.env[expedited ? 'PO_EXPEDITED_RESPONSE_MINUTES' : 'PO_NORMAL_RESPONSE_MINUTES']);
  return Number.isSafeInteger(value) && value > 0 && value <= 10080 ? value : expedited ? 30 : 60;
}

/** Internal planning bounds only; these values never establish a customer delivery SLA. */
export function getEstimatedPickupLead() {
  const minutes = Number(process.env.PROCUREMENT_ESTIMATED_PICKUP_LEAD_MINUTES ?? '240');
  const uncertaintyMinutes = Number(process.env.PROCUREMENT_PICKUP_UNCERTAINTY_MINUTES ?? '120');
  if (![minutes, uncertaintyMinutes].every(value => Number.isSafeInteger(value) && value > 0 && value <= 10080)) {
    throw new Error('Invalid procurement pickup estimate configuration');
  }
  return { minutes, uncertaintyMinutes };
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

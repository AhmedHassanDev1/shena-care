import { cairoWallTime, isSupplierOperating, SupplierSchedule, supplierResponseDeadline } from './supplier-schedule';
import { getProcurementBatchConfig, getSupplierResponseMinutes } from '../config/procurement-batch.config';

export interface RecoveryContext {
  now: Date;
  quantity: number;
  maximumUnitCost: number;
  currency: string;
  deliveryDeadline: Date | null;
}

export function committedDeliveryDeadline(date: Date | null): Date | null {
  return date ? new Date(cairoWallTime(date.toISOString().slice(0, 10), 23 * 60 + 59).getTime() + 60_000) : null;
}

export function recoveryExclusions(offer: {
  costPrice: number; currency: string; minimumOrderUnits: number; orderMultipleUnits: number;
  supplier: SupplierSchedule & { pickupLeadMinutes: number | null };
}, context: RecoveryContext): string[] {
  const reasons: string[] = [];
  if (!isSupplierOperating(context.now, offer.supplier, getProcurementBatchConfig().timeZone)) reasons.push('SUPPLIER_CLOSED');
  if (context.quantity < offer.minimumOrderUnits) reasons.push('MOQ');
  if (context.quantity % offer.orderMultipleUnits !== 0) reasons.push('ORDER_MULTIPLE');
  if (offer.currency !== context.currency) reasons.push('ORDER_CURRENCY');
  if (Math.round(offer.costPrice * 100) > Math.floor(context.maximumUnitCost * 100 + 1e-7)) reasons.push('MARGIN_LIMIT');
  if (offer.supplier.pickupLeadMinutes === null) reasons.push('PICKUP_FEASIBILITY_UNKNOWN');
  else if (context.deliveryDeadline) {
    try {
      const readyBy = supplierResponseDeadline(context.now, offer.supplier, getSupplierResponseMinutes(true));
      if (readyBy.getTime() + offer.supplier.pickupLeadMinutes * 60_000 > context.deliveryDeadline.getTime()) reasons.push('DELIVERY_PROMISE');
    } catch { reasons.push('NO_SERVICE_WINDOW'); }
  }
  return reasons;
}

export interface ScarceAllocation {
  id: string; orderId: string; quantity: number; deliveryDeadline: number;
  otherwiseReady: boolean; orderCreatedAt: number;
}

/** Current owner instruction: delivery deadline, physical readiness, FIFO, stable order/allocation IDs. */
export function allocateScarceQuantity(entries: ScarceAllocation[], confirmedQuantity: number): Map<string, number> {
  if (!Number.isSafeInteger(confirmedQuantity) || confirmedQuantity < 0) throw new Error('Invalid confirmed quantity');
  let remaining = confirmedQuantity;
  const result = new Map<string, number>();
  for (const entry of [...entries].sort((a, b) =>
    a.deliveryDeadline - b.deliveryDeadline || Number(b.otherwiseReady) - Number(a.otherwiseReady) ||
    a.orderCreatedAt - b.orderCreatedAt || a.orderId.localeCompare(b.orderId) || a.id.localeCompare(b.id))) {
    const quantity = Math.min(remaining, entry.quantity);
    result.set(entry.id, quantity);
    remaining -= quantity;
  }
  if (remaining !== 0) throw new Error('Confirmed quantity exceeds active demand');
  return result;
}

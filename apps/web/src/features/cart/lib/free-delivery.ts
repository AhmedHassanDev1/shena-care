export const DEFAULT_FREE_DELIVERY_THRESHOLD = 500;

export interface FreeDeliveryCalculation {
  threshold: number;
  remaining: number;
  progressPct: number;
  reached: boolean;
}

export function calculateFreeDeliveryProgress(
  total: number,
  customThreshold?: number
): FreeDeliveryCalculation {
  const threshold =
    customThreshold ??
    (Number(process.env.NEXT_PUBLIC_FREE_DELIVERY_THRESHOLD) || DEFAULT_FREE_DELIVERY_THRESHOLD);

  const safeTotal = Math.max(0, total);
  const remaining = Math.max(0, Math.round((threshold - safeTotal) * 100) / 100);
  const progressPct = Math.min(100, Math.max(0, Math.round((safeTotal / threshold) * 100)));
  const reached = safeTotal >= threshold;

  return {
    threshold,
    remaining,
    progressPct,
    reached,
  };
}

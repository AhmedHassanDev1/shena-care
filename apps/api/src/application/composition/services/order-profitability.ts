import { Prisma } from '@prisma/client';

/**
 * Internal profitability of ONE order, on exactly the approved profit model's per-order terms (see `profit-model.ts`):
 *
 *   margin = goods sold net of every discount and coupon + delivery fee the customer paid − purchase cost of those goods − packaging − delivery cost
 *
 * The delivery fee is revenue and the courier cost (actual, or the quote's estimate while none is recorded) is a cost: they are never netted.
 * Every figure is integer cents. A cost that is not recorded yet is never treated as zero for the verdict "fine", but
 * costs only ever add up: when the costs already known exceed the goods sold, the order is a loss whatever the missing ones turn out to be.
 */
export interface OrderProfitInput {
  goodsNet: number;
  customerDeliveryFee: number;
  /** Purchase cost of the goods, null while any unit has no recorded cost. */
  cogs: number | null;
  packaging: number | null;
  courier: number | null;
}

export type OrderProfitState = 'LOSS' | 'PROFIT' | 'PENDING_COSTS';
export type MissingOrderCost = 'PURCHASE_COST' | 'PACKAGING_COST' | 'COURIER_COST';

export interface OrderProfit {
  state: OrderProfitState;
  /** Revenue less every cost recorded so far (missing costs excluded, so it can only fall once they are recorded). */
  marginSoFar: number;
  /** All costs are recorded: the margin is final. */
  complete: boolean;
  missing: MissingOrderCost[];
  costs: { purchase: number | null; packaging: number | null; delivery: number | null };
}

export function evaluateOrderProfit(input: OrderProfitInput): OrderProfit {
  const missing: MissingOrderCost[] = [];
  if (input.cogs === null) missing.push('PURCHASE_COST');
  if (input.packaging === null) missing.push('PACKAGING_COST');
  if (input.courier === null) missing.push('COURIER_COST');
  const marginSoFar = input.goodsNet + input.customerDeliveryFee - (input.cogs ?? 0) - (input.packaging ?? 0) - (input.courier ?? 0);
  return {
    state: marginSoFar < 0 ? 'LOSS' : missing.length ? 'PENDING_COSTS' : 'PROFIT',
    marginSoFar, complete: missing.length === 0, missing,
    costs: { purchase: input.cogs, packaging: input.packaging, delivery: input.courier },
  };
}

type Money = Prisma.Decimal;
interface LineForCogs { id: string; quantity: number }

/**
 * Purchase cost of an order's active lines: each line from the Buy List purchases that covered it (only when every unit is costed), else the
 * whole order from the supplier-PO invoice costs when those are complete. Null while anything is uncosted; nothing is estimated.
 */
export function orderPurchaseCost(
  items: LineForCogs[],
  buyCosts: Map<string, { units: number; costedUnits: number; cost: Money }>,
  poCost: { complete: boolean; actualCogs: Money | string | number | null } | undefined,
): Money | null {
  let cogs: Money | null = new Prisma.Decimal(0);
  for (const item of items) {
    const bought = buyCosts.get(item.id);
    if (cogs && bought && bought.units >= item.quantity && bought.costedUnits === bought.units) cogs = cogs.plus(bought.cost.mul(item.quantity).div(bought.units));
    else cogs = null;
  }
  if (cogs === null || items.length === 0) {
    return poCost?.complete && poCost.actualCogs !== null ? new Prisma.Decimal(poCost.actualCogs.toString()) : null;
  }
  return cogs;
}

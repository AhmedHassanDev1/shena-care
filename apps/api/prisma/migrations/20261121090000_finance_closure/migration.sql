-- Financial closure: schema only, additive and nullable/defaulted. No data is rewritten and no historical figure changes.
-- Refunds: how much of a refund returns the delivery fee (the rest is goods).
ALTER TABLE "ordering"."refund_transactions" ADD COLUMN "delivery_fee_amount" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "ordering"."refund_transactions" ADD CONSTRAINT "refund_delivery_fee_within_amount_chk" CHECK ("delivery_fee_amount" >= 0 AND "delivery_fee_amount" <= "amount");

-- Courier cash settlements: declared cash and the counted-vs-declared variance live on the settlement.
ALTER TABLE "ordering"."courier_settlement_batches" ADD COLUMN "total_declared" DECIMAL(10,2);
ALTER TABLE "ordering"."courier_settlement_batches" ADD COLUMN "variance" DECIMAL(10,2);

-- Goods bought for cancelled/returned orders: recoverable unless an Admin confirms damage.
ALTER TABLE "operations"."order_cost_records" ADD COLUMN "damaged_amount" DECIMAL(10,2);
ALTER TABLE "operations"."order_cost_records" ADD COLUMN "damage_reason" TEXT;
ALTER TABLE "operations"."order_cost_records" ADD COLUMN "damage_confirmed_by" TEXT;
ALTER TABLE "operations"."order_cost_records" ADD COLUMN "damage_confirmed_at" TIMESTAMP(3);
ALTER TABLE "operations"."order_cost_records" ADD CONSTRAINT "order_cost_damage_non_negative_chk" CHECK ("damaged_amount" IS NULL OR "damaged_amount" >= 0);

-- Expenses: DIRECT (shared, needs approval) vs PLATFORM (never shared). Existing rows become PLATFORM.
ALTER TABLE "operations"."finance_expenses" ADD COLUMN "kind" VARCHAR(10) NOT NULL DEFAULT 'PLATFORM';
ALTER TABLE "operations"."finance_expenses" ADD COLUMN "approved_by" TEXT;
ALTER TABLE "operations"."finance_expenses" ADD COLUMN "approved_at" TIMESTAMP(3);
ALTER TABLE "operations"."finance_expenses" ADD CONSTRAINT "finance_expense_kind_chk" CHECK ("kind" IN ('DIRECT', 'PLATFORM'));

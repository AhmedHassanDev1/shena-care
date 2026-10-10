-- Promotion provenance was added to Prisma without a corresponding migration.
-- Nullable additions preserve all existing order data and historical totals.
ALTER TABLE "ordering"."orders"
  ADD COLUMN IF NOT EXISTS "applied_promotions" JSONB;
ALTER TABLE "ordering"."order_items"
  ADD COLUMN IF NOT EXISTS "applied_promotions" JSONB;

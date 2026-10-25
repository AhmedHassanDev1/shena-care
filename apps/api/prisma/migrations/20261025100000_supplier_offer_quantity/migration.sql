-- Quantity a supplier reports it can supply now (owner decision 2026-10-25: supplier quantities are kept current and
-- allocation never exceeds them). NULL = the supplier reports no quantity (availability stays yes/no, as before).
-- "quantity_updated_at" marks the supplier's own count: only allocations made after it are subtracted from it.
ALTER TABLE "sourcing"."supplier_offers"
  ADD COLUMN "available_quantity" INTEGER,
  ADD COLUMN "quantity_updated_at" TIMESTAMP(3),
  ADD CONSTRAINT "supplier_offers_available_quantity_nonneg" CHECK ("available_quantity" IS NULL OR "available_quantity" >= 0);

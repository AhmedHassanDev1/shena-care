-- Supplier working schedule (owner decision 2026-10-25): Friday is closed by default for every warehouse;
-- weekdays use JavaScript numbering (0 = Sunday … 6 = Saturday). Hours are optional "HH:MM" (Cairo time):
-- empty means open all day until the owner enters the real hours when the warehouse is connected.
ALTER TABLE "sourcing"."suppliers"
  ADD COLUMN "closed_weekdays" INTEGER[] NOT NULL DEFAULT ARRAY[5]::INTEGER[],
  ADD COLUMN "opens_at" VARCHAR(5),
  ADD COLUMN "closes_at" VARCHAR(5);

-- The delivery date promised to the customer at checkout (first day after the order on which the supplier is open).
ALTER TABLE "ordering"."orders" ADD COLUMN "promised_date" DATE;

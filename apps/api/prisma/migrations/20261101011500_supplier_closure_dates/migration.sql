ALTER TABLE "sourcing"."suppliers"
  ADD COLUMN "closed_dates" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

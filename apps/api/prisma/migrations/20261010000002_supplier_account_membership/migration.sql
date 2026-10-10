-- Nullable membership is provisioned by trusted administration, never by registration.
ALTER TABLE "accounts"."customers" ADD COLUMN "supplier_id" UUID;
CREATE INDEX "customers_supplier_id_idx" ON "accounts"."customers"("supplier_id");
ALTER TABLE "accounts"."customers" ADD CONSTRAINT "customers_supplier_id_fkey"
  FOREIGN KEY ("supplier_id") REFERENCES "sourcing"."suppliers"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

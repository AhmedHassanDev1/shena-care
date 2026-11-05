-- MVP procurement closure: audited supplier enrollment and Hub actual acquisition cost. Additive only.
-- Rollback: DROP TABLE sourcing.acquisition_cost_events, sourcing.acquisition_cost_lots, sourcing.supplier_enrollment_events;
--           DROP FUNCTION sourcing.refuse_append_only_change();

CREATE TABLE "sourcing"."supplier_enrollment_events" (
  "id" UUID NOT NULL,
  "supplier_id" UUID NOT NULL,
  "action" VARCHAR(40) NOT NULL,
  "actor_id" TEXT NOT NULL,
  "reason" TEXT,
  "before" JSONB,
  "after" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "supplier_enrollment_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "supplier_enrollment_events_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "sourcing"."suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "supplier_enrollment_events_supplier_id_created_at_idx" ON "sourcing"."supplier_enrollment_events"("supplier_id", "created_at");

-- One row per consistent cost lot / invoice line. Unit cost comes only from the supplier invoice captured at the Hub.
CREATE TABLE "sourcing"."acquisition_cost_lots" (
  "id" UUID NOT NULL,
  "purchase_order_id" UUID NOT NULL,
  "purchase_order_line_id" UUID NOT NULL,
  "supplier_id" UUID NOT NULL,
  "sku_id" UUID NOT NULL,
  "invoice_ref" VARCHAR(80) NOT NULL,
  "invoice_line_ref" VARCHAR(40) NOT NULL DEFAULT '',
  "quantity" INTEGER NOT NULL,
  "unit_cost" DECIMAL(10,2) NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'EGP',
  "version" INTEGER NOT NULL DEFAULT 1,
  "idempotency_key" UUID NOT NULL,
  "captured_by" TEXT NOT NULL,
  "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "acquisition_cost_lots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "acquisition_cost_lots_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "sourcing"."supplier_purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "acquisition_cost_lots_purchase_order_line_id_fkey" FOREIGN KEY ("purchase_order_line_id") REFERENCES "sourcing"."purchase_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "acquisition_cost_lots_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "sourcing"."suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "acquisition_cost_lots_quantity_check" CHECK ("quantity" >= 0),
  CONSTRAINT "acquisition_cost_lots_unit_cost_check" CHECK ("unit_cost" > 0),
  CONSTRAINT "acquisition_cost_lots_currency_check" CHECK ("currency" = 'EGP'),
  CONSTRAINT "acquisition_cost_lots_invoice_ref_check" CHECK (length(btrim("invoice_ref")) > 0)
);
CREATE UNIQUE INDEX "acquisition_cost_lots_idempotency_key_key" ON "sourcing"."acquisition_cost_lots"("idempotency_key");
-- The same supplier invoice line can be captured once against one PO line, whichever client retries or races.
CREATE UNIQUE INDEX "acquisition_cost_lots_one_invoice_line" ON "sourcing"."acquisition_cost_lots"("supplier_id", "invoice_ref", "invoice_line_ref", "purchase_order_line_id");
CREATE INDEX "acquisition_cost_lots_purchase_order_id_idx" ON "sourcing"."acquisition_cost_lots"("purchase_order_id");
CREATE INDEX "acquisition_cost_lots_purchase_order_line_id_idx" ON "sourcing"."acquisition_cost_lots"("purchase_order_line_id");
CREATE INDEX "acquisition_cost_lots_sku_id_idx" ON "sourcing"."acquisition_cost_lots"("sku_id");

CREATE TABLE "sourcing"."acquisition_cost_events" (
  "id" UUID NOT NULL,
  "lot_id" UUID NOT NULL,
  "action" VARCHAR(20) NOT NULL,
  "actor_id" TEXT NOT NULL,
  "reason" TEXT,
  "previous" JSONB,
  "current" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "acquisition_cost_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "acquisition_cost_events_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "sourcing"."acquisition_cost_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "acquisition_cost_events_lot_id_created_at_idx" ON "sourcing"."acquisition_cost_events"("lot_id", "created_at");

-- Audit history cannot be rewritten, whichever code path connects.
CREATE FUNCTION "sourcing"."refuse_append_only_change"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "supplier_enrollment_events_append_only" BEFORE UPDATE OR DELETE ON "sourcing"."supplier_enrollment_events"
  FOR EACH ROW EXECUTE FUNCTION "sourcing"."refuse_append_only_change"();
CREATE TRIGGER "acquisition_cost_events_append_only" BEFORE UPDATE OR DELETE ON "sourcing"."acquisition_cost_events"
  FOR EACH ROW EXECUTE FUNCTION "sourcing"."refuse_append_only_change"();

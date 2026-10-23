-- DRAFT — NOT APPLIED. Gate 08 (GLO-280) supplier offer terms + revision history. Additive only.
-- Lives outside prisma/migrations on purpose so `prisma migrate` cannot pick it up before owner approval.
-- Target name when approved: prisma/migrations/2026102XXXXXXX_g08_supplier_offer_terms/migration.sql
--
-- Semantics (all quantities are in SELLABLE UNITS of the offer's canonical SKU):
--   * cost_price (existing) stays the normalized purchase cost PER SELLABLE UNIT — every current reader (ranking,
--     PO unit_cost snapshot, financial hold, payables) keeps working unchanged.
--   * trade_pack_units = the SUPPLIER's case/carton of N identical sellable units (a purchasing unit). It is NOT a
--     manufacturer bundle: a "Pack of 2" sold to customers is its own catalog SKU and never a trade pack here.
--   * quoted_cost/quoted_cost_basis keep the number exactly as the supplier stated it (per unit or per trade pack);
--     cost_price = quoted_cost / trade_pack_units when the basis is PER_TRADE_PACK.
--   * minimum_order_units / order_multiple_units bound feasible PO quantities (ranking eligibility filter).
--   * discount_* and bonus_* describe stated terms; effective cost is computed per purchased quantity, and bonus
--     units are never counted as available stock.
--   * reported_quantity is a stock SIGNAL (not a reservation, not a confirmation); last_confirmed_at is untouched.
--   * cost_observed_at / quantity_observed_at separate price freshness from stock freshness; source_observed_at is the
--     supplier-reported row time (advisory); terms_source records who stated the terms.

-- AlterTable
ALTER TABLE "sourcing"."supplier_offers"
ADD COLUMN     "quoted_cost" DECIMAL(12,2),
ADD COLUMN     "quoted_cost_basis" VARCHAR(16),
ADD COLUMN     "trade_pack_units" INTEGER,
ADD COLUMN     "minimum_order_units" INTEGER,
ADD COLUMN     "order_multiple_units" INTEGER,
ADD COLUMN     "discount_percent" DECIMAL(5,2),
ADD COLUMN     "discount_min_units" INTEGER,
ADD COLUMN     "bonus_paid_units" INTEGER,
ADD COLUMN     "bonus_free_units" INTEGER,
ADD COLUMN     "terms_valid_until" TIMESTAMP(3),
ADD COLUMN     "reported_quantity" INTEGER,
ADD COLUMN     "cost_observed_at" TIMESTAMP(3),
ADD COLUMN     "quantity_observed_at" TIMESTAMP(3),
ADD COLUMN     "source_observed_at" TIMESTAMP(3),
ADD COLUMN     "terms_source" VARCHAR(20);

-- CreateTable: append-only history of every accepted offer change (who/what/when/before/after).
CREATE TABLE "sourcing"."supplier_offer_revisions" (
    "id" UUID NOT NULL,
    "offer_id" UUID,
    "supplier_id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "source" VARCHAR(20) NOT NULL,
    "actor_id" TEXT,
    "ingestion_item_id" UUID,
    "before" JSONB,
    "after" JSONB NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_offer_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_offer_revisions_offer_id_created_at_idx" ON "sourcing"."supplier_offer_revisions"("offer_id", "created_at");

-- CreateIndex
CREATE INDEX "supplier_offer_revisions_supplier_id_sku_id_idx" ON "sourcing"."supplier_offer_revisions"("supplier_id", "sku_id");

-- AddForeignKey: history survives offer deletion (SET NULL), never cascades away.
ALTER TABLE "sourcing"."supplier_offer_revisions" ADD CONSTRAINT "supplier_offer_revisions_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "sourcing"."supplier_offers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Range guards the application also enforces (defence in depth). Existing rows have NULLs and satisfy all of them.
ALTER TABLE "sourcing"."supplier_offers" ADD CONSTRAINT "supplier_offers_terms_valid" CHECK (
  (quoted_cost IS NULL OR quoted_cost > 0) AND
  (quoted_cost_basis IS NULL OR quoted_cost_basis IN ('PER_UNIT', 'PER_TRADE_PACK')) AND
  (quoted_cost_basis IS DISTINCT FROM 'PER_TRADE_PACK' OR trade_pack_units IS NOT NULL) AND
  (trade_pack_units IS NULL OR trade_pack_units >= 2) AND
  (minimum_order_units IS NULL OR minimum_order_units >= 1) AND
  (order_multiple_units IS NULL OR order_multiple_units >= 1) AND
  (discount_percent IS NULL OR (discount_percent > 0 AND discount_percent < 100)) AND
  (discount_min_units IS NULL OR discount_min_units >= 1) AND
  ((bonus_paid_units IS NULL) = (bonus_free_units IS NULL)) AND
  (bonus_paid_units IS NULL OR (bonus_paid_units >= 1 AND bonus_free_units >= 1)) AND
  (reported_quantity IS NULL OR reported_quantity >= 0) AND
  (terms_source IS NULL OR terms_source IN ('SUPPLIER_FILE', 'SUPPLIER_PORTAL', 'STAFF', 'CANDIDATE_PUBLISH'))
);
ALTER TABLE "sourcing"."supplier_offer_revisions" ADD CONSTRAINT "supplier_offer_revisions_source_valid"
  CHECK (source IN ('SUPPLIER_FILE', 'SUPPLIER_PORTAL', 'STAFF', 'CANDIDATE_PUBLISH'));

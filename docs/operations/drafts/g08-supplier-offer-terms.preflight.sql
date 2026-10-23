-- DRAFT preflight for g08_supplier_offer_terms. Run inside: BEGIN; SET TRANSACTION READ ONLY; ... ROLLBACK;
-- Stop (do not apply) if any check returns an unexpected result.

-- 1. Target: the Supabase development project, PostgreSQL 17.
SELECT current_database(), current_user, version();

-- 2. Migration history: 57 applied, none failed / rolled back / unfinished, no pending local-only migration.
SELECT count(*) AS applied FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;
SELECT migration_name FROM public._prisma_migrations WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL;

-- 3. No name collisions with the columns / table / constraints this migration adds.
SELECT column_name FROM information_schema.columns
 WHERE table_schema = 'sourcing' AND table_name = 'supplier_offers'
   AND column_name IN ('quoted_cost','quoted_cost_basis','trade_pack_units','minimum_order_units','order_multiple_units',
     'discount_percent','discount_min_units','bonus_paid_units','bonus_free_units','terms_valid_until','reported_quantity',
     'cost_observed_at','quantity_observed_at','source_observed_at','terms_source');
SELECT to_regclass('sourcing.supplier_offer_revisions')::text AS existing_revisions_table;
SELECT conname FROM pg_constraint WHERE conname IN ('supplier_offers_terms_valid', 'supplier_offer_revisions_source_valid');

-- 4. Existing data the CHECKs must accept (all new columns start NULL, so only sanity of the base table).
SELECT count(*) AS offers, count(*) FILTER (WHERE cost_price <= 0) AS non_positive_cost FROM sourcing.supplier_offers;

-- 5. Lock impact: ADD COLUMN without default is metadata-only on PG17; CHECK validation scans supplier_offers once.
SELECT pg_size_pretty(pg_total_relation_size('sourcing.supplier_offers')) AS offers_size;

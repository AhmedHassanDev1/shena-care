# Supabase migration `20261106170000_catalog_profiles` — APPLIED 2026-11-08 (owner confirmed)

Checked read-only against Supabase before anything was written:
- Exactly one migration is pending: `20261106170000_catalog_profiles` (78 applied, 79 in the folder, none unfinished or rolled back).
- None of its objects exist yet (no `catalog.sku_routine_profiles`, none of the 5 new columns).
- The SQL is additive only: `brands.profile`, `brands.profile_updated_at`, `products.product_type`, `products.product_subtype`, `products.classification` (all nullable) and the new table `catalog.sku_routine_profiles` (FK to `skus`, ON DELETE CASCADE). Nothing is changed or dropped.
- Note: `20261106190000_catalog_product_archive` was applied on Supabase before this one (out of timestamp order); `prisma migrate deploy` applies pending migrations regardless.

To apply (from `apps/api`, uses `DIRECT_URL` in `.env`):

    npx prisma migrate deploy

To verify afterwards (same fingerprint as `fp-before.txt`; the 8 lines must be identical):

    psql "$DIRECT_URL" -At -F ' | ' -f output/supabase-migration-2026-11-08/fp.sql

Then `npx prisma migrate status` must say the database schema is up to date.
Rollback if needed (nothing depends on it yet): `DROP TABLE catalog.sku_routine_profiles; ALTER TABLE catalog.brands DROP COLUMN profile, DROP COLUMN profile_updated_at; ALTER TABLE catalog.products DROP COLUMN product_type, DROP COLUMN product_subtype, DROP COLUMN classification;` and delete the row from `_prisma_migrations`.

## Result (2026-11-08)
`prisma migrate deploy` applied exactly one migration. Verified read-only afterwards: the fingerprint of the 8 existing data tables is identical to `fp-before.txt` (`fp-after.txt`), `catalog.sku_routine_profiles` exists (0 rows) with its FK, the 5 new columns exist, the migration is recorded as finished, and `prisma migrate status` reports "Database schema is up to date!". No data was written to Supabase: the 10 old products, 5 order items and the listing are untouched.

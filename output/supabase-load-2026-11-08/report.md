# Supabase catalog replacement: report (2026-11-08)

Old catalog archived, policies applied, the verified products imported through the pipeline. Nothing was deleted. Nothing was published. Storefront code untouched. No pipeline change and no new migration (the pending one, `20261106170000_catalog_profiles`, had been applied earlier today).

Operator script (record of exactly what ran): `apps/api/scripts/first-catalog-load.ts` (uncommitted). It ran with `NODE_ENV=test` plus explicit zeros so no background worker (outbox, domain events, RFQ, availability, retention, procurement) could act on live data. Proof: outbox 17 `held` → 17, domain events 3 → 3, orders 2 cancelled → 2, carts, sessions and customers unchanged.

## 1. Backup (verified restorable)
- Location (outside the repo, contains customer data): `C:\Users\El-mostakbal.DESKTOP-PM74NIT\shenacare-backups\supabase-2026-11-08-pre-catalog-replace\`
  - `supabase-schemas-20261108-041311.dump` (9 application schemas, schema + data, custom format, 407,841 bytes, sha256 `97fd111cf44746173923adef226f6b7acc22722df64546ce7cb79fae444ad222`)
  - `supabase-migrations-20261108-041311.dump` (`public._prisma_migrations`, sha256 `1af7f66703b792156bd28817cbc6e3a54efd9666316ec821acfee024e0239f41`)
- Proof it restores: restored into an empty PostgreSQL 17 database with **0 errors**, then **114 tables: identical row counts** to Supabase and **identical content hashes** for the 22 tables this work touches or depends on. (A restore target needs the `pg_trgm` extension.)
- Taken at the state after the `catalog_profiles` migration and before any change below.

## 2. Old catalog: archived, not deleted
Dependencies inspected first:
- The 2 historical orders (both cancelled, 5 items), the purchase order (ready, 2 lines), carts, fulfillment, care and sourcing records **do not reference any of the 10 old products**: they point at SKUs (BLESS, Eva, Hair Addict) that were already gone and carry their own name and code snapshots. Cross-context links are plain ids, not foreign keys, by design.
- The old products' own dependents: 48 ingredient links, 2 media rows + 2 media assets (RESTRICT keys), 1 listing + 1 price + 1 offer (on the already archived CeraVe Hydrating cleanser), and ingestion history.
- Matching only considers **active** SKUs, so archived products cannot capture new rows.

Done (via `CatalogItemManagementService.archive`): the 8 not-yet-archived products were archived; the 2 already archived stayed. Result: 10 archived, **0 active old SKUs**, 0 published. The one listed listing (CeraVe Hydrating) was un-listed (`CommerceService.unlistSku`); its price and offer remain as history. Orders, order items, PO lines, offers, prices, suppliers, customers, categories and the old media rows are **byte-identical** to the backup (hash check).

## 3. Policy (Catalog Policy v18 → v21, three new immutable versions)
- StarVille: enabled for Cleansers + Moisturizers (it had none).
- Eva Cosmetics: enabled, alias **"Eva Skin Clinic"**, leaves Serums & Treatments + Cleansers + Moisturizers.
- Bobai: new brand, added by the Admin (website `parkvillepharma.com/brand/bobai` recorded as Admin-entered, not verified), leaf Sunscreens.
- Sourcing: `eparkville.com`, `parkvillepharma.com`, `parkville.com.eg` read as **trusted-distributor** sources (never "official") via `RESEARCH_ALLOWED_HOSTS`. **This is a process setting for the load run; it is not in `.env` and not in any deployed environment yet.**

## 4. Import (job `3e02482b-426d-4d33-aed3-4dca0ff3ca1f`, 33 rows, real web, ~minutes)
**13 accepted, 19 on HOLD, 1 skipped, 0 retries pending.** All 13: identity EVIDENCE_VERIFIED from the brand's/distributor's own product page, evidence kept per fact.

| Brand | Product | Size | Barcode | Notes |
|---|---|---|---|---|
| Eva Cosmetics | Hyaluronic Acid Facial Serum | 30 ml | 6223001380016 VERIFIED | |
| Eva Cosmetics | Niacinamide Facial Serum | 30 ml | 6223001380054 VERIFIED | |
| Eva Cosmetics | Hyaluronic Acid Night Cream | 45 ml | 6223001384007 VERIFIED | |
| Eva Cosmetics | Hyaluronic Acid Day Gel | 45 ml | 6223001383994 VERIFIED | |
| Eva Cosmetics | Hyaluronic Acid Facial Wash | 160 ml | 6223001384021 VERIFIED | |
| Eva Cosmetics | Hyaluronic Acid Micellar Water | 200 ml | 6223001384014 VERIFIED | |
| Eva Cosmetics | Vitamin C Facial Serum | 20 ml | none | |
| Dermactive | ACTI-REPAIR CICA Cream | 50 ml | none | size supplied from the official page (its single size); 36 INCI; line ACTI-REPAIR |
| Bobai | Sunscreen Oil Defense Fluid SPF 50 | 75 ml | none | SPF 50, broad spectrum |
| Shaan | Rejuvenation Cream | 120 g | none | |
| Shaan | Antioxidant Facial Cleanser | 250 ml | none | **needs a person: page title says Antioxidant, body describes a Gentle Hydrating cleanser** |
| StarVille | Whitening Cleanser | 200 ml | none | |
| StarVille | Acne Prone Skin Cream | 60 g | none | description withheld (acne-treatment wording) |

Created as a side effect of the pipeline (same as the local run): brands **Dermactive** (verified on derm-active.com; website only, no logo/country stated) and **Bobai**; product line **Dermactive / ACTI-REPAIR**; **29 ingredients** from the CICA INCI (APPROVED, no function/benefit text); 14 original images, all `PENDING_REVIEW`.

**On HOLD (19) + 1 skipped** (14th SKU: the StarVille cleanser below has a SKU but is held):
- Missing size (the official pages state several): 8 Dermactive, 1 CeraVe (Blemish Control), StarVille Facial Cleanser Hydro, Shaan Dry S Cream.
- Category cannot be told from the name: StarVille Acne Prone Skin Gel, Shaan Soothing Gel.
- No page states the exact product: Shaan Oily Matte Cream-Gel, Bobai Extra Lightening Gel, Bobai Tinted Extra Lightening Gel.
- CeraVe Foaming and Hydrating Facial Cleanser: `COMPETING_IDENTITIES` (more than one CeraVe SKU could be it; no size given).
- **StarVille Acne Prone Skin Facial Cleanser**: SKU created, then held `USAGE_INSTRUCTIONS_CONTRADICT` (the distributor page mixes a lotion's instructions in). **Known wrong data: its description is the lotion's.** It is unpublished with an open critical exception; fix it when that exception is resolved.
- Skipped: Eva Collagen Toner (the taxonomy has no Toners leaf).

## 5. Final database state (exact)
| | Before | Now |
|---|---|---|
| Brands | 8 | 10 (+Bobai, +Dermactive) |
| Product lines | 9 | 10 (+ACTI-REPAIR) |
| Products | 10 (2 archived) | 24: **14 active** (13 accepted + 1 held), **10 archived** |
| SKUs | 10 | 24: 14 active, 10 inactive |
| Published products | 0 | **0** |
| Ingredients | 28 | 57 |
| Media assets | 2 | 16 (14 new, all PENDING_REVIEW) |
| Catalog Policy | v18 | v21 |
| Listings (listed) | 1 (1) | 1 (**0**) |
| Orders / items / PO lines / prices / offers | 2 / 5 / 2 / 1 / 1 | unchanged |
No duplicate SKU codes, barcodes or product names (checked). Zero `dry` skin-type leaks and zero undecoded HTML entities in the new data.

## 6. Not done on purpose
No price, listing, carton decision or approved image exists for any new product, so **none can or was published**.

## 7. Open items before publishing the first products
1. **Images:** all `PENDING_REVIEW` (hosts not on `MEDIA_TRUSTED_SOURCE_HOSTS`), and their files are stored on this machine (`apps/api/uploads`, URLs `http://localhost:3001/storage/…`, gitignored). They must be approved and moved to production storage before anything goes live.
2. Prices, listings, carton decisions.
3. `RESEARCH_ALLOWED_HOSTS` (the three distributor hosts) and `EXA_API_KEY` in the deployed environment.
4. People: Shaan Antioxidant cleanser (title/body mismatch), the StarVille cleanser exception (wrong description), sizes and categories for the held rows.
5. 29 new ingredients have only INCI names; function/benefits/safety text is still to be written.
6. Eva "Skin Clinic" is an approved alias but no page names it as a product line, so Eva products have no line.

## 8. How to undo
- Archive: `CatalogItemManagementService.restore(productId)` per product; listing: `CommerceService.listSku(skuId)`.
- Policy: versions are append-only; publish a new version that reverts the three brand changes.
- New products: archive them the same way. Nothing was hard-deleted, so no restore from the dump is needed for this work; the dump is the safety net for anything unexpected.

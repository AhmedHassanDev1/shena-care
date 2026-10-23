# ShinaCare — EVA Supplier Ingestion Stress Pack
Prepared: 2026-10-21. Status: **OFFLINE FIXTURES — NOT RUN**.

## Why EVA?
The provided picture shows the EVA Skin Care Natural Glow **Night Cream 50g + Free Facial Wash for Combined Skin** promotional set. This is NOT the same canonical SKU as either component. Source: https://cdn.shopify.com/s/files/1/0700/9488/0959/files/natural_glow_white_bg_1.png?v=1776525610

Products are **20 real listings from EVA Shop**, covering:
- **9 Natural Glow skincare listings**, including 2 promotional two-product sets;
- **11 Aloe Eva haircare listings**, including oil-replacement promotional labels and a 4 x 15 ml ampoule multipack.
- An additional **9 real bodycare/deodorant Natural Glow listings** are in the oracle's out-of-scope reference sheet and dirty input scenarios, because ShinaCare MVP is **Skincare + Haircare only**.

Official sources:
- https://www.shop.eva-cosmetics.com/collections/skin-care-natural-glow
- https://www.shop.eva-cosmetics.com/collections/skin-care-natural-glow?page=2
- https://www.shop.eva-cosmetics.com/collections/aloe-eva
- https://www.shop.eva-cosmetics.com/products/eva-skin-care-natural-glow-day-cream-spf-30-50g-free-facial-wash-for-oily-skin-copy

## Files (import inputs vs test oracle)
| File | Rows | Intended use |
|---|---:|---|
| `00_Test_Oracle_and_References.xlsx` | 126 case verdicts + 62 coverage checks | **NOT FOR IMPORT**: sources, expected results, prerequisites, stepwise runbook, status fields, safe read-only SQL |
| `01_Baseline_20.xlsx` | 20 | Main real-listing baseline (supplier test values) |
| `02_Dirty_Supplier.xlsx` | 34 | Arabic headings, identity mixups, invalid prices/currency/stock, duplicate rows, scope skips |
| `03_Identity_Collisions.xlsx` | 14 | EAN/alias contradictions, size/variant/pack vs single-unit, bundle collision; requires isolated test fixture |
| `04_Price_Stock_Edges.xlsx` | 18 | Cost vs retail, quantity absent vs zero, high prices, wrong currencies, pack stock |
| `05_Reimport_Changed.xlsx` | 20 | Reimport with intentional cost and qty differences |
| `06_Partial_Full_Snapshot.xlsx` | 8 | **Deliberately incomplete** snapshot, never auto-deactivate absent offers |
| `07_Second_Supplier.xlsx` | 6 | Supplier tenancy and same local supplier codes with independent costs |
| `08_Exact_Replay_Bytes.xlsx` | 20 | Same bytes as file 01, different filename: content hashing/idempotency |
| `09_Arabic_BOM_Semicolon.csv` | 6 | UTF-8 BOM, Arabic headers, semicolon delimiter, mixed-language text |
| `expected_results.json` | 126 cases | Machine-readable oracle **desired outcomes**, not real API result enums |

## VERIFIED vs SIMULATED
- **VERIFIED**: Public EVA Shop product *listing names*, line/family and shop retail price snapshot with source URL. These are not supplier prices.
- **SIMULATED**: `TEST-EVA-###` supplier codes, supplier **purchase costs** (roughly 67% of listed retail), stock quantities, synthetic EAN test numbers, expected states. None come from EVA or any real wholesaler.
- **NOT VERIFIED**: Real manufacturer barcodes, canonical internal SKU identifiers, actual supplier prices/quantities, official verified primary packshots for each standalone SKU, product-specific full INCI, and model-enriched claims.
- The only supplied image is for the bundle; **never assign it as the primary image of the standalone night cream or facial wash**.
- Some source rows are promotional *listings* rather than established physical SKU barcodes. Hold bundle/offer semantics for review instead of automatically creating canonical items.

## Mandatory sequencing / safety
1. **Wait for Antigravity to finish P0 hardening** before running imports.
2. Prepare a **separate local PostgreSQL database ending in `_test`**, ideally seeded with a controlled snapshot of existing data (never truncate Supabase).
3. Snapshot Product/Sku/SupplierOffer/Ingredient/Brand counts and targeted records to compare later. Supplier A and B fixture accounts are needed for isolation tests.
4. Start with `01_Baseline_20.xlsx`, **PARTIAL_UPDATE** mode. Approve column mapping, run pipeline; reconcile all **20** source rows.
5. Do NOT automatically publish new candidates or claim pass for promo/bundle without verified identity. Actual SKU matching depends on what canonical data is seeded.
6. Run `08_Exact_Replay_Bytes.xlsx` (exact bytes, new filename), then `05_Reimport_Changed.xlsx`; assert no canonical SKU duplication and correct supplier offer updates.
7. Run Dirty, Identity (test-only seeded EANs), Price/Stock and Second Supplier tests; require expected row-level outcomes.
8. `06_Partial_Full_Snapshot.xlsx` is a **destructive-safety scenario**. Use preview/dry-run. No auto-deactivation until scope completeness + explicit reviewed approval; **never run on production**.
9. Run the Arabic CSV test, asynchronous provider/retry and concurrent commit tests in isolated environment.
10. Record actual status in Oracle. A pass means **source row → expected DB/UI outcome** is verified, not just HTTP 200 or job published.

## Pass/fail interpretation
- **PASS**: Exact preconditions met; intended safe effect persisted; no false matches; audited source outcome.
- **FAIL**: Inconsistent identity, unsafe supplier cost/quantity update, silent missing source row, unreviewed product publication, unapproved snapshot deactivation, or cross-supplier access.
- **BLOCKED**: Missing DB seed, actual API mapping support, provider credential, verified product packshot, or independent policy decision. Mark blocked honestly; don't soften to pass.
- **SKIPPED**: Out-of-scope by configuration, with explicit saved skip reason.

## Two key expert traps
1. Source image/official collection alone cannot establish a manufacturer barcode or a standalone SKU for a promotional combo.
2. Retail shop price is **not the supplier's purchase price**. Fake fixture costs must **never** be loaded into a real supplier account or used in live inventory/commerce.

See `00_Test_Oracle_and_References.xlsx` for 126 row-level cases, 62 coverage checks, a 17-step runbook and read-only SQL checks.

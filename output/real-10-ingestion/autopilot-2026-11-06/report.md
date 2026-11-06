# Catalog pipeline closure — automatic decisions, critical-only review, clean media (2026-11-06)

Isolated run only: local PostgreSQL `real10_autopilot_test` (127.0.0.1:55494, scratch cluster) seeded from `../policy-v14-local-snapshot.json`; API from the working tree on :3063 with local file storage, no Cloudinary, no AI or discovery keys. Live product pages were read. No remote database was read or written, nothing was published, nothing was pushed.

## What changed

| Area | Change |
|---|---|
| Decision engine | `ingestion/services/catalog-decision-engine.ts` (pure, `autopilot@1`): every row ends in exactly one of AUTO_ACCEPT, AUTO_LINK, SKIP, HOLD_CRITICAL, RETRY_AUTOMATIC. Field-level fact rules, media choice and editorial QA live here. |
| Orchestration | `composition/services/catalog-autopilot.service.ts`: per-row lease, resumable stages (INTAKE_DONE → RESEARCHED → FACTS_DONE → COMPLETE), bounded automatic retries with backoff, atomic SKU ownership for concurrent imports. |
| Identity | New products are verified by a manufacturer or trusted-distributor page (brand or approved alias, product, **same size**) **before** a SKU is created. No barcode required. Re-imports link only with independent support (pipeline provenance by fingerprint or brand-ID identity key, the same verified page, or a VERIFIED barcode), never on name and size alone. Brands resolve through Policy aliases and the curated alias list (e.g. "سيرافى" → CeraVe) before matching. Brands outside the allowlist SKIP; close misspellings of allowed brands HOLD with a precomputed correction. A different size of a known product is a new SKU that goes through the same source check. List barcodes are claims: never written to a SKU; a barcode becomes VERIFIED only from the manufacturer's structured data. `skus.identity_status` and `skus.barcode_status` are separate. |
| Facts | Each proposal now carries `verification`, `decided_by`, `decision_rule`, `conflict_reason`; each run has `field_coverage` (VERIFIED / UNVERIFIED / CONFLICT / UNKNOWN). Consistent official/distributor facts apply automatically; retailer-only stays unknown; descriptive conflicts settle by authority; conflicting size, barcode, INCI, active strength, rinse-off vs leave-on (incl. against an already applied instruction) and warnings open one critical exception. The ingredient list outranks a "fragrance-free" claim; treatment wording never reaches the description; marketing never overrides instructions. |
| Review | One Critical Exceptions Queue in the existing Catalog Workbench (no new navigation). Each item: product/row, field, reason and severity, evidence and source links, candidates, a precomputed resolution, and Resolve / Correct / Reject / Retry. Corrections go back through the same checks. Per-row approval on the imports page was removed. |
| Audit | `ingestion.catalog_decisions` (append-only, enforced by trigger) records every automatic and manual decision; `ingestion.catalog_exceptions` holds the queue (one per subject/field/reason). |
| Media | Default template `sahel-clean`: solid #F7F5F2, 1254×1254, product centred at one scale, shadow engine off (`shadow.enabled=false`). Compositor: source cast shadows removed by a region test (large, dark, thick, attached to the backdrop, outside the pack's row and column span); pale caps and white tubes are never cut; coreless hairlines dropped; new `DETACHED_PART`, `UPSCALED_SMALL_SOURCE` checks. Originals and derivatives are approved automatically only when every check passes; a host missing from the trusted-media list leaves the asset pending (configuration), not rejected. |
| Publication | Verification is separate from sale: `IDENTITY_NOT_VERIFIED` replaces the universal barcode blocker (`BARCODE_MISSING` is now a warning); approved (not yet published) primary imagery satisfies readiness and is published in the same Admin sign-off; open critical exceptions block. Commercial data is never created by the pipeline. |
| Migration | `20261106120000_catalog_autopilot` (additive). Applied only to local test databases. |

## Real run (final code, clean DB)

| Step | AUTO_ACCEPT | AUTO_LINK | SKIP | HOLD_CRITICAL | RETRY |
|---|---:|---:|---:|---:|---:|
| 10 original products (33 s) | 10 | 0 | 0 | 0 | 0 |
| Same file again | reused job, no new rows or SKUs |||||
| Re-import variants (8 rows) | 0 | 5 | 0 | 3 | 0 |
| Negative gates (3 rows) | 0 | 0 | 2 | 1 | 0 |

- All ten: identity `EVIDENCE_VERIFIED` from africa.cerave.com / eparkville.com / e-majestic.com; barcode `UNKNOWN` (honest); 5–7 facts verified automatically each; 0 pending, 0 conflicts.
- Re-import AUTO_LINK: Arabic misspelt brand "سيرافى", alias `clary` with a merchant code `6224008073666` in the barcode column (not written to the SKU), canonical name instead of alias, same pages again.
- Remaining holds, all genuine: generic "CeraVe Cleanser 236ml" (three 236 ml CeraVe cleansers compete; shown as one-click candidates), "CeraVe Hydrating Cleanser 473ml" with no page (`NO_IDENTITY_SOURCE`), "Capixxy" (spelling; resolved in the UI in two steps to an Admin-confirmed link). Eva and CeraVe-shampoo skipped by Policy v14.
- A first run (kept as `result-first-BEFORE-rinse-fix.json`) held Clary Conditioner and Mask for "rinse-off vs leave-on": "Leave on for 3–5 minutes … Rinse thoroughly" was misread. Fixed and covered by tests with the real sentences; the rerun has no false holds.
- DB after the run: 10 SKUs, 0 listings, 0 prices, 0 supplier offers, 0 published products, 0 published media, 0 barcodes written.

## Media on real sources

| Product | Original | Clean editorial |
|---|---|---|
| Clary Shampoo, Clary Conditioner, Capixy Conditioner | approved automatically | approved automatically (source shadow removed, cap intact) |
| Clary Mask | approved | auto-rejected: `LOW_EDGE_CONTRAST` (looks clean at a glance; conservative heuristic) |
| Capixy Shampoo | approved | auto-rejected: `ENCLOSED_BACKGROUND` (clear pump collar) |
| CeraVe Moisturising Cream | approved (400×450) | auto-rejected: `UPSCALED_SMALL_SOURCE` |
| CeraVe Hydrating, Foaming, SA, Lotion | none: official images are 300×400 / 177×400 (`RESOLUTION_TOO_LOW`), never upscaled | — |

## Tests

- Unit + pipeline integration (fresh DB): 716 passed, 1 failed of 717 (47 suites). The failure is `brand-research.e2e-spec` "Arabic-only name": that uncommitted spec builds the identical Arabic brand name in two tests (lines 234 and 256), so the second gets BRAND_EXISTS. Not touched by this work.
- New: `catalog-autopilot.e2e-spec` (12 adversarial scenarios), `catalog-decision-engine.spec` (23), `product-compositor-regression.spec` (6, real Clary/Capixy/CeraVe sources).
- The commit set typechecks on its own in a clean worktree (API and Business); lint clean on changed files.

## Remaining

Pipeline defects: none open from this run. Conservative editorial warnings (`LOW_EDGE_CONTRAST`, `ENCLOSED_BACKGROUND`) reject some visually acceptable derivatives; tightening those metrics is a quality improvement, not a safety gap.

Publication prerequisites (legitimate, not bypassed): approved selling prices and listings for all ten; outer-carton decisions; higher-resolution official packshots for four CeraVe SKUs; editorial images for Clary Mask, Capixy Shampoo and CeraVe Cream; trusted-media host entries (`MEDIA_TRUSTED_SOURCE_HOSTS`) for distributor sites in each environment.

Owner decisions: apply migrations `20261105130000`, `20261105140000`, `20261106120000` to a shared database (not done); confirm the publication rule change (barcode no longer universally required when identity is evidence-verified); `RESEARCH_ALLOWED_HOSTS` / `MEDIA_TRUSTED_SOURCE_HOSTS` values for eparkville.com and e-majestic.com.

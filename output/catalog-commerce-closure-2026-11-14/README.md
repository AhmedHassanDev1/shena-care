# Catalog and commerce closure — 2026-11-14

This report separates the retained real-product pilot, synthetic regression fixtures and the configured shared development environment. Local test selling prices are **not commercial approvals**. No production deployment or shared-database mutation was performed.

## A. Git

Work was isolated on `codex/catalog-commerce-verification-20261114`, continuing from `ee38c3e`. Current verified code/test head is `feaba13`; the evidence-only commit containing this report follows it. `main` retains `574622d`, `ee38c3e` and the independent AI-service change `63143e9`.

Independently verified batches were fast-forwarded to main and pushed normally:

- `9bb0856`: Catalog owner services use concrete internal injection imports, fixing real Nest bootstrap failures caused by their own public barrel's circular imports. Public module boundaries remain intact.
- `886162e`: Shared sellable-SKU test fixtures explicitly provide an identity review and valid generated GTINs; durable buy-list tests await the actual orders' delivered events. Production validation was preserved.
- `4bbabaf`: Exact selected-size and asset-name validation, removal of review-aggregate size text from product facts, campaign/homepage image exclusion and structured product-image precedence. Extractor version is now 3; there is no schema migration.
- `feaba13`: An opt-in guarded real-SKU HTTP/DB commerce proof, plus purchase-batch test isolation that drains previous due events before parking old demand and dispatches each new order's own events.

Unrelated dirty main storefront/Claude files were preserved, including the existing `.claude/worktrees` entries. Original image WIP `242c6fd` and measured profile WIP `51b4acd` remain separate and unmerged. No package manifest, lockfile, frontend source or production configuration changed in these batches. Untracked retained images, ignored local databases/backups/logs and generated build output remain local. The Business tsconfig has no semantic diff; its automatic task-output includes were removed after the build.

## B. Catalog

The ten real intake rows are terminal: **5 created, 3 linked, 2 unresolved, 0 skipped**. Eight identities are persisted; **five are technically sellable in the isolated pilot and five are held**. These are not ten commercially approved products. See [the per-product persisted audit](final-integrity-audit.json).

| Product | Persisted decision | Public result / remaining evidence |
|---|---|---|
| CeraVe Hydrating Cleanser 236 ml | READY | API and original image 200; DEV EGP 100 |
| CeraVe Foaming Cleanser 236 ml | READY | API and original image 200; DEV EGP 100 |
| CeraVe SA Smoothing Cleanser 236 ml | READY | API and original image 200; DEV EGP 100 |
| The Ordinary Niacinamide 10% + Zinc 1% 30 ml | READY | API and original image 200; owner's DEV EGP 950 |
| The Ordinary HA 2% + B5 **Original Formulation** 30 ml | NEW READY | Exact original formulation recovered; approved authentic native image; DEV EGP 100; real checkout verified |
| CeraVe Moisturizing Cream 454 g | HOLD / public 404 | Official feature highlights Niacinamide while the complete INCI does not list it. Reliable exact-formula/stock-label reconciliation is still required. No claim of ingredient absence was invented. |
| LRP Effaclar Foaming Gel 200 ml | UNRESOLVED | Existing protected provider still returns official-site access denied after five recorded attempts; no identity created by guesswork. |
| LRP Cicaplast Baume B5+ 40 ml | UNRESOLVED | Same permitted official-source access blocker; exact identity remains unverified. |
| Cetaphil Gentle Skin Cleanser 236 ml | NEW VERIFIED IDENTITY / HOLD / public 404 | Manufacturer explicitly offers 236 ml, but currently selects 1 L and shows its 1 L hero; original CDN also denies robots access. Exact permitted 236 ml native packshot still needed. |
| Bioderma Sensibio H2O 250 ml | HOLD / public 404 | A second official UK page confirms variant 28703A; native image fetch remains robots-disallowed. No 500 ml substitution. |

The two recovered identities were retried through the existing intake owner in a fresh local clone. There are zero duplicate identity keys, no pending intake rows or active leases, and a replay drain performs zero work. Missing barcodes remain empty. Outer carton is UNVERIFIED; no boxed/unboxed promise was created. Optional presentation fields and neural enhancement do not clear factual, identity, rights, primary-image, listing or price gates.

## C. Data integrity and images

The actual Cetaphil page exposed two independent problems: a size inside `bvseo-itemReviewed` was being treated as product evidence, and a page mentioning 236 ml while selecting 1 L could contribute a generic 1 L image. Version 3 removes the review label, requires an unambiguous matching selected size when no exact AEM variant binding exists, and rejects contradictory asset filename sizes. Six focused regression cases reproduce mismatched selection, absent selection, correct selection, review text, stale hero and unrelated campaign imagery.

Real Ordinary enrichment initially selected a larger two-product homepage campaign. Visual inspection caught it **before publication**. The asset was rejected through the media owner and its old source-image fact candidates withdrawn. The new extractor selects the actual product asset instead. [Correction and lineage](campaign-correction.json) retains both hashes:

- Rejected, never published: `6d8b78ba961ec932ae58f7c27e67d93876cab8f89a68ddb29c2133dfd6f80882`.
- Approved native 1200×1200 original: `741b042d7dca0edd0c85cd41fb6c07656ed4e50fbbab7890c4d51899f48e75ae`.

The approved manufacturer image visibly contains one HA 2% + B5 bottle with intact label, geometry and colors. Exact 30 ml identity is established by the selected official page and named original asset; the front image does **not** visibly establish net content or carton presence. No pixels were synthesized, relabeled or composited to make the proof pass. Reviewer authentication remained mandatory: publication was performed only after the actual publishing administrator reviewed the correct original.

All five ready SKUs' public image bytes match an approved native primary asset by SHA-256 and dimensions; applied fact proposals retain HTTPS source, content hash and observation time. The audit reports **zero provenance errors and zero identity errors**. Native WebP/readability tests pass. No global media resolution/rights/variant threshold was lowered.

The existing asynchronous enhancement/original fallback is preserved. Two optional derivatives remain pending. Slow neural WIP was not merged: the saved `51b4acd` four-thread profile measured cold loading **57.451 s**, first inference **135.308 s**, warm inference **85.247 s** and failed the 60 s budget. Those settings were not adopted. This batch verifies original-image availability and fallback behavior; it does not claim that the live BiRefNet worker timeout is fixed.

Current market references remain advisory and version-filtered. Niacinamide's retained HIGH reference is EGP 650 (three sellers), while its explicitly assigned local selling price remains EGP 950. Foaming/Cream/SA single-seller references remain UNVERIFIED; the two newly recovered products have no researched price. Old/withdrawn observations and cross-product evidence cannot become accepted current references. No market-research call assigned a SellingPrice or SupplierOffer. The commerce proof snapshots and verifies unchanged prices, listings and offers.

Historical evidence warning: `source-investigation.json`, `recovered-products.json` and `new-product-images.json` record discovery **before** the campaign correction; the initial Ordinary image is withdrawn. Use `campaign-correction.json`, `new-publication.json` and `final-integrity-audit.json` for final approved state. The untracked initial campaign PNG is not an approved product asset.

## D. Real commerce

[SA proof](commerce-proof.json) and [new Ordinary proof](ordinary-commerce-proof.json) each passed 13 recorded HTTP/DB checks on actual retained SKUs. Ordinary's latest proof sends **two concurrent checkout submissions plus a replay**, persists exactly one order and reaches the authenticated INTERNAL_BUY_LIST with exactly two units of the exact SKU at DEV EGP 100 each. Its JSON records duration, order ID, native image hash and individual HTTP results.

The proof exercises public listing/detail/image delivery, real OTP send/verify, malformed/wrong-code denial, anonymous 401, customer/admin separation, cart persistence and cross-customer isolation, invalid SKU/quantity, client price injection, held Cream rejection, quote ownership, stale revision, unchanged order/allocation/cart state after failed submissions, persisted server-side price, order ownership and durable procurement delivery. A retried serialization conflict was logged during concurrent checkout; the existing transaction retry recovered and both callers received the same persisted order. No duplicate order was hidden by deleting test data.

The committed runner is `apps/api/scripts/verify-catalog-commerce.cjs`. It requires matching guarded localhost `_test` datasource URLs, `NODE_ENV=test` and `SOURCING_MODE=INTERNAL_BUY_LIST` before loading the application. It reads existing prices/catalog state and adds only isolated test actors/carts/orders. It is specifically for the retained pilot, including its held Cream SKU; it does not create prerequisites or production prices.

From `apps/api`, with an explicitly guarded clone environment and retained local media configured:

```powershell
node scripts/with-system-ca.cjs scripts/verify-catalog-commerce.cjs a30ad05a-d192-479b-9900-2f4c27793d11 100 <report-path>
```

## E. Testing, builds and remaining impact

[Focused results with exact test identities](focused-tests.json) record exit 0 separately for 50 bootstrap/identity/pricing/navigation tests, 53 cart/checkout/buy-list/integrity tests, 37 exact-source/native-media tests, 14 procurement/checkout regression tests and 177 storefront tests. Groups overlap and must not be summed. The full API run also exercises retry/lease recovery, authentication, neural fallback and compositor tests.

The final sequential run at `feaba13` used another fresh restored database and exited **1**: **140 suites passed / 27 failed; 1111 tests passed / 104 failed / 1 skipped**, 266.763 s. Comparing exact test identities against `574622d` (863 passed / 344 failed / 1 skipped) found **zero newly failing identities**; comparison to the original `2f97b0a` baseline is retained in the same artifact. See [final comparison and all failed test identities](final-full-suite-comparison.json). This is not a green full suite.

Two earlier attempts remain visible: [first run](full-suite-comparison.json) had 1109 passed / 106 failed, including the two purchase-batch cross-suite fixture failures now fixed; [connection-affected run](connection-failure-run-comparison.json) had 1089 passed / 126 failed, with 21 newly failing identities all reporting database initialization connection failures. The final sequential rerun had **zero database connection failures** and confirmed both purchase-batch failures resolved. The environmental instability's underlying cause was not proven; concurrent host workload was isolated operationally, not asserted as a diagnosed database defect.

The old failures are **not all irrelevant**: catalog media publication/discovery, legacy administrative routes/security expectations, supplier PO/availability/receiving and broader C2C acceptance remain incompletely verified. The focused retained-SKU purchase proof does not certify those workflows. See the exact failed identities and messages in the full-suite comparison. No unrelated production workflow or failing assertion was rewritten just to make the suite green.

API's standard main-checkout `nest build` and normal `tsc --noEmit` exited 0; no production preserveSymlinks change was required. Business production Webpack build completed all 43 routes using the existing OS-CA launcher with SSL verification enabled; isolated Business typecheck exited 0. Its ordinary main typecheck hit an existing collision between two generated route caches, while a clean isolated build/typecheck passed. Worktree junctions require Webpack for Business; this is not evidence of a normal API deployment TS2742 failure.

Storefront typecheck and 35 suites / 177 tests passed. Token, core design and class checks passed, but asset provenance validation remains blocked by the missing `docs/frontend/homepage-image-manifest.md` and 16 existing unlisted assets. No provenance manifest was fabricated. The pnpm shim tried automatic workspace preparation, was stopped, and verification used the installed tools directly; no manifest/lock changes were committed.

Earlier in this batch the AI mock suite passed 66 tests / 3 skipped. After the interruption the registered system Python and graphify interpreter target were missing: a fresh bundled-Python retry passed the model-failure fallback test, while the TLS test could not import the existing `requests` dependency. Graph update was attempted but could not load its missing interpreter/tree-sitter native binding. These environmental checks remain explicitly blocked; no new Python environment or ML dependency was installed to conceal them.

## F. Database and environment

[Database safety](database-safety.json) records backup/restore verification of all ten retained rows from `catalog_blockers_20261113_test` to **new** `catalog_commerce_closure_20261114_test`, localhost 5434. Original pilot data was not overwritten. All real-product changes, DEV prices and real checkout proofs in this report occur only in that new clone.

Fresh regression databases `catalog_commerce_regression_20261114_test`, `catalog_commerce_full_20261114_test`, `catalog_commerce_final_20261114_test` and `catalog_commerce_stable_20261114_test` were independently restored from the same retained prechange backup. Each used the 90 current migrations; the three already-existing main migrations applied to those older backups were `20261114100000_finance_profit_model`, `20261114120000_purchase_batches`, `20261114130000_staff_phone`. This task introduces **zero new migrations**. Restores only targeted newly created databases; existing databases were not reset, replaced or deleted. Ignored custom-format backups and the preserved source databases provide rollback/reproduction.

[Configured development read-only check](development-readonly.json) found the shared datasource reachable (11 products / 11 SKUs) inside an explicit READ ONLY transaction, but the configured API, Business, storefront and AI HTTP services were unreachable. The API environment points to shared, non-test data and Cloudinary; AI service token and pseudonym secret are missing. No shared write, migration, synthetic price, server repointing or deployment was performed. The isolated proof does **not** establish shared-development cart/checkout, runtime frontend compatibility or launch readiness.

## G. Final readiness classification

**BLOCKED — SPECIFY EXACT REASONS.** Five pilot products still lack essential factual/source/image evidence; the broader API suite retains relevant catalog/commerce/security failures; the intended development services did not pass runtime verification; native Python/graph maintenance checks are environmentally blocked; and live BiRefNet inference remains outside its budget. Five local pilot products and their original-image commerce path are verified within the scope above. Commercial launch approval and shared-development readiness are not asserted.

Next closure actions are the specific permitted originals/formula evidence in section B, diagnosis of the exact retained critical full-suite failures, and owner-controlled restoration/configuration of the intended development services. Continue using originals while optional neural work remains isolated; do not remove factual/publication gates or write local test prices into shared data.

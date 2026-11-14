# Catalog autopilot closure — isolated pilot, 2026-11-14

## Scope and outcome

All catalog, price, order and migration writes were confined to guarded localhost PostgreSQL databases ending in _test. The retained pilot is catalog_blockers_20261113_test on 127.0.0.1:5434. Both datasource URLs were checked for identical local targets before every runner. No shared Supabase database was migrated or written, and no production deployment was performed. All code batches were individually reviewed, tested, fast-forwarded into main and pushed normally; other agents' work was preserved.

The 10-product job is COMPLETED: **3 automatic drafts, 3 links to existing canonical SKUs, 4 unresolved identities, 0 skipped**. All 10 rows have terminal decisions and provenance. There are no pending intake rows, active intake jobs or expired leases in this isolated database (all five retained intake jobs are COMPLETED). Replaying the drain worked zero rows and changed no product, SKU, fact or asset counts. Six verified pilot identities persist with zero duplicate identity keys.

**4/10 are technically publishable in the isolated development test; 0 are asserted commercially launch-ready.** Ordinary Niacinamide 30 ml retains the explicitly assigned DEV-ONLY EGP 950. Hydrating, Foaming and SA use explicitly assigned DEV-ONLY EGP 100. These are not approved production prices, market prices or supplier costs. No synthetic price was written to shared infrastructure.

| Product | Processing decision | Publication result | Critical reason |
|---|---|---|---|
| CeraVe Hydrating Facial Cleanser 236ml | AUTO_LINK | TECHNICALLY READY — DEV ONLY |  |
| CeraVe Foaming Facial Cleanser 236ml | AUTO_LINK | TECHNICALLY READY — DEV ONLY |  |
| CeraVe Moisturizing Cream 454g | AUTO_LINK | HOLD_CRITICAL | REAL_VALIDATION_SOURCE_FORMULA_CONFLICT |
| CeraVe SA Smoothing Cleanser 236ml | AUTO_ACCEPT | TECHNICALLY READY — DEV ONLY |  |
| The Ordinary Niacinamide 10% + Zinc 1% 30ml | AUTO_ACCEPT | TECHNICALLY READY — DEV ONLY |  |
| The Ordinary Hyaluronic Acid 2% + B5 30ml | HOLD_CRITICAL | HOLD_CRITICAL | PAGE_NAMES_ANOTHER_VARIANT |
| La Roche-Posay Effaclar Purifying Foaming Gel 200ml | HOLD_CRITICAL | HOLD_CRITICAL | RETRY_EXHAUSTED |
| La Roche-Posay Cicaplast Baume B5+ 40ml | HOLD_CRITICAL | HOLD_CRITICAL | RETRY_EXHAUSTED |
| Cetaphil Gentle Skin Cleanser 236ml | HOLD_CRITICAL | HOLD_CRITICAL | SIZE_NOT_CONFIRMED |
| Bioderma Sensibio H2O 250ml | AUTO_ACCEPT | HOLD_CRITICAL | PRIMARY_IMAGE_SOURCE_RESTRICTED |

## Actual product proof and authentic images

The new SA Smoothing Cleanser 236 ml proof covers authenticated/public listing, original image, cart, quote, checkout and INTERNAL_BUY_LIST. Order 252474f8-3a74-4f9d-9141-12d314f611f8 appears as the exact order-specific requirement in the buy list. Checkout replay returned the same order. Public API and image returned 200. Customer buy-list access returned 403 and anonymous workbench access returned 401. The other three products were freshly checked against persisted identity, current Commerce orderability, authenticated workbench, public detail and native image hashes in final-pilot-closure.json. Held Cream and Bioderma detail requests returned 404; Commerce denied orderability.

The authentic SA original is unchanged at **200x400**, SHA256 **9f56f7745a0cef9e11e0d1a3f0fe0997348c5bf424d28d070b6d65c9edce026a**. Visual review at native resolution established the readable CeraVe, SA Smoothing Cleanser, and 8 FL OZ / 236 ml label, intact pump/bottle geometry and colors. The exact original is retained as apps/api/test/fixtures/media/cerave-sa-smoothing-cleanser-236ml.webp. No upscaling, synthesis, relabeling, new shadow or segmentation result was published.

Automatic resolution thresholds remain unchanged. A small verified manufacturer portrait can only enter private PENDING_REVIEW quarantine. It still fails automatic approval. Explicit Admin review must supply readable brand, product and exact net-content text for an independently verified SKU; the proof binds to the original content hash and reviewer. Wrong 500 ml, substring 1236 ml, missing proof, untrusted sources and customer actions are rejected. Publication independently checks the stored proof. A manual review is recorded as manual, not falsely labeled automatic.

Bioderma's manufacturer page explicitly binds the 250 ml primary asset to variant **28703A** in its configurable-product data; the default 500 ml OG image is no longer an acceptable substitute. Only the exact variant's primary asset is extracted; unrelated gallery roles, ambiguous variants and extra formulation dimensions are excluded. Import revalidates the current product page and rejects rejected/stale wrong-variant image evidence. The exact 250 ml CDN asset returns ROBOTS_DISALLOWED, so its bytes were not imported, approved or replaced with a guessed image. Source, rights and variant gates were preserved.

Missing full INCI on Bioderma is unknown and noncritical under the owner's revised policy; its old missing-INCI-only exception was settled with an audit note. No ingredient, fragrance-free claim, absence of warnings or carton claim was invented. The remaining image exception blocks publication. All four ready products retain UNVERIFIED carton status without a boxed/unboxed promise.

## Current regular-market prices — policy market-price@4

The existing research/store/schema are reused. Observations retain actual currency, source URL/domain, source type, observation time, price type, confidence and an excerpt in versioned evidence. The existing priceEgp and regularPriceEgp columns remain separate; source metadata uses the existing evidence column, and reference confidence/evidence use the existing check JSON. No migration or parallel pricing system was added.

Current references only use exact-brand/product/formulation/size/unit/pack evidence. The offered title and its own page heading must support the canonical title using existing deterministic identity helpers. A shared generic Cleanser word, related-product metadata, invalid GTIN, mismatched size/strength, missing size, aggregate lowPrice, unverified marketplace seller or unknown retailer is insufficient. SSL verification, public-DNS/SSRF restrictions, robots and source restrictions remain enabled.

A plain undiscounted offer is REGULAR. Sale/coupon/save-percent/crossed-price context is kept separate. A structured struck list price is only LIST_CANDIDATE until independently corroborated by a reasonably consistent regular price. One established pharmacy can provide MEDIUM confidence; consistent independent sources provide HIGH. Multiple listings from one seller do not count as independent sellers. Large differences trigger price-only review, never a catalog identity hold. Market research never writes SellingPrice, Listing or SupplierOffer.

**The initially reported price coverage was corrected, not retained as a success.** Inspection of actual source URLs exposed Hydrating/Foaming/SA prices accepted from a Blemish Control or another cleanser page by partial-word overlap. These references were withdrawn. withdrawn-market-v2.json is explicitly historical invalid evidence, not a usable reference. Earlier-policy observations/checks are preserved for audit but excluded from current reference reads and current-rule fetch reuse. The final rule also fixes save-percent promotion detection. Current results are below; UNVERIFIED candidate medians are not approved market references.

| Verified SKU | Candidate regular median EGP | Confidence | State | Reason |
|---|---:|---|---|---|
| CeraVe Hydrating Facial Cleanser 236ml | Unknown | UNVERIFIED | UNAVAILABLE | NO_VERIFIED_REGULAR_PRICE |
| CeraVe Foaming Facial Cleanser 236ml | 540 | UNVERIFIED | UNAVAILABLE | REGULAR_PRICE_NOT_CORROBORATED |
| CeraVe Moisturizing Cream 454g | 1050 | UNVERIFIED | UNAVAILABLE | REGULAR_PRICE_NOT_CORROBORATED |
| CeraVe SA Smoothing Cleanser 236ml | 600 | UNVERIFIED | UNAVAILABLE | REGULAR_PRICE_NOT_CORROBORATED |
| The Ordinary Niacinamide 10% + Zinc 1% 30ml | 650 | HIGH | REFERENCE_READY | CORROBORATED_REGULAR_PRICE |
| Bioderma Sensibio H2O 250ml | Unknown | UNVERIFIED | UNAVAILABLE | NO_VERIFIED_REGULAR_PRICE |

Coverage: **1 reliable HIGH reference, 3 uncorroborated regular candidates, 2 without a reliable observation**, out of six verified SKUs. Four unverified identities were not priced. Ordinary Niacinamide 30 ml has a corroborated regular reference of EGP 650; each underlying observation and URL is retained in real-market-prices.json and final-pilot-closure.json. Unknown prices remain terminal UNAVAILABLE answers and do not hold the product. Selling prices, listings and supplier offers were compared before/after real research and remained unchanged.

## Critical cases still requiring evidence

- **CeraVe Moisturizing Cream 454g**: Official cream page highlights Niacinamide but its INCI does not list it; formula claim requires review Resolution: Reconcile Niacinamide feature with the exact 454 g manufacturer INCI or a reliable stock label; keep unpublished meanwhile
- **The Ordinary Hyaluronic Acid 2% + B5 30ml**: The official page found is for Hyaluronic Acid 2% + B5 (with Ceramides), not exactly "Hyaluronic Acid 2% + B5" Resolution: Give the exact product name or its official page URL
- **La Roche-Posay Effaclar Purifying Foaming Gel 200ml**: Kept failing after 5 automatic attempts: BRAND_RESEARCH_UNAVAILABLE:SITE_ACCESS_DENIED; exact identity remains unverified, so creating this SKU would be unsafe. Resolution: Provide a permitted manufacturer page for La Roche-Posay Effaclar Purifying Foaming Gel 200ml or restore official site access before retrying
- **La Roche-Posay Cicaplast Baume B5+ 40ml**: Kept failing after 5 automatic attempts: BRAND_RESEARCH_UNAVAILABLE:SITE_ACCESS_DENIED; exact identity remains unverified, so creating this SKU would be unsafe. Resolution: Provide a permitted manufacturer page for La Roche-Posay Cicaplast Baume B5+ 40ml or restore official site access before retrying
- **Cetaphil Gentle Skin Cleanser 236ml**: The product page names the product but not this size, so the variant is not proven Resolution: Add the page for this exact size
- **Bioderma Sensibio H2O 250ml**: The exact 250 ml manufacturer asset is bound to variant 28703A, but its CDN robots policy denies fetching. Without permitted original bytes its identity/label and image quality cannot be approved. Resolution: Supply a permitted authentic manufacturer 250 ml original or an accessible official exact-variant packshot URL

These are six product exceptions, not optional-field approvals. Each retained exception contains evidence, why creating/publishing the SKU would be unsafe and a specific resolution action. Cream's Niacinamide feature versus its complete INCI remains a real contradiction, not a claim that the ingredient is absent. One duplicate exception introduced while refreshing that issue was consolidated through the owner while retaining the original exception OPEN; no factual hold was cleared. The four unresolved product-source searches were rechecked through existing providers with bounded calls; no additional approved exact pages were found. No exhausted job was reset into an infinite retry.

## Reliability, verification and deployment boundary

The fifth failed intake attempt now persists atomically with supporting evidence, then settles UNRESOLVED and clears the lease/retry time. A real PostgreSQL test recovers an expired lease, verifies attempts=5, closes the job and proves replay schedules no sixth attempt. The two retained LRP historical counters were corrected from 4 to 5 using their recorded five-attempt terminal reasons; original error context and the prior recorded count remain in the evidence.

Optional descriptions no longer falsely block PDP readiness. Selling readiness reads Commerce orderability and only requires a supplier offer cost in OFFER_BASED mode; INTERNAL_BUY_LIST does not acquire a false supplier-cost blocker. Listing, price, verified identity, authentic primary media and genuine critical contradictions still gate publication. Market reference confidence cannot set a selling price or override a hold.

The existing nonblocking BiRefNet/original fallback remains in place. There was no new worker timeout increase, new model or ML infrastructure. Slow image experiments remain separate: original WIP 242c6fd and pushed profile WIP 51b4acd are preserved and unmerged. Optional enhancements are not used as primary-image availability or publication requirements.

Verification details are in verification.json and full-regression-comparison.json. Final focused checks, real retained-cohort HTTP/DB checks, API typecheck/build and Business typecheck/production build are reported separately from pre-existing full-suite failures. The actual main API build uses its standard production configuration; worktree-only preserveSymlinks was not added to deployment configuration. Business built all 43 routes in a task-specific output directory; the two automatic tsconfig include changes were restored. No manifest, framework version or lockfile change was made.

A pre-existing test inherited a developer Cloudinary uploader and attempted an upload that failed. The run was stopped; test setup now forces local media providers and has a regression test. Subsequent integration/full comparisons used local storage and empty external live-test keys. No successful remote upload was recorded. The pnpm launcher separately attempted automatic workspace preparation and was cancelled on certificate errors; existing installed tools were used without disabling TLS or changing dependencies.

A local pg_dump custom-format backup was restored into an independent database and all ten pilot rows were verified before the three existing main migrations were applied locally. All 90 migrations are present locally. This batch introduces zero migrations. Shared development/production databases were not migrated or cleaned. Existing development processes on ports 3001/3002 were not restarted or repointed; public catalog and authenticated checkout proofs were run against the guarded isolated application. No production deployment is claimed.

Passing code batches merged/pushed: 50da311 (regular/promo separation), 18b59e4 (test upload isolation), 5ba1f41 (exact variant originals), 2ea3b7a (native readability proof), 1838731 (retry closure), a90d99f (exact size boundaries), ef5bf25 (optional/sourcing readiness), 574622d (cross-product and obsolete price rejection). No matching engine/research-provider redesign, dependency, endpoint or new ML stack was introduced.

Final verification of catalog code at 574622d: 24 focused suites and 136 tests passed (exit 0); two Python BiRefNet regression tests passed (exit 0). API standard production build, API typecheck, changed-file lint, Business typecheck and Business production build each exited 0. The full suite remains failing: identical restored local test databases yielded baseline 835 passed / 345 failed / 1 skipped, versus candidate 863 passed / 344 failed / 1 skipped. Comparing individual test identities found zero newly failing tests. This is evidence of no detected regression in that comparison, not a claim that the full suite is green. See the compact comparison for the retained baseline failures.

While preparing this evidence commit, main advanced independently to 63143e9 with changes confined to services/ai. Those changes are outside this catalog batch and its test claims. The final evidence merge preserves them; catalog verification above remains explicitly bound to 574622d.

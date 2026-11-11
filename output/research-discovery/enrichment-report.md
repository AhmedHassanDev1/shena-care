# ShinaCare research enrichment closure — 2026-11-11

## Scope and result

This round started from clean local `main` (`c3e5a1e`, containing the research merge at `3ffd6e2`) in the isolated research worktree. The desktop worktree with 124 uncommitted changes stayed on `codex/main-work-in-progress-20261111` and was not modified. Development catalog writes used `CanonicalResearchService.startRun` followed by `autoVerify`, with exact existing SKU IDs, sizes, identity-source URLs and an existing Admin actor checked before each run. No images or other product systems were changed.

**Measured improvement:** full INCI completeness increased from **1/10 to 2/10**. SC-MVP-055 gained 26 reviewed ingredient links and an applied `composition.fragrance = PRESENT` fact (`isFragranceFree = false`). The official source is [L'Oréal Paris Hyaluron Moisture Shampoo 200 ml](https://www.loreal-paris-me.com/en/elvive/hyaluron-moisture/hyaluron-moisture-shampoo-200ml). All previously present tracked product-value hashes stayed equal. Usage remained 8/10, description 9/10 and warnings 0/10.

## Root-cause trace

| SKU | Search and source | Fetch and extraction | Validation, decision and persistence |
|---|---|---|---|
| SC-MVP-001 | Exact 200 ml Parkville page discovered. Earlier direct fetch was HTTP 429, then Firecrawl recovered the exact page. | Navigation before the H1 had previously polluted extraction; this was repaired in the merged code. The page's generic lotion overview conflicts with its cleanser identity and rinse-off direction, so description is rejected. | Existing usage and key ingredients are already applied; the new shorter ingredient reading cannot replace them. The old `PROVIDER_UNAVAILABLE` status recorded a transient direct failure despite provider recovery; the current run is `COMPLETE`, with zero new fields. |
| SC-MVP-006 | Exact 250 ml Parkville page found and read after direct HTTP 429. | Firecrawl Markdown exposes `Daily use` and a short key-ingredient reading; the page also states a more detailed use and ingredients, but those are already represented by earlier reviewed facts. | Both new proposals remain `UNVERIFIED` with `CATALOG_VALUE_EXISTS` because reviewed usage and key ingredients already exist. Auto-verification correctly refuses a silent replacement. |
| SC-MVP-023 | Exact 30 ml Eva manufacturer shop page found and read. | The page exposes `Directions of Use` as an empty section. Direct access was HTTP 429; Firecrawl supplied no instruction. | No `usage.instructions` fact can be proposed. A stated 10% niacinamide/1% zinc concentration proposal cannot be applied without a reviewed ingredient relationship and full formula; the existing workflow leaves it unverified. Current run is `NO_EVIDENCE` for new applicable fields. |
| SC-MVP-055 | Exact 200 ml L'Oréal manufacturer page fetched directly. | Its 26-item INCI list is separated by HTML `&bull;` entities. The extractor decoded neither those entities nor bullet delimiters, so the old run missed the complete formula. | A narrow decoder/parser fix produced an exact-page `composition.inci` proposal. Auto-verification persisted 26 reviewed ingredient links and verified fragrance presence with official URL, excerpt and timestamp. |

The configured Exa and Firecrawl credentials were usable only after Node was run with `NODE_USE_SYSTEM_CA=1` on this workstation; without it both failed certificate verification. Grok extraction returned rejected/unavailable in the live runs, so deterministic extraction carried the usable evidence. This environment issue was kept separate from source-quality results.

## Before and after, ten development SKUs

| SKU | Usage | Description | Warnings | Full INCI | Remaining gap or dispute |
|---|---|---|---|---|---|
| SC-MVP-001 | yes → yes | no → no | no → no | no → no | Official overview describes a leave-on lotion; no safe description or full formula. |
| SC-MVP-006 | yes → yes | yes → yes | no → no | no → no | New shorter usage/ingredient proposals would replace existing reviewed values. |
| SC-MVP-007 | yes → yes | yes → yes | no → no | no → no | Direct source rate limited; discovered retailer page supplied no applicable fact. |
| SC-MVP-008 | yes → yes | yes → yes | no → no | no → no | Retailer-only new claims/ingredients remain unverified. |
| SC-MVP-011 | yes → yes | yes → yes | no → no | no → no | Direct source rate limited; discovered retailer page supplied no applicable fact. |
| SC-MVP-013 | yes → yes | yes → yes | no → no | no → no | No new applicable fact; existing usage kept. |
| SC-MVP-023 | no → no | yes → yes | no → no | no → no | Official directions section empty; concentrations unverified without formula. |
| SC-MVP-024 | no → no | yes → yes | no → no | no → no | Official directions section empty; concentrations unverified without formula. |
| SC-MVP-055 | yes → yes | yes → yes | no → no | **no → yes (26)** | Warnings absent. Public product detail still returns 404 under the existing media eligibility path. |
| SC-MVP-056 | yes → yes | yes → yes | no → no | yes (27) → yes (27) | Warnings absent; official conditioner INCI resembles the shampoo list and should be checked against physical packaging before any replacement. Public detail still returns 404. |

The four tracked field groups total **18/40 → 19/40** present values; one additional verified fragrance state was applied to 055. No critical hold was produced by the ten new runs. “No evidence” does not mean the product lacks the property; it means accessible exact-product evidence did not establish it.

## Benchmark and verification

- Read-only live provider baseline: 10 SKUs, 14 Exa searches, 11 Firecrawl page fetches, 64.620 seconds aggregate elapsed, zero false exact-title matches in accepted discovered pages. This measures discovery and extraction; it is not a catalog write benchmark.
- Comparable ten-SKU canonical runs in development PostgreSQL: previous run set took 91.563 seconds, with 10 direct source attempts, 12 provider-discovered pages, 10 successful page reads and 6 failed reads. New run set took 93.823 seconds, with 10 direct attempts, 9 provider-discovered pages, 11 successful page reads and 4 failed reads. These are observed run records, not precise billed request counts; no defensible currency cost was recorded.
- PostgreSQL integration test on isolated `127.0.0.1:5434/shenacare_test` proves exact SKU application, field provenance, duplicate prevention, existing-value preservation and critical review behavior. Combined focused run: 5 suites, 48/48 tests, exit 0. TypeScript, targeted ESLint, Nest build and `git diff --check`: exit 0.
- Development PostgreSQL readback found 26 SC-MVP-055 ingredient links, `isFragranceFree = false`, and applied facts with official manufacturer URL and observation timestamps. All ten existing usage, description, warning, suitability, texture, SPF and target-area hashes remained unchanged.
- Storefront `GET /products/:slug` through the Nest app returned 200 with correct IDs for 8/10. SC-MVP-055 and 056 returned 404 under the pre-existing public media eligibility rule, so the new 055 formula is verified in the database but not yet visible on its product-detail API. Media work remains outside this scope.

Evidence: [live baseline](baseline-live.jsonl), [before DB](enrichment-before.json), [new runs](enrichment-apply-results.jsonl), [after DB](enrichment-after.json), [applied fact readback](enrichment-db-readback.json), [API readback](enrichment-api-readback.json), [run metrics](enrichment-run-metrics.json).

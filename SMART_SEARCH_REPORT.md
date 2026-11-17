# Smart Search implementation and integration handoff

Status: feature branch only. **Do not merge or push.** The owner's latest instruction is to keep both implementations separate until their differences and final verification are resolved.

## Provenance

- Branch: `feat/smart-search-experience`.
- Base: `34ff81a4a76f243ef3058a8d123ce3364ab18b5f`, the latest local `main` when work began. Fetch completed; local main contained all upstream commits at that time.
- Isolated managed worktree: `.codex/worktrees/smart-search-experience/shena care` under the user's profile.
- Main has unrelated, uncommitted work. Its search changes are **working-tree changes**, not a second committed branch. Git provides no author for those edits. The available Codex chat inventory did not establish another author; attribution remains unknown.
- No source edits, commits, merges, cleanup, database mutations or pushes were performed on main by this task. Local disposable databases were used exclusively.
- Read-only main snapshots, hashes, timestamps and merge simulations are in `.codex/qa-logs/smart-search/comparison/`. Files were normalized to LF **in the comparison copies only**.

## Implemented behavior

The existing Catalog `SearchProvider` and PostgreSQL implementation remain the search boundary. There is no external search service, embedding, LLM request, new dependency, schema change or migration.

- Existing Arabic/English Unicode normalization, approved brand aliases and transliteration remain in use.
- Queries combine product names, brand/line, category/type, active-ingredient relationships, exact SPF and verified skin/hair suitability. Explicit constraints are ANDed on the same eligible SKU where SKU evidence is involved.
- Known ingredient intent requires a canonical approved active-ingredient relationship; a marketing name alone is insufficient. Concerns require explicit catalog links or sourced, accepted routine-profile claims. Suitability requires `VERIFIED` profile data; both canonical lowercase and older uppercase values are supported.
- Identifiers remain whole and exact. Ordinary numeric terms have boundaries, preventing `1` from matching unrelated UUID digits or `10`. SQL values are parameterized, LIKE wildcards escaped, and malformed/control input safely rejected.
- Exact identifying fields rank first, followed by product-name exact/prefix/substring matches, brand/line matches and a deterministic per-term lexical score. Approximate matches remain fallback retrieval. Ties use product UUID; popularity does not participate.
- `EXISTS` prevents duplicate products. Archive/publication checks and existing Commerce, reviewed-media and Sourcing gates remain authoritative. Matches are rechecked against the SKUs that survived those gates.
- Suggestions page through bounded candidate batches until enough eligible products are found. They no longer stop after 100 hidden candidates. Responses expose only public identity, reviewed thumbnail and category.
- Search results reuse the existing listing/cards, honest counts/facets and cursor pagination. Sort values are validated and preserved in the URL with filters.

The frontend uses a 250 ms debounce, abort signals and query-key isolation. A different query cannot select the previous query's products. Offline requests enter a visible error/retry state rather than remaining silently paused.

Desktop suggestions are anchored to the header, grouped by brands/products/categories, with keyboard arrows, Home/End, Enter and Escape. Mobile uses the existing Radix-backed Sheet with a new `full` layout variant, autofocus, scroll containment, focus restoration and 44 px controls. This variant uses the existing colors, typography, spacing and safe-area primitives. Thumbnails use `ProductTile`; there are no generated product assets.

Only submitted searches are stored, in this tab's `sessionStorage`, capped at five. Numeric/email-like values are excluded; history is clearable and storage failure does not prevent searching. Arabic and English copy are included.

## Verification

Current evidence is retained under `.codex/qa-logs/smart-search/` and `output/playwright/smart-search/`.

| Check | Result |
| --- | --- |
| Focused API search, PostgreSQL provider, public discovery/media gates and architecture | 5 suites, 64 tests passed |
| API typecheck and build | Exit 0 |
| Frontend unit tests | 38 suites, 199 tests passed |
| Frontend typecheck, token synchronization and design/assets checks | Exit 0 |
| Browser acceptance, actual API and isolated PostgreSQL | 9 scenarios passed; no page errors, unexpected HTTP errors or console errors |
| Initial complete API regression | 150 suites passed / 32 failed; 1244 tests passed / 124 failed; exit 1 |
| Final complete API regression | 152 suites passed / 30 failed; 1267 tests passed / 102 failed; exit 1 |
| General route/RTL check (`check:ui-reset`) | Exit 1 on both attempts: initial readiness timeout, then socket closure (`UND_ERR_SOCKET`) after several routes |
| Production web build | Exit 0 |
| Changed-source lint | API and web exit 0; full-package lint remains red |
| Graphify update | Exit 103: configured Python interpreter points to an unavailable Administrator installation |

Browser coverage includes desktop autocomplete and real image loading, exact PDP selection with keyboard and browser Back, Arabic RTL search, contextual category filtering, URL sort state, verified suitability, empty results, rapid typing, mobile fullscreen/autofocus/close/focus restoration, tab-history clearing, actual offline failure/retry, and English/tablet behavior. Screenshots cover 1440, 768 and 390 px. Main search results were never mocked; the test harness replaces external AI and background-only side effects.

The broad API run is not green. Failures include current fixture/policy incompatibilities and transient local Prisma `P1001` connection errors; they have not all been proven pre-existing. Its final run preceded two additional ingredient-typo cases, which are included in the final focused 64-test run. Detailed failing suite names are listed below. General route coverage remains unverified beyond the routes exercised before the socket failure; search-specific browser acceptance is a separate check.

Browser validation uses its own migrated `shenacare_search_browser_test` database. Reusing the focused-test database exposed broken remote-image URLs from fixtures left by an interrupted run; the independent database prevents that contamination without suppressing network failures. Both explicit database URLs use loopback port 5547, a `_test` database, and `connection_limit=3&connect_timeout=30&pool_timeout=30`. Shared database configuration was not changed.

The existing public-discovery fixture was corrected to meet current policies: valid synthetic test GTINs, explicit Admin identity review, explicit OFFER_BASED/24-hour availability policy, and PUBLISHED routine templates. Production gates were not weakened.

The pnpm runtime attempted automatic dependency preparation; that attempt was stopped. Existing npm scripts were used without changing manifests or lockfiles. Frontend Jest needed a CLI `--testMatch '**/src/**/*.test.ts'` override because its root-expanded glob mishandles this Windows worktree path. No tests were skipped or disabled.

Asset verification depends on the existing ignored `docs/frontend/homepage-image-manifest.md`. An unchanged local copy was supplied from the original checkout for verification. The manifest is not silently added to this feature commit; a clean-clone asset-check reproducibility gap remains in the baseline.

Full-package lint is not green. Initial API lint reported 270 errors including one new control-regex rule violation, which was fixed; web lint included existing errors outside this feature and one new empty catch, which was fixed. Changed-source lint is checked separately. Do not describe the full package lint as passing.

Review outcome: **HOLD integration**. The focused feature can be reviewed independently, but the broad API failures, general route-check failure and main contract reconciliation prevent a full regression-free or launch-ready claim.

## Observed search and performance

These are **isolated local fixtures**, not production catalog coverage, clinical validation or a production latency guarantee.

| Query | Observed HTTP result |
| --- | --- |
| `سيرافي` / `cerav` | CeraVe Moisturising Cream and CeraVe SA Smoothing Cleanser |
| `غسول للبشرة الدهنية` | CeraVe SA Smoothing Cleanser only |
| `مرطب للبشرة الجافة` | CeraVe Moisturising Cream only |
| `zzzzunmatched` | Zero products |

Six-request local HTTP samples initially measured matching-query medians of 48–59 ms and no-match median of 18 ms. The scaling probe then exposed repeated Unicode normalization and fuzzy matching across translated alternatives. Normalized fields are now projected once per candidate using a non-inlined lateral projection; literal query spellings are tested first, and translated alternatives do not receive additional fuzzy expansion.

| Retrieval-only probe | Before p50 | After p50 | After maximum of 6 samples |
| --- | ---: | ---: | ---: |
| 1,000 products, `scale cleanser` | 645 ms | 106 ms | 192 ms |
| 1,000 products, `clenaser` | 299 ms | 80 ms | 85 ms |
| 5,000 products, `scale cleanser` | 2,896 ms | 319 ms | 425 ms |
| 5,000 products, `clenaser` | 1,086 ms | 350 ms | 359 ms |

The host also ran other verification work; these are observed measurements, not a controlled production benchmark. The 5,000-row probe measures retrieval only, excluding commercial composition. Existing full-result eligibility/facet evaluation and per-SKU availability reads remain a separate scaling limit to profile before a substantially larger catalog rollout. Synthetic scaling rows are removed in `finally`.

## Main comparison and recommended retention

The read-only three-way simulation found four textual conflict regions across three files after normalizing comparison line endings. It did not modify either implementation.

| Area | Main WIP | Smart Search branch | Recommendation |
| --- | --- | --- | --- |
| `postgres-search.provider.ts` | Adds explicit skin-type filtering and broadens acne matching from `acne-prone` or the product name | Evidence-constrained intent, ingredients/SPF, archive/identifier safety, ranking and measured SQL improvement | Keep the branch engine. Preserve the explicit filter capability, but wire it to reviewed evidence. Do not retain name-only acne inference as clinical suitability. Two textual conflicts. |
| DTO / `search-provider.ts` | Adds `skinType` across public/internal filters | Adds bounded suggestion offset | Combine both contracts; keep validation and recheck SKU evidence for skin-only requests too. No textual conflict in the interface simulation. |
| `discovery.service.ts` | Threads skinType into filters, cursor fingerprint and discovery path | Public thumbnails/categories and paged eligible suggestions | Keep both. The simulation merges text cleanly, but the combined behavior still needs tests. |
| Frontend `api/discovery.ts` | Adds skin/skinType URL input, sort and optional bilingual PDP/content fields | Strict sort union, suggestion thumbnail/category contract | Preserve all bilingual fields and skin aliases, retain strict sort typing once. Resolve the sanitizer conflict and remove the duplicate sort declaration produced by a naive text merge. |
| `listing.ts` | Supports `skin=...`, a concern page context and sort | Preserves URL sorting for search | Keep pretty skin URLs and concern context, plus the branch's sort state. Resolve one textual conflict; show applied skin filters explicitly during integration. |
| `PlpHeader.tsx` | Adds concern-specific headers with Arabic-only copy | Reuses the existing listing and neutral search subtitle | Keep the concern context. Move its strings into both-language messages and avoid unsupported product-effect claims. |
| `messages.ts` | Other ongoing PDP/assistant/localization changes | Search states/history/categories/sort and accurate query subtitle | Retain both sets of keys; run parity tests. No textual conflict in the captured simulation. |
| PDP, product card/tile, Shina and unrelated configuration | Existing uncommitted work | Not changed by this branch | Preserve main's work intact; do not replace those files with the feature baseline. |

Textual conflict resolution alone is insufficient: main's acne fallback can merge automatically in another hunk while violating this request's evidence rule. Skin-only filters must also use the same SKU visibility recheck, not only query-based requests.

## Reproduction and next action

1. Set both `DATABASE_URL` and `DIRECT_URL` explicitly to the same disposable localhost PostgreSQL database ending `_test`. Migrate it with the existing Prisma deploy script. Keep browser and broad regression datasets in separate databases.
2. Run focused API suites listed in `api-search-tests.log`; run the web test/type/token/design scripts.
3. Run `node -r ts-node/register test/smart-search-browser-server.ts` from `apps/api` against the isolated database, then web dev on `127.0.0.1:3107` with `NEXT_PUBLIC_API_URL=http://127.0.0.1:4107`. The API binds only to loopback.
4. Run `node apps/web/scripts/check-smart-search.cjs` with an existing Playwright installation available through normal module resolution or `NODE_PATH`. No project dependency installation is required. Internal regression photographs are served only by this local test harness.
5. Run `test/smart-search-benchmark.ts` with ts-node for the scoped 1,000/5,000-row probe.
6. Let the owner stabilize/commit main's current work. Preserve its patch and hashes, refresh the comparison against that exact state, reconcile the contracts above in an isolated integration checkout, then rerun affected API/browser tests and resolve the broad regression/lint blockers. **No main merge has been performed or is authorized in this handoff.**

## Final broad API failing suites

- `test/integration/media-editorial.e2e-spec.ts`
- `test/integration/glo-243-supplier-exceptions-shortfalls.e2e-spec.ts`
- `test/integration/supplier-quantity.e2e-spec.ts`
- `test/integration/rfq-staff-offline.e2e-spec.ts`
- `test/integration/glo-283-supplier-po-batching.e2e-spec.ts`
- `test/integration/glo-236-durable-events.e2e-spec.ts`
- `test/integration/c0-workspace-reads.e2e-spec.ts`
- `test/integration/supply-plan.e2e-spec.ts`
- `test/integration/rc-smoke.e2e-spec.ts`
- `test/integration/glo-237-po-lineage.e2e-spec.ts`
- `test/integration/catalog-intake.e2e-spec.ts`
- `test/integration/glo-240-delivery-recovery.e2e-spec.ts`
- `test/integration/availability-expiry.e2e-spec.ts`
- `test/integration/availability-resolution.e2e-spec.ts`
- `test/integration/glo-238-financial-integrity.e2e-spec.ts`
- `test/integration/glo285-media-service.e2e-spec.ts`
- `test/integration/rt-operational-hardening.e2e-spec.ts`
- `test/integration/glo-205-security-regressions.e2e-spec.ts`
- `test/integration/product-sku-media.e2e-spec.ts`
- `test/integration/catalog-policy.e2e-spec.ts`
- `test/integration/fulfillment-receiving.e2e-spec.ts`
- `test/integration/glo-242-product-identity.e2e-spec.ts`
- `test/integration/c2c-backend-acceptance.e2e-spec.ts`
- `test/integration/glo-239-operational-queues.e2e-spec.ts`
- `test/integration/glo-77-candidate-review-publish.e2e-spec.ts`
- `test/integration/brand-research.e2e-spec.ts`
- `test/unit/route-optimization.spec.ts`
- `test/unit/product-read-performance.spec.ts`
- `test/unit/ai-client-privacy.spec.ts`
- `test/integration/interventions.e2e-spec.ts`

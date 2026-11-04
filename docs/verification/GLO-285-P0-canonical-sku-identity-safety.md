# GLO-285 P0 — Canonical SKU identity safety

Date: 2026-11-02. Branch: `feat/c0-commerce-integration`. Starting and final HEAD: `91236b7e60fdb75d8dca7d8a0e0fa06f07956d5a`. No commit, push, migration file, dependency or remote database change.

**Verdict: PASS for the scoped P0 acceptance checks. Full API regression: FAIL, not a release-wide green result.** Production accuracy remains unmeasured; the benchmark is synthetic.

## Root causes and implementation

1. Supplier aliases passed `ignoreName:true`; a reused supplier code could establish exact identity despite a contradictory formulation or vague description.
2. Matching barcode evidence suppressed name disagreement, and a matching stated brand supplied sufficient corroboration. Neither fact independently proves the formulation/version.
3. Approval trusted stored `matchedSkuId` when the DTO omitted it. Publication reused stored IDs, barcode hits and SKU codes before a consistent final identity check.
4. Alias creation preceded later media identity validation. Two additional PostgreSQL red tests demonstrated an alias write surviving failed approval/publication review.
5. New-product publication could create a Product and SKU using reviewed packaging that contradicted retained source size, then fail later. A separate red test demonstrated these catalog writes.
6. Barcode intake previously stripped arbitrary non-digits and checked length alone; wrong checksums and alphabetic contamination could become identity evidence.

`ProductIdentityService.validateIdentity()` is now the shared, read-only evidence boundary. It distinguishes `VERIFIED_IDENTITY`, `EXPLICIT_CONFLICT` and `INSUFFICIENT_EVIDENCE`. Classification, explicit/stored-ID approval, publication reuse and direct/batch offer commit reuse that validation. `assertSkuAssociation()` loads current canonical facts and supplier-scoped alias evidence, checks collisions and rejects non-verified associations before writes. Stored IDs are proposals, not evidence.

Existing explicit brand, barcode, size, unit, variant and pack vetoes remain. Recognized product forms, active/formula markers, concentration/SPF and version contradictions cannot be overridden by an alias or barcode. One-sided version evidence and informal/vague descriptions retain uncertainty. Structured source facts cannot hide contradictory extracted title facts. Retained reviewed physical facts must also agree.

Translated wording does not require literal equality: informative Arabic/English descriptions with physical corroboration and alias/barcode evidence remain supported. Reviewed same-script form synonyms preserve exact descriptor evidence without fuzzy scoring. Generic forms, substring lookalikes and unresolved descriptions cannot establish identity merely from brand/code.

Approval defers alias creation until identity/media checks complete and revalidates the completed review. Publication validates both existing targets and the proposed new SKU's reviewed physical identity before creating even its Product. Direct and batch SupplierOffer writes perform current identity validation inside their transaction. An unsafe batch throws and rolls back rather than applying its collected writes.

GTIN intake normalizes NFKC and Arabic/Persian digits, preserves leading zeros, rejects contamination, accepts only lengths 8/12/13/14 and validates the GS1 modulo-10 check digit. A valid checksum still cannot override other identity contradictions. No fuzzy engine, AI identity decision, infrastructure adapter or schema change was added.

## Changed paths

| Path | Purpose |
|---|---|
| `apps/api/src/modules/ingestion/services/product-identity.service.ts` | Shared states/evidence validation, canonical association guard and classifier fixes |
| `apps/api/src/modules/ingestion/services/row-normalization.service.ts` | Strict normalization and GTIN checksum validation |
| `apps/api/src/modules/ingestion/services/ingestion.service.ts` | Approval, stored-ID/barcode/code reuse, reviewed physical facts and proposed-SKU write gates |
| `apps/api/src/modules/ingestion/services/offer-batch-commit.service.ts` | Final identity enforcement in direct/batch offer transactions |
| `apps/api/test/unit/glo285-identity-safety.spec.ts` | 64 focused identity/GTIN/translation/contradiction assertions |
| `apps/api/test/integration/glo285-identity-safety.e2e-spec.ts` | 53 actual PostgreSQL classification, approval, publication and write-safety tests |
| `apps/api/test/unit/glo285-stock-freshness.spec.ts` | Supply verified identity fixture to the new dependency; retain F1 assertions |
| `apps/api/test/integration/ingestion-eligibility.e2e-spec.ts` | Replace opaque TEST-BAR marker with a valid synthetic GTIN in the real fast-lane fixture |
| `apps/api/test/integration/g08-offer-pricing-safety.e2e-spec.ts` | Establish the reviewed supplier alias claimed by its approved-item fixture; retain pricing/freshness assertions |
| This report | Evidence, limitations and handoff |

Existing changes to `apps/api/src/main.ts`, Business Workspace files and the admin-policy handoff were preserved. No files were staged. The original four tracked unrelated paths retain their original diff counts. Graphify's AST update completed; its generated outputs did not add tracked changes.

## Regression evidence

All counts below come from executed commands, not inferred behavior.

| Check | Result |
|---|---|
| Initial classifier red run | Exit 1: 28 failed / 27 passed, before the classifier fix |
| Initial final-boundary red run | Exit 1: 5 failed / 2 passed, before write-boundary guards |
| Late media/alias red tests | Exit 1: 2 failed; alias counts increased despite failed review |
| New-SKU packaging red test | Exit 1: Product/SKU counts increased despite failed publication |
| Final focused run, ten suites | **Exit 0: 235/235 passed**, 22.897 s |
| Included actual identity PostgreSQL suite | **53/53 passed**; 24 unsafe cases blocked, 16 positive exact controls preserved, plus 13 boundary/evidence/role/translation tests |
| Separate final pricing/catalog/discovery/vertical-slice run | **Exit 0: 40/40 passed**, four suites, 15.875 s |
| Original 320-case synthetic corpus, final source | Exit 0: policy 192/192 unchanged; identity safe-association expectations 128/128; no unsafe associations |
| Typecheck and API build | Passed using installed TypeScript/Nest runners; final commands recorded separately |
| Scoped source lint | Exit 1: 58 errors; identical per-file/rule counts against unchanged HEAD (40/1/5/12). No new rule-count increase. Not claimed lint-clean |
| Five changed test files lint | Exit 0 |
| Whitespace check | `git diff --check` exit 0 |

The final focused run includes the existing Allowlist unit/Egyptian tests, both Allowlist PostgreSQL suites, F1 stock-freshness, scope golden tests, candidate identity regressions and module-boundary architecture tests. Tests cover malformed/wrong-checksum and translated numeric GTINs, missing attributes, formulation/SPF/version contradictions, vague Arabic, physical vetoes, reviewed translations and barcode aliases, stored IDs, direct/batch commit, Admin/Hub role separation, and count equality after rejected writes.

Publication tests stub unrelated readiness output to expose the final identity boundary; they do not stub Prisma, identity validation, Catalog writes or SupplierOffer writes. Source/classifier and packaging review contradictions are exercised against persisted rows. This is not a complete external-media/provider end-to-end certification.

Reproduction from `apps/api`, with both URLs explicitly set to the same localhost `_test` database and `TEST_BYPASS_AUTH=false`:

```powershell
node ../../node_modules/jest/bin/jest.js --runInBand --runTestsByPath test/unit/glo285-identity-safety.spec.ts test/unit/glo285-stock-freshness.spec.ts test/unit/ingestion-eligibility.spec.ts test/unit/ingestion-eligibility-egyptian.spec.ts test/unit/g06-candidate-identity.spec.ts test/unit/g09-scope-golden.spec.ts test/integration/glo285-identity-safety.e2e-spec.ts test/integration/ingestion-eligibility.e2e-spec.ts test/integration/ingestion-eligibility-operational.e2e-spec.ts test/architecture/module-boundaries.spec.ts
```

For discovery/pricing regressions explicitly set `SUPPLIER_AVAILABILITY_MAX_AGE_HOURS=24`; local `.env` has 720, which contradicts those tests' stale-at-48-hours fixture assumptions. This was not changed in the repository or runtime configuration.

## Independently verified disposable database

Created task-only container `glo285-p0-identity-test`, ID `e5a90c222b223f0872e3fb2ccb646daa5348f7a8b2e1e3b2a4fc59dca30870fe`, label `codex.task=GLO-285-P0`, image `postgres:17-alpine`, published only on `127.0.0.1:55485`. SQL identified PostgreSQL **17.11**. No existing container was restarted or reused as the task's database.

Both datasource URLs were explicitly overridden and checked with the existing `local-test-database.cjs` guard before migrations. All **68 existing migrations** applied successfully; no migration was generated. The tests independently query `current_database()` and compare it to the explicit datasource database, retaining the `_test` guard. Final focused verification used `glo285_identity_clean_test`; performance and regression groups used separate task-owned `_test` databases in that container. No Supabase connection or remote migration was used.

An intermediate combined run was discarded: it overlapped another task-owned test runner against the same disposable database and observed changing global count snapshots, plus static-name collisions from reusing the fixture database. The final focused run was serial and isolated. These failed intermediate runs are not represented as passes.

The task container was stopped after verification; its disposable evidence databases remain available for an explicit restart. This local report is under the repository's ignored `docs` directory and is also copied to the evidence artifact folder; it is not staged or tracked automatically.

## Measured matching cost

Actual Prisma SQL query events, same tiny seeded database, unchanged HEAD service/normalizer versus final service, alternating order by case, one unmeasured warmup and two measured passes over 128 identity rows per implementation. The database is `glo285_identity_perf_final_test`; these are hot local measurements, not a production load test or a confidence interval.

| Measure | HEAD baseline | Final implementation |
|---|---:|---:|
| Measured rows per implementation | 256 | 256 |
| Unsafe exact associations | 48 | **0** |
| Correct positive exact controls | 32 | **32** |
| Matching p50 | 9.456 ms | 9.736 ms |
| Matching p95 | 22.331 ms | 20.582 ms |
| Mean SQL statements per row | 5.4375 | 5.4375 |
| Min–max SQL statements per row | 5–8 | 5–8 |

No performance gain is claimed: small p50/p95 shifts vary with local resource contention. The 48 unsafe/32 positive measurements are two repetitions of the 24/16 cases, not independent examples. Additional approval/publication/commit revalidation has read overhead; write-path end-to-end latency was not benchmarked. No AI call was added.

## Full API regression and attribution

The bare API Jest command was executed against the task container: **exit 1, 31 failed / 106 passed suites; 135 failed / 1,176 passed tests; 1,311 total**, 793.751 s. This was an earlier implementation snapshot; it is not claimed as a passing final full run. The final focused checks above supersede affected P0/fixture checks, but the complete suite was not rerun after the final surgical guards.

Unchanged HEAD was exported outside the working tree, using its original sources/tests/root TypeScript configuration and the same installed dependencies, against a separate disposable `_test` database. Two selected failing-suite comparisons yielded 20 failed / 2 passed suites (83 failed / 170 passed tests) and 7 failed / 2 passed suites (25 failed / 25 passed tests). **27 of the 31 failing suite names also fail on HEAD**; this is suite-level attribution, not a claim that every assertion failure is baseline. Stricter identity checks also reject legacy forced associations and invalid-barcode fixtures inside already-red suites.

The four other suite names were `product-discovery`, `g08-offer-pricing-safety`, `vertical-slice`, and `catalog-read-filters`. The corrected reviewed-alias fixture and explicit 24-hour test policy produced the final **40/40** pass. All failing suite names and individual assertion details remain in the raw logs. Release-wide regression health is still **FAIL**.

## Security impact and remaining risks

Security impact: untrusted supplier identifiers and stale stored IDs cannot override current identity contradictions at the guarded write boundaries.

Trust boundary: supplier intake/review metadata to canonical Catalog and supplier-scoped offer state.

Authorization rule: existing Admin approval/publication and supplier tenancy controls remain; no endpoint or permission was added. Hub Operator approval/publication attempts are denied in PostgreSQL tests.

Sensitive data involved: synthetic fixture records and local test configuration; no real customer/supplier export or credentials added to source.

Abuse cases considered: code reuse, conflicting GTIN, formulation/version drift, vague Arabic, hidden packaging contradictions, stale matched IDs, barcode reuse and premature alias/catalog writes.

Security tests added: negative role, conflicting identity, final write/count invariants, direct/batch offer transaction guards and media/proposed-SKU contradictions.

Remaining risk: semantic facts are a bounded deterministic vocabulary, not a universal formulation parser. Reviewed translation/alias evidence still requires trustworthy human review. Unknown wording may require more review; this corpus does not estimate production recall or review volume. Generic alias provenance/retirement, vendor engines, distributed concurrency redesign and production corpus adjudication remain outside P0. Existing cross-owner publication is not converted into a single new transaction; unrelated concurrent catalog edits and external-provider failures are not certified here. Full-suite health and the 58 baseline lint errors remain unresolved.

## Evidence artifacts and handoff

Raw data and logs are under:

`C:/Users/El-mostakbal.DESKTOP-PM74NIT/.codex/visualizations/2026/11/02/01a19bba-b202-7ff3-bfae-992559aa1b70/`

Key files: `p0-final-focused.log`, `p0-four-suite-retest-final.log`, `p0-full-api.log`, `p0-head-failing-suites.log`, `p0-head-extra-failures.log`, `p0-classifier-red.log`, `p0-boundary-red.log`, `p0-alias-write-red.log`, `p0-new-sku-red.log`, `p0-after-results.json`, `p0-db-performance.json`, `p0-db-benchmark-final.cjs`, `p0-lint-comparison.json`.

Next action: owner review of the scoped diff and the documented regression limits. No automatic commit, push, merge or publication is authorized or performed. Stop after this P0 handoff; no fuzzy/AI follow-up implementation was started.

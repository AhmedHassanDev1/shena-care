# GLO-285 — Arabic product identity matching

Date: 2026-11-03. Branch `feat/c0-commerce-integration`, HEAD `91236b7`, on top of the uncommitted P0 and Admin policy work. Nothing committed, pushed or staged. No migration, dependency, remote database write or Linear access.

**Verdict: PASS for the scoped matching work on synthetic evidence. Production accuracy is UNKNOWN (no labeled real supplier data). Full API suite is still red: 26 suites failed, 0 newly failing tests compared with the P0 run.**

## P0 was not complete when this started

The earlier P0 report passed its own 24/16 corpus, but new adversarial probes produced 11 false `VERIFIED_IDENTITY` results and 27 failing assertions (`hardening-red.log`). Example: `سيرافي سيروم فيتامين سي 236 مل` verified against `CeraVe Retinol Serum` through a reused code or a shared barcode. Cause: any cross-script title with one form word and the right size counted as corroboration, and the veto vocabulary knew five actives.

Fixed before any fuzzy work. P0 gate after the fix: 284/284.

## Algorithms

**Identity facts (`identity-text.ts`).** One folding function (NFKC, invisible marks, tashkeel, Arabic and Persian letters and digits). A bounded Arabic/English vocabulary splits a title into stated facts (type, texture, active, target, concern, time, area) and unknown words.

- Confirmed contradictions veto, even through an alias or barcode. Actives must match exactly; other dimensions conflict when disjoint.
- A fact stated on one side only is unknown. It never conflicts and never corroborates.
- An alias or barcode verifies only if every supplier word is accounted for: same word, same fact, or (cross-script, 3+ letters) same phonetic skeleton. Unknown words abstain.
- Size compares as a physical quantity (1 L = 1000 ml). A SKU with no recorded size or barcode no longer conflicts, but cannot corroborate either. The catalog `spf` column and Arabic SPF wording count as formula facts.
- GTIN: leading-zero forms are one identity, indicator digits are not. The source adapter no longer strips contaminated cells into a GTIN.

**Layered retrieval (`ProductIdentityService`).**

1. Verified alias, revalidated against this row.
2. Verified GTIN or barcode alias, same validation.
3. Top-K in SQL inside the brand block (`CatalogService.findSkuIdentityCandidates`): K closest products by trigram similarity, plus K closest in the stated packaging.
4. Rank in memory: vetoes first, then wording overlap plus packaging, then stable IDs. Typo tolerance exists only here.
5. Route to VERIFIED, CONFLICT, AMBIGUOUS or NEW. Retrieval alone never links.

`prepareBatch` loads aliases, GTINs, reviewed wordings, brands and candidates once per 200-row chunk. Stage 4 (open-candidate sweep) stays per row, because a prefetched snapshot would break the GLO-278 concurrent-importer election.

**Reviewed wording.** A reviewer confirmation stores `enrichment.identityReview` (SKU, reviewer, wording key). The same supplier, code, SKU and wording then links without review. Changed wording returns to review, and stated contradictions still veto. A stored `matchedSkuId` alone proves nothing.

**Brands.** The allowlist's ALLOW/SKIP/HOLD logic is unchanged apart from a few form words accepted beside a reviewed alias. Phonetic and initials keys feed `suggestBrands` only; `evaluate()` never reads them. Recurring unresolved names were already grouped by `holds()`. No LLM was added.

## Before / after

Before = the P0 working tree at the start of this task. Same PostgreSQL 17.11 database, same rows. **All synthetic, with labels written by the implementer.** "Held-out seeds" reuse the tuned vocabulary, so their 100% figures are expected, not impressive. **"Unseen wording" is the honest generalisation estimate**: product wording written once and never tuned against.

| Metric | Held-out seeds (930 rows, 688 unique) | Unseen wording (540 rows, 370 unique) |
|---|---:|---:|
| False auto-links | 36 → **0** | 36 → **0** |
| Auto-link precision | 84.2% → 100% | 73.1% → 100% |
| Correct auto-links | 192 → 210 | **98 → 72** |
| Auto-link recall | 91.4% → 100% | **77.8% → 57.1%** |
| Recall@1 | 46.7% → 98.8% | 50.0% → 89.6% |
| Recall@5 | 46.7% → 100% | 50.0% → 93.4% |
| Known SKU wrongly routed NEW | 47.1% → 0% | 50.0% → 6.6% |
| Truly new rows routed NEW | 60/60 → 60/60 | 36/36 → 36/36 |
| Route correct | 68.4% → 100% | 61.5% → 86.5% |
| First-import rows needing review | **40.0% → 67.7%** | **38.5% → 73.2%** |
| One confirmation, then auto-linked | 30/318 → 270/300 | 18/190 → 198/216 |
| AI research calls (on known SKUs) | 270 (210) → 60 (0) | 162 (126) → 47 (11) |
| Identity LLM calls | 0 → 0 | 0 → 0 |
| SQL per row, single row | 5.97 → 4.24 | 6.00 → 4.52 |
| SQL per row, batched | n/a → 0.31 | n/a → 0.42 |
| Latency p50 / p95 (ms, tiny catalog) | 9.4 / 17.9 → 10.8 / 19.5 | 9.5 / 18.1 → 8.9 / 16.2 |

Two results go the wrong way, by design:

- **Review goes up on first import.** Before, about half of known SKUs without an identifier routed NEW (duplicate-candidate risk and wasted research) and some rows auto-linked falsely. Those rows now reach a reviewer. Review falls on the second import.
- **Correct auto-links fall on unseen wording (98 → 72).** The old cross-script rule that produced these links also produced all 36 false ones. The new rule cannot tell them apart without a reviewer or more vocabulary.

Latencies are hot, local and single-process. Before's maximum of one suggestion caps its Recall@K. SQL excludes the per-row status update, and stage 4 ran against an empty candidate table, so its JSON-scan cost at volume is unmeasured.

**Policy (90 synthetic rows).** Correct 80 → 90. HOLD 47.8% → 36.7%. False SKIP 0 → 0. False ALLOW 0 → 0. Unreviewed misspellings admitted 0/30. Suggestion Recall@3 28/30 → 30/30.

**Large brand (55,200 products; one brand with 5,027; 186 rows from that brand).**

| | Before | After |
|---|---:|---:|
| Block rows p50 / p95 | 393 / 454 ms | 144 / 231 ms |
| Block rows SQL | 7.33 | 2.00 |
| Rows sent to the application per lookup | 5,027 | about 33 |

## pg_trgm decision

Measured on the 5,027-product brand, 60 known-SKU rows, DB time only.

| Strategy | Recall | Rows returned | p50 / p95 ms |
|---|---:|---:|---:|
| Full brand load (old) | 100% | 5,027 | 26 / 36 |
| Packaging block only, no text | **18.3%** | 35 | 3 / 36 |
| `similarity()` order + packaging block (shipped) | **100%** | 33 | 98 / 114 |
| `%` operator, threshold 0.1 | 98.3% | 17 | 21 / 33 |

Used: `similarity()` from the extension already installed by migration `20261016100000_product_search`. It clearly beats no text retrieval on recall. No new extension, index or migration. The plan uses the brand b-tree, not the trigram GIN index.

`%` is faster on a huge brand but loses recall on this set and needs `SET LOCAL`, meaning a transaction with extra round trips, which is expensive through the Supabase pooler. The raw old query is faster in the database than the shipped one; the net gain comes from not hydrating 5,000 rows.

A planner issue was also fixed: `jsonb_to_recordset`'s default 100-row estimate triggered about 20–60 ms of JIT per query (about 2 ms without).

## Regression and database evidence

Database: task container `glo285-matching-test`, `postgres:17-alpine`, PostgreSQL 17.11, `127.0.0.1:55486` only, tmpfs. All 68 migrations applied. `_test` guard plus independent `current_database()` and version checks. Stopped after verification; its data is gone.

| Check | Result |
|---|---|
| 24 unsafe baseline cases / 16 exact controls (PostgreSQL) | 53/53: all 24 blocked, all 16 preserved |
| Original 320-row corpus | Policy 192/192; identity 128/128; 0 unsafe links; 16 controls |
| New layered matching and write boundaries (PostgreSQL) | 26/26 |
| New hardening, Arabic, GTIN and brand-suggestion units | 73/73 |
| P0 identity units / F1 freshness | 64/64 / 11/11 |
| Allowlist: unit, Egyptian, PostgreSQL, operational | 7, 24, 13, 12: all pass |
| Scope golden / offer pricing / module boundaries | 38/38, 8/8, 7/7 |
| Real fast lane + F1 under a policy; snapshot-deactivation block | Pass (in `ingestion-eligibility.e2e`) |
| Typecheck and API build | Pass |
| **Full API suite** | **Exit 1: 26 failed / 113 passed suites; 121 failed / 1,296 passed tests** |

Full-suite attribution by test name against the earlier P0 log: 0 newly failing, 14 fixed. The P0 report found 27 of its 31 failing suites also fail on HEAD. Many remaining failures are suites predating the allowlist, whose rows now HOLD. That grouping is a message-based heuristic, not a per-test diagnosis. This includes `g05-offer-fast-lane` (8/8 red) and `g04-upload-matching`, so those two suites are not evidence here; the fast lane is covered by the separate test named above.

Lint on touched files: `product-identity` improved 1 → 0, `ingestion.service` 40 (unchanged), `row-normalization` 12 (unchanged), new files 0. `catalog.service` (8) and `source-adapter` (2) were not diffed against HEAD; the added code has no `any`.

Fixtures changed in existing tests: wrong GS1 check digits corrected in `g04`, `glo-120` and `sg04`; one spy assertion in `ingestion-eligibility`; one order-dependent assertion in `glo284-formula-isolation` now accepts `INVALID`; the P0 unit mock gained batch lookups.

Verification order note: the matcher sources' checksums were unchanged between the benchmarks and the final regression. The 320-row corpus was re-run on the final source.

## Remaining risks

1. **No real data.** Precision and recall above say nothing about production. Needed: 300–500 independently labeled rows from an owner-authorized supplier export.
2. **Reviewers cannot see the candidates yet.** Top-K is stored in `enrichment.identity.candidates` and `approveItem` accepts them, but the review record and the Business UI do not show them. Until then the review workload benefit is mostly theoretical.
3. **Invalid GTIN rejects the whole row at upload** (existing behaviour, stricter since P0's checksum). If suppliers put internal codes in the barcode column, real offers are dropped with a visible row error. Owner decision: keep, or treat as "no barcode" with the raw value retained.
4. **Vocabulary is finite and author-written.** Unknown wording abstains (safe, more review). Unknown contradictions are not vetoed, only unaccounted for, so a reviewer could still confirm them.
5. **Reviewer confirmation is trusted** when no stated fact contradicts it and packaging agrees. A row without a stated size cannot be confirmed until its wording includes one.
6. **Fingerprints:** the wider folding changes the v1 fingerprint for titles containing hamza-seat, Persian or invisible characters, so old open candidates with those titles may not dedupe against new rows.
7. **Deployment check:** the container's locale handled Arabic trigrams. Confirm production with `SELECT show_trgm('سيرافي'), datctype FROM pg_database WHERE datname = current_database();`. If trigrams come back empty, only the packaging block helps Arabic rows.
8. **Pre-existing:** the stage 4 same-size scan is capped at 500 before the brand filter; `sourcing.service` can still create an offer directly by SKU ID (Admin path, no supplier text); supplier aliases have no provenance or retirement columns.

## Changed paths

| Path | Purpose |
|---|---|
| `apps/api/src/modules/ingestion/services/identity-text.ts` (new) | Folding, vocabulary, phonetic skeleton, wording support and overlap, measures, GTIN forms |
| `apps/api/src/modules/ingestion/services/product-identity.service.ts` | Vetoes, evidence rules, batch lookups, ranking, routing, reviewed wording |
| `apps/api/src/modules/ingestion/services/ingestion.service.ts` | Chunked matching, confirmable candidates, `identityReview`, stable publish order |
| `apps/api/src/modules/ingestion/services/row-normalization.service.ts` | Shared folding, multipack and unit shorthand parsing |
| `apps/api/src/modules/ingestion/services/ingestion-eligibility.policy.ts` | Form words beside a reviewed alias; phonetic and initials suggestions |
| `apps/api/src/modules/ingestion/adapters/source-adapter.interface.ts` | Contaminated barcode cells no longer become a GTIN |
| `apps/api/src/modules/catalog/services/catalog.service.ts`, `catalog/public.ts` | Owner-side Top-K query and its exported types |
| `apps/api/scripts/benchmark-identity-matching.cjs`, `test/fixtures/glo285-matching-corpus.ts` (new) | Repeatable benchmark and labeled synthetic corpus |
| `apps/api/test/integration/glo285-matching.e2e-spec.ts`, `test/unit/glo285-identity-hardening.spec.ts` (new) | New coverage |
| `g04`, `glo-120`, `sg04`, `ingestion-eligibility`, `glo284-formula-isolation` specs; `glo285-identity-safety.spec` | Fixture corrections listed above |

Existing `apps/business`, `main.ts` and admin-policy handoff changes were preserved.

## Reproduce

From `apps/api`, with both URLs set to a local `_test` PostgreSQL 17 database that has migrations applied and no products:

```bash
node scripts/benchmark-identity-matching.cjs --out <dir> --seeds 2,3,4,5,6 --label holdout
```

Other sets: `--seeds 11,12,13 --held-out-vocabulary`; `--seeds 7 --noise 50000 --big-brand 5000 --focus-brand CeraVe --compare-retrieval`. Add `--before <dir>` with the P0 service snapshots for the comparison.

Raw results are in `docs/verification/GLO-285-matching-evidence/`.

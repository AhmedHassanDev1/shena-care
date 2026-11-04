# GLO-285 — Supplier ingestion and product intelligence: closure evidence

Date: 2026-11-04. Branch `feat/c0-commerce-integration`, on top of `91236b7`. Tested on a throwaway PostgreSQL 17.11 cluster bound to `127.0.0.1:55490`. No Supabase access, remote migration, deployment or push.

**Verdict: technical pipeline PASS on synthetic and semi-real data. Pilot and production: NO-GO. GLO-285 stays open.** Real supplier files, genuine product images and live providers have not been tested. See "Blockers".

## Three separate statuses

### 1. Verified technically (real code, real PostgreSQL, executed)

| Check | Result |
|---|---|
| Ingestion, identity, media, research, publication and architecture suites, clean database | **53/53 suites, 813/813 tests** |
| API unit suites | 38/38 suites, 634 pass, 1 skipped (live Mapbox) |
| **Full API suite (everything), clean database** | **1,574 pass, 26 fail, 1 skip (142/148 suites); earlier log: 121 fail. Not green: see below** |
| `npm ci` + API build + Business tests and production build, on the exact committed file set | Pass |
| Migrations from empty on that file set | 71/71; 41/41 focused tests on it |
| EVA oracle (20 real listings, 126 labelled cases) | 126/126; 31/31 automatic links correct, 0 false |

### 2. Production integrations NOT tested

- **Live research providers (Exa, Firecrawl, LLM).** Stubbed at the network edge. Paid keys were not used. The configured `GROK_API_KEY` has a Groq-style prefix while the code calls `api.x.ai`, so live extraction may be failing into the rule-based fallback. Needs one live check.
- **Supabase.** The three new migrations are not applied there. Local timings do not transfer: an earlier measurement put the pooler at 67–330 ms per query.
- **Cloudinary** media delivery. Local storage only.
- **Business UI in a browser.** Typecheck, unit tests and production build only. No browser pass this session.
- **Retail price collection against any real site.** No host is allowlisted, so automated collection reports `NOT_CONFIGURED`.

### 3. Acceptance blockers that code cannot close

- **No real supplier export.** EVA pack listing names and shop prices are real, but its supplier codes, costs, stock and EANs are simulated. Precision and recall below say nothing about real supplier wording.
- **No genuine product images or rights.** The media pilot ran on 5 diverse SKUs with generated test pixels. A real 5-SKU pilot is blocked until images and their rights are supplied.
- **The ~50 launch SKUs do not exist.** None was created, and no synthetic product counts as inventory.

## Defects found and fixed

| Sev | Defect | Proof |
|---|---|---|
| P0 | 50,000-row file refused by 10,000-row and 5 MB limits | Reproduced before the fix |
| P1 | Candidate sweep quadratic: unindexed JSON scans, then a parameterised status defeating the partial index | 4,046 eligible rows: 406 s → 81 s; EXPLAIN 1,464 → 74 buffers |
| P1 | Row-level `RETAIL_REFERENCE` stored as `PURCHASE_COST`: a retail price could become a supplier cost | Oracle P10, D22 |
| P1 | One malformed barcode rolled back the whole offer commit | Red 409 → green 201, that row held alone |
| P1 | 50,000 known rows could not commit (bind-parameter cap, 30 s transaction) | Failed → 50,000 offers in 253 s |
| P1 | Research outage cached forever as an answer; marked `succeeded` | `glo285-research-resilience` |
| P1 | LLM output stored unvalidated; model asked with no page text | Same; fabricated facts rejected |
| P1 | Any host "official" for an Arabic brand; look-alike domains official | Same, plus unit tests |
| P1 | Background AI unbounded: 50,000 concurrent calls possible | Now 4 concurrent, 200 per file, stops on outage: 8 calls on an all-eligible 50k file |
| P1 | "( 4 Ampoules * 15 Ml )" parsed as one unit, so the multipack could never match | Oracle R20; unit tests |
| P1 | Foreign currency in a row, 999,999 stock and a contradicting pack spec passed silently | Oracle D20/D21, P05, P12, I06 |
| P2 | SSRF gaps: metadata IP, mapped IPv6, trailing dot, credentials | Unit tests |
| P2 | Job list loaded every job's rows; re-upload reopened a blank mapping form | `glo285-scale-gate`, EVA |

Built: the independent Media Service (`catalog.media_assets`) and read-only retail observations (`ingestion.retail_price_observations`).

## 50,000-row benchmark

Real services; one clean database per run; 8-column synthetic rows; dead AI endpoint. Local single process, so these are not production latencies. `Excl/elig/unres` are fixture counts.

| Profile | Excl / elig / unres | Time | Rows/s | Peak RSS | SQL | Identity calls | AI | Product/SKU writes |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| all-excluded CSV | 50,000 / 0 / 0 | **1.9 s** | 26,584 | 537 MB | **20** | **0** | **0** | **0** |
| all-excluded XLSX (16 MB) | 50,000 / 0 / 0 | 3.9 s | 12,859 | 576 MB | 21 | 0 | 0 | 0 |
| mixed 99% | 49,504 / 404 / 92 | 4.1 s | 12,275 | 574 MB | 1,273 | 404 | 8 | 0 |
| mixed 95% CSV | 47,502 / 2,007 / 491 | 35.0 s | 1,427 | 650 MB | 6,123 | 2,007 | 8 | 0 |
| mixed 95% XLSX | 47,502 / 2,007 / 491 | 33.7 s | 1,485 | 604 MB | 6,122 | 2,007 | 8 | 0 |
| mixed 90% | 44,989 / 4,046 / 965 | 81.4 s | 615 | 639 MB | 12,291 | 4,046 | 8 | 0 |
| ambiguous-heavy | 2,464 / 2,534 / 45,002 | 37.2 s | 1,344 | 931 MB | 7,712 | 2,534 | 8 | 0 |
| all-eligible, all new | 0 / 50,000 / 0 | 1,432 s | 35 | 1,034 MB | 151,383 | 50,000 | 8 | 0 |
| known fast lane: match | 0 / 50,000 / 0 | 133 s | 376 | 2,503 MB* | 851 | 50,000 | 0 | 0 |
| known fast lane: commit | | 253 s | 198 | | 100,456 | | 0 | 50,000 offers |
| 1,000-row mixed | 956 / 31 / 13 | 0.4 s | 2,650 | 424 MB | 146 | 31 | 8 | 0 |

*Peak across match and commit. Baseline RSS with the app booted is about 410 MB.

**Gate proof.** In every run, excluded rows made zero identity, normalization, AI, research or media calls and zero product or offer writes; every row is in exactly one accounting bucket, or the import throws. An all-excluded file stores 429 bytes of outcome data. Before: rejected outright.

**AI count of 8:** the provider was unreachable by design, and the breaker stopped after 5 consecutive failures plus 3 in flight.

**Not streaming.** CSV and XLSX are parsed whole in memory, bounded by the 25 MB and 50,000-row limits. The owner's bounded-memory requirement is met by a hard ceiling, not by streaming. SheetJS has no streaming XLSX read.

The matrix ran before two small later changes: chunked commit lookups (the fast-lane row was re-measured after it) and the re-upload response. Neither is on the excluded-row path.

## Accuracy: EVA oracle

Listing names are real, labels are the pack author's, supplier data is simulated. **This is not production accuracy.**

| Measure | Result |
|---|---|
| Cases evaluated | 126/126 (no row lost) |
| False automatic links | **0** of 31 |
| Automatic links correct | 31/31 |
| Linkable cases linked automatically | 31/81. The rest abstained into review |
| First import of 20 listings: automatic links | 0/20; review rate 100%, by design without verified barcodes |
| Expected SKU offered to the reviewer | 15/15 known rows, always first |
| Reviewer confirmations accepted | 15/15 |
| Re-import after confirmation | 15/20 on the fast lane, 0 AI calls |
| Second supplier | 5 independent offers, supplier A's untouched, 0 new SKUs |
| Collision file | 14 cases: 0 links |

Recall here is deliberately low on first contact: the system prefers review to a guess. Earlier matching figures remain in `GLO-285-matching-report.md`: unseen wording had 0 false links and 57.1% automatic recall on synthetic data.

## Legacy test changes (reviewed for weakening)

22 older suites were red at baseline (108 of 674 tests) because they predate the allowlist and the P0 identity rules.

- **Admission is stubbed in 21 suites** by `test/fixtures/downstream-admission.ts`. They prove what happens after admission, not admission. Real-policy admission is proven by `ingestion-eligibility`, `ingestion-eligibility-operational`, `glo285-scale-gate`, `glo285-eva-real-products` and `glo285-publication-journey`, which do not use it. Test-only; nothing in `src` references it.
- **Barcodes:** random fixtures replaced with valid GS1 check digits, because 90% failed the checksum.
- **Expectations that became stricter:** barcode alone no longer auto-links an unread cross-language title (`sg04`, `lifecycle`); a wrong-brand row is refused at approval, earlier than before (`sg05`); several 400s became 409 identity conflicts. A reviewer now must state evidence.
- **Moved, not lost:** research caching moved to `glo285-research-resilience`, where a provider actually answers; the oversize check moved to the 25 MB limit, with a new test that images keep the 5 MB limit.
- **Coverage genuinely reduced:** in `g09` and `sg03` the `OUT_OF_SCOPE` row outcome became `POLICY_HOLD`. Since the allowlist, the upload path skips the keyword classifier, so that outcome is unreachable there. The classifier itself keeps `g09-scope-golden`. Worth an owner look: a product of an allowed brand and category is no longer stopped by product-type keywords.
- I tightened my own first drafts of `g04` and `sg05` after this review, and a too-broad commit fix was narrowed so that a genuine identity contradiction still rolls back the whole commit (`glo285-identity-safety`).

## Remaining gaps

**P0/P1 known in code: none.** That covers defects found, not a guarantee, and nothing here has met a real supplier file.

**Owner decisions (behaviour unchanged):**
1. `SUPPLIER_PROVISIONAL_ORDERABLE` defaults to on: a supplier file alone can make a SKU orderable before any confirmation. Tests cover the strict mode.
2. Publication needs a barcode for a new SKU. EVA's real listings have no verified barcodes, so they cannot publish as new products today.
3. Non-EGP in a row cell now holds for review; an Admin-approved constant currency does not. New behaviour from the oracle's requirement.

**The full API suite is not green. Its 26 failures:**
- **21 in stale suites outside the 813-test set: `product-readiness` 14, `supplier-workflow-engagement` 3, `g10-upload-outcome-truthfulness` 3, `glo-77` 1.** They predate the allowlist and would need their scenarios rewritten. They are not evidence for or against those paths, and were left as they were after one time-boxed attempt. New suites cover overlapping ground (`glo285-publication-journey`, `glo285-eva-real-products`, `glo285-scale-gate`), but `product-readiness`'s 12-product pilot scenario has not itself been re-proven.
- **5 environmental: `delivery-fee-policy` 4, `product-discovery` 1.** The test log shows `Can't reach database server`; the PostgreSQL log shows `could not reserve shared memory region (error code 48)`, a Windows startup race in this throwaway cluster, and `could not serialize access` twice. Run one suite at a time on a fresh database they pass: `delivery-fee-policy` 4/4, `product-discovery` 8/8, `cash-round-settlement` 4/4 (hit in an earlier run). A multi-suite re-run hit the same flake, so this is not "fixed": a clean full run needs a steadier database such as the Docker recipe. The `could not serialize` conflicts on `order.create` were not investigated further.

**P2:**
- Commit revalidates each row, about 2 queries per row. At the earlier pooler latency, 50,000 rows would take hours in one transaction. Fine for ~50 SKUs; must be batched before large files on Supabase.
- 2.5 GB peak on a 50,000-row known file. Provision for it or batch the commit.
- Background matching and enrichment are in-process. After a restart, `POST /ingestion/jobs/:id/match` resumes matching; enrichment waits for on-demand.
- Research reads only the first source, and a squatted `brand.xyz` domain would read as official until human review.
- Media has an API but no Admin UI. Template 01 takes its field colour from the caller.
- `apps/api` lint still fails: 470 errors, baseline 494. New files are clean.
- One `500` in `glo285-research-resilience` once, not reproduced in the following runs, and probably the same database flake. Error logging is left on in that spec.

## Migrations and rollback

Additive, applied only to the local test cluster. **Not applied to Supabase: needs owner authorization.**

| Migration | Adds | Rollback |
|---|---|---|
| `20261104100000_glo285_ingestion_sweep_indexes` | 4 indexes | `DROP INDEX` each; slower, still correct |
| `20261104110000_glo285_media_assets` | `catalog.media_assets`, 4 enums, 2 nullable `product_media` columns, immutability trigger | In the migration's header |
| `20261104120000_glo285_retail_price_observations` | One table, one enum | In the migration's header |

Before applying on production, check `SELECT show_trgm('سيرافي')` returns trigrams; Arabic retrieval depends on it.

## Reproduce

From `apps/api`, with `DATABASE_URL` and `DIRECT_URL` both on a local `*_test` database with migrations applied and provider keys blank:

```bash
npx jest --runInBand --forceExit --testPathPattern 'test/(integration/(g0[0-9]|glo-12|glo285|glo284|ingestion-|product-sku-media|sg[0-9]|supplier-ingestion)|unit/(glo285|g09|.*ingest|.*spreadsheet|.*normal))|test/architecture'
```

```bash
node --max-old-space-size=4096 scripts/benchmark-ingestion-scale.cjs --profile mixed95 --rows 50000 --format csv --out <dir>
```

Profiles: `mixed90`, `mixed95`, `mixed99`, `all-excluded`, `all-eligible`, `ambiguous-heavy`, `known-fast-lane`. Use a fresh database per run. Raw results: `docs/verification/GLO-285-closure-evidence/`.

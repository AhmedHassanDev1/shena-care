# ShinaCare — Research Discovery closure, updated 2026-11-11

## Status

**Research code merged locally into `main` by fast-forward:** the prior `main` commit was `0244296`; it advanced to `3ffd6e2` on 2026-11-11. No push or deployment was performed. The clean `main` checkout is `C:/Users/El-mostakbal.DESKTOP-PM74NIT/.codex/worktrees/research-discovery-closure/shena care`.

After the owner confirmed concurrent work had ended, the desktop checkout with 124 uncommitted changes was moved, without changing its files or index, to `codex/main-work-in-progress-20261111` at `0244296`. Before/after hashes of the staged diff (`74c5d79b0809342d30f69c4548f3d293a3fbfc80`), unstaged diff (`1b0aaa111ada49ce35fc20e95d5d47c952410b85`), and expanded status (`2f2ba607bf2dec1acea77cf5df22f54c5d5cbacf`) matched. The protected checkout still has 124 status entries; its work is not part of the research merge. The ancestor branch `codex/research-discovery-engine` also contains Routine Builder, Chatbot, and Business Workspace changes; only the separate research-only branch was fast-forwarded into `main`.

## PostgreSQL verification

- Disposable local PostgreSQL: `127.0.0.1:5434/shenacare_test`; both `DATABASE_URL` and `DIRECT_URL` pinned there for tests. The original intake branch previously applied 81 migrations. On 2026-11-11 a fresh test container received the 80 migrations present on `main`, exit 0.
- The original intake branch ran `test/integration/research-discovery.e2e-spec.ts`, `test/integration/catalog-publication.e2e-spec.ts`, and `test/unit/product-research-discovery.spec.ts`: **3 suites, 26 tests passed, exit 0**. The integration suites exercise actual Nest endpoints and PostgreSQL persistence, source URLs and field evidence, idempotent duplicate handling, exact SKU/variant matching, existing value preservation, conflict holds without catalog writes, and source failure recovery. Search and scrape provider responses are controlled fixtures in the integration tests; development enrichment below used live provider results.
- TypeScript `tsc --noEmit --project tsconfig.json`: exit 0. Targeted ESLint on the four changed source/test files: exit 0. `git diff --check`: exit 0.
- On the isolated `main`-based branch, the research integration test, research unit test, and source-fetch security test passed again on 2026-11-11: **3 suites, 26 tests, exit 0**. TypeScript and Nest build exited 0 in the same verification round; targeted ESLint and `git diff --check` had exited 0 in the prior round. This verifies the selected research changes without the Routine Builder or Chatbot ancestry.

## Development product application and API readback

Ten distinct existing, published, identity-verified SKUs were matched to the original intake source URLs and exact sizes. Research was started through `CanonicalResearchService.startRun` and evaluated through `autoVerify` under an existing Admin actor. [Before snapshot](dev-before.json), [after snapshot](dev-after.json), and [run results](dev-apply-results.jsonl) record the database results. The snapshots contain public catalog metadata and hashed field values; no credentials are stored.

On the original research branch, [public API readback](dev-api-readback-parent.json) returned HTTP 200 and the expected product ID for all ten `GET /products/:slug` requests. On the clean `main`-based branch, [the same readback](dev-api-readback.json) returned **8 HTTP 200 and 2 HTTP 404**. The eight responses exposed the expected existing usage fields (six present, Eva 023/024 absent). SC-MVP-055 and 056 were 404 despite being marked published in the database: their derived media did not satisfy the committed `main` public product eligibility path. The original branch has additional catalog/media changes; transferring them would violate the instruction to exclude image processing. The 404s remain an explicit public API limitation of the merged code.

| SKU | Usage | Description | Warnings | INCI | New verified catalog fields |
|---|---|---|---|---|---:|
| SC-MVP-001 | present → present | missing → missing | missing → missing | missing → missing | 0 |
| SC-MVP-006 | present → present | present → present | missing → missing | missing → missing | 0 |
| SC-MVP-007 | present → present | present → present | missing → missing | missing → missing | 0 |
| SC-MVP-008 | present → present | present → present | missing → missing | missing → missing | 0 |
| SC-MVP-011 | present → present | present → present | missing → missing | missing → missing | 0 |
| SC-MVP-013 | present → present | present → present | missing → missing | missing → missing | 0 |
| SC-MVP-023 | missing → missing | present → present | missing → missing | missing → missing | 0 |
| SC-MVP-024 | missing → missing | present → present | missing → missing | missing → missing | 0 |
| SC-MVP-055 | present → present | present → present | missing → missing | missing → missing | 0 |
| SC-MVP-056 | present → present | present → present | missing → missing | present → present (27 ingredients) | 0 |

Aggregate before → after: usage **8/10 → 8/10**, description **9/10 → 9/10**, warnings **0/10 → 0/10**, full INCI **1/10 → 1/10**. Every tracked published field hash stayed the same. New field-level proposals/evidence were persisted for SC-MVP-006 (usage, key ingredients), SC-MVP-008 (manufacturer claim), and SC-MVP-013 (usage), but remained unverified; no current `CONFLICT` facts or critical holds remain. The Eva serum pages exposed empty directions sections to the accessible scraper and their direct fetch was rate limited. No instructions were inferred from a heading or substituted from a similar product. The latest runs are `COMPLETE` for 006/008/013, `NO_EVIDENCE` for 007/011/023/024/055/056, and `PROVIDER_UNAVAILABLE` for 001's earlier run; no accepted new data resulted.

## Correctness incident and repair

The first live run for SC-MVP-001 exposed a page-scoping defect: a related 60 ml product appeared before the target page's H1, producing a false size conflict and a malformed key ingredient proposal that temporarily replaced an existing reviewed claim. Processing was stopped after that first run. The prior key ingredients and provenance were restored through the catalog update workflow; the three erroneous proposals were rejected, and an interrupted empty run for SC-MVP-006 was marked failed. The final snapshot matches all tracked pre-run product fields, and SC-MVP-001 has no remaining critical hold. The transient write and repair may have advanced audit version/timestamps; they are not represented as a successful enrichment.

The extraction now scopes scraped Markdown to the target H1, derives size from the exact heading, ignores navigation text as usage, rejects empty ingredient sections, shapes ingredient claims correctly, and preserves existing reviewed claims. The PostgreSQL tests cover these regressions. The earlier `after-final.jsonl` benchmark overstated verified retrieval because it did not use the canonical product context and counted content before the target H1; [read-only corrected results](after-closure2.jsonl) supersede it. No defensible improvement in **persisted verified completeness** was measured.

## Scope and next action

The isolated branch changes research extraction, verification, source fetching, identity helpers, published-content projection of applied facts, focused tests, the description compare-and-set helper, and this evidence report. No Routine Builder, Chatbot, Recommendation Engine, or image-processing code was transferred. **Code integration is complete, but the original data-level Definition of Done is not:** the live development run produced zero new verified catalog fields, and two public API readbacks returned 404. Those gaps require source evidence and separately owned media eligibility work respectively. Do not treat unverified proposals as merge-ready data.

## Isolated changed paths

- Research: `brand-aliases.ts`, `canonical-research.service.ts`, `catalog-decision-engine.ts`, `identity-text.ts`, `product-content.service.ts`, `product-fact-extractor.ts`, `product-research.service.ts`, `product-source-discovery.ts`, `research-evidence.ts`, and `research-source-fetcher.ts` under `apps/api/src/modules/catalog/research/`.
- Required catalog helper: `apps/api/src/modules/catalog/services/catalog-intake.service.ts`.
- Tests: `apps/api/test/integration/research-discovery.e2e-spec.ts` and `apps/api/test/unit/product-research-discovery.spec.ts`.
- Evidence: this report plus `after-closure2.jsonl`, `dev-before.json`, `dev-after.json`, `dev-apply-results.jsonl`, `dev-api-readback.json`, `dev-api-readback-parent.json`, and the read-only `dev-api-readback.cjs` verifier under `output/research-discovery/`.

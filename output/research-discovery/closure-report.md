# ShinaCare — Research Discovery closure, 2026-11-10

## Status

The research engine is **not merged into `main`**. `main` is at `0244296` with 124 uncommitted changes, including changes to the same research files and catalog schema. Branch `codex/research-discovery-engine` descends from `f46f77d` through `f622aac`, whose commit also contains Routine Builder, Chatbot, and Business Workspace changes. A separate `codex/research-discovery-main-isolated` branch now starts at `main` and carries only the research files, tests, evidence, and the required compare-and-set description helper. Merging into the occupied `main` worktree would risk unrelated work. No reset, stash, overwrite, push, or merge was performed.

## PostgreSQL verification

- Disposable local PostgreSQL: `127.0.0.1:5434/shenacare_test`; both `DATABASE_URL` and `DIRECT_URL` pinned there for tests. 81 migrations applied, exit 0.
- Final test command: `node scripts/isolated-test-env.cjs node ../../node_modules/jest/bin/jest.js --runInBand --runTestsByPath test/integration/research-discovery.e2e-spec.ts test/integration/catalog-publication.e2e-spec.ts test/unit/product-research-discovery.spec.ts`. **3 suites, 26 tests passed, exit 0.** The integration suites exercise actual Nest endpoints and PostgreSQL persistence, source URLs and field evidence, idempotent duplicate handling, exact SKU/variant matching, existing value preservation, conflict holds without catalog writes, and source failure recovery. Search and scrape provider responses are controlled fixtures in the integration tests; development enrichment below used live provider results.
- TypeScript `tsc --noEmit --project tsconfig.json`: exit 0. Targeted ESLint on the four changed source/test files: exit 0. `git diff --check`: exit 0.
- On the isolated `main`-based branch, the research integration test, research unit test, and source-fetch security test passed: **3 suites, 26 tests, exit 0**. TypeScript, targeted ESLint, Nest build, and `git diff --check` also exited 0. This verifies the selected research changes without the Routine Builder or Chatbot ancestry.

## Development product application and API readback

Ten distinct existing, published, identity-verified SKUs were matched to the original intake source URLs and exact sizes. Research was started through `CanonicalResearchService.startRun` and evaluated through `autoVerify` under an existing Admin actor. [Before snapshot](dev-before.json), [after snapshot](dev-after.json), and [run results](dev-apply-results.jsonl) record the database results. The snapshots contain public catalog metadata and hashed field values; no credentials are stored.

On the original research branch, [public API readback](dev-api-readback-parent.json) returned HTTP 200 and the expected product ID for all ten `GET /products/:slug` requests. On the clean `main`-based branch, [the same readback](dev-api-readback.json) returned **8 HTTP 200 and 2 HTTP 404**. The eight responses exposed the expected existing usage fields (six present, Eva 023/024 absent). SC-MVP-055 and 056 were 404 despite being marked published in the database: their derived media did not satisfy the committed `main` public product eligibility path. The original branch has additional catalog/media changes; transferring them would violate the instruction to exclude image processing. Public API verification is therefore incomplete for a safe merge of all ten products.

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

The isolated branch changes research extraction, verification, source fetching, identity helpers, published-content projection of applied facts, focused tests, the description compare-and-set helper, and this evidence report. No Routine Builder, Chatbot, Recommendation Engine, or image-processing code was transferred. To reach the Definition of Done, resolve the overlapping uncommitted changes on `main`, reconcile the research files with their active owners, address the two public API eligibility failures within the separately owned media work, rerun PostgreSQL/API verification on the resulting tree, and merge only if it passes. The live development run produced **zero new verified catalog fields**, so the requested completeness improvement is not yet demonstrated. Do not treat unverified proposals as merge-ready data.

## Isolated changed paths

- Research: `brand-aliases.ts`, `canonical-research.service.ts`, `catalog-decision-engine.ts`, `identity-text.ts`, `product-content.service.ts`, `product-fact-extractor.ts`, `product-research.service.ts`, `product-source-discovery.ts`, `research-evidence.ts`, and `research-source-fetcher.ts` under `apps/api/src/modules/catalog/research/`.
- Required catalog helper: `apps/api/src/modules/catalog/services/catalog-intake.service.ts`.
- Tests: `apps/api/test/integration/research-discovery.e2e-spec.ts` and `apps/api/test/unit/product-research-discovery.spec.ts`.
- Evidence: this report plus `after-closure2.jsonl`, `dev-before.json`, `dev-after.json`, `dev-apply-results.jsonl`, `dev-api-readback.json`, `dev-api-readback-parent.json`, and the read-only `dev-api-readback.cjs` verifier under `output/research-discovery/`.

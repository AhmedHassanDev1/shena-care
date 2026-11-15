# Catalog evaluation — 15 November 2026

This is a real, isolated evaluation input batch, not a publish/import request against the shared catalog. The current approved policy was read in an explicit read-only transaction (`transaction_read_only=on`), version 23. No shared data was changed.

## Inputs and selection

- `dataset.json`: 100 distinct manufacturer identities, exact input names, expected names/net contents/packs, source timestamps and SHA-256, and selection keys. Unknown GTINs remain null; native manufacturer SKU strings are kept separately and never promoted to barcodes.
- `input.csv`: the exact UTF-8 names and manufacturer URLs submitted through Admin Intake. This measures the **names plus source URL** lane; name-only web discovery is not measured.
- `input-variants.json`: 22 documented Arabic input spellings keyed by exact manufacturer URL and title. They do not alter the expected identity or establish manufacturer claims.
- `policy-snapshot.json`: public Brand/category metadata, approved BrandDraft aliases and approved policy only; no customer data, API keys or selling/acquisition prices. Policy version 23 was unchanged on the second read-only refresh.
- `source-ledger.json`: all discovered collection/product URLs, native titles, outcomes and exclusions. Raw HTML is retained in local QA archives, not committed.
- `scope.json`: actual ScopeGate preflight. Missing category mapping remains in the evaluation as a difficult case; it is not cherry-picked away.

The collector enumerates verified manufacturer catalogs, excludes ambiguous native net contents and non-care/out-of-scope products, removes promotional-title duplicates, then takes seeded round-robin brand/type strata sorted by URL hash. It never selects for pipeline success. The v2 seed is `shinacare-eligible-20261115-v2`; 123 eligible distinct candidates were available for selecting 100. The selected batch includes six allowlist brands, 13 type strata, 34 size/unit combinations, one multipack, 22 Arabic, 28 mixed and 50 English names. Eva contributes 51/100; this is a disclosed source-cohort bias, not Egyptian-market prevalence or coverage of all nine allowlist brands.

Manufacturer sources: [Parkville shop](https://shop.parkvillepharma.com/), [Eva Cosmetics shop](https://www.shop.eva-cosmetics.com/), [Majestic's Capixy catalog](https://e-majestic.com/pages/capixy). Native source titles, not search snippets, supply the literal identity oracle. The stored Clary canonical display name/website are inconsistent with Parkville's haircare brand; the current approved `clary` alias maps the canonical ID, and this data-quality issue remains explicit.

## Reproduce

Use installed workspace dependencies and a **new disposable localhost PostgreSQL database ending `_test`**. Both explicit datasource URLs must match. The guard runs before loading the app and again before seeding. The operator script refuses a nonempty initial database; on resume it checks the job, database and exact input checksum. It disables paid research providers, live intake workers and public media uploads, writes files only into its local output directory, and asserts zero publication and selling-price rows throughout.

From the repository root, after creating the fresh local database:

```powershell
$env:DATABASE_URL = 'postgresql://astra@127.0.0.1:55435/my_catalog_evaluation_test'
$env:DIRECT_URL = $env:DATABASE_URL
node apps/api/scripts/local-test-database.cjs node_modules/prisma/build/index.js migrate deploy --schema apps/api/prisma/schema.prisma
node --use-system-ca apps/api/scripts/run-catalog-evaluation.cjs apps/api/scripts/data/catalog-evaluation-20261115 apps/api/scripts/data/catalog-evaluation-20261115/policy-snapshot.json output/catalog-evaluation-runtime
node apps/api/scripts/summarize-catalog-evaluation.cjs apps/api/scripts/data/catalog-evaluation-20261115 output/catalog-evaluation-runtime
```

The shown port/user belong to the task's disposable local instance; use your own explicit localhost test connection when reproducing elsewhere. Migrations require the existing pg_trgm prerequisite used by the project. Never substitute a development/staging/production URL or weaken the guard.

Fresh manufacturer discovery (no DB writes) uses:

```powershell
node --use-system-ca apps/api/scripts/collect-catalog-evaluation.cjs apps/api/scripts/data/catalog-evaluation-20261115/policy-snapshot.json output/catalog-evaluation-discovery
```

The collector checkpoints `discovery.json` and content-addressed `sources/*.html`. Re-running resumes; `--rebuild` reclassifies the recorded HTML before fetching any missing pages. Live websites may change: preserve the recorded hashes/HTML to reproduce a specific observation. TLS, robots and SSRF restrictions stay enabled.

Audit retained source binding with `node apps/api/scripts/audit-catalog-evaluation-sources.cjs <dataset-directory> <archive-sources-directory> <output-file>`. The committed `source-binding-audit.json` records 100/100 hash-verified native Product identities bound to the primary page title or URL. This does not approve their claims or images.

## Measurement boundaries

The independent oracle compares all native formulation/name words after brand/measurement formatting removal, canonical brand, net content/unit and pack count. A correct brand and size with the wrong named variant is incorrect. Precision covers only identified rows; coverage uses all 100. These checks do not substitute for an expert formula/GTIN/label audit.

This is a development cohort used to expose and repair identity defects, not a blind holdout. Fixed-code measurements require committed source; the runner records Git HEAD and source hashes, rejects changed-code resumes, and fails if code changes during execution. Earlier exploratory results remain separate from that proof.

PDP readiness, guidance readiness and commercial eligibility are separate. This lane collects no market prices and never publishes. The ten-product pilot separately exercised current retail research; none met the corroborated regular-price gate. Numeric automatic selling-price rules remain unapproved; confirmed order prices are untouched. Whole-order contribution and actual acquisition costs remain owned by Commerce/Hub and current Admin Settings.

`summary.json` in the runtime output records counts, holds, review-demand lower bound, measured time and fetch usage. It does not report unmetered network/compute/storage costs as zero. Pre-repair and repaired runs must keep separate input checksums and denominators.

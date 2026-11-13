# Catalog gate: incomplete real regression

Base: `90105d4`. Independently verified changes merged into main: `0681f8a` (durably defer enhancement; no worker launched by intake), `3524ce9` (real PostgreSQL/original-photo preservation regression). Image WIP `242c6fd` remains separate and unmerged.

## Real results

- Local disposable `catalog_blockers_20261113_test` only; no shared DB mutation. Existing CeraVe identity from the previous real run was reused. Test photo preservation fixtures are excluded from the SKU counts below.
- Names-only initial 3: one identity verified, two safely held; 22,552 ms.
- Correct official-source CSV 3: 3 distinct persisted identities; 34,218 ms. All authenticated HTTP 200 responses match DB SKU ID, product name, size and barcode. This is **not** three fully validated products: approved originals are missing and the cream has a source/formula conflict.
- Official-source CSV 10: 6 distinct persisted identities; initial ingestion 77,822 ms. Three linked existing, three created drafts. No catalog products were published.
- Two rows held: The Ordinary Hyaluronic Acid has a different named variant on the supplied page; Cetaphil page did not confirm the requested metric size. No variant/size substitution was made.
- Two La Roche-Posay rows retry automatically: `BRAND_RESEARCH_UNAVAILABLE:SITE_ACCESS_DENIED`. Actual attempts, last errors and future retry timestamps are in `10-sources/results.json` and `audit.json`. No retry timestamp was accelerated.
- Identical replay returns the same job and leaves product, SKU, fact and asset counts unchanged. Authenticated API facts belong to their requested SKU; unauthenticated workbench read returns 401. Six persisted identities have no duplicate product/size/unit/variant identity. All unverified barcodes remain null.
- Complete gate: **0/10**. The driver exits 1 when any requested product lacks an approved, hash-verified original or has critical fact review blockers. Readback-only timings are not ingestion timings; earlier timings remain in `priorRuns`.

## Fact review

`audit.json` records two CRITICAL exceptions opened idempotently through `CatalogDecisionLogService`. Publication readiness confirms `CRITICAL_EXCEPTION_OPEN` for both affected SKUs:

1. CeraVe Moisturising Cream: the official page highlights Niacinamide, but its INCI does not list it. This source contradiction requires formula review; no ingredient was invented to reconcile it.
2. The Ordinary Niacinamide: `Learn More About Niacinamide / Read More Here` was applied as a key ingredient. Existing matching and research implementations were left unchanged; the affected unpublished draft is held for review.

## Images and worker isolation

- Six original 900x900 The Ordinary files decode and match stored SHA-256 hashes. They remain PENDING_REVIEW because their source is outside the configured media trust list. No host was added to bypass this gate. Visual inspection includes the genuine bottle and a marketing infographic: the six files are not six validated packshots.
- CeraVe source images failed the existing resolution/source checks. No upscaling or wrong variant image was substituted.
- The new integration test verifies exact original photo byte/hash preservation, one durable PENDING editorial record after repeated requests, refusal to publish that record, and no change to product publication state. It uses an authentic regression photo, not a newly ingested product.
- Intake no longer starts or immediately retries BiRefNet. Processing remains an explicit media derive action; pending requests are durable records, not a new automatic worker/queue.
- Existing measured WIP evidence: optimized BiRefNet imports 28.125s, model load 56.138s, preprocessing 0.077s, inference 59.134s, matting 1.494s. Live path still failed in 198.756s with a 180s deadline. Those measurements were reviewed, not re-labelled as a new successful run. No new timeout, model, resolution reduction or ML stack was introduced.

## Verification

- Unit/provenance/approved-template/barcode/measure tests: 22/22, exit 0.
- Architecture boundaries: 7/7, exit 0.
- PostgreSQL/authentic-photo integration: 1/1, exit 0; repeated run passes without reusing pixels across different fixture SKUs.
- Changed enrichment/test files lint: exit 0. Full touched media service lint finds one existing `as any` at baseline `90105d4`; no new lint error introduced.
- Worktree `tsc --noEmit --preserveSymlinks`: exit 0. Main checkout `nest build` with the actual Nest/Swagger/declaration configuration: exit 0 before and after the production change. The Dockerfile calls this build command after `npm ci` on Node 20 Alpine; Docker/Node 20 container build was not executed. No production TypeScript configuration was changed for the worktree junction TS2742 issue.
- Existing installed runners used directly; pnpm bootstrap previously attempted an unrelated dependency installation and failed certificate verification. No dependency or lockfile changes.

Operator scripts require explicit matching local *_test URLs before importing the app. Run from `apps/api`, with real provider credentials supplied separately and system CA verification enabled: `node scripts/with-system-ca.cjs scripts/catalog-gate-real-run.cjs 3 --sources`, then `10 --sources`. `--resume` processes only naturally due retries; `--resume --readback` verifies persisted HTTP/DB/image state without research work. `catalog-gate-audit.cjs` records the observed review holds locally. Environment files, credentials and storage directories are not committed.

Remaining blockers: four unverified requested identities, two applied fact review defects, no approved original packshot for these six identities, and unreliable live BiRefNet processing outside intake. This evidence batch stays separate from main because the full 3-to-10 gate did not pass.

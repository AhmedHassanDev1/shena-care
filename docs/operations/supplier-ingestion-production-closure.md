# Supplier Ingestion — Production Closure Progress Report

Persistent execution log for the Supplier Ingestion → Product Intelligence → Catalog
Publication closure (gates GLO-273 … GLO-281). Resume from **Next safe action** below.
Linear status is not evidence; only executed tests recorded here count.

## Execution context (Phase 0 — 2026-10-22)

| Item | Value |
|---|---|
| Branch / HEAD | `feat/c0-commerce-integration` @ `9c22bf7` |
| Uncommitted user changes | `apps/business/**` (5 modified, 3 new dirs), `apps/api/scripts/{qa-supplier-audit,seed-staff,verify-db,verify-staff}.ts`, `apps/api/test/fixtures/eva-stress-pack/`, `apps/business/.env.example`, `services/ai/*.egg-info` — **untouched by this work** |
| `apps/api/.env` `DATABASE_URL` / `DIRECT_URL` | remote Supabase pooler (`aws-0-eu-west-1.pooler.supabase.com`, db `postgres`) — **never used for tests or migrations** |
| Test guard | `apps/api/test/test-database-guard.ts` refuses any DB name not ending in `_test` (verified) |
| Local Postgres | `docker-compose.yml` defines `shenacare-postgres` on `:5433`; **Docker Desktop cannot start: WSL2 kernel missing** (`wsl --status` → "The WSL 2 kernel file is not found… run `wsl --update`"). No native `psql`/`pg_ctl`. |
| Safe checks run | `tsc --noEmit` (src) → exit 0. `jest test/architecture` with `DATABASE_URL=postgresql://…@127.0.0.1:59999/shenacare_test` (dead local URL) → 7/7 pass. |

### Blocker B-1 (P0) — no isolated `_test` database
All DB-backed acceptance tests (every SG/GLO ingestion suite) are blocked. Remote Supabase
must not be substituted. Owner action needed — one of:
1. Run `wsl --update` (admin) so Docker Desktop starts, then `docker compose up -d postgres`
   and create `shenacare_test` on `localhost:5433`; or
2. Approve installing a local PostgreSQL 15+/17 (official installer or a portable binary) and
   provide a `postgresql://…@localhost:<port>/shenacare_test` URL.

**Update 2026-10-22 15:15** — owner ran `wsl --update`. `C:\Program Files\WSL\wsl.exe --version` → WSL 2.7.11,
kernel 6.18.33.2-2, `WSLService` running. But the inbox `C:\Windows\System32\wsl.exe --status` still reports
"The WSL 2 kernel file is not found", and Docker Desktop 4.84 logs `/backend/state … "wslUpdateRequired":true`.
Tried: Docker Desktop restart, `wsl --shutdown` + restart → still "Docker Desktop is unable to start".
A Windows restart is the usual step to finish switching the inbox `wsl.exe` to the Store package. B-1 remains open.

## Gap matrix (audit of code + tests, not of Linear)

| Gate | Status | Evidence (source) | Verified gaps |
|---|---|---|---|
| 01 Secure intake | **PARTIAL** | `ingestion.controller.ts` upload (AuthGuard+Roles, supplier scope); `upload-validator.ts`, `file-signature.ts`, `spreadsheet-parser.service.ts` (sniff, limits, formula neutralising); `ingestion.service.ts:105-237` SHA-256 + advisory-lock dedup; `storage.service.ts`/`local-storage.adapter.ts` private per-supplier keys, temp+rename writes. Tests `sg01`, `sg02` (DB, not executed). | No uploader/audit record on `IngestionJob`; dedup has no DB unique backstop on `(supplier_id, source_checksum)`; stored original never re-verified against checksum when re-read (`applyJobMapping` → `getFileBuffer`); `xlsx@0.18.5` parses untrusted files and has published advisories (prototype pollution CVE-2023-30533, ReDoS CVE-2024-22363) — dependency decision needed. |
| 02 Mapping & fingerprint | **EXISTS_BUT_BROKEN** | `format-fingerprint.service.ts`, `export-profile.service.ts`, `ExportProfile` model; approved profile reused without AI (`ingestion.service.ts:164`). File hash (`source_checksum`), layout fingerprint (`format_fingerprint`), identity fingerprint (`identity.fingerprint` v1) are distinct. | **P0:** a `SUPPLIER` can `POST /ingestion/jobs/:id/mapping`, which saves the profile `isApproved: true, approvedBy: <supplier>` (`ingestion.service.ts:266-274`) — supplier self-approves cost/retail/discount semantics and the profile is silently reused for every later file. Generic `price`/`سعر` header maps to purchase cost with no confidence gate. AI is not used for proposals (keyword heuristic only). |
| 03 Validation & eligibility | **EXISTS_BUT_BROKEN** | `row-normalization.service.ts`; zero vs missing qty handled (`MISSING`/`UNKNOWN`=null vs `ZERO`=0); zero cost → INVALID. Test `sg03` (DB; fails strict `tsc`). | **P0:** numeric `-5` qty → `+5` in stock (negative check only for strings; `parseInt(digits-only)`); `12.5` → `125`; `3-5` → `35`. **P0:** excluded-goods substring match runs *before* skincare cues → "Green Tea Cleanser", "Rice Water Toner", "Sugar Lip Scrub", "Coffee Scrub" become confident `OUT_OF_SCOPE` (rejected in `processMatching`). Bare discount `15` silently treated as fixed amount and used to derive cost; `-10%` sign dropped. Arabic-Indic digit prices rejected (safe-fail, unsupported). MOQ / pack units not modelled. |
| 04 Canonical SKU matching | **EXISTS_BUT_BROKEN** | `ingestion/services/product-identity.service.ts` alias → barcode (+approved barcode aliases, collision) → brand+name+size; hard vetoes brand/size/unit/pack/variant/barcode; never forces nearest. Tests `sg04` (DB). | **P0:** spreadsheet path (`uploadSupplierSpreadsheet` approved-profile branch, `applyJobMapping`) never calls matching — `processMatching` runs only for JSON `createJob`. Uploaded rows keep `matchedSkuId=null` and all SKIP in diff/commit. `sg11`/`sg12` hide this by writing `matchedSkuId` via Prisma. No AI-assisted matching endpoint exists (FastAPI has enrichment/content/guidance only). Brand candidates loaded in memory (no indexed retrieval). `createSupplierSkuAlias` upsert silently re-points an alias to another SKU. `processMatching` calls AI enrichment for EXACT_MATCH known SKUs. |
| 05 SupplierOffer fast lane | **EXISTS_BUT_BROKEN** | `offer-batch-commit.service.ts`: staged diff, per-supplier advisory lock, stale check, >30% jump and currency change → review, retail-only/price-only semantics, idempotent re-commit, held FULL_SNAPSHOT deactivations + `approveDeactivations`. No ingestion/sourcing code writes `SellingPrice` (grep). Test `sg05` (DB; fails strict `tsc`). | **P0:** `IngestionService.publishJob` FULL_SNAPSHOT branch (`ingestion.service.ts:1896-1940`) guards only when `actorId` is absent; an ADMIN publish of a snapshot with no approved candidates runs `supplierOffer.updateMany(... notIn matched → isAvailable:false)`, bypassing coverage confirmation. Freshness uses import time, not source data time (`sourceTimestamp` mapped but unused) → an older file uploaded later wins; no file-age warning. Reported quantity, MOQ, discount not persisted on the offer. `approveDeactivations` skips confirmation when called without options. |
| 06 New candidate & dedup | **EXISTS_BUT_BROKEN** | Candidate dedup in `classifyCandidateMatch` §4; catalog search includes unpublished products; brand reuse via `BrandService`/approved `BrandDraft`. | **P0:** `ensureCanonicalSku` product slug uses ASCII-only `slugify` → Arabic names collapse to `"<brand>-"`, so a different Arabic product's SKU is attached to the wrong `Product`. Fingerprint dedup scans only the 100 **oldest** open candidates. `existingCandidateId` is advisory only. Lock is per candidate, not per identity (barcode/fingerprint) → concurrent publish of two same-barcode candidates races on `skus.barcode` unique (500, not graceful). |
| 07 Product intelligence | **PARTIAL** | `product-research.service.ts` (field evidences, SSRF-validated URLs), `ingredient-ontology.service.ts`, `ProductIngredient.concentration` ("only when verified"), `routine-placement.service.ts`; verified-packshot gate (`requireMediaReview`, trusted source, barcode/size/pack match) in `ingestion.service.ts`. Tests `sg07`–`sg09` (DB). | Routine role / AM-PM / rinse-leave / frequency+unit / conditional schedules / usage variants live only in ingestion `enrichment` JSON; publish persists ingredients + one routine step only. Unknown fields not tracked explicitly. Cached research never invalidated. Needs deeper read once DB tests can run. |
| 08 Review, comparison, publication | **PARTIAL** | ADMIN-only approve/publish with role re-check, `withCandidateLock`, `canPublish` readiness, brand-draft gate, packshot gate, `assertCandidateOfferSafe`; `ranking.service.ts` (cost/reliability/freshness). `SellingPrice` separate. Tests `glo-77`, `sg10`, `sg11-*` (DB). | Publication not atomic: SKU create, alias upsert, media copy, offer commit, status update are separate writes (lock tx does not wrap them). Ranking ignores MOQ, discounts, same-unit normalisation (data not stored). |
| 09 Full E2E acceptance | **MISSING / BLOCKED** | `sg11-full-e2e-verification.spec.ts` (bypasses matching), `sg12` (synthetic `DEMO-*` CSV; fallback product create uses non-existent `title` field), untracked `test/fixtures/eva-stress-pack/*.xlsx` (synthetic oracle pack). | No real-flow E2E (upload→match→commit) without manual DB writes; no 1,000-row known-SKU run; no authentic supplier export available; blocked by B-1. |

### Test-suite type health
`tsc` over `src`+`test` with jest types reports errors in: `sg03-row-normalization`, `sg05-offer-batch-commit`,
`sg12-real-supplier-file-pilot` (`title` is not a `Product` field — its fallback product create would throw at
runtime), `ingestion-lifecycle`, `supplier-workflow-engagement` (`CONSUMER_REFERENCE` enum value does not exist),
`product-readiness`, `glo-237-po-lineage`, `test/unit/guidance/*`, `test/evaluations/routine-ai.eval`.
ts-jest still executes them (verified: `jest sg03` with a dead local `_test` URL → 14/14 fail only with
`PrismaClientInitializationError: Can't reach database server at 127.0.0.1:59999`). Even pure-logic suites
such as SG-03 boot `AppModule`, so they need the DB.

## Owner decisions (2026-10-22)
- Linear may be read (read-only) for scope. Requirements were read from GLO-244, GLO-258 and GLO-273.
- **"Supabase only, no local DB."** I briefly installed a portable PostgreSQL 17.11 under
  `%LOCALAPPDATA%\shenacare-pg` (port 5434) and migrated it; on the owner's instruction it is now **stopped and unused**
  (the folder can be deleted). Supabase access is read-only; every Supabase migration or test run needs explicit
  per-action owner approval.
- Supabase read-only snapshot (inside `SET TRANSACTION READ ONLY`): 7 ingestion jobs (3 with checksum),
  **0 duplicate `(supplier_id, source_checksum)`**, 35 items (10 matched), 20 offers (19 available, 1 supplier), 20 SKUs (all
  with barcode), 3 export profiles (all approved), 0 supplier SKU aliases. `prisma migrate status`: only
  `20261022090000_g01_source_intake_audit` is unapplied.

## Owner decisions (2026-10-23)
1. **Ranking** — redesign inside the existing Sourcing engine: eligibility filters first (exact SKU, fresh source, MOQ/pack
   feasibility, supplier eligibility, price-anomaly review, delivery constraints), then lowest comparable effective cost,
   respecting confirmation reliability and SLA; never auto-select an unverified suspiciously cheap offer.
2. **SupplierOffer terms migration** — design and review only, not execution (draft + preflight below).
3. **Stock feed** — a supplier spreadsheet is an availability signal, not a reservation or a confirmation; separate catalog
   visibility, provisional purchase availability and PO-level confirmed quantity; never fabricate `lastConfirmedAt`.
4. **Gate 09** — controlled synthetic tests on the Supabase DEVELOPMENT project incl. a bounded 1,000-row test, after a
   read-only preflight, recoverable snapshot, cleanup verification and resource limits; no resets, broad deletes, mass
   deactivations or migrations.
5. Fix unsafe fixture cleanup before stress testing. 6. Verify all GLO-273..281 gaps. 7. Narrow, task-owned commits only.

## GLO-273 — Gate 01 Secure Source Intake & File Custody

**Already implemented (reused):** AuthGuard + RolesGuard, multer MIME/extension filter + 5 MB cap, content signature
check, CSV/XLSX sniffing + formula neutralisation, SHA-256 + advisory-lock dedup, private per-supplier storage keys,
temp+rename writes, scoped private file serving, delete-on-failure compensation.

**Fixed / added (uncommitted):**
| Change | Files |
|---|---|
| Supplier scope taken from the session; a body `supplierId` that differs → 403; staff must name a supplier | `ingestion.controller.ts`, `dto/ingestion.dto.ts` |
| Intake audit: `uploaded_by`, sanitized `source_file_name`, `source_mime_type`, `source_size_bytes`, `source_metadata` (server `receivedAt`, workbook created/modified, declared `documentKind`, sheet names — advisory, never freshness) | `schema.prisma`, migration `20261022090000_g01_source_intake_audit`, `ingestion.service.ts` |
| DB backstop `UNIQUE (supplier_id, source_checksum)`; a P2002 race resolves to the winner's receipt | same |
| Retained originals re-verified against checksum before reuse and before remapping; mismatch → 409, original never overwritten | `ingestion.service.ts` |
| Zip-bomb / encrypted / ZIP64 / entry-count bounds from the ZIP central directory before inflating; row parsing bounded with `sheetRows` and the true extent checked (reject, never truncate); column cap on true extent | `spreadsheet-parser.service.ts` |
| Isolated-DB runner and example env (still useful if a `_test` DB is approved later) | `scripts/isolated-test-env.cjs`, `.env.test.example` |

**Evidence**
| Control | Test | Result |
|---|---|---|
| File safety / bounds | `npx jest --runInBand test/unit/g01-source-file-safety.spec.ts` (DB-free; dead local `_test` URL) | **8/8 pass.** Same spec against HEAD's parser: **3 fail** (zip bomb, encrypted, ZIP64 not rejected) → defect reproduced. |
| Types/lint | `tsc --noEmit`; strict `tsc` on both new specs; `eslint` changed files | pass; no new lint findings vs HEAD (39 pre-existing `no-explicit-any`) |
| Migration | `prisma migrate deploy` on the local test cluster (before the owner stopped it) | applied cleanly; Gate 01 columns/index match `schema.prisma` (`migrate diff`). Unrelated pre-existing drift: varchar/text types, dropped defaults, `products_search_concerns_idx`, `product_line_drafts_status_idx`, extra `routine_proposals` columns. |

**Owner approval (2026-10-22):** apply only `20261022090000_g01_source_intake_audit` to Supabase (dev/test environment, no
production data) and run the Gate 01 HTTP acceptance + regression tests there.

**Supabase preflight (read-only, before any write)**
| Check | Result |
|---|---|
| Target | `DATABASE_URL` user `postgres.cluidtctwgxxhybzftft` @ `aws-0-eu-west-1.pooler.supabase.com:6543/postgres` (pgbouncer); `DIRECT_URL` same project :5432; PostgreSQL 17.11 |
| Pending migrations | only `20261022090000_g01_source_intake_audit`; SQL = 5 nullable `ADD COLUMN` + 1 `CREATE UNIQUE INDEX` (additive) |
| History integrity | 55 applied, 0 unfinished/rolled back, 0 remote-only, 0 checksum mismatches vs repo files |
| Drift | remote-vs-`schema.prisma` diff = the known pre-existing drift + exactly the Gate 01 statements |
| Unique-index conflicts | 0 duplicate `(supplier_id, source_checksum)` among 7 jobs |
| Snapshot | `%USERPROFILE%/shenacare-db-snapshots/20261022-pre-g01/`: `schema.sql` (schema-only, 80 tables), `migrations-and-jobs.data.sql`, `SHA256SUMS`, `ROLLBACK.md` (DROP INDEX + DROP COLUMNs + delete migration row; documented, not executed) |
| Hazard found | Booting `AppModule` in tests started `DataRetentionService` global cleanup after 10 s, and `.env` enabled the domain-event poller. **Fixed:** retention disabled under `NODE_ENV=test` (`data-retention.service.ts`); runs force `DOMAIN_EVENTS_POLL_MS=0`. |

**Applied:** `npx prisma migrate deploy` → "Applying migration 20261022090000_g01_source_intake_audit"; `migrate status` → up to date.

**Supabase test runs** (`NODE_ENV=test`, pollers off, AI pointed at a dead address, provider keys blank, storage in a scratch dir;
one-off Jest config = repo config minus the `_test` guard; the repo guard itself is unchanged)
| Run | Suites | Result |
|---|---|---|
| Gate 01 acceptance | `test/integration/g01-secure-source-intake.e2e-spec.ts` | **11/11 pass** (first run) |
| Gate 01 regression | `sg01-canonical-intake`, `sg02-spreadsheet-parsing`, `supplier-ingestion-readback.e2e-spec`, `test/unit/g01-source-file-safety`, `test/architecture` | **5 suites, 32/32 pass** |
| After `xlsx` 0.18.5 → 0.20.3 | unit + SG-02 + Gate 01 e2e | **3 suites, 29/29 pass** |
| Cleanup proof | read-only counts before vs after both runs: jobs, items, profiles, suppliers, offers, aliases, SKUs, products, brands, selling prices, customers, sessions, domain events, outbox | **all 14 identical**; only `_prisma_migrations` 55→56; 0 files left in test storage |

**Also changed for this gate:** `xlsx` upgraded to SheetJS `0.20.3` from `cdn.sheetjs.com` (per GLO-273; fixes
GHSA-4r6h-8v6p-xvw6 and GHSA-5pgg-2g8v-p4x9, both reachable because supplier files are untrusted) — `apps/api/package.json`,
`package-lock.json` (removed only 0.18.5's own deps: adler-32, cfb, codepage, crc-32, frac, ssf, wmf, word). SG-01/SG-02
`afterAll` now delete only their own fixtures (SG-02 previously left suppliers/jobs/profiles/users/files; SG-01 left a brand).

| GLO-273 control | Verdict |
|---|---|
| Auth + tenant scope | **PASS** — 401/403 for anonymous, customer, unlinked and forged supplier; cross-tenant job/diff/list/original-file reads denied |
| File safety/limits | **PASS** — spoofed/corrupt/empty/executable/oversize rejected with no receipt; zip-bomb/encrypted/ZIP64 bounded |
| Storage and privacy | **PASS** — private per-supplier key, sanitized name, integrity re-verify, tamper → 409 without overwrite |
| Retry/duplication | **PASS** — repeat + 6 parallel identical uploads → 1 receipt; DB unique backstop; cross-supplier isolation; restore-on-retry |
| Network/storage failure | **PASS** — storage outage → 500, no receipt, retry succeeds; DB failure after store → stored file removed |
| Zero business mutation on upload | **PASS** — offers/SKUs/products/selling prices/aliases unchanged |
| UI correct receipt status | **NOT VERIFIED** — `apps/business/.../supplier/updates/page.tsx` is an uncommitted owner file |

**Status: backend PASS with evidence; NOT production-ready** — open: Supplier UI receipt wording; no retention/deletion policy
for retained originals (owner decision).

## GLO-274 — Gate 02 Mapping & Schema Fingerprint

**Reproduced P0 in real data (Supabase, read-only):** all 3 approved `export_profiles` were approved by a `{SUPPLIER}` account of
the same supplier, with no reviewed semantics (price columns `سعر_التوريد`, `سعر_التوريد`, `Purchase Price`). Code path:
`applyJobMapping` saved `isApproved: true, approvedBy: <supplier>` and every later same-layout file reused it.

**Already implemented (reused):** structural layout fingerprint (`format-fingerprint.service.ts`: sheets + normalized ordered
headers; distinct from file SHA-256 and product identity fingerprint), supplier-scoped `ExportProfile` versions, deterministic
reuse without AI, keyword proposal (EN/AR), cross-supplier profile isolation.

**Fixed / added (no migration — semantics live in the existing `mapping` JSON):**
| Change | Files |
|---|---|
| Typed reviewed semantics on a mapping: `documentKind`, `priceBasis`, `quantityBasis`, `discountBasis`; `mappingApprovalProblems` refuses anything but `UNIT_PURCHASE_COST`, unconfirmed qty/discount bases, and invoice quantity as stock | `export-profile.service.ts`, `dto/ingestion.dto.ts` |
| Supplier mapping = **proposal** (`isApproved:false`, `proposal.proposedBy`), job pinned to it, 0 rows admitted; internal reviewer (ADMIN/HUB_OPERATOR, role read from DB) approves; proposer can never approve; approval admits every job held on exactly that profile, once | `ingestion.service.ts`, `export-profile.service.ts`, `ingestion.controller.ts` |
| Reuse only profiles with approvable semantics and matching declared `documentKind`; legacy self-approved profiles go back to review (rows untouched) | `export-profile.service.ts` |
| Same-layout uploads while a proposal is open are held on that proposal | `ingestion.service.ts` |
| Quantity column used only for `ON_HAND`/`AVAILABLE_TO_SELL`; discount unit from `discountBasis` instead of guessing from a "(%)" header | `ingestion.service.ts`, `row-normalization.service.ts` |

**Evidence**
| Test | Result |
|---|---|
| `test/unit/g02-mapping-semantics.spec.ts` (DB-free) | **9/9 pass** |
| `tsc --noEmit`; strict `tsc` on Gate 02 specs + SG-02; eslint changed files | pass; lint findings identical to HEAD |
| `test/integration/g02-mapping-approval.e2e-spec.ts` on Supabase (owner-approved run): novel layout held; supplier proposal imports 0; supplier cannot approve; second file held on proposal; retail basis rejected; approval admits both held jobs once; reuse with **0 AI calls** and distinct file hashes; duplicate bytes reused; different document kind not reused; reordered layout held; legacy self-approval not reused; cross-supplier isolation; invoice qty never stock | **12/12 pass** (first run; verbose rerun 12/12) |
| Combined run: Gate 02 e2e + unit, Gate 01 e2e + unit, SG-01, SG-02 (updated), job readback, architecture | **8 suites, 64/64 pass** |
| Cleanup proof (read-only counts, 14 tables, before vs after both runs) | identical; 0 files left in test storage; no migration |

**Open / PARTIAL:** AI mapping proposals are not implemented — FastAPI has no mapping endpoint, proposals are deterministic
keywords (so sample-row prompt injection is not reachable today). No admin UI calls `POST /ingestion/profiles/:id/approve`, and
the supplier wizard (`apps/business/.../supplier/updates/page.tsx`, owner's uncommitted file) neither sends `semantics` nor shows
"awaiting approval". `sg03`, `sg11`, `sg12` still assume supplier self-approved mappings and must be updated in their gates.

**Status: backend PASS with evidence; NOT production-ready** — open: AI mapping proposals not implemented (PARTIAL), no admin approval UI, supplier wizard does not send/show semantics or awaiting-approval state.

## GLO-275 — Gate 03 Row Validation, Scope & Arabic Normalization

**Reproduced (DB-free, `test/unit/g03-row-validation.spec.ts` against pre-fix code): 28 of 41 cases failed** — numeric `-5` became
+5 in stock; `12.5`→125, `3-5`→35, `5 boxes`→5; Arabic-Indic quantities/prices unread; `-10%`/`150%` discounts sign-dropped or
accepted; bare `15` discount silently treated as a currency amount; contradictory cost/retail/discount not flagged; "Green Tea
Cleanser", "Rice Water Toner", "Sugar Lip Scrub", "Coffee Body Scrub", "Steam Cream", "Cabbage … Cream", "غسول بالشاي الاخضر" excluded
as food/goods (substring match ran before skincare cues); lipstick/mascara/perfume under a skincare brand not excluded.

**Already implemented (reused):** zero vs unknown vs missing quantity, zero/negative/garbled cost → INVALID, retail-only cost never
manufactured, Arabic text normalization (alef/ya/ta, tashkeel, digits) for classification, size/pack extraction, 100% row
outcomes (`IMPORTED`/`INVALID`/`DUPLICATE`) on the job.

**Fixed (no migration):**
| Change | Files |
|---|---|
| Quantity: number cells taken exactly; negative → INVALID; decimal/range/unit-bearing text → REVIEW with stock UNKNOWN; Arabic-Indic digits and `1,200`/`١٬٢٠٠` thousands; explicit "unknown/N/A/غير معروف" stays UNKNOWN without review | `row-normalization.service.ts` |
| Money: Arabic-Indic digits and `٫`/`٬` separators | same |
| Discounts: `classifyDiscount` → typed / INVALID (signed, >100%, garbled) / AMBIGUOUS (bare number, no stated unit); currency code in the cell = per-unit amount; never derive cost from an ambiguous discount; explicit cost contradicting retail−discount → REVIEW | same |
| Scope: exclusions are whole-word/token product types (goods, electronics, clothing, **makeup, perfume, tools**); food/ingredient words alone never exclude (→ REVIEW); excluded + skincare/haircare signals → REVIEW | same |
| Confident `OUT_OF_SCOPE` rows recorded as a row outcome with reason and **no candidate item**; every outcome carries its reason; deactivation approval treats `OUT_OF_SCOPE` as resolved | `ingestion.service.ts`, `offer-batch-commit.service.ts` |
| SG-03 updated to the new contract (semantics on reviewer mapping, basmati row skipped, bare `0.20` ambiguous) and now deletes its own fixtures | `test/integration/sg03-row-normalization.spec.ts` |

**Evidence:** `test/unit/g03-row-validation.spec.ts` **41/41 pass**; all unit suites **193/193**; `tsc --noEmit` clean; lint findings
unchanged vs HEAD. **Supabase (owner-approved run):** SG-03 (updated), Gate 01 e2e, Gate 02 e2e, SG-01, SG-02, job readback →
**6 suites, 54/54 pass** on the first run; read-only counts on 14 tables identical before/after; 0 files left; no migration.

**Open — owner input / later gates:**
- **Brand/Line allowlist (BLOCKED on owner input).** GLO-244/275 require an owner-approved, versioned allowlist; none exists. The
  code's `KNOWN_PILOT_BRANDS` list is a hard-coded heuristic, not an approved allowlist. Brand does not currently gate eligibility.
- **FINANCIAL_HOLD (cost > approved selling price, same unit)** needs a verified SKU — moved to Gate 05 per the GLO-275 review refinement.
- **MOQ / bonus / carton-vs-piece** are not modelled in intake or `SupplierOffer` — Gate 05 decision (likely needs a migration).
- Bounded AI for ambiguous brand/type: not implemented (deterministic rules only).
- Business UI display of raw row / normalized field / outcome: not verified (owner's uncommitted files).

**Status: P0 fixes PASS with evidence; gate NOT complete** — brand allowlist blocked on owner input; FINANCIAL_HOLD and MOQ/bonus/carton move to Gate 05.

## GLO-276 — Gate 04 Canonical SKU Matching

**Confirmed P0 (code):** spreadsheet rows (approved-profile upload, mapping apply/approval) never called matching —
`processMatching` ran only for JSON `createJob`; SG-11/SG-12 hid it by writing `matchedSkuId` through Prisma. Also found:
the **supplier's name was stored as the product brand** when no brand column was mapped (every alias check then vetoed on
`brand_mismatch`); a brand+name+size match was auto-**EXACT** (name similarity alone); a barcode with no corroboration was EXACT;
AI enrichment ran for known SKUs; rejection overwrote the item's enrichment and **destroyed the raw-row provenance**;
`createSupplierSkuAlias` silently **re-pointed** a supplier code to another SKU; reviewers could only confirm EXACT matches, so a
name-retrieved suggestion was a dead end.

**Already implemented (reused):** `classifyCandidateMatch` tiers (supplier alias → barcode + approved barcode aliases with
collision detection → brand/name), hard veto on brand/size/unit/variant/pack/barcode, supplier-scoped `SupplierSkuAlias`.

**Fixed (no migration):**
| Change | Files |
|---|---|
| Admitted rows always go through matching after upload (approved profile), internal mapping, and proposal approval; result reports `matching` counts; outage → `FAILED_RETRYABLE` with rows left pending; `POST /ingestion/jobs/:id/match` resumes (supplier-scoped, idempotent) | `ingestion.service.ts`, `ingestion.controller.ts` |
| Brand = stated brand column only; otherwise inferred from the title via curated aliases + active catalog brands (only if exactly one); never the supplier | `ingestion.service.ts`, `product-identity.service.ts` |
| Placeholder brands ("General", blank) = unknown, not INVALID; brand veto only when stated | `product-identity.service.ts` |
| Alias tier vetoes on physical facts (brand if stated, size, unit, variant, pack, barcode), not wording | same |
| Barcode tier needs a stated matching brand or the same base name; otherwise LIKELY_MATCH + `suggestedSkuId` | same |
| Name+size retrieval → LIKELY_MATCH + `suggestedSkuId` (never auto-merge); different size/pack → no suggestion | same |
| Reviewer can confirm exactly the exact match or the vetted suggestion; confirmation persists the supplier alias; alias re-point → 409 | `ingestion.service.ts`, `product-identity.service.ts` |
| AI enrichment only for proven NO_MATCH rows with a stated brand (new-candidate slow lane) | `ingestion.service.ts` |
| Classification merges into enrichment (raw row kept); extracted size/unit/pack feed the veto | `ingestion.service.ts` |

**Evidence so far:** `tsc --noEmit` clean; strict `tsc` + eslint on the new spec clean (lint vs HEAD unchanged); all unit suites
193/193. **Not yet run on Supabase:** `test/integration/g04-upload-matching.e2e-spec.ts` (6 cases, real upload path, isolated
fixture catalog with random barcodes: exact barcode, size conflict, name-only suggestion, new product, uncorroborated barcode,
twin pack, offer commit only for the exact match, reviewer confirm + alias persistence + re-point refusal, Arabic-Indic renamed row
via alias with 0 AI calls, cross-supplier alias scoping, outage → retry endpoint), and Gate 02 e2e (assertions updated for the
`matching` field and slow-lane enrichment).

**Not yet done:** pg_trgm indexed retrieval (needs `CREATE EXTENSION` + index = migration → owner authorization), AI-assisted
disambiguation (no FastAPI endpoint), alias provenance columns (reviewedBy/evidence/version — migration), batched alias lookup
(N+1 per row; measure in Gate 09), gold bilingual labelled set from real supplier names (owner data).
**Legacy suites** `sg04`, `glo-120`, `glo-242`, `glo-77`, `ingestion-lifecycle` use fixed real-world barcodes (e.g. CeraVe
`3337875597381`) and publish media/offers — must be audited against Supabase's seeded catalog before running there.

**Supabase runs (owner-approved):**
| Run | Result |
|---|---|
| `g04-upload-matching` run 1 | 5/6 — renamed Arabic row ("كلينزر …", transliterated word not in the Stage 03 vocabulary) was held for *scope* review and never matched despite a reviewed supplier alias |
| Fix | `NormalizedProductRow.holds = { scope, fields }`: a scope-only hold is still matched (an exact catalog match proves scope; otherwise it stays in review with no AI spend); field holds (qty/price/discount) never reach matching or the fast lane. Unit cases added (195/195). SG-03 updated: admitted rows are classified at once (`review_required` + identity) |
| Run 2 (g04, g02, g01, SG-01, SG-02, SG-03, job readback) | 59/60 — SG-02 read `items[0]` from an unordered `findMany`; matching changed physical order (test defect, fixed with `orderBy`) |
| SG-02 rerun | **10/10** |
| **Final** | g04 **6/6**, g02 12/12, g01 11/11, SG-01, SG-02, SG-03, readback — **all pass**; 14 table counts identical before/after (aliases 0→0, offers 20→20); 0 files left; no migration |

**Status: P0 PASS with evidence; gate NOT complete** — pg_trgm retrieval and alias provenance need a migration; AI disambiguation
endpoint missing; gold bilingual set needs real supplier names; legacy matching suites need a seeded-catalog audit; Arabic
transliterations (e.g. "كلينزر", "سيرم") not yet in the Stage 03 vocabulary (rows go to review, never skipped).

## GLO-277 — Gate 05 Supplier Offer Fast Lane

**Confirmed P0s (code):** (1) `IngestionService.publishJob` FULL_SNAPSHOT branch ran `supplierOffer.updateMany(... notIn matched →
isAvailable:false)` whenever an ADMIN actor published a snapshot with no approved candidates — mass deactivation that bypassed
`approveDeactivations`. (2) `approveDeactivations` skipped coverage/change-set checks when called without options. (3) Staleness
compared item upload time with offer **commit** time: an old export uploaded later overwrote newer truth, and a newer export
uploaded earlier was refused; the mapped `sourceTimestamp` column was never parsed. (4) Same supplier code twice with different
cost/stock: first row silently won. (5) No financial hold for cost above the approved selling price.

**Already implemented (reused):** staged diff, per-supplier advisory lock, `ALREADY_PUBLISHED` idempotency, >30% jump and
currency-change review, retail-only/price-only semantics, held FULL_SNAPSHOT deactivations, no `SellingPrice` writes.

**Fixed (no migration):**
| Change | Files |
|---|---|
| `publishJob` never deactivates; deactivation only via `approveDeactivations`, which now always requires coverage confirmation + exact reviewed SKU set | `ingestion.service.ts`, `offer-batch-commit.service.ts` |
| Row source time parsed from the mapped column (Excel serial, ISO, unambiguous d/m/y, Arabic digits); ambiguous/unparseable/future → field hold | `row-normalization.service.ts`, contract, `ingestion.service.ts` |
| `assessSourceFreshness` (pure, exported): source time vs the last *accepted* row's source time (via `lastIngestionItemId`, batched), else unproven → REVIEW, else workbook-modified check, else receipt order; old upload-vs-commit checks removed | `offer-batch-commit.service.ts` |
| FINANCIAL_HOLD: verified per-unit cost > currently effective approved `SellingPrice` (same currency) → REVIEW; selling price never written | same |
| Conflicting duplicate supplier codes → admitted row held for review with both readings; outcome `duplicate_supplier_sku_with_conflicting_values` | `ingestion.service.ts` |
| SG-05 updated: deactivation approval needs confirmation + SKU set (unconfirmed call now asserted to fail); stale scenario uses file receipt time | `test/integration/sg05-offer-batch-commit.spec.ts` |

**Evidence so far:** `test/unit/g05-offer-freshness.spec.ts` (freshness + timestamp parsing) and all unit suites **208/208**;
`tsc` clean; lint identical to HEAD. **Not yet run on Supabase:** `test/integration/g05-offer-fast-lane.e2e-spec.ts` (8 cases: real
upload→match→commit with 0 AI calls and explicit-zero stock; double/concurrent commit + replay exactly once; older export uploaded
later refused; undated row after dated export held; FINANCIAL_HOLD with selling price untouched; conflicting duplicate held;
cross-supplier separation + 403s; admin FULL_SNAPSHOT publish deactivates nothing and unconfirmed deactivation → 400) and SG-05.

**Not yet done / decisions needed:** reported quantity, MOQ, discount and bonus are **not persisted on `SupplierOffer`** (only
cost + availability) — needs a migration (owner authorization). Price-jump threshold (30%) is hard-coded, not configurable.
Per-supplier refresh cadence and staleness alerts (owner addendum) need owner-configured cadence and likely schema. The
publish-path `commitCandidateOffer` still uses the receipt-time check (Gate 08). 1,000-row timing/query counts → Gate 09.

**Supabase runs (owner-approved):**
| Run | Result |
|---|---|
| Batch 1: g05, SG-05, g04, g02, g01, SG-01/02/03, readback | 89/91 — (a) g05 double-commit: money applied once ([0,1]) but both concurrent commits returned `published`: `commitJobOffers` read the job **before** taking the supplier lock, so the waiter re-applied the row as UNCHANGED. **Fixed:** job re-read after the lock. (b) SG-03 fixture has supplier code `SKU-01` twice with different qty/product → now correctly held as a conflicting duplicate; test updated to assert the hold |
| Rerun g05 + SG-03 | **8/8 + 14/14** (double-commit now returns `ALREADY_PUBLISHED`) |
| Rerun SG-05 (lock change) | **23/23** |
| **Cleanup check** | **LEAK FOUND** — legacy SG-05 left per run: 1 "Other Supplier", 2 fixture users + sessions, 2 `ingestion.offers_deactivated` outbox rows (2 runs → +2 suppliers, +4 customers, +4 sessions, +4 outbox). New gate specs leaked nothing. **Fixed SG-05** (tracks/deletes its actors, extra supplier and its jobs' outbox rows). **Removed the leaked rows** by exact id in one verified transaction (4 fixture users @fixtures.test, 4 sessions, 2 suppliers with no linked data, 4 outbox rows for deleted jobs) → all 14 counts back to the pre-Gate-05 snapshot |
| Verification (fixed SG-05 + g04 + g05 + SG-03, on code that already includes the Gate 06 identity changes) | **51/51 pass; all 14 counts identical before/after** (SG-05 no longer leaks rows; it still leaves candidate test images in the local scratch storage dir only) |

**Status: P0 PASS with evidence; gate NOT complete** — offer qty/MOQ/discount persistence (migration), configurable
thresholds, refresh cadence/alerts (owner config) open.

## GLO-278 — Gate 06 New Candidate & Cross-Supplier Dedup

**Confirmed defects (code):** candidate sweep scanned only the 100 **oldest** open rows and did not exclude the row itself;
fingerprints were stored only after matching, so concurrent importers could not see each other (both "new", or each pointing at the
other); barcode dedup required identical raw brand text (سيرافي ≠ CeraVe); inactive SKUs were invisible (treated as new → later
unique-barcode 500 at publish); rejected identities were resurrected as fresh candidates; `ensureCanonicalSku` looked products up by
an ASCII-only slug of the title, collapsing every Arabic title of a brand to `<brand>-` and attaching new SKUs to the wrong product;
publication was locked per candidate, not per identity.

**Fixed (no migration):**
| Change | Files |
|---|---|
| Fingerprint stored on the row at admission (`source.fingerprint`); sweep over **all** open rows by barcode or fingerprint via JSON-path filters; self excluded; **oldest row wins** (createdAt, id) so racing importers converge on one primary | `product-identity.service.ts`, `ingestion.service.ts` |
| Same barcode, stated brands disagree → CONFLICT (no link, no new) | `product-identity.service.ts` |
| `previouslyRejectedCandidateId` and `possibleDuplicateCandidateIds` (older rows, same canonical brand + net content, different wording) surfaced; such rows go to review without AI | same + `ingestion.service.ts` |
| Inactive SKU by barcode/alias or exact name+size → CONFLICT `canonical_sku_inactive` (never "new", never auto-revived) | `product-identity.service.ts` |
| AI research only for provably new rows (stated brand, net content, recognised scope, no linked/rejected/possible duplicate); `linkedToExistingCandidate` counter | `ingestion.service.ts` |
| Product reuse by (brand, normalized base name) only; new product slug = ASCII words + hash of normalized identity (`canonicalProductSlug`) | `ingestion.service.ts`, new `canonical-product-slug.ts` |
| Publication takes sorted advisory locks on candidate + barcode + fingerprint | `ingestion.service.ts` |

**Evidence so far:** `test/unit/g06-candidate-identity.spec.ts` (slug) + all unit suites **211/211**; `tsc` clean. **Not yet run on
Supabase:** `test/integration/g06-candidate-dedup.e2e-spec.ts` (5 cases: one candidate across 3 suppliers incl. Arabic title via
barcode; differently-worded same-size row held; inactive SKU / different size / missing net content not new; rejected identity not
resurrected; two suppliers racing → single primary, 1 AI call).

**Not yet done:** publish-time dedup + Arabic slug fix verified end-to-end through a real publication (needs reviewed packshot
media — Gate 08); research outage/resume (Gate 07); pending-Brand/Line draft reuse audit (Gate 07); admin review UI.

**Supabase run (owner-approved):** g06 + g04, g05, g02, g01, SG-01/02/03, readback → **9 suites, 73/73 pass on the first run**
(g06 5/5: one candidate across three suppliers incl. Arabic title linked by barcode; differently-worded same-size row held;
inactive SKU / different size / missing net content not new; rejected identity not resurrected; two suppliers racing → one
primary, one AI call). Read-only counts on 14 tables identical before/after; 0 files left; no migration.

**Status: P0 PASS with evidence; gate NOT complete** — end-to-end publish proof of the Arabic slug fix and per-identity lock
(Gate 08), research outage/resume and Brand/Line/Ingredient draft reuse (Gate 07), admin review UI.

## GLO-279 — Gate 07 Structured Product Intelligence

**Reproduced STOP defect (HEAD `RoutinePlacementService`, run via a probe of the HEAD file):** a cleanser whose directions state no
time or frequency → `AM_PM, TWICE_DAILY, CONFIRMED`; a cream with **no directions at all** → `AM_PM, LEAVE_ON, DAILY, CONFIRMED`;
a retinol serum with no directions → two invented product warnings ("Mandatory daily sunscreen…"). Frequency/timing/rinse were
filled from the product type and labelled CONFIRMED; "serum = step 3" style rules were hard-coded; those values also feed AI copy
generation (`product-content.service.ts`).

**Fixed (no migration):** `routine-placement.service.ts` / contract —
| Change | Detail |
|---|---|
| Role is a labelled proposal | `roleSource: 'NAME_AND_CATEGORY_HEURISTIC'` for stepType/phase/area |
| Usage facts only from the product's own directions | typed `usageRules[]` (targetArea, AM/PM/BOTH, rinse/leave-on, DAY/WEEK/AS_NEEDED with min–max, stated contact minutes + whether it is a maximum, INTRODUCTORY condition, evidence sentence); EN + AR (Arabic-Indic digits, hamza/tanween); area-only sentences attach to the neighbouring rule; compatible sentences merge, face vs scalp vs introductory stay separate |
| Never defaulted | timing/rinse `UNKNOWN` when unstated; frequency `UNCLEAR_HELD` + `HELD_FOR_REVIEW` unless stated; "as needed" never becomes a cadence |
| Warnings only from directions | stated contact limits, sunscreen/eye/broken-skin/patch-test sentences; ingredient-class notes → `genericGuidance` (`requiresReview: true`) |

**Evidence:** `test/unit/g07-usage-rules.spec.ts` **9/9** (incl. The Ordinary Glycolic 7% face-daily-PM / scalp-3×-week /
beginner-2–3×-week as three rules); all unit suites pass; `tsc` + eslint clean. SG-08 assertions updated to the evidence-only
contract (they encoded the invented values) — **not yet run on Supabase**.

**Blocked on owner decision (migration):** typed usage rules, rinse/area, verified ingredient concentration as decimal+unit+evidence,
and fact provenance are **not persisted on the published catalog Product/SKU** — publication copies only ingredient links
(`ProductIngredient`, concentration is a free string) and one routine-step link. Proposed additive migration (needs authorization):
`catalog.product_usage_rules` (product_id, sku_id nullable, target_area, routine_period, rinse_mode, frequency_unit, uses_min,
uses_max, contact_minutes, contact_is_maximum, condition, evidence_text, source_url, retrieved_at, review_state, reviewed_by) and
`product_ingredients.concentration_value DECIMAL(6,3)` + `concentration_unit` + `concentration_evidence`.
**Also open:** research cache never invalidated on re-import/formulation change; Brand/Line/Ingredient draft reuse across
candidates not yet audited end-to-end; 10–20 owner-approved real product examples (owner data).

**Owner-approved migration applied (2026-10-22):** `20261022150000_g07_product_usage_rules_and_concentration` — additive only
(4 enums, `catalog.product_usage_rules` + indexes/FKs/CHECKs, 3 nullable `product_ingredients` columns + CHECK). Preflight:
56 applied, 0 pending/failed/mismatched, drift = known drift. Snapshot + `ROLLBACK.md`: `%USERPROFILE%/shenacare-db-snapshots/20261022-pre-g07/`.
Post: 57 migrations, drift unchanged, 14 business counts unchanged.

**Wired (uncommitted):** approve with `confirmUsageRules` snapshots rules parsed from SUPPORTED official https directions (400 if
none); concentrations kept only when the official evidence states "<ingredient> N%" (else `unverifiedConcentrations`); publish writes
`product_usage_rules` (never overwrites existing reviewed rules on the SKU) and typed concentration; product detail returns per-SKU
`usageRules`. Unit + architecture **227/227**; `tsc` clean.

**Supabase:** SG-08 **10/10 pass** — but SG-08 (legacy) **leaked 2 fixture customers + 2 sessions** (@fixtures.test, created now).

**Recovery (owner-approved 2026-10-22/23):**
- **SG-08 leak removed by exact id only**, in one transaction that verified each id, the creation window
  (15:25:40–15:26:05Z) and the expected row counts before deleting: customers `1d30bf79-42b4-4e3c-a75f-429a83a3c11d`,
  `c4caa995-18af-4ab8-8ffa-3c489841f49b`; sessions `3f495f68-86d6-433a-8df0-cd9ca9ec563d`, `0406c7c3-fccc-4cc0-8416-895df7c04eae`.
  No suffix/bulk delete. SG-08 teardown now deletes its own actors' sessions + customers by id; re-run SG-08 **10/10** with
  all 20 tracked counts identical before/after.
- **Evidence policy corrected.** Accepted official evidence = `MANUFACTURER_WEBPAGE` (https), `MANUFACTURER_DOCUMENT` (https,
  exact-SKU PDF/spec) or `PRODUCT_LABEL` (authentic label photo, `reviewedBy` required); every entry stores `evidenceKind`,
  `marketVersion` and an identity snapshot `{barcode, name}`, and evidence whose identity no longer matches the candidate is
  ignored (formulation/market version change). Missing usage directions never block publication: approve records
  `usageRulesStatus = NO_VERIFIED_DIRECTIONS` and publishes with 0 rules.
- **`test/integration/g07-publication.e2e-spec.ts` 6/6 on Supabase** — confirmed rules persisted (FACE/PM/1×DAY,
  SCALP/2×WEEK); stated concentration 5% stored with value+unit+document evidence, unsupported/contradictory ones stay null
  (UNKNOWN); unapproved rules never exposed; a second supplier's candidate links to the same SKU without overwriting
  rules or facts; a failed publish (offer commit rejected) leaves nothing visible and the retry converges on exactly one
  product/SKU/media/offer; a repeated publish is refused (400); a product with no directions publishes with 0 rules.
  20 tracked counts identical before/after.
- **Finding for Gate 08:** public availability requires `supplierOffer.lastConfirmedAt`, which only
  `POST /sourcing/offers/:id/confirm-availability` sets — ingestion commits and candidate publication never make a product
  storefront-available by themselves (the e2e sets it as a labelled Stage 08 fixture). Whether a fresh stock feed may count as
  confirmation is an owner decision.

**Status: P0 PASS, gate incomplete** — research-cache invalidation on formulation change, Brand/Line/Ingredient draft reuse
audit and the 10–20 owner-approved real examples remain open.

**Gate 01–06 regression after the Gate 07 changes (2026-10-23, Supabase, hardened runner):** g01, g02, g04, g05, g06, SG-01,
SG-02, SG-03, SG-05, readback — **10 suites, 96/96 pass**; 20 tracked counts identical before/after; no migration. SG-05 still
leaves 4 candidate test images (+ meta) in the local scratch storage directory only (not Supabase, not Cloudinary).

## GLO-280 — Gate 08 Review, Supplier Price Comparison & Pricing Safety

**Audit (code, HEAD `9c22bf7` + uncommitted work):**
| Area | Reuse / finding |
|---|---|
| Retail price | `commerce.selling_prices` (versioned, `POST/PATCH /commerce/prices` **ADMIN only**); never written by ingestion or sourcing. |
| Order / PO snapshots | `OrderItem.price` and `PurchaseOrderLine.unitCost` are snapshots; payables use the snapshot. |
| Sourcing choice | Existing `RankingService.rankOffersForSku` (used by PO + supply plan) — reused, no second engine. |
| Publication | Candidate approve/publish, job publish, approve-deactivations are **ADMIN only**; Gate 06/07 e2e prove one canonical SKU under retry/race. |
| **Bypass (fixed)** | `PATCH /sourcing/offers/:id` let a SUPPLIER change cost/currency with none of the Gate 05 checks (jump, currency, financial hold). |
| **Bypass (fixed)** | `POST /sourcing/offers` let a SUPPLIER link itself to any active canonical SKU with no identity review. |
| **Gap (fixed)** | `commitCandidateOffer` / `assertCandidateOfferSafe` used receipt time for staleness and had no FINANCIAL_HOLD. |
| **Gap (owner decision)** | Ranking weights let reliability/freshness outweigh cost — see below. |
| **Gap (migration)** | `SupplierOffer` has no MOQ, pack size/price basis, bonus/discount, landed fees, offer revision history or separate cost vs quantity observation times. |

**Fixed (no migration):**
- `offer-batch-commit.service.ts`: `candidateOfferReview` — the candidate path now uses `assessSourceFreshness` against the row
  that produced the current offer, currency change, >30% jump and FINANCIAL_HOLD against the effective selling price, under the
  same supplier lock; all reasons are reported together (`Supplier offer requires review: …`).
- `sourcing.service.ts` / controller: a SUPPLIER's direct edit of its own offer gets the same policy (currency change, >30% jump,
  cost above the approved selling price → 409 "submit it in a price file"); availability-only and normal cost edits still apply
  (the owner's Business UI "edit price/availability" dialog keeps working). Non-positive cost → 400 for everyone.
  `POST /sourcing/offers` is now ADMIN/HUB_OPERATOR only (the Business UI does not call it; `glo-205` already expected 403).
  `SourcingModule` imports `CommerceModule` (public API) for the current selling price — no cycle.

**Evidence:** `test/integration/g08-offer-pricing-safety.e2e-spec.ts` **7/7 on Supabase** + g07 6/6, g06 5/5, g05 8/8
(**26/26**); 20 tracked counts identical before/after; 0 files left; no migration. Unit + architecture **25 suites, 278/278**
(offline `_test` dummy URL); `tsc` clean; eslint: no new findings (pre-existing `any`/unused in touched files).
| Scenario | Result |
|---|---|
| Two fresh suppliers (165 vs 180) + a stale cheaper one (150, 10 days) | existing ranking returns [165, 180]; stale excluded |
| Supplier direct edit: availability, 150→160 | applied |
| Supplier direct edit: −34% jump, currency change, cost 0, cost 205 > retail 200 | 409 / 409 / 400 / 409 `financial_hold`; offer + retail unchanged |
| Tenant isolation | A cannot read/patch B's offer, list by B, by SKU or unscoped (403); own list returns only own offers |
| Supplier self-link offer, create/patch/deactivate retail price, approve/publish candidate or job, approve deactivations | all 403; nothing written; staff POST /sourcing/offers still 201 |
| Candidate path | older export uploaded later → `source_time_older…`; undated after dated → `no_source_time…`; cost 320 > retail 300 → `financial_hold`; replay no-op; newer row applies; retail unchanged |
| No repricing | later cost change leaves the PO line `unitCost` snapshot (180) and the current retail price intact |

**Owner decisions needed:**
1. **Ranking policy (consequential).** Score = `0.6·(1000/cost) + 30·reliability + freshnessDays`. The cost term is tiny:
   with equally fresh offers, an established supplier (reliability 1.0) at 800 EGP scores ≈37.8 and beats a new supplier
   (neutral 0.5) at 100 EGP (≈28.0);
   between 165/175/180 EGP the cost terms differ by ≤0.3 points, so one day of freshness (1 point) decides. Linear asks for
   lowest feasible cost subject to eligibility, with freshness/reliability as tie-breakers. Proposal: hard eligibility filters
   (available, fresh, active, reliability above an owner-set floor), then lowest comparable unit cost, ties by freshness then
   reliability. This changes PO allocation, so it needs approval.
2. **Migration (needs authorization):** `SupplierOffer` terms — `moq`, `units_per_pack` + price basis, bonus/discount terms,
   landed fee fields — plus a `supplier_offer_revisions` audit table and separate `cost_observed_at` / `quantity_observed_at`.
   Without these, the MOQ, carton-vs-piece, bonus and landed-cost scenarios cannot pass; they are **BLOCKED**, not passed.
3. **Stock feed → `lastConfirmedAt`.** Today only `confirm-availability` makes an offer storefront-available.
4. **Direct-edit hold UX.** Held direct edits are refused (not queued); the supplier must send a price file, which lands in review.
   Alternative: queue them as review items (needs the revision table above).

**Status: P0 PASS, gate incomplete** — MOQ/pack/bonus/landed cost (migration), ranking policy (owner), admin review UI and
browser evidence (owner's Business files) open.

### Gate 08 follow-up (owner decisions 2026-10-23)

**Ranking (implemented in the existing `RankingService`, same output contract + additive `excludedOffers`):**
1. Hard filters, each excluded offer kept with its reason: `OUT_OF_STOCK`, `STALE_OFFER` (>7 days), `INVALID_COST`,
   `CURRENCY_NOT_COMPARABLE` (mixed currencies without a verified rate → only EGP compared), `PRICE_ANOMALY_REVIEW`
   (cost < 50% of the benchmark: median of all comparable quotes when ≥3, the other quote when 2, none for a single
   offer — no invented median). Expensive outliers (>2× benchmark) stay eligible, flagged `PRICE_OUTLIER_HIGH`.
2. Order: suppliers with confirmation reliability ≥ 0.5 (or < 5 PO lines of history) first, then **lowest cost**, then
   higher reliability, then fresher observation. Low-reliability suppliers stay as fallbacks (`LOW_CONFIRMATION_RELIABILITY`).
3. Not yet possible without the offer-terms migration: MOQ/order-multiple feasibility, trade-pack normalization, bonus/
   discount effective cost, landed fees, delivery SLA (no lead-time data exists). These remain **BLOCKED (migration)**.
Evidence: `ranking.service.spec.ts` 24/24 (Linear cases: 180/165/150-stale → 165, 180; 180-reliable vs 100-new → 100;
100/102/800 → 800 flagged last; 100/102/30 and 100 vs 40 → cheap quote held; single offer unflagged; EGP vs SAR not
compared; low-reliability cheaper supplier ranks behind but stays fallback); g08 e2e ranking case on Supabase.

**Availability layers (stock feed decision):** catalog/PDP sellability still requires a fresh supplier **confirmation**
(`getPublicAvailability`, unchanged contract); cart/checkout's provisional availability (`checkAvailability`) previously
accepted **any** available offer regardless of age — it now requires a fresh signal (confirmation or feed/edit observation
inside `SUPPLIER_AVAILABILITY_MAX_AGE_HOURS`, default 24 h); quantity actually committed is confirmed per PO (unchanged).
Ingestion never sets `lastConfirmedAt`. Evidence: g08 e2e "treats a supplier feed as a provisional signal" — feed offer has
`lastConfirmedAt = null`, provisional = true, confirmed = false, public availability false; after 48 h without a signal,
provisional = false.

**SupplierOffer terms migration — DRAFT, NOT APPLIED:** `docs/operations/drafts/g08-supplier-offer-terms.migration.sql`
(additive: 15 nullable columns on `sourcing.supplier_offers` + append-only `sourcing.supplier_offer_revisions` + CHECKs) and
`…preflight.sql`. Audit of existing history: no offer revision/audit table exists today; provenance is only
`last_ingestion_item_id` → the ingestion row (file-sourced changes) and nothing for portal/staff edits. `cost_price` stays the
normalized per-sellable-unit cost so every existing reader is unaffected; `trade_pack_units` is the supplier's case/carton
and is explicitly not a manufacturer bundle (bundles are their own catalog SKUs). Read-only preflight run on Supabase
2026-10-23: PostgreSQL 17.11, 57 migrations applied, none failed/pending, no column/table/constraint name collisions,
0 offers with non-positive cost, `supplier_offers` 104 kB (ADD COLUMN without default is metadata-only). **Awaiting owner
approval to apply.**

## GLO-281 — Gate 09 Scale, Reconciliation, Concurrency & GO/NO-GO

**Environment (owner-approved 2026-10-23, Supabase DEVELOPMENT project `cluidtctwgxxhybzftft`, PostgreSQL 17.11):**
- Read-only preflight: 57 migrations, none failed/pending; read-only fingerprint of all 81 application tables + migration
  history (row count + md5 of every row's content) before and after every run — equal ⇒ nothing left behind and no
  pre-existing row modified.
- Recoverable snapshot: `%USERPROFILE%/shenacare-db-snapshots/20261023-pre-g09/` (81 tables + `_prisma_migrations`,
  272 rows, JSON per table, `SHA256SUMS`, `ROLLBACK.md`). Not needed: every run's fingerprint matched.
- Resource/cost limits: synthetic rows only (1,000 per file, 1,000 SKU fixtures), Prisma pool capped at 8 connections,
  AI provider stubbed (0 USD, no provider calls), files in a scratch storage dir only, no migration, no reset, no broad delete,
  no deactivation. Runs used Supabase **session** pooling (port 5432); the app's transaction pooler (6543, `pgbouncer=true`)
  was measured but is ~5× slower from this workstation.
- Network reality of these numbers: client → eu-west-1 round trip **67 ms** (session pooler) / **328 ms** (transaction
  pooler), p50 of 20 `select 1`. Every per-row DB operation therefore costs ~130 ms here; a co-located API would see ~1–2 ms.
  Wall times below are **this workstation's**, not production estimates; DB operations per row are environment-independent.
- Workstation: Windows 10 Pro, Node 24.20.0; peak RSS of the test process 456 MB.

**Fixture cleanup audit (owner item 5):** SG-05 deleted by slug prefix (`startsWith 'sg05-supplier'` / `'sg05-brand'`) and left
candidate images in storage — now id-tracked (owned supplier/brand ids) and removes its source/candidate/product media
files. All Gate suites delete only ids they created. Verified: SG-05 23/23 with all 83 fingerprints identical and 0 files.

**Defects found by Gate 09 and fixed (no migration):**
1. **Batch commit could not commit 1,000 rows** — ~5 DB operations per row inside one 30 s transaction (50 rows took 23.5 s
   at 67 ms RTT). Now set-based (one prefetch, `createMany`, chunked `UPDATE … FROM (VALUES …)`, one item write per row
   merging only `diff`/`offerCommit` keys with `jsonb ||`, so concurrent enrichment keys are no longer clobbered).
   50 rows: 23.5 s → 2.2 s; **1,000 rows: 7.9 s, 14 DB operations**. SG-05 23/23 + g05/g04/g08/g01 unchanged.
2. **Concurrent commit of the same job returned HTTP 500** ("Transaction not found" — the second commit's transaction
   expired while waiting for the supplier lock). After fix 1 the lock is held for seconds; verified at 1,000 rows: two
   concurrent commits → 201/201, changes applied exactly once (520 + 0).
3. **Second Prisma connection pool** — `AccountsModule` registered its own `PrismaService` beside the global
   `DatabaseModule` one (two pools per process). Removed; one pool.
4. **Possible-duplicate rule held every new product of a brand in a common size** — at 1,000 rows, 149 of 150 distinct new
   products (same brand, 30 ml) went to review and only 1 to research. Narrowed: same brand + same size is a possible
   duplicate only when titles are cross-script (Arabic vs Latin) or their distinguishing words overlap ≥ 50%.
   Unit 3 new cases; g06 Arabic-vs-English hold unchanged; new g06 case for a different same-size product.

**Final run (2026-10-23 02:15–02:47 UTC, all fixes in place): `g09-scale-and-concurrency.e2e-spec.ts` 3/3 PASS, 1,939 s;
all 83 fingerprints identical before/after; 0 files left.** (Run #1 found defect 4; run #2 is the evidence.)
| Stage | Rows | Wall | DB ops | ops/row | DB op p50 / p95 |
|---|---|---|---|---|---|
| Mixed upload (receipt, novel layout) | 1,000 | 1.2 s | 7 | 0.01 | 131 / 261 ms |
| Mixed mapping approve + admit + match | 1,000 | 567 s | 4,313 | 4.3 | 69 / 268 ms |
| Mixed commit (600 verified rows → offers) | 600 | **6.2 s** | 14 | 0.02 | 274 / 1,765 ms |
| Known-only first file: map + admit + match | 1,000 | 612 s | 4,013 | 4.0 | 198 / 265 ms |
| Known-only first commit (1,000 creates) | 1,000 | **6.8 s** | 14 | 0.01 | 251 / 2,032 ms |
| Changed re-upload on approved layout (admit + match, 0 AI) | 1,000 | 616 s | 4,010 | 4.0 | 197 / 271 ms |
| Changed commit, 2 concurrent | 1,000 | 23.6 s | 27 | 0.03 | 430 / 6,658 ms |
| Identical-bytes replay (receipt reused) | 1,000 | 7.7 s | 6 | 0.01 | 132 / 2,999 ms |
| Same file uploaded 3× concurrently | 300 | 64 s | 1,218 | 4.1 | 197 / 270 ms |
| Two suppliers, same new product, concurrently | 2 | 3.8 s | 36 | 18 | 70 / 652 ms |

| Case | Expected | Observed |
|---|---|---|
| Mixed 1,000 reconciliation | every row in exactly one outcome | IMPORTED 830 + INVALID 70 + DUPLICATE 50 + OUT_OF_SCOPE 50 = **1,000** |
| Mixed matching | 600 exact / 150 new / 80 review | **600 / 150 / 80**, 150 research requests (stubbed), 0 rejected |
| Mixed commit | only verified rows become offers | 600 committed, 230 skipped (unverified), 0 errors; 0 offers with `lastConfirmedAt` |
| Known-only first file | 1,000 exact, 0 AI | 1,000 exact, 1,000 offers, **0 AI calls** |
| Changed file (500 repriced, 20 jumps, 20 zero stock) | 520 applied, 20 held, rest unchanged | 520 / 20 held (accepted cost kept) / 460 unchanged; zero-stock → unavailable |
| Concurrent double commit | exactly once | 201/201, 520 + 0 |
| Identical replay | same receipt, nothing re-applied | same job id, `reused: true`, commit applies 0 |
| 3 concurrent identical uploads | one receipt | one job |
| Two suppliers race one new product | one candidate + one link | 1 new + 1 linked, one primary row, 0 offers |
| AI / cost | known-only path 0 calls | 152 stubbed calls total (all new products), 0 USD; peak RSS 462 MB |

Remaining performance gap (not fixed): **matching is per-row (≈4 DB operations per row)** — ~0.6 s/row from this workstation,
roughly 4 × (in-region RTT) per row in production; batching the identity sweep is the next optimization, not a correctness issue.

## Gate checkpoints

| Gate | Status | Notes |
|---|---|---|
| Phase 0 audit | DONE | This document. |
| 01 (GLO-273) | **Backend PASS** | 11/11 e2e + 32/32 regression on Supabase; UI wording + retention policy open → not production-ready. |
| 02 (GLO-274) | **Backend PASS** | 12/12 e2e + 64/64 combined on Supabase; AI proposals + approval UI open → not production-ready. |
| 03 (GLO-275) | **P0 PASS, gate incomplete** | 41/41 unit + 54/54 Supabase integration; brand allowlist blocked on owner; financial hold/MOQ → Gate 05. |
| 04 (GLO-276) | **P0 PASS, gate incomplete** | Real upload→matching verified 6/6 + regression on Supabase; pg_trgm/alias provenance (migration), AI disambiguation, gold set open. |
| 05 (GLO-277) | **P0 PASS, gate incomplete** | 8/8 e2e + SG-05 23/23 + regression on Supabase; lock-ordering bug fixed; SG-05 leak fixed and cleaned; offer qty/MOQ persistence needs migration. |
| 06 (GLO-278) | **P0 PASS, gate incomplete** | 5/5 e2e + 73/73 combined on Supabase; publish-time proof in Gate 08. |
| 07 (GLO-279) | **P0 PASS, gate incomplete** | Migration applied; publish e2e 6/6 + SG-08 10/10 on Supabase, counts identical; SG-08 leak removed by exact id; cache invalidation + real examples open. |
| 08 (GLO-280) | **P0 PASS, gate incomplete** | Bypasses fixed; ranking redesigned per owner policy (24/24 unit + e2e); feed vs confirmation availability separated; g08 8/8; offer-terms migration drafted, not applied → MOQ/pack/bonus/landed cost BLOCKED. |
| 09 (GLO-281) | **Technical synthetic PASS; real-supplier pilot BLOCKED** | 1,000-row mixed + known-only + concurrency 3/3 on Supabase dev, fingerprints identical; 4 defects found and fixed; no authentic export, no browser evidence. |

## Acceptance gap matrix — GLO-273..281 (2026-10-23)

| Gate | Verified with DB/API evidence | Open — exact gap | Kind |
|---|---|---|---|
| 01 Intake | auth upload, tenant scope, MIME/magic/zip-bomb/limits, SHA-256 dedup + unique index, original custody, audit fields, storage/DB failure recovery | Supplier UI receipt wording not verified in a browser; retention/deletion policy for originals | UI (owner files) · owner policy |
| 02 Mapping | reviewed semantics, supplier can only propose, fingerprint reuse with 0 AI, held jobs admitted once | **No admin UI to approve a mapping profile** (no `/profiles/:id/approve` call in Business); supplier wizard sends no `semantics`; AI mapping proposals not implemented | UI (owner files) · feature |
| 03 Validation | strict qty/price/discount typing, scope by product type, row reasons, 1,000-row reconciliation exact | **Brand/Line allowlist does not exist** (owner list needed; only brand drafts gate publication) | owner data |
| 04 Matching | uploaded rows matched, barcode corroboration, LIKELY_MATCH suggestions, alias never re-pointed, 600/600 exact at scale | pg_trgm retrieval + alias provenance (migration); AI disambiguation; labelled bilingual gold set from real names; matching is ~4 DB ops/row | migration · owner data · perf |
| 05 Fast lane | source-time freshness, FINANCIAL_HOLD, holds, exactly-once, no auto-deactivation, 1,000 known rows 0 AI, 7.9 s commit | **Offer MOQ/qty/discount/bonus/terms not persisted** (draft migration); configurable thresholds; per-supplier refresh cadence + stale alerts | migration · owner config |
| 06 Dedup | fingerprint at admission, oldest-wins race → one candidate, inactive SKU conflict, rejected not resurrected, possible-duplicate rule narrowed at scale | Arabic-title publish end-to-end (slug fix unit-verified only) | test |
| 07 Intelligence | evidence-only usage rules, typed concentration, publish persistence, no overwrite, failed publish converges | research cache not invalidated on formulation change; Brand/Line/Ingredient draft reuse audit; 10–20 owner-approved real examples | feature · owner data |
| 08 Review/price | supplier bypasses closed, RBAC (no retail price, no competitor cost, no approve/publish), ranking policy, retail/PO snapshots never repriced | **Admin approve UI sends `{}` but approval requires `mediaReviews`; no evidence/packshot upload in UI** → a new product cannot be approved/published from the UI; MOQ/pack/landed-cost comparison (migration); publication is retry-convergent, not one transaction (no recovery queue); Cloudinary `copyToPublic` not idempotent on retry | UI (owner files) · migration · design |
| 09 E2E | 1,000-row mixed + known-only + concurrency on Supabase dev, fingerprints identical, measured | **No authentic supplier export** → real-supplier pilot BLOCKED; browser (Playwright) role flows not run; live provider research not exercised (stubbed) | owner data · UI |

## GO / NO-GO (2026-10-23)

**Technical backend (synthetic, Supabase dev): GO for continued pilot preparation** — every P0 hard stop in GLO-281 that can
be exercised synthetically was exercised without a violation: no false canonical merge, no duplicate SKU, no cross-supplier
leak, no snapshot deactivation, no stale price overwrite, no repricing of retail/PO snapshots, no unapproved publication,
no orphan state from failed/replayed commits, no destructive test on Supabase (fingerprints identical on every run).

**Real-supplier pilot: BLOCKED** — no authentic supplier export, no owner brand allowlist, no approved real packshots.

**Production / operational launch of Supplier Ingestion: NO-GO** until:
1. Admin UI can approve mapping profiles and approve/publish candidates (evidence + packshot + `mediaReviews`) — owner Business files.
2. Offer-terms migration approved and applied (MOQ, trade pack, bonus/discount, cost vs quantity observation times, revisions),
   then MOQ/pack feasibility wired into the ranking filters.
3. Owner brand/line allowlist and at least one authentic export per launch supplier format, run as a 10–20 SKU pilot.
4. Browser evidence for supplier upload → admin review → publish → storefront visibility.

## Remaining P0 blockers
1. Each further Supabase migration needs separate owner authorization (Gate 01 approval is used up).
2. ~~Upload path never matches rows (Gate 04)~~ — fixed and verified on Supabase.
3. ~~Supplier self-approval of column mappings (Gate 02)~~ — fixed and verified; the 3 legacy self-approved profiles on Supabase now require internal re-approval.
4. ~~Snapshot mass-deactivation via `publishJob` with an admin actor (Gate 05)~~ — fixed and verified on Supabase.
5. ~~Negative/decimal quantity corruption and over-broad out-of-scope rules (Gate 03)~~ — fixed (unit evidence); owner brand allowlist still missing.
6. Arabic product slug collapse attaching SKUs to wrong products (Gate 06) — fixed in code; end-to-end publish proof in Gate 08.
7. ~~Supplier direct offer edits / self-linking bypass the offer safety policy (Gate 08)~~ — fixed and verified on Supabase.
8. ~~Sourcing ranking lets reliability/freshness outweigh cost (Gate 08)~~ — redesigned per owner policy, unit + e2e verified.
9. ~~1,000-row batch commit exceeded its transaction; concurrent commit → 500 (Gate 09)~~ — set-based commit, verified at 1,000 rows.
10. Admin/supplier UI cannot complete mapping approval or candidate approval/publication (owner Business files).
11. Offer terms (MOQ/pack/bonus/discount) not persisted — draft migration awaiting approval.

## Next safe action
1. Owner: approve (or amend) `docs/operations/drafts/g08-supplier-offer-terms.migration.sql`; then persist terms from
   files and wire MOQ/pack feasibility + effective cost into the ranking filters.
2. Owner: Business UI — mapping-profile approval screen; candidate approval with evidence/packshot upload and `mediaReviews`.
3. Owner data: brand/line allowlist; one authentic export per launch supplier format; 10–20 SKU pilot with real packshots.
4. Engineering: batch the per-row identity sweep (≈4 DB ops/row) before large real files.

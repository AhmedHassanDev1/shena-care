# ShinaCare backend product readiness — 2026-10-13

The feasible backend scope is implemented and verified through an authenticated 12-product synthetic pilot. The real-data acceptance gate remains pending. The full API suite remains red with the same 139 failing tests found at untouched `HEAD`; no additional failing test was introduced.

## 1. Existing functionality verified

- NestJS Catalog, Commerce, Sourcing, Ingestion, Care, Accounts and the existing composition layer are reused.
- Public product gates require publication, active exact-SKU reviewed media, a listed SKU, an effective independent SellingPrice and fresh confirmed supplier availability. Unconfirmed, withdrawn and stale stock fail closed. Freshness defaults to 24 hours; this is supplier confirmation freshness, not real-time inventory.
- Media review binds barcode, size, unit and variant to an authenticated internal reviewer and trusted source. Mock/signature-only files, invalid MIME, missing media, supplier-owner violations and unauthenticated commands are rejected.
- Supplier procurement costs remain separate from public selling prices. New canonical Products remain unpublished and new SupplierOffers unavailable until separate authorized commercial operations.
- Routine placements expose only manual/expert recommendations from active public templates. Customer/private/AI routine data remain excluded.

## 2. Demonstrated gaps repaired

- Identical supplier-original uploads now reuse the existing job by supplier and SHA-256 checksum under a database advisory lock. If the original object is lost, identical bytes are restored at the existing private key, preserving every recorded row reference. The existing private storage adapter retains the original.
- Normalized rows can populate that same uploaded job through `sourceJobId`. Each row records object key, checksum, original input and source row in the existing ingestion JSON. Replaying identical input returns existing row IDs; changing an already-imported source payload returns 409. Duplicate/empty rows, malformed currencies, blank identity edits and prices outside database precision/range fail validation.
- Internal operators can record human source evidence without an AI provider, using the new evidence endpoint. Each field retains a trusted source URL/type, excerpt, proposed value, reviewer and timestamp. Identity-evidence changes invalidate old media approval; all evidence changes invalidate old content approval and require candidate review.
- Internal operators can approve Arabic fields against stored source evidence and a reviewed exact identity. Publication does not require generated text. Published content is projected per SKU; private reviewer/provenance metadata never enters PDP.
- Unreviewed AI descriptions no longer populate canonical Products. Legacy unreviewed Catalog description/usage/warnings are withheld from public projections. Reviewed PDP fields follow the selected SKU.
- Candidate edit/review/media-upload/publish commands serialize per candidate, including the batch publish path. A regression test pauses media publication and verifies a concurrent correction cannot publish an obsolete approval. Matching and optional enrichment use version/state checks against concurrent changes.
- Interrupted local uploads now reject source-stream errors, wait for file closure, remove partial objects and support retry. Existing local storage is retained; no provider or pipeline was introduced.

## 3. API and contract changes

| API | Contract |
| --- | --- |
| `POST /ingestion/jobs/upload` | Existing multipart upload; supplier UUID DTO, supported source-document types, checksum replay returns the existing private source job. |
| `POST /ingestion/jobs` | Optional `sourceJobId`; source-backed imports require unique positive `sourceRow` values. Existing JSON-only imports remain supported but carry no original-file provenance. |
| `PATCH /ingestion/candidates/:id/evidence` | Admin/Hub Operator only. `fields` contains distinct `field`, trusted HTTPS `sourceUrl`, `sourceType`, `excerpt`, and either textual `value` or `size`/`sizeUnit`. UUID and nested field validation apply. |
| `PATCH /ingestion/candidates/:id/content/review` | Admin/Hub Operator only. Distinct Arabic `fields` contain `field`, `value`, source URL/type and require matching stored evidence plus reviewed candidate identity. Published/rejected candidates cannot be changed. |
| `GET /products/:slugOrId` and `/detail` | Optional `skuId` UUID; additive `selectedSkuId`, `selectedVariant`, per-SKU media/content/facts/promotions; 404 for an ineligible/foreign SKU, 400 for malformed/unknown queries. Both share a Swagger response DTO. |

Source fields: name, brand, barcode, size, description, ingredients, usage and warnings. Public Arabic fields: name, description, ingredients, usage and warnings. Source evidence is a human attestation; source-provider suggestions do not automatically publish content. Authenticated human reviewers remain responsible for confirming that the source and translation support the actual product facts.

The existing workflow accepts normalized JSON rows after original-file upload. This work links those rows and preserves original bytes; it does not introduce automated XLSX/PDF parsing or claim that a supplied row number proves the file's contents. Reviewers must reconcile rows with the retained original.

Promotions use the existing Commerce evaluator for a one-unit automatic **order** promotion preview. The authoritative SellingPrice is unchanged; checkout confirms final basket/currency eligibility. SKU-targeted item promotion rules are absent from the existing domain and are not invented. Delivery promises, fees, returns policy and clinical claims are not synthesized in PDP.

## 4. Database and environment

No Prisma schema changes or new migrations. All 30 existing migrations deployed successfully to fresh disposable databases.

Initial reproduction used a newly created dedicated test database. Final comparison used separately created local PostgreSQL UTF-8 databases, `shina_readiness_baseline_test` and `shina_readiness_final_v2_test`, on an isolated loopback cluster. The initially created remote test database was removed after use, and the isolated local cluster was stopped after verification. No shared development database was reset, seeded or mutated. The configured application database was inspected through read-only Prisma queries, without starting application workers. Test artifacts are retained under the ignored `.codex/qa-logs/pdp-readiness-01a13433` directory.

The local test cluster initially inherited Windows WIN1252; a separate UTF-8 database corrected the test environment for Arabic. A remote discovery setup timed out at its existing 15-second hook limit; final verification used the isolated local UTF-8 database.

## 5. Verification outcomes

| Check | Exact outcome |
| --- | --- |
| Focused HTTP/storage suite | 4 suites passed; 35/35 tests passed. Includes 14 readiness cases, 13 existing media/authorization cases, 7 discovery/PDP cases and 1 interrupted-storage case. |
| Synthetic pilot | 12/12 products traversed actual authenticated upload, row import, human evidence, media approval, batch publish, independent price/stock confirmation and public PDP. Replays created no duplicate canonical identities or media. |
| API typecheck | `npm run typecheck --workspace=api`: exit 0. |
| API build | `npm run build --workspace=api`: exit 0. |
| Existing migrations | 30/30 applied on fresh test databases; no schema push/reset. |
| Full suite at untouched HEAD | 42 suites: 18 passed, 24 failed. 307 tests: 168 passed, 139 failed. |
| Full suite with final implementation | 44 suites: 20 passed, 24 failed. 322 tests: 183 passed, 139 failed. |
| Failure comparison | No added failures and no removed baseline failures; the exact 139 failing test names match. |
| Diff review | Backend/contracts/tests/documentation only; no changes under `apps/web/**` or `apps/business/**`; `git diff --check` passed. |

Commands used the repository's Jest runner with `--runInBand`, a dedicated test database and isolated storage. Full runs used `--forceExit` because existing application-worker timers remain open in legacy tests; this is not a clean suite shutdown claim. The baseline was a read-only `git archive HEAD` snapshot, not a branch/worktree/reset/stash. Both baseline and final ran with the same dependencies and migrations on separate fresh databases.

The [machine-readable results](pdp-readiness-test-results.json) list every failing test by name, file, initial failure reason and matching baseline status. Failures include obsolete anonymous-write expectations, older catalog/media fixtures that omit current review gates, unrelated checkout/fulfillment/guidance assertions, and the unchanged `security-validators.spec.ts` load failure for missing `file-type`. These remain a repository-wide release blocker; authorization was not weakened to make them pass.

Regression tests were observed failing before fixes for original-file replay, source linkage, unsupported content review, unreviewed AI/legacy content, Swagger selection, interrupted streams, concurrent approval invalidation and invalid candidate edits. Earlier intermediate failures and environment issues were resolved in the focused final run; the baseline full-suite failures remain explicitly reported.

## 6. Remaining acceptance gates and external dependencies

- Real product pilot: pending. Final read-only audit on 2026-10-13 at 11:27 Africa/Cairo found no ingestion candidates or retained original-source jobs, zero Arabic content reviews and zero published media review receipts in the configured database. The historical 12-item pilot ID from older repository evidence was absent there. No approved real data was invented or published.
- Supply licensed exact-SKU media, reconciled supplier source documents, human product-fact/Arabic approvals, independently approved selling prices and current supplier confirmation for 10–20 real products.
- Deploy/restart the updated API and perform real-data acceptance. No production deployment or push was performed.
- Existing Cloudinary credentials, account delivery and provider failure behavior were not exercised against a live account. Local storage integration and existing adapter unit tests are verified. S3 switching remains explicitly unsupported in the repository.
- Local production storage still needs the owner's persistent volume and backup policy. Automated document parsing, missing targeted item-promotion rules and trusted delivery/policy data remain distinct decisions, not implied capabilities of this PDP contract.
- Repair the unchanged full-suite failures before declaring repository-wide readiness.

## 7. Git and scope safety

Work began on `main` at `1f18de8d0566e266ae188a56c05d7ed4ab3806fe`, six commits ahead of the recorded `origin/main`. Existing worktrees were inspected; no new branch, worktree, merge, reset or stash was created. No other active Codex chat was editing this checkout, and HEAD stayed stable during implementation.

The existing two-line edit in `apps/api/src/modules/accounts/accounts.service.ts` is preserved and excluded from the delivery commit. The delivery commit hash and final working-tree status are supplied in the final chat report. Nothing is pushed. No Linear or project-management integration was accessed or updated.

## 8. GLO completion recommendations

| Issue | Recommendation based on repository evidence |
| --- | --- |
| GLO-183 | Accept the implemented backend/PDP scope after reviewing the contract and focused evidence. Keep real-data/product acceptance and the repository-wide test blocker visible before calling production readiness complete. |
| GLO-124 | Backend ingestion/review/publish/provenance/retry gaps are technically verified. Reconcile the issue's full acceptance criteria with the owner; no external issue specification was consulted. |
| GLO-123 | Accept local media upload, review, exact-variant association, privacy and retry verification. Real licensed asset acceptance remains pending. |
| GLO-204 | Original-source upload and row/job association now consume the existing storage boundary. Keep production persistence/provider acceptance and any automated parsing requirement pending. |
| GLO-78 | Keep real pilot acceptance open. Twelve isolated synthetic products verify the technical flow and do not count as genuine product acceptance. |

Security impact: new internal evidence/content writes and stricter public-content disclosure; no auth controls were removed.

Trust boundary: supplier documents and external source facts enter private ingestion storage; only authorized human-reviewed, exact-SKU data reaches public PDP.

Authorization rule: supplier import/upload remains scoped to persisted membership; evidence/content review remains Admin/Hub Operator only; public PDP requires every existing visibility gate.

Sensitive data involved: private original files, procurement costs, reviewer identity and operational enrichment remain internal; responses explicitly project public fields.

Abuse cases considered: unauthenticated/wrong-role/wrong-supplier access, unsupported source hosts, invalid rows/currencies/prices, unreviewed or wrong-SKU media/content, stale stock, replay, partial storage failures and concurrent candidate edits during publication.

Security tests added: persisted-session HTTP negatives, source isolation/provenance, per-variant content/price/media consistency, validation, source-backed human review, replay/partial-failure and concurrency regressions.

Remaining risk: human authenticity/licensing/medical-review acceptance and the unchanged repository-wide test failures require external completion. Local command serialization protects normal concurrent operations; cross-module writes and provider I/O remain resumable rather than one distributed transaction.

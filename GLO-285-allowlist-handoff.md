# GLO-285 — Dynamic ingestion eligibility

Implementation against branch `feat/c0-commerce-integration`, HEAD `ae7a745f096d65717179c8982c53ae1acd7eb1ac`, including the pre-existing uncommitted F1 fix. No commit, push, Linear access, remote migration or remote seed was performed.

## Behavior

- Each new source receipt pins the latest APPROVED policy. Mapping approval and all rows reuse that snapshot. Identical file bytes reuse the original job and its version.
- Brand AND exact leaf Category approval are required. Canonical IDs are authoritative. Arabic/English labels use NFKC, case folding, Arabic diacritic/tatweel removal, alef/ya normalization and punctuation/space normalization. There is no fuzzy admission or AI eligibility decision.
- A known unapproved/inactive/denied brand or a known excluded category is SKIP. Explicit ancestor category DENY overrides leaf ALLOW; parent ALLOW is rejected. Unknown/ambiguous labels and non-leaf categories HOLD. A definite DENY can exclude a row even if the other dimension is unknown.
- Reviewed supplier-specific category mappings take precedence over exact canonical category names. Multiple targets deliberately HOLD. Normalized brand alias collisions and duplicate supplier-label mappings are rejected at preview.
- Files pass the existing upload/parser checks and approved column mapping first. Policy evaluation then runs before row identity fingerprints, SKU matching, enrichment, research and Product/SupplierOffer writes. Both spreadsheet and typed JSON ingestion are gated.
- SKIP/HOLD rows remain in `IngestionJob.rowOutcomes`, with policy ID/version and reason; they do not create IngestionItems. Approved rows retain their eligibility proof in item source provenance.
- The old keyword classifier is bypassed only after internal policy admission. Existing SKU identity hard vetoes and catalog review/publication remain separate. Canonical brand resolution for admitted candidates uses the approved Brand ID.
- Policy activation changes no existing offers or accepted orders. Old jobs keep their snapshot. Full snapshots containing POLICY_SKIP or POLICY_HOLD cannot authorize missing-offer deactivation. Price-only stock freshness behavior from F1 is preserved.
- An explicit Admin recheck of HOLD creates an idempotent PARTIAL successor with the new approved snapshot, original source time/provenance, actor and reason. The original job and its already admitted rows stay unchanged. Rechecks never replay excluded or previously admitted rows.

## Schema and routes

One additive model: `IngestionEligibilityPolicy` in schema `ingestion`, table `eligibility_policies`. Fields: UUID ID, nullable unique integer version, baseVersion, PREVIEW/APPROVED status, immutable JSON document and impact, actor UUID, reason, createdAt and approvedAt. Approval serializes on a PostgreSQL advisory transaction lock and rejects stale base versions, foreign preview ownership, expired previews and changed taxonomy. Database CHECK constraints and a trigger protect approved snapshots against update/delete.

`IngestionJob.eligibilityPolicyId` is a nullable indexed FK with deletion restricted. There is no destructive backfill and no per-SKU allowlist.

Business UI: `/admin/ingestion-policy`, linked in existing Admin navigation. Search/allow/deny existing canonical brands and leaf categories, review aliases, add/remove supplier category mappings, inspect impact, activate a version, view history and recheck held jobs. Adding canonical catalog entities remains separate from allowing them; the initial seed uses the verified identities below. Supplier upload mapping now includes a Category column.

All policy API routes require the existing real AuthGuard and ADMIN RolesGuard. Mutation services independently verify an active Admin; actor identity comes from the session, never the body.

| Method | Route |
| --- | --- |
| GET | `/ingestion/eligibility` |
| GET | `/ingestion/eligibility/options` |
| GET | `/ingestion/eligibility/history` |
| GET | `/ingestion/eligibility/holds` |
| POST | `/ingestion/eligibility/preview` |
| POST | `/ingestion/eligibility/:id/approve` |
| POST | `/ingestion/eligibility/jobs/:id/recheck` |

## Read-only live seed preview

The live taxonomy read found 4 canonical brands and 9 categories. The default seed command was run read-only against that data. Proposed changes were applied and replayed ONLY against the independent local `glo285_seed_test` database.

| Initial brand | Live resolution |
| --- | --- |
| Eva | REUSE Eva Cosmetics, `f32d7b9d-e667-46c5-be80-2136a48aa12b` |
| Starville | REUSE StarVille, `8dcbdbdc-3dac-45f3-a710-e2025244ad7d` |
| Shaan, Strongville, Bobai, Dermactive, CeraVe, Bioderma, La Roche-Posay, Vichy | CREATE missing canonical records; database-generated IDs |

Skin Clinic and Dercos are product lines, not separate brands or standalone brand aliases. No ProductLines or reference SKUs are automatically created. Brand identity references are embedded in the seed manifest: [Eva](https://eva-cosmetics.com/brands/), [Parkville](https://www.parkvillepharma.com/brands), [Dermactive](https://derm-active.com/about-us/), [CeraVe](https://www.cerave.com/), [Bioderma](https://www.bioderma.com/), [La Roche-Posay](https://www.laroche-posay.com/), [Vichy/Dercos](https://www.vichy.co.uk/all-products/haircare). Proposed Arabic aliases are printed for Admin review before activation.

| Requested leaf | Live canonical resolution |
| --- | --- |
| Facial Cleansers | Cleansers — `6cb0932b-94c3-487f-b70f-4a5e7e859dd6`, under Skin Care |
| Moisturizers | `06fd62be-5e4c-4b8a-aa36-498c8c78152d`, under Skin Care |
| Sunscreens | `86b2f262-379b-4b94-a6fb-485cd654d0b2`, under Skin Care |
| Face Serums/Treatments | Serums & Treatments — `d97b6c27-034e-4d80-810b-59270da1efdb`, under Skin Care |
| Shampoos | `54be8317-71b3-440d-92e7-14d630d96a7a`, under Hair Care |
| Conditioners | `8348236c-bf76-4216-abfb-e7d9cd989341`, under Hair Care |
| Hair Masks | CREATE precise `hair-masks` leaf under existing Hair Care |
| Scalp Treatments | CREATE precise `scalp-treatments` leaf under existing Hair Care |

The broader existing Hair Treatments & Styling category is not approved. Seed checks the expected parent and leaf status, refuses identity conflicts, and does not overwrite an existing approved policy. The local double-run produced 10 approved brands, 8 approved leaves and exactly one approved policy; Products = 0, Offers = 0, Skin Clinic/Dercos brand records = 0.

## Verification

Database safety: a new Docker PostgreSQL 17 container, `glo285-allowlist-test`, bound only to `127.0.0.1:55485`. Both DATABASE_URL and DIRECT_URL explicitly targeted `glo285_allowlist_test`; database identity/version were queried independently through container psql before migration. A separate `glo285_seed_test` database verified the seed. All 68 migrations applied locally, including this additive migration. Remote taxonomy access used a READ ONLY transaction.

Consolidated command, with both URLs set to the isolated test DB, TEST_BYPASS_AUTH=false and both Mapbox token variables empty:

```powershell
npm --prefix apps/api test -- test/unit test/architecture src/modules/sourcing/services/ranking.service.spec.ts test/integration/ingestion-eligibility.e2e-spec.ts test/integration/supplier-ingestion-readback.e2e-spec.ts --no-cache
```

Result: 30 suites passed; 377 tests passed, 1 live Mapbox test skipped; exit 0. This is the selected regression set, not a claim that every API integration suite passed. It includes all 11 pre-existing F1 regressions, 7 policy unit tests, 13 new database/HTTP integration tests and supplier readback isolation.

Integration coverage: unauthorized/forged/malformed/oversized edits; alias collision; parent ALLOW rejection; preview ownership; immutable audit/replay; unknown and misspelled labels; reviewed Arabic aliases; zero matching/AI/research and zero Product/Offer creation for excluded/held rows; duplicate spreadsheet bytes; version changes during matching; idempotent HOLD successor/release; existing offer/order equality before/after policy activation; snapshot deactivation safety; real canonical SKU matching and real SQL price-only commit preserving stale availability; competing activations.

Other checks: Prisma validation, API typecheck/build, Business typecheck/production build, new-file lint, and 44/44 design token contrast checks passed. Browser verification used a new local test Admin: login, policy page, changing brand effect, impact preview, activation, and resulting version/history were observed. No real account credentials were used.

Baseline lint is not green: Business lint reports 95 existing errors; its touched supplier upload page has the same 18 errors on HEAD. Existing API ingestion service and offer service lint debt is reported separately; new policy files are clean. No unrelated lint cleanup was attempted.

Evaluator-only measurement: 50,000 decisions in 107.7 ms in one observed focused test run, with one compiled snapshot and no parser/DB/network. This is not an upload benchmark or a guaranteed SLA.

## Changed paths

```text
apps/api/prisma/schema.prisma
apps/api/prisma/migrations/20261102130000_ingestion_eligibility_policy/migration.sql
apps/api/scripts/seed-ingestion-eligibility.ts
apps/api/src/modules/ingestion/eligibility.controller.ts
apps/api/src/modules/ingestion/ingestion.controller.ts
apps/api/src/modules/ingestion/ingestion.module.ts
apps/api/src/modules/ingestion/dto/eligibility-policy.dto.ts
apps/api/src/modules/ingestion/dto/ingestion.dto.ts
apps/api/src/modules/ingestion/contracts/offer-batch-commit.contract.ts
apps/api/src/modules/ingestion/contracts/row-normalization.contract.ts
apps/api/src/modules/ingestion/services/ingestion-eligibility.policy.ts
apps/api/src/modules/ingestion/services/ingestion-eligibility.service.ts
apps/api/src/modules/ingestion/services/ingestion.service.ts
apps/api/src/modules/ingestion/services/export-profile.service.ts
apps/api/src/modules/ingestion/services/offer-batch-commit.service.ts
apps/api/src/modules/ingestion/services/product-identity.service.ts
apps/api/src/modules/ingestion/services/row-normalization.service.ts
apps/api/test/unit/ingestion-eligibility.spec.ts
apps/api/test/integration/ingestion-eligibility.e2e-spec.ts
apps/business/app/(workspace)/admin/ingestion-policy/page.tsx
apps/business/app/(workspace)/supplier/updates/page.tsx
apps/business/components/bw/workspace-frame.tsx
apps/business/components/workspace/source-rows.tsx
GLO-285-allowlist-handoff.md
```

The pre-existing untracked `apps/api/test/unit/glo285-stock-freshness.spec.ts` was preserved, not rewritten. Existing F1 changes remain in the shared offer service.

## Deployment — owner approval required for remote writes

Run from repository root. Review the migration and the seed's printed identities, aliases and category resolution before activating. Never substitute production URLs into test commands.

1. With owner-approved target credentials, explicitly set BOTH DATABASE_URL and DIRECT_URL to the same intended database. Apply `node node_modules/prisma/build/index.js migrate deploy --schema apps/api/prisma/schema.prisma`. Generate Prisma client and build/deploy the API and Business app together.
2. Default read-only seed preview:

```powershell
$env:TS_NODE_PROJECT='apps/api/tsconfig.json'
node -r ts-node/register/transpile-only apps/api/scripts/seed-ingestion-eligibility.ts
```

3. After owner review/approval, set ELIGIBILITY_SEED_ACTOR_ID to the actual active Admin UUID and ELIGIBILITY_SEED_REASON to the review reason. `--apply` creates/reuses canonical records and persists a preview. `--activate` additionally activates that reviewed preview. Remote execution requires the explicit `--owner-approved-remote` switch. These switches were used only on the local isolated test DB during this task.

```powershell
node -r ts-node/register/transpile-only apps/api/scripts/seed-ingestion-eligibility.ts --apply --activate --owner-approved-remote
```

4. Open `/admin/ingestion-policy`, verify approved IDs and version, review supplier-specific category labels and approve the Category column mapping. Files without a configured policy or resolvable Brand/Category HOLD safely. Use explicit HOLD rechecks after approving new aliases/mappings.
5. Reverting eligibility means publishing another reviewed version, not editing/deleting history. Existing jobs retain their version; no offers/orders are retrospectively disabled. Do not drop the additive schema as a routine rollback.

## Remaining limits

- Existing parser limit is 10,000 rows. 50,000-row uploads remain rejected; no parser redesign was performed.
- HOLD listing is capped at the latest 200 source rows; original historical HOLD outcomes remain auditable after successors resolve them. No large-file review UI redesign or general-purpose pagination was added.
- Pre-policy candidate rows have no approval proof and cannot newly enter matching/enrichment/publication through the guarded candidate path. Re-import/review their source under a policy rather than inventing retroactive approval. Already existing offers and accepted orders are unchanged; legacy offer commit behavior is retained where no policy ID exists.
- Correcting an admitted row to another brand requires policy re-admission/re-import; a free-text candidate correction cannot bypass the pinned decision. New canonical taxonomy creation remains a catalog concern, separate from enabling existing IDs in this policy.
- Preview impact reports existing offers whose canonical products fall outside the proposed allowed IDs. It does not simulate unknown future supplier text, mutate sellability or promise ingestion performance.
- Full API integration regression beyond the selected set, real production rollout and production seed execution remain unverified/unperformed.

## Security assessment

Security impact: controls the early ingestion admission boundary and Admin policy mutation. Trust boundary: supplier text → reviewed canonical snapshot; authenticated Admin → auditable version. Authorization rule: existing ADMIN guards plus active actor verification; session-derived actor and preview ownership. Sensitive data: private supplier labels/source rows stay behind Admin routes; no credentials enter policy/audit records. Abuse cases: unauthorized mutation, forged actor, alias collision, stale/replayed/concurrent activation, ambiguous labels, policy change during import and unsafe snapshot deactivation. Security tests: production guards/HTTP and isolated DB integrity assertions above. Remaining risk: deployment requires coordinated schema/application rollout and owner-reviewed initial identities/aliases/mappings; production itself was not changed.

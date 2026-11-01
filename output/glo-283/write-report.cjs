const fs=require('fs');const paths=require('./task-paths.json');const full=require('./closure-release-full.json');const baseline=require('./glo-283-baseline-results.json');const failed=r=>r.testResults.flatMap(t=>t.assertionResults.filter(a=>a.status==='failed').map(a=>a.fullName)).sort();const same=JSON.stringify(failed(full))===JSON.stringify(failed(baseline));if(!same)throw Error('Regression classification mismatch');const report=`# GLO-283 final Supplier PO closure — 2026-11-01

## Decision and scope

Supplier PO acceptance is **PASS for the verified local scenarios**. **NO-GO for an unrestricted production release**: the full API suite still has seven pre-existing failures (six catalog/availability expectations and one live Mapbox connectivity check). No production deployment or main merge is authorized or performed. Existing supplier data needs staff-verified preparation/pickup/onward delivery lead times before automatic recovery can use those suppliers; unknown values intentionally block recovery.

The task continues the authorized staged changes on \`feat/c0-commerce-integration\`, starting at \`f28698186c3f45e01a3b436261128857f8ec99e3\`. Storefront changes, including the already-staged route rename, are outside the commit. No Linear or AI/routine implementation changes were made. Git commit/push identifiers are recorded in the final handoff after remote confirmation.

## Before and after

Previously normal demand could dispatch between checkpoints; shortages waited for another batch; no-response POs remained live; stale stock could continue sourcing; shared partials required manual distribution; standalone creation competed with allocation-backed procurement.

Now customer order allocations consolidate by supplier/SKU/approved cost at the latest elapsed checkpoint (09:00, 12:00, 15:00, 18:00, 21:00, 00:00 by default). Operating hours, closures, timezone, checkpoints and 60/30 working-minute response durations remain configurable. Delayed workers catch up without pulling demand after the cutoff. A persisted response deadline is independent of viewing, preparation and receiving.

Confirmation and expiry claim the PO atomically. Partial/zero/price-change/expiry events preserve confirmed units, suppress contradicted availability, and durably replan only unmet demand. Open eligible alternate suppliers receive an expedited consolidated PO immediately; feasible closed alternatives defer to reopening. The bounded recovery sweep and existing transactional outbox recover interrupted delivery. Expiry cannot prove physical cancellation: an owned, validated, deduplicated dispute report opens an operational case and never reauthorizes stock or Hub receipt.

Recovery evaluates canonical SKU, supplier opening, trusted freshness, stock less outstanding commitments, normalized MOQ/multiples, reliability, currency, snapshotted customer net unit price, configured minimum gross unit margin, and verified lead time against the delivery promise. Missing pickup feasibility fails closed. The default margin floor is zero (no loss on the customer unit price); \`PROCUREMENT_MIN_MARGIN_BPS\` can impose a higher floor. No monetary/customer/routine preference was added.

Shared partial confirmations use the owner-proposed deterministic policy: delivery deadline, completion of otherwise physically ready orders, FIFO creation time, stable order/allocation IDs. Confirmed quantities are never revoked. Allocation priority inputs and outcomes are persisted; cancelled/amended conflicts become operational exceptions. Existing undistributed partials have a bounded recovery worker. Original ranking decisions and before-issue exclusions are stored in sourcing decisions.

Stock snapshots are physical observations; pending and confirmed commitments are subtracted once, including after newer snapshots. Shortage evidence has its own timestamp. Only newer dated trusted feeds restore contradicted eligibility; older/undated signals do not silently restore it. Price-only feeds preserve quantity. Direct offer/schedule changes use the same supplier advisory lock as feed commits and procurement, with stale-edit rejection.

Unused standalone PO creation returns 409. Unlinked legacy records remain readable; new confirmations require allocation lineage. Ready remains separate from physical pickup and independently accepted Hub quantities. Payables use accepted Hub units and the PO cost snapshot. Customer prices and order snapshots remain unchanged.

## Use-case matrix

| Scenario | Result | Execution evidence |
|---|---|---|
| Three real checkout orders, 2 + 1 + 3, one PO for 6 | PASS | GLO-283 HTTP integration |
| 6/6, 4/6, 0/6 | PASS | GLO-283 consolidation, partial and zero cases |
| Automatic partial distribution and audit | PASS | Delivery-priority 4/6 links are 1, 0, 3; pure policy ties/readiness tests |
| Immediate eligible fallback | PASS | Closed, MOQ, multiple, unknown lead and excessive-cost alternatives skipped; one eligible expedited PO |
| Two suppliers attempting conflicting coverage | PASS | Old supplier upgrade rejected while alternate confirmation succeeds; aggregate remains exactly 6 |
| 60-minute normal / 30-minute expedited working-time expiry | PASS | Working-window unit tests and actual expiry of both POs |
| Duplicate/simultaneous/late responses and expiry race | PASS | Concurrent same answers, competing expiry workers, overdue HTTP answer returns 409 |
| Viewing does not extend deadline | PASS | Supplier engagement and browser detail |
| Friday, overnight, holidays, configured timezone/hours | PASS | Schedule unit/integration and GLO-283 checkpoints; Dubai configuration regression |
| Process restart, duplicate events, expired leases | PASS | GLO-236 durable-event recovery; schedule delayed-worker cases |
| Interrupted partial transaction | PASS | Injected outbox failure rolls back PO, allocation and offer suppression; retry succeeds |
| Snapshot 21, commit 10, availability 11 | PASS | Supplier quantity test, including a newer stock snapshot |
| Stale/newer stock and price-only feed | PASS | SG05 regression and freshness unit coverage; full suite |
| MOQ/pack/price increase/margin/currency/pickup/deadline checks | PASS | Recovery-policy unit tests, GLO-283 eligible recovery and GLO-243 exceptions |
| Cancellation/amendment during procurement | PASS | GLO-283 before/after dispatch; financial/amendment regression; shared stale-lineage conflict holds |
| Cross-supplier access, IDOR, supplier data isolation | PASS | GLO-205/GLO-237; dispute anonymous/customer/foreign owner/oversized-note negatives |
| Legacy workflow blocked, history retained | PASS | HTTP negative legacy test and unit gates; portal positive fixtures have lineage |
| Ready 8 → pickup 7 → Hub accepted 6 | PASS | GLO-243 discrepancy/payable regression |
| Customer snapshots unchanged | PASS | Actual before/after order-item comparisons and financial regression |
| Real supplier browser workflow | PASS | Local password login, 4/6 response accepted, Ready action; original Hub receipt stays null |
| Real Admin browser workflow | PASS | Original confirmed 4 and alternate expedited 2 on same order; re-batching creates no duplicate |
| Full API regression | FAIL — BASELINE | 1095 pass / 7 fail, 123 passing suites / 127; failed names exactly match HEAD baseline |
| Actual production supplier response/transport SLA | BLOCKED / NOT CLAIMED | Local fixtures only; no production deployment or real supplier timing |

## Verification commands and results

All integration databases are explicit disposable localhost PostgreSQL databases ending in \`_test\`, with BOTH datasource URLs set identically before dotenv or Prisma. The strengthened preflight rejects missing/mismatched URLs, non-local hosts, non-test names and connection-host overrides. No integration tests used Development.

Commands below run in \`apps/api\` unless noted; installed tools were invoked directly because the pnpm launcher attempted dependency preparation and encountered certificate failures. No manifest/lockfile changes or dependency installations were introduced.

- \`node scripts/local-test-database.cjs -- ../../node_modules/prisma/build/index.js migrate deploy\`: exit 0, all 64 migrations on fresh local databases; also rehearsed on the restored Development copy.
- \`node scripts/local-test-database.cjs -- ../../node_modules/jest/bin/jest.js --runInBand --json --outputFile=../../output/glo-283/closure-release-full.json\`: exit 1; 1095 passed, 7 failed, 127 suites, 716.989 seconds. All seven failures match the independently run baseline names.
- \`node scripts/local-test-database.cjs -- ../../node_modules/jest/bin/jest.js --runInBand --testPathPattern='glo-283|glo-237|glo-243|glo-236|glo-205|glo-238|supplier-quantity|supplier-schedule|supplier-engagement|procurement-policy|purchase-order|ranking.service|architecture'\`: exit 0, 96/96 in 14 suites, 42.308 seconds.
- \`node scripts/local-test-database.cjs -- ../../node_modules/jest/bin/jest.js --runInBand --testPathPattern='glo-283|supplier-workflow-engagement'\`: exit 0, 21/21 in two suites, 32.358 seconds, after final dispute security assertions.
- From repository root: \`node --test apps/api/scripts/local-test-database.test.cjs apps/api/scripts/verify-development-database.test.cjs\`: exit 0, 3/3.
- \`node ../../node_modules/@nestjs/cli/bin/nest.js build\` and \`node ../../node_modules/typescript/bin/tsc --noEmit\`: exit 0.
- Business: \`node ./node_modules/next/dist/bin/next build\`, typecheck and scoped ESLint: exit 0.
- API changed/new TypeScript lint: 39 existing findings versus 44 on the equivalent HEAD paths, zero introduced findings. No unrelated lint cleanup was attempted.
- \`graphify update .\`: exit 0; optional SQL parser unavailable, AST graph refreshed.
- \`git diff --check\`: no whitespace errors on task paths. Credential comparison against configured secrets: no matches in task sources.

One overlapping acceptance run encountered a 30-second GLO-237 timeout under concurrent full-suite/build load. The isolated final 96-test run passed that scenario. The earlier transient cash attention failure also disappeared in the fresh full run; its baseline isolated check passed 4/4. Neither is presented as a persistent new regression.

Database assertions (\`docs/verification/glo-283-db-assertions.sql\`, exit 0): overconfirmed allocations 0; overcommitted active requirements 0; competing pending allocations 0; expired-PO pending allocations 0; broken aggregated quantities 0.

Local shortage/expiry-evidence-to-expedited-PO issue latency, deduplicated by PO: n=10, minimum 57 ms, p50 128 ms, p95 281.2 ms, maximum 337 ms. These are synthetic local backend timings, not real supplier response latency or a production SLA. Supplier response limits are verified working-time rules, not observed supplier performance.

## Development backup, migrations and incident

Owner explicitly confirmed project \`cluidtctwgxxhybzftft\`, database \`postgres\`, as Development. DATABASE_URL and DIRECT_URL were independently parsed and checked for the exact project/account, database, allowed host/port, credential agreement and safe query parameters. Credentials were not printed or committed.

Read-only inspection verified all 60 existing migration checksums. The earlier accidental \`20261026090000_routine_phase1_individual\` migration had finished, matched local SQL, was not rolled back, and its eight Care foundation tables existed. No pre-incident backup was available to establish historic before/after row counts. No automatic rollback was attempted; no Care implementation was changed in this closure.

A custom pg_dump backup covered all nine application schemas and public migration metadata: 90 tables, 300628 bytes, SHA-256 \`a8ab63824d8f7f1c795407c2388b16d010286d331519f9219dbfa5111d34cb51\`. It was restored on isolated PostgreSQL 17 with pg_trgm provisioned; the existing public schema declaration was omitted from the restore list. All 90 table counts and row hashes and all 60 migration records matched the remote snapshot. This is a verified application-schema backup, not a claim to back up Supabase-managed global infrastructure.

The restored copy then applied all four pending migrations. Every original application row/column digest and existing migration record was preserved. The same gates were rechecked immediately before remote deployment; any drift of data, migration SQL or history would have stopped the write.

Applied with \`prisma migrate deploy\` (exit 0) on Development only:

1. \`20261101005709_supplier_po_response_deadline\`: expired enum, deadline/expedited fields, due index.
2. \`20261101005910_supplier_offer_shortage_evidence\`: separate shortage timestamp.
3. \`20261101011500_supplier_closure_dates\`: closure-date array.
4. \`20261101020000_final_supplier_po_closure\`: nullable verified lead time, positive MOQ/multiple fields and checks, sourcing decision audit table, bounded-work indexes.

Post-deploy verification at 2026-11-01 04:26:39 Africa/Cairo: 64 migrations applied; \`prisma migrate status\` exit 0/up to date; all 89 original application table hashes preserved (the migration registry changed as expected); all original migration records preserved; two checks validated and five new indexes present; new Prisma client field reads succeeded inside a read-only transaction.

Existing unrelated schema drift includes extra Care proposal columns, catalog/ingestion index/default/type differences. The generated destructive schema diff was **reviewed but never executed**. Remote residual drift after deployment exactly matches the successfully rehearsed clone; the four Supplier migrations do not drop, reset, rewrite or delete application data.

Backup and restore/deploy evidence is retained, excluded from Git, under \`.codex/qa-logs/glo-283-20261101/development-backup/\`. Raw verification logs remain in \`output/glo-283/\`. Neither secrets, backup data nor runtime fixture credentials belong in the commit.

## Security assessment

Security impact: procurement commitments, supplier authorization, allocation quantities and database target safety.

Trust boundary: supplier session → owned PO → owner-controlled allocation ledger; staff-only supplier configuration; local test environment versus the explicitly confirmed Development project.

Authorization rule: anonymous 401; customer/foreign supplier 403; suppliers see only their own lines and approved costs, not customer lineage or competing offers. Legacy creation cannot bypass the ledger. Expiry dispute only records an exception.

Sensitive data involved: session credentials, supplier costs, customer/order snapshots and database backup. All remain within their existing boundaries; no credentials or backup content are committed.

Abuse cases considered: extra/foreign/duplicate line IDs, conflicting replay, overconfirmation, timeout races, stale inventory restoration, changed cost/terms, cancelled demand, stock overcommit, direct-edit races and wrong datasource selection.

Security tests added: datasource mismatch/host override checks; exact Development identity checks; rollback/concurrent response tests; cross-owner/anonymous/customer/oversized dispute requests; expired/legacy confirmation rejection; snapshot preservation.

Remaining risk: existing catalog/availability regression failures and live Mapbox connectivity remain outside this Supplier task. Physical disputed handovers require an operations decision and independent Hub evidence. Staff must verify real lead times/trade terms; unknown pickup feasibility is not guessed. Margin policy above the no-loss floor remains a configurable owner/finance decision.

## Git handoff

Only the explicit paths below plus this report and its assertion SQL are selected. Unrelated storefront/configuration work stays outside this commit. The existing feature remote was an ancestor (one existing local commit ahead before this task commit). GitHub reported no repository hooks or deployments; its only active Actions workflow is security validation for main/PR-main/schedule, with no deployment/migration action. Final fetch, fast-forward check, commit and push verification are performed after the report is written. The final chat handoff records the exact resulting SHA and remote branch URL.

## Changed task paths

${paths.map(p=>'- '+p).join('\n')}
- docs/verification/GLO-283-supplier-po-hardening.md
- docs/verification/glo-283-db-assertions.sql
`;
fs.writeFileSync('docs/verification/GLO-283-supplier-po-hardening.md',report.replaceAll('\`','`'));
console.log('Acceptance report written; baseline failure names verified');

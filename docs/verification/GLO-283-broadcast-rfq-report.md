# GLO-283 — BROADCAST_ON_DEMAND RFQ procurement and real-time demand sync

Status: implemented and verified on an isolated local PostgreSQL 17 `_test` database (never Supabase). See "Verdict".

## What it does

`SOURCING_MODE=BROADCAST_ON_DEMAND` (explicit; unset keeps the legacy `OFFER_BASED` behaviour, an unknown value refuses to boot).

1. **Broadcast.** At each 3-hour checkpoint (09:00 … 00:00 Africa/Cairo, 00:00–01:00 hold, supplier working calendar) the demand that is
   not yet covered is aggregated per canonical SKU across customer orders and sent as a **non-binding RFQ** to every active,
   **enrolled** (`suppliers.rfq_enrolled_at`) supplier whose optional `rfq_scope_sku_ids` covers the SKU. No `SupplierOffer`, stock figure or
   price is read; suppliers never see customer data, other suppliers or prices. OrderItem lineage is stored in `rfq_demand_sources`.
2. **Answer per line.** FULL / PARTIAL(q) / UNAVAILABLE; no answer stays pending until the recipient deadline
   (`PO_NORMAL_RESPONSE_MINUTES`, supplier working minutes; 30 for expedited).
3. **Atomic allocation.** `POST /rfq/:id/responses` locks the affected orders (advisory, same order as cancellations), then the demand lines
   (`FOR UPDATE`), rejects stale answers (`409 STALE_DEMAND` when `basedOnVersion` or `seenQuantity` no longer match; UNAVAILABLE can never
   over-buy so it is always accepted), splits the awarded quantity over the order items by the existing scarce-stock policy
   (`allocateScarceQuantity`), writes confirmed `source_allocations` (no offer, no cost) and **creates the binding supplier PO** (status
   `confirmed`, `unit_cost` NULL = cost captured at Hub receipt per the GLO-283 cost policy) in the same transaction. DB CHECK constraints
   (`awarded <= required`, `>= 0`) make over-award impossible even if the code were wrong.
4. **Real-time demand sync.** Every change appends to `sourcing.rfq_events` (durable, same transaction). `GET /rfq/stream` (SSE, Bearer auth,
   per-supplier, resume with `after=`/`Last-Event-ID`) pushes it; the Business UI re-reads the authoritative snapshot on every (re)connect and
   change, shows "الكمية المطلوبة اتغيّرت من X إلى Y", highlights the quantity and **blocks submission until the line is re-reviewed**.
5. **Recovery.** Partial / unavailable / timeout / supplier unavailable keep committed allocations and expose only the remainder.
   `evaluateRfq` adds newly eligible suppliers immediately (expedited deadline, no 3-hour wait); when every eligible supplier answered or
   timed out and demand remains, the RFQ is `exhausted`: `AvailabilityActionRequirement` (customer-decision path) + an Admin support case.
6. **Idempotency.** One key per submit intent; a retry (even a concurrent one) replays the stored outcome; the same key with different
   content is `409`; a supplier answers a demand line once (`unique(demand_line_id, supplier_id)`).
7. **Cancellations / amendments.** `SupplyPlanService.releaseForCancelledOrder/applyAmendment` call `RfqService.touchForRequirements` in the
   same transaction: open RFQs shrink, the line version bumps, SSE notifies, in-flight answers become stale.

OFFER_BASED code, tables and tests are preserved and inactive in the MVP mode (`SupplyPlanService.advance`, ranking, offer capacity,
`flushProcurementBatch` for offer allocations). `getPurchaseAvailability` returns orderable in broadcast mode (no supplier stock exists to gate on).

## API

| Route | Role | Purpose |
| --- | --- | --- |
| `GET /rfq/mode` | staff, supplier | active sourcing mode |
| `POST /rfq/batches` `{reason, includeClosedSuppliers?}` | ADMIN/HUB + `sourcing.manage` | audited early flush |
| `POST /rfq/maintenance` | ADMIN + `sourcing.manage` | run timeouts / recovery / escalation now |
| `GET /rfq/staff`, `GET /rfq/staff/:id` | ADMIN/HUB + `sourcing.manage` | queue, lineage, append-only audit trail |
| `GET /rfq/mine`, `GET /rfq/:id`, `POST /rfq/:id/responses`, `GET /rfq/stream` | SUPPLIER (own account only) | supplier workspace |
| `PATCH /sourcing/suppliers/:id` `{rfqEnrolled, rfqScopeSkuIds}` | ADMIN/HUB | approve / scope a supplier |

## Files

Backend: `prisma/schema.prisma`, `prisma/migrations/20261105090000_broadcast_rfq_demand_sync/migration.sql`,
`src/modules/sourcing/services/rfq.service.ts`, `dto/rfq.dto.ts`, `config/procurement-batch.config.ts`, `services/supplier-schedule.ts`
(`isDemandDueForCheckpoint`), `services/supply-plan.service.ts`, `services/purchase-order.service.ts`, `services/sourcing.service.ts`,
`dto/supplier.dto.ts`, `sourcing.module.ts`, `public.ts`, `platform/events/domain-events.service.ts`,
`application/composition/controllers/rfq.controller.ts`, `composition.module.ts`, `.env.example`.
Business UI: `apps/business/lib/rfq-live.ts`, `app/(workspace)/supplier/rfq/page.tsx`, `app/(workspace)/supplier/rfq/[id]/page.tsx`,
`components/bw/workspace-frame.tsx` (nav).
Tests: `apps/api/test/integration/rfq-broadcast.e2e-spec.ts`.

## Operating notes

* Set `SOURCING_MODE=BROADCAST_ON_DEMAND` in every environment that should run the MVP flow; enrol suppliers (`rfqEnrolled: true`) — the
  migration enrols nobody.
* Migration is additive except four `DROP NOT NULL` on `sourcing.source_allocations` (needed so an award has no offer/cost). Rollback notes
  are in the migration header. **Not applied to Supabase** (owner approval required).
* Notifications to suppliers are in-app (durable events + banner). WhatsApp/push for suppliers is not wired.

## Verification (local PostgreSQL 17.11 `broadcast_rfq_test`, 127.0.0.1, `--runInBand`, provider keys blank)

Commands (from `apps/api`, both datasource URLs set to the local `_test` database):

```
npx jest --runInBand test/integration/rfq-broadcast.e2e-spec.ts
```

| Area | Result |
| --- | --- |
| New `rfq-broadcast.e2e-spec.ts` (real HTTP + SSE socket + DB), scenarios A–K | **12 / 12 pass** |
| Mutation check: stale-version rejection disabled | 4 tests fail (D/F/G, E, E/F property, cancellation) — the tests guard the invariant |
| Legacy OFFER_BASED sourcing regression (architecture boundaries, GLO-283 batching, PO, supply plan, schedule, quantity, GLO-243, sourcing, ranking) | **10 suites / 78 tests pass** |
| Wider regression (order, checkout, hub, receiving, availability, financial, ingestion…) | 108 / 115 suites pass; 7 suites / 27 tests fail |
| Same 7 failing suites on untouched HEAD (temporary git worktree) | **identical: 7 suites / 27 tests fail** → pre-existing (catalog/ingestion/discovery; Prisma pipeline client), not caused by this change |
| `tsc --noEmit` (api, business), `nest build`, `next build` (new `/supplier/rfq`, `/supplier/rfq/[id]` routes), eslint on new files | pass |
| Browser E2E (built-in browser, real API + Next dev, mobile 375px, Arabic RTL) | pass — see below |

Scenario coverage: A 20-SKU fan-out to 3 suppliers; B A fulfils 9 / marks 11 unavailable and B immediately sees 9 fulfilled-elsewhere + 11
actionable; C open session receives `demand_changed` (10→4) over SSE; D stale FULL/PARTIAL refused (409 STALE_DEMAND) and no over-award;
E simultaneous whole-batch races and a 3-supplier interleaved property check (total awarded == demand, never above, DB CHECK holds);
F exact per-order-item split (4+6); G full / zero availability, exhaustion → Admin case + customer action-required; H cursor replay +
snapshot reconcile; I duplicate/concurrent confirmation replay, key reuse conflict, second answer refused, application restart;
J RBAC (outsider, customer, hub, admin-as-supplier, unauthenticated), product-scope isolation, no customer data/competitor id in supplier
payloads, append-only audit trail; K supplier-ready → Hub barcode receiving (wrong code rejected, over-quantity rejected, duplicate scan
replayed, PO → `received_at_hub`), unknown cost never turned into a payable; checkpoint cutoff (11:50 vs 12:30), issued PO immutability,
mode switch refusing RFQ in OFFER_BASED, expedited recovery reaching a late-opening supplier, timeout of non-responders.

Browser run (two sessions, real DB): supplier B chose FULL on a 10-unit line; supplier A's 6-unit award arrived over SSE into B's open page
(banner "الكمية المطلوبة اتغيّرت من 10 إلى 4", quantity highlighted, submit disabled, review required); after review B submitted and was awarded
exactly 4 (DB: awarded 10/10, two confirmed POs of 6 and 4). The API was killed mid-session: the page showed "بيعيد الاتصال…" with submit
disabled; an award made through a second API instance during the outage appeared (5→3) after reconnect via the snapshot.
The scheduler timer (`RFQ_TICK_MS`) issued an RFQ unprompted from demand older than the last checkpoint (see Linear evidence).

## Known limitations / not claimed

* No Admin UI yet for supplier enrolment or the RFQ queue (API only). Supplier notifications are in-app; no WhatsApp/push for suppliers.
* Hub **invoice acquisition-cost capture** (GLO-283 cost seam) is a separate deliverable and is not part of this change: broadcast POs carry
  `unit_cost NULL`, payables refuse to invent a cost. The Hub scan/receipt path itself is verified.
* A supplier may answer a demand line once; a supplier that changes its mind after answering must use staff (or a later recovery round).
* The browser test drove supplier A through HTTP (Next dev blocks a second local origin); A's page was exercised separately by tests.
* The migration is not applied to the shared Supabase project.

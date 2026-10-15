# C1 — Backend Cart-to-Cash contracts and operations

Backend only (NestJS modular monolith, Prisma, PostgreSQL). Scope: GLO-235 and its C1 issues
(GLO-231 backend part, GLO-236 … GLO-243). No Storefront or Business Workspace changes. This page
is the contract reference for the paused UIs and the runbook for operators.

## 1. End-to-end flow (one order)

```
cart (server quantities, revision)
 → POST /ordering/checkout/quote            authoritative prices, Cairo/Giza only
 → POST /ordering/checkout                  confirmed pin, idempotency key, COD (default)
      └─ same transaction: order + operations.domain_events(order.placed → sourcing.supply-plan)
 → supply plan (cheapest eligible supplier offer per order item, pending allocation)
 → POST /purchase-orders/batches            one PO per supplier, one line per SKU+cost, N allocation links
 → POST /purchase-orders/:id/confirm        supplier; full / zero / single partial → allocations,
                                            shared partial → admin distribution, exceptions recorded
 → POST /purchase-orders/:id/ready          supplier; NOT a receipt
 → POST /fulfillment/receipts               hub; identity evidence, quantities vs lineage
      (POST /purchase-orders/:id/shortfalls for confirmed units that never arrived)
 → preparation session scans → complete     reviewed barcode / audited manual check
 → GET  /fulfillment/shipments/:id/documents, POST …/label, LABEL_PRINTED, PACKED
 → delivery run: stops → HANDOFF_SCANNED (driver, label barcode) → dispatch (atomic)
 → DELIVERED + collectedAmount (driver)  |  FAILED + reasonCode → RECEIVED_BACK → next run
                                          |  RETURNED (hub) → order `returned`, cash voided
 → POST /ordering/settlements/batch         cashier count at the hub, once per collection
 → POST /sourcing/purchase-orders/:id/payable, PATCH /sourcing/payables/:id/mark-paid
 → returns / refunds (cash-bounded, proof required), staff cancellation before custody
```

The canonical automated run is `apps/api/test/integration/c2c-backend-acceptance.e2e-spec.ts`.

## 2. Breaking API changes for the frozen frontends

| Endpoint | Change |
|---|---|
| `POST /ordering/checkout` | requires `latitude`, `longitude`, `locationSource` (`map_pin`\|`current_location`), `locationConfirmed: true`; 422 `OUT_OF_SERVICE_AREA` / `LOCATION_PIN_IMPROBABLE`; optional `paymentMethod` (`COD` default; `CARD`/`MOBILE_WALLET` → 422 `PAYMENT_METHOD_UNAVAILABLE` until a provider is connected) |
| `POST /ordering/checkout/quote` | 422 `OUT_OF_SERVICE_AREA` outside Cairo/Giza |
| `POST /ordering/settlements/batch` | now in the composition layer; requires `locationId` and a driver `courierId` (UUID); returns per-line expected/declared/counted/variance |
| `POST /fulfillment/receipts` | requires `barcodeScanned` **or** `manualReason` + `manualChecks: [brand, variant, size, pack]` |
| `POST /fulfillment/preparation-sessions/:id/scan` | a bare `skuId` is a manual verification and needs `manualReason` + all `manualChecks` |
| `POST /fulfillment/shipments/:id/events` | `FAILED` needs `reasonCode`; new `RECEIVED_BACK` (hub, barcode); `RETURNED` needs the barcode |
| `PATCH /fulfillment/shipments/:id/status` | `failed` needs `reasonCode`; `cancelled`, `returned` and failed→`packed` are command-only; staff cannot set a COD shipment `delivered` (409 `COD_DELIVERY_REQUIRES_DRIVER`) |
| `POST /purchase-orders/:id/confirm` | late identical answer is idempotent, different → 409; optional `exceptionCode`, `exceptionNote`, `proposedQuantity`, `proposedUnitCost`; status `price_changed` |
| refunds | typed DTOs; `succeeded` needs `providerRef` (409/400 `NO_CASH_RECEIVED`, `REFUND_PROOF_REQUIRED`) |

## 3. New endpoints and who may call them

| Endpoint | Roles (permission) | Notes |
|---|---|---|
| `GET /operations/events`, `POST /operations/events/dispatch`, `POST /operations/events[/:id]/requeue` | ADMIN (`order.manage`) | durable event visibility / replay |
| `POST /purchase-orders/batches` | ADMIN, HUB (`sourcing.manage`) | manual procurement flush |
| `GET /purchase-orders` | ADMIN, HUB, SUPPLIER (own only) | supplier view has no order/customer lineage |
| `POST /purchase-orders/:id/ready` | SUPPLIER (own), staff | |
| `POST /purchase-orders/:id/lines/:lineId/distribute` | ADMIN (`sourcing.manage`) | scarce-stock decision, audited |
| `POST /purchase-orders/:id/shortfalls` | ADMIN, HUB (`hub.receive`) | `NOT_HANDED_OVER` \| `LOST_IN_TRANSIT` \| `SHORT_SHIPPED` \| `DAMAGED_IN_TRANSIT` |
| `PATCH /ordering/orders/:id/delivery-location` | ADMIN, HUB (`delivery.plan`) | only for orders without a pin |
| `POST /ordering/orders/:id/cancel` | ADMIN (`order.manage`) | before custody only |
| `GET /ordering/settlements/collections`, `/batches`, `/batches/:id` | ADMIN, HUB (`cod.reconcile`) | own hubs only |
| `GET /fulfillment/locations/:id/receivables`, `/shipments`, `/runs` | ADMIN, assigned HUB | bounded, no customer phone/address |
| `GET /operations/queues/attention` | ADMIN (`dashboard.read`) | everything waiting on a human |
| `POST/PATCH/GET /catalog/barcode-aliases` | ADMIN (`catalog.manage`) | reviewed manufacturer codes |
| `POST /payments/webhooks/:provider` | provider signature | no provider registered → 404 |
| `GET /fulfillment/driver/runs` (existing) | DRIVER (own runs) | adds `location { latitude, longitude, navigationUrl }`, `attemptStatus` |

## 4. Financial invariants (enforced in code, proven by tests)

| Invariant | Where |
|---|---|
| Expected COD is the order's own figure (amendments included), fixed when the run is dispatched, stamped with the hub | `ReconciliationService.ensureExpectedCollection` inside `dispatchBatch` |
| Only the assigned driver declares door cash, once (replay = same amount) | `recordDriverDeclaration` inside the delivery transaction |
| Delivered ≠ declared ≠ counted ≠ settled | separate fields/statuses; staff cannot deliver COD |
| Settlement only for delivered + declared cash of the same courier on the same hub, exactly once, idempotent reference, explicit short/over | `createSettlementBatch` |
| Card/wallet orders never create driver cash; online paid only from a verified provider event | `PaymentsService`, `ensureExpectedCollection` |
| Payable = accepted quantity (received for order-linked lines) × PO cost snapshot, EGP, Decimal, unique per PO | `PayablesService` |
| Refund ≤ money actually received (counted, else declared, or confirmed online) − earlier refunds; paid only with proof | `ReconciliationService.initiateRefund/updateRefundStatus` |
| Money is `Decimal(10,2)`; DTO amounts ≤ 2 decimals | schema + DTOs |

## 5. Operations runbook

- **Durable events.** Rows live in `operations.domain_events`. The API polls every
  `DOMAIN_EVENTS_POLL_MS` (default 5000; off under `NODE_ENV=test` unless set). Inspect failures
  with `GET /operations/events?status=failed|dead`; replay with `POST /operations/events/:id/requeue`
  or from a shell: `npm run events:dispatch` (add `-- --requeue` to retry failed/dead rows first).
  Consumers are idempotent; replay is safe while the API runs.
- **Procurement cadence.** Manual by default (`POST /purchase-orders/batches`). Automatic batching
  runs only if `PROCUREMENT_BATCH_INTERVAL_MINUTES` is set (owner policy; provisional 12 h = 720).
- **Notifications.** No WhatsApp/email/push provider is connected: notifications stay `held` with
  `PROVIDER_NOT_CONNECTED`. Register a real `NotificationProvider` to send.
- **Exceptions.** Returned parcels, cancellations with goods in flight, receiving damage, shortfalls
  and supplier exceptions open support cases (`GET /operations/support/cases`,
  `GET /operations/queues/attention`). Support records decisions; canonical changes go through the
  owning workflow.

## 6. Running the backend acceptance evidence

Never against Neon/shared/production. Use a disposable cluster:

```bash
initdb -D <tmp>/pgdata -U postgres -A trust -E UTF8 --locale=C
pg_ctl -D <tmp>/pgdata -o "-p 55432 -c listen_addresses=127.0.0.1 -c max_connections=200" start
createdb -h 127.0.0.1 -p 55432 -U postgres shenacare_test
cd apps/api
DATABASE_URL="postgresql://postgres@127.0.0.1:55432/shenacare_test?connection_limit=5&connect_timeout=30" NODE_ENV=test npx prisma migrate deploy
DATABASE_URL="postgresql://postgres@127.0.0.1:55432/shenacare_test?connection_limit=5&connect_timeout=30" NODE_ENV=test npx jest --runInBand --forceExit
```

The test guard refuses any database whose name does not end in `_test`.

## 7. Owner decisions still open (code fails closed until decided)

- Procurement cadence / cutoff; scarce-stock priority (today: explicit admin distribution only);
  buying above-demand cartons into owned stock (today: never automatic).
- Maximum delivery attempts before return to sender; restock vs return-to-supplier of returned goods.
- Cash variance tolerance (today: every short/over is reported, nothing auto-accepted).
- Refund eligibility windows; supplier payable treatment of customer returns; payment timing.
- Payment providers for cards and Vodafone Cash (none connected; METHOD-READY only).
- Whether a supplier pickup manifest is mandatory per run (shortfall reasons cover attribution today).
- Exact Cairo/Giza service polygons (today: a generous Greater Cairo bounding box).

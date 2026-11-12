# ShinaCare MVP readiness audit — 2026-11-12

**Verdict:** **Not ready to claim real-order MVP readiness.** This is a read-only inspection of the current checkout, not a deployed-system acceptance test. `UNVERIFIED` means the code or page exists but its live behavior, data, configuration, or end-to-end outcome was not demonstrated here.

**Scope and evidence:** Branch `codex/main-work-in-progress-20261111`, HEAD `0244296`; the checkout already has extensive staged, unstaged, and untracked work across all three apps. I inspected routes, active controllers and services, critical order paths, recent commits, and the older `docs/verification/pdp-backend-readiness-report.md`. That October report describes a synthetic pilot and an old baseline; it is **not** current launch evidence. No database, deployed environment, browser flow, build, or tests were run. Statuses below describe this checkout only.

Key code paths: `apps/api/src/modules/accounts/accounts.service.ts`, `apps/api/src/modules/ordering/{checkout.controller.ts,services/ordering.service.ts}`, `apps/api/src/modules/sourcing/config/procurement-batch.config.ts`, `apps/api/src/application/composition/controllers/catalog-intake.controller.ts`, `apps/api/src/modules/fulfillment/fulfillment.controller.ts`, `apps/web/src/features/checkout/components/CheckoutView.tsx`, and `apps/business/app/(workspace)/`.

| Feature | Status | Missing/Broken | Priority |
| --- | --- | --- | --- |
| Storefront home, listing, search, product detail | **CODE PRESENT; UNVERIFIED live** | Routes and discovery/detail APIs exist. Home reads discovery without mock fallback; detail gates purchase on `canOrder` and price, and reviewed content is conditional. Current real published SKUs, prices, images, and content are unverified. | P0 data gate |
| Customer auth | **BLOCKED for production OTP** | `accounts.service.ts` logs OTP in dev/test, but production `sendOtp` throws `ServiceUnavailableException` because no delivery provider is configured. Checkout requires a customer session. | **P0** |
| Cart and checkout | **CODE PRESENT; UNVERIFIED end to end** | Guest cart/quote and customer checkout routes exist. Checkout rechecks quote, cart revision, sellability, service area/pin, and idempotency; web submits COD. No successful real order was observed. | **P0** |
| Orders and tracking | **CODE PRESENT; UNVERIFIED live** | Customer order/tracking routes and web pages exist; guest tracking requires a per-order token. Status updates, customer visibility, and notifications were not exercised. | P0 acceptance |
| Admin Workspace | **CODE PRESENT; UNVERIFIED live** | Overview, catalog/intake, orders, sourcing, exceptions, hub, delivery, and cash routes exist. The new intake is uncommitted; operational data and publication outcomes are unverified. | P0 operations gate |
| Supplier Workspace and sourcing | **CODE PRESENT; UNVERIFIED live** | RFQ, PO, account, and new price-list upload routes exist. `BROADCAST_ON_DEMAND` is the documented MVP mode, but unset `SOURCING_MODE` falls back to `OFFER_BASED`; deployed mode, enrolled responsive suppliers, and successful procurement are unverified. Price-list upload does not by itself prove fulfillment. | **P0** |
| Hub and delivery workspaces | **CODE PRESENT; UNVERIFIED live** | Receive, prepare, pack, dispatch, driver stop, and COD event flows call guarded API routes. No real receive-to-delivered order or cash reconciliation was observed. Delivery is limited to Cairo/Giza with a confirmed pin. | P0 acceptance |
| Backend/API integration | **CODE PRESENT; UNVERIFIED deployment** | Nest composition wires catalog, commerce, ordering, sourcing, fulfillment, accounts, messaging, and intake routes. Current migrations, API startup, frontend/API compatibility, background event dispatch, and production storage/provider setup were not checked. | **P0** |
| Security and critical failures | **PARTIAL; UNVERIFIED runtime** | Customer-session, staff role/permission, supplier-scope, and guest-order-token checks are visible in the inspected controllers. Production OTP failure is confirmed in code. No live authorization, secret/configuration, abuse, or penetration checks were performed. | P0 auth; P1 review |

## P0 blockers and acceptance gates

1. **Confirmed code blocker:** connect and verify production OTP delivery (or an approved production customer sign-in path). Without it, new customers cannot place orders through the required session path.
2. **UNVERIFIED data gate:** prove a small set of real, reviewed, published products has exact SKU media, active listings/prices, and orderable availability. Prior synthetic or older database counts cannot establish today's catalog.
3. **UNVERIFIED order gate:** verify deployed mode/configuration, supplier enrollment and response, and one real COD order from sign-in → cart → quote → placement → sourcing/PO → hub → driver delivery → tracking/COD reconciliation, including failure and retry paths. Resolve any failure before launch.
4. **UNVERIFIED release gate:** verify current migrations, API/web/business builds or focused checks, and production providers (OTP, map, messaging, storage) against the intended environment. The older full-suite failure inventory is stale for this dirty checkout.

## P1 improvements

- Run focused authorization checks for customer order access, supplier isolation, staff roles, and guest tokens; confirm OTP rate limiting and production logging behavior.
- Validate empty/error/loading states and Arabic/RTL on the live storefront and workspaces; measure the product and checkout read path with real API data.
- Establish a current, reproducible focused test and deployment smoke-check record after the uncommitted work settles.

## P2 defer

- Online card/wallet payment until a real provider is integrated; COD is the coded storefront path.
- Advanced routines/AI chat, richer reviews/content, route optimization, and broad catalog automation beyond the initial real-order cohort.

**Recommended execution order:** production auth → real sellable catalog → sourcing/operator readiness → one complete COD order and failure/retry drill → focused security/build/deployment checks → P1 polish. Keep all unobserved outcomes marked **UNVERIFIED** until tested in the target environment.

# C0 Commerce Execution State

Durable checkpoint for the C0 directive (W1 → W6 → GLO-232). Update at each verified checkpoint.

## Current

- **Stage:** GLO-232 technical acceptance — evidence gathered, report/build gates pending
- **Branch / worktree:** `feat/c0-commerce-integration` in the main checkout (`C:/Users/Administrator/Desktop/shena care`).
  Branched from `feat/w1-storefront-checkout` at W1 commit. Nothing pushed or merged.
- **Last verified commit:** `4cc59b7` (W6)

## Completed

| Stage | Commit | Evidence |
|---|---|---|
| W1 Storefront COD checkout + confirmed map pin | `4b7e166` | Real UI on disposable DB: missing pin blocked; stale price → change receipt, 0 orders; double submit → 1 order `ORD-058C00FF8BDC46B3` with pin 30.04288/31.22589 `map_pin`, COD 255; tracking shows pin and status. API suites checkout/cart/glo-231/order-tracking/storefront-contract/c2c/architecture 7/7 (54 tests). Web jest 52/52, typecheck, lint, check:design, tokens:check clean. |
| W2 Admin workspace | `351742e` | Founder real login → overview KPIs → orders list → composite detail of the W1 order → manual flush created one PO aggregating 3 orders (serum 1+2+1). New `c0-workspace-reads` spec 6/6; 18 affected suites 129/129. |

| W3 Supplier workspace | `4ebec4b` | Supplier login; aggregated PO (3 orders) partial 3/4 + full; Ready (not receipt); founder distribution 1/2/0; order 3 ACTION_REQUIRED, COD unchanged. |
| W4 Hub workspace | `7978c80` | Receive (wrong barcode refused, lot/expiry), scan station (WRONG_ITEM, EXCESS, 1/1), 80 mm receipt + Code128 slip previews, pack, run with custody gate. Printer/scanner hardware NOT VERIFIED. |
| W5 Driver + COD | `517886a` | Driver login, wrong slip refused, custody, dispatch, delivered 255, failed + received back, retry by other driver (unassigned 404, rewrite 409), cashier counts 255 settled and 580/590 short −10. |
| W6 Customer recovery | `4cc59b7` | Guest decision panel → support case → cancel whole order (COD 255→0). New spec c0-customer-recovery 3/3. |

## GLO-232 evidence (so far)

- Canonical chain on `ORD-058C00FF8BDC46B3`: steps 1–22 traced across storefront, admin, supplier, hub, driver UIs; PO `5154579F` payable 500.5 EGP (3×136.5 + 1×91) computed, left OPEN (no real payment); customer and admin both DELIVERED; settlement `CNT-2026-10-15-EFEDE5-69MRJ`.
- Live negative matrix (scratchpad `c0-negative-matrix.cjs`): 35 checks, 33 PASS + 2 investigated and correct (expired receipt → 400 RECEIVING_EXCEPTION, 0 stock rows; staff PATCH delivered on an already-delivered parcel is a same-status no-op — still 1 DELIVERED event, cash unchanged; the true negative is covered by c2c step 7, 409 COD_DELIVERY_REQUIRES_DRIVER).
- Full API regression on `shenacare_test`: **72/72 suites, 483/483 tests** (at `4cc59b7`).
- Notifications: all `held` (no provider), none falsely `sent`.

## Environment (local only, never Neon)

- Disposable PostgreSQL 16 cluster: scratchpad `pgdata`, `127.0.0.1:55442`, trust auth.
  - `shenacare_test` — automated suites (`DATABASE_URL=postgresql://postgres@127.0.0.1:55442/shenacare_test?connection_limit=5&connect_timeout=30 NODE_ENV=test npx jest --runInBand --forceExit`).
  - `shenacare_c0_test` — browser walkthrough DB (migrated + `npm run seed` + staff via `npm run staff:provision`).
- Preview configs `c0-api` (3111), `c0-web` (3112), `c0-business` (3120) in `.claude/launch.json` call a scratchpad launcher that forces the local DB.
- Staff test accounts (`founder@c0.local`, `hub@c0.local`, `hub2@c0.local`, `supplier@c0.local`, `driver@c0.local`, `driver2@c0.local`); password kept only in the session scratchpad, not in the repo.
- `POST /accounts/login` is rate-limited to 5 per 5 minutes per IP — reuse sessions during walkthroughs.

## Known issues / notes

- Windows host: first DB query after an API watch-restart can fail with "Can't reach database server" (transient; retry passes). Same flake recorded in W0/C1.
- Pre-existing ESLint errors in touched files are unchanged (e.g. `ordering.service.ts` 9 = HEAD 9).
- Delivery fee is `DELIVERY_FEE_EGP` (provisional 50); no free-shipping threshold exists. Final shipping policy = owner decision.

## Not yet done

- `next build` for apps/web and apps/business (stop dev servers first — same `.next` dir).
- Final GLO-232 acceptance report document; owner hand-off list.

## Owner / external items (NOT VERIFIED, cannot be done in software)

- Thermal printer output and Code128 scanability on the real printer and scanner.
- Physical supplier pickup, physical cash handover/count.
- SMS provider: phone OTP fails closed outside dev/test, so cross-device order access via phone is blocked in production until a provider is connected.
- Owner policies still open: delivery fee (`DELIVERY_FEE_EGP`, provisional 50), cash variance tolerance, retry limit, service polygons, phone-based guest order adoption (implemented; confirm acceptable).

## Next executable action

Stop preview servers, run `npm run build` in apps/web and apps/business, write `docs/verification/GLO-232_C0_ACCEPTANCE.md` from this file, commit.

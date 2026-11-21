# Capital Partner Portal

A read-only portal inside the Business app (`/partner`) for the single capital partner (MVP), plus the Admin controls that record what is actually paid to them. It adds **no financial formula**: every figure is read from the approved finance model (`profit-model.ts`, assembled by `ProfitService`, frozen at month close) and the platform's existing records.

## 1. Business model (unchanged, approved)

- The partner funds product purchases and the agreed direct operating costs, gets that capital back, and receives a share of the distributable profit.
- Distributable profit = net sales (after discounts and coupons) + delivery revenue − actual product cost − actual delivery − packaging − confirmed damages − approved DIRECT costs.
- The platform takes a percentage of it (Admin Settings, currently 40 %); the partner receives the rest (60 %). The platform's own technical expenses (`kind = PLATFORM`) are shown to Admin, never deducted from the shared profit, and never shown to the partner.
- Sound returns go back to stock (not a loss). A loss exists only when an Admin confirms damage.
- **Capital recovered is separate from profit; cash collection is separate from accounting profit.** A capital return is never counted as profit and a profit payout never reduces capital.

Reference scenario (asserted by `capital-partner-portal.e2e-spec.ts`): sales 1,000, coupon 100, delivery fee collected 35, purchase cost 700, actual delivery 25, packaging 10 → net sales 900 + 35 − 700 − 25 − 10 = **200** distributable; platform 40 % = **80**; partner 60 % = **120**.

## 2. Pages (Business app, Arabic RTL, mobile responsive)

| Route | Content |
|---|---|
| `/partner` Overview | Period filter (1/3/6/12 months or a custom month range). Headline strip (capital funded, not yet returned, partner share, remaining). Capital breakdown, profit breakdown, cash (in courier custody, expected on road, disputed, counted / declared / variance), monthly summary, latest movements. |
| `/partner/ledger` Capital & movements | Statement of account: date, type, amount, status, order number / reference, source. Filters (dates, type, status), search (order number / reference), pagination, a detail drawer per movement. |
| `/partner/settlements` Profits & settlements | One card per month with the numbered monthly statement (1 sales after discounts … 12 capital recovered, shown apart), the orders that formed the numbers, payouts, and a link to the month's movements. |

Statuses always carry words: **مستحق** (due), **مدفوع** (paid), **مدفوع جزئيًا**, **غير مسوّى** (cash still with the courier), **معلق** (costs missing: no number is shown, never an estimate).

Admin side: a *Capital partner* panel on `/admin/finance` (designate the partner, record a payment, void a payment). Team page: the new role is selectable; it cannot be combined with Admin.

## 3. Data model (additive migration `20261121120000_capital_partner_portal`)

- `accounts.Role` gains `CAPITAL_PARTNER`.
- `operations.capital_partners`: the partner profile (`account_id` → the staff login). A partial unique index allows exactly one **active** partner.
- `operations.capital_partner_entries`: money actually paid to the partner, **append-only** (void with a reason, never edit). `kind` = `CAPITAL_RETURN` | `PROFIT_PAYOUT` (a payout names the profit month). CHECK constraints: amount > 0, known kind, well-formed period, payout has a period, void fields all-or-none. `idempotency_key` is unique: a retried request is the same payment.

Nothing else is stored. Purchases, costs, expenses, settlements, returns, damages and profit stay in their owner tables; the portal reads them.

## 4. API

Partner (`@Roles('CAPITAL_PARTNER')`, plus an **active partner profile found from the signed-in account**: no partner id exists in any route, so there is nothing to forge):

`GET /capital-partner/me` · `/overview?from=YYYY-MM&to=YYYY-MM` · `/movements?from&to&type&status&q&limit&offset` · `/movements/:id` · `/statements?from&to` · `/statements/:period`

Admin (`@Roles('ADMIN')`): `GET|PUT /operations/finance/capital-partner` · `POST …/deactivate` · `GET|POST …/entries` · `POST …/entries/:id/void`.

Rules enforced on recording a payment (under one advisory lock, with the checks and the insert in one transaction):

- `PROFIT_PAYOUT`: the month must be COMPLETE; amount ≤ partner share of the **cash that was counted** − already paid for that month.
- `CAPITAL_RETURN`: amount ≤ capital funded − capital already returned.
- date not in the future; amount > 0 with at most 2 decimals; idempotency key reuse with different content → 409.

## 5. Movements (one source record → exactly one movement)

`PURCHASE` (Buy List batch cost / supplier invoice lot) · `DIRECT_EXPENSE` (DIRECT only; *pending approval* is listed but not counted) · `DELIVERY_COST` · `PACKAGING_COST` · `CAPITAL_RETURN` · `PROFIT_PAYOUT` · `SOUND_RETURN` · `DAMAGED_RETURN` · `DAMAGE` · `CANCELLED_ORDER` (goods recoverable, not a loss) · `CASH_SETTLEMENT` (counted / declared / variance on the settlement) · `CASH_PENDING` (declared and not yet counted, or disputed).

Each movement has a stable id (`<source>:<record id>`), an `effect` (`FUNDED` / `RETURNED` / `INFO` — only FUNDED and RETURNED are ever summed), and a status. An amount that cannot be known (a returned unit with no recorded cost) is `null` with status `COST_MISSING`.

Capital funded = product purchases + actual delivery + packaging + approved DIRECT expenses, by the date each was recorded. Overview totals are computed from the very movements the ledger lists.

## 6. Security

- Role `CAPITAL_PARTNER` is separate from `HUB_OPERATOR`: one person may hold both (a plain link switches workspace), every guard checks its own role. It **cannot** be combined with `ADMIN` (the partner is paid and has costs approved by an Admin) nor with SUPPLIER / DRIVER.
- The partner can read only: no endpoint under `/capital-partner` writes. Rates, costs, refunds, expense approval and settlements stay Admin / Hub.
- No customer personal data: orders appear as order numbers only.
- A deactivated profile, or a login with the role but no active profile, gets `403 NOT_A_CAPITAL_PARTNER`.

## 7. What is deliberately not here

No multi-partner marketplace, no automatic money transfer, no loss carry-forward, no change to any profit formula or closed month. Open decisions inherited from the finance closure (loss carry-forward, mid-month percentage change) are unchanged.

## 8. Operating it

```
STAFF_PASSWORD='…' npm run staff:provision -- --email partner@… --name "Capital Partner" --role CAPITAL_PARTNER
```
creates the login and designates the profile (or use Admin → Team, then Admin → Finance → *Capital partner* → *Designate*). Payments are recorded from Admin → Finance. Tests: `npx jest --runInBand test/integration/capital-partner-portal` (disposable `*_test` database).

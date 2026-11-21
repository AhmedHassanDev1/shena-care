# ShinaCare — financial scenarios: expected vs actual (before and after the closure fixes)

Branch `fix/financial-closure`, 2026-11-21. Suite: `apps/api/test/integration/financial-audit-scenarios.e2e-spec.ts` (13 tests, all green).
Database: disposable local `auto_dispatch_test` (a shared scratch database: every figure is a before/after **difference**, so other data never matters). Sourcing: `INTERNAL_BUY_LIST`.
**Before** = the run of 2026-11-20 on the code before the fixes (67 values). **After** = the same 13 scenarios on the fixed code (98 values: the original 67 plus 31 added to pin B2–B5).

## الملخص التنفيذي (بالعربي)

- الـ13 سيناريو مالي اتشغّلوا تاني بنفس التدفق الحقيقي (سلة ← أوردر ← شراء ← استلام ← تجهيز ← مشوار ← تسليم ← عدّ الكاش ← تقارير الأدمن) على قاعدة بيانات محلية معزولة.
- **قبل الإصلاح**: 67 قيمة، 46 مطابقة و**21 مختلفة**. **بعد الإصلاح**: 98 قيمة (الـ67 + 31 قيمة جديدة بتثبّت الإصلاحات)، **98 مطابقة و0 فرق متبقّي**.
- من الـ21 فرق: **17 اتقفلوا بنفس القيمة المتوقعة** (كوبون الطلب بيتخصم، إيراد التوصيل بند مستقل وتكلفة المندوب كاملة، كارت «تحصيل لم يُسوَّ» بيعرض الكاش اللي مع المندوب، رفض الاسترداد الزائد 250 على مرتجع بـ100، حفظ مبلغ المندوب المُعلن مقابل المعدود وتسجيل العجز على التسوية، وإرجاع الوحدة المرتجعة السليمة للمخزون).
- **9 صفوف اتغيّر «المتوقع» بتاعها** لأن قراراتك المعتمدة غيّرت التعريف نفسه، مش عشان تطابق الكود: خصم الصنف (compare-at) معلومة مش خصم يتخصم تاني، تكلفة التوصيل التقديرية من عرض السعر بتتعلّم «تقديرية» ومش بتتكتب كفعلية، بضاعة اتشرت لأوردر ملغي أو مرتجع **مش خسارة تلقائية** (التلف المؤكد من الأدمن بس هو الخسارة)، وعجز المندوب مابيتحمّلش على أوردر معيّن من غير دليل. كل واحد منهم موضّح في الجدول التالي بسببه.
- **الربح المرجعي**: الربح القابل للتوزيع للأوردر المرجعي (مبيعات 1,000، كوبون 100، رسوم توصيل 35، شراء 700، توصيل فعلي 25، تغليف 10) = **200** والنظام بقى بيعرض **200** (كان 290). مع نسبة 40%: المنصة 80 والشريك 120.
- ما اتجرّبش في السيناريوهات: لوحة المتصفح بالبيانات الحقيقية اتفحصت (انظر `final-e2e-report.md`)؛ إدخال «استلام المرتجع» في FIN-07 اتعمل بإدخال سجل الفحص مباشرة في القاعدة (مسار الفحص نفسه مغطّى في `hub-corrections-returns`).

## Before → after, in one table

| | Before | After |
|---|---:|---:|
| Scenarios | 13 | 13 |
| Values compared with the hand calculation | 67 | 98 |
| PASS | 46 | **98** |
| FAIL | 21 | **0** |
| Reference order: distributable profit shown (hand: 200) | 290 | **200** |

## Ideals that were re-defined by the approved decisions (not to fit the code)

| Row | Metric | Before ideal | After ideal | Why the definition changed |
|---|---|---:|---:|---|
| FIN-02e | `summary.sales.discounts` for a compare-at (list-price) saving | 100 | 0 | The saving is already inside the selling price; counting it again would deduct it twice. Only coupons are discounts. The saving is shown separately as information (`listPriceSaving`, new row FIN-02g = 100) |
| FIN-04a | courier cost "recorded automatically" from the quote | 35 | 0 | Decision: use the **actual** delivery cost when present, keep the quote as an **estimate**. The quote is never written into the cost record as if it were actual (`delivery.estimatedOrders`, rows FIN-04c/d/e/f) |
| FIN-05a | loss booked for goods bought for a cancelled order | 280 | 0 | Decision: goods bought for a cancelled order are reusable, not an automatic loss. They are shown as capital tied up in recoverable goods (FIN-05c = 280). Only an Admin-confirmed damage is a loss (FIN-05d–h) |
| FIN-05b | profit effect of that cancellation | −280 | 0 | same decision |
| FIN-05c | what the summary shows for it | −280 | 280 (as "capital tied up in recoverable goods") | same decision |
| FIN-06b | effect of a failed delivery closed as returned | 135 loss | −35 (courier 25 + packaging 10) | The 100 of goods are back in stock (recoverable). Only the real expenses the failed trip caused are counted |
| FIN-09b-a | order's collected cash on the hub-desk settlement round (declared 235, counted 200) | 200 | 235 | Decision: no shortage is pushed onto an individual order without supporting data and the amount the customer paid is never reduced because of the courier's shortage |
| FIN-09b-b | the order is marked `short` | 1 | 0 | same decision |
| FIN-09b-d | the counted-cash figure | 200 | 235 on the order, **200 as the hub's counted cash** (FIN-09b-c) and **−35 variance on the settlement** (FIN-09b-e) | The counted amount, the declared amount and the difference now live on the settlement |

## How to read the ledger

*Ideal* is worked out by hand in the test comments **before** looking at any report, from the approved model:
**distributable profit = net sales + shipping revenue − actual product cost − delivery − packaging − confirmed damages − approved direct costs**.
*Before* is the figure the old code produced; *After* is the figure the fixed code produces. `PASS` = after equals ideal.
Sources: `profit` = `/operations/finance/profit`, `summary` = `/operations/finance/summary`, `overview` = `/operations/dashboard/overview`.

## Ledger (generated by the suite; before column from the 2026-11-20 run)

#### FIN-01

| ID | Metric | Ideal (hand, approved model) | Before | After | Verdict | Note |
|---|---|---:|---:|---:|---|---|
| FIN-01a | order.subtotal (goods before order discount) | 1000 | 1000 (PASS) | 1000 | **PASS** |  |
| FIN-01b | order.shippingFee | 35 | 35 (PASS) | 35 | **PASS** |  |
| FIN-01c | order.totalAmount = 1000 − 100 + 35 | 935 | 935 (PASS) | 935 | **PASS** |  |
| FIN-01d | order.codAmount | 935 | 935 (PASS) | 935 | **PASS** |  |
| FIN-01e | Σ orderItem.lineTotal − coupon (the order discount is order-level, never allocated to lines; reports deduct it) | 900 | 1000 (FAIL) | 900 | **PASS** | lines keep the pre-coupon price by design; the 100 lives in order.appliedPromotions and every report subtracts it |
| FIN-01f | courierCost kept as recorded by hand (nothing overwrites it) | 25 | 25 (PASS) | 25 | **PASS** |  |
| FIN-01g | profit.revenue.netSales (net sales after the order discount) | 900 | 1000 (FAIL) | 900 | **PASS** |  |
| FIN-01h | profit.costs.products (COGS) | 700 | 700 (PASS) | 700 | **PASS** |  |
| FIN-01i | profit.costs.packaging | 10 | 10 (PASS) | 10 | **PASS** |  |
| FIN-01j | profit.costs.delivery (actual cost 25 is shown; the 35 fee is revenue, not netted) | 25 | 0 (FAIL) | 25 | **PASS** |  |
| FIN-01k | distributable profit (900 + 35 − 700 − 25 − 10) | 200 | 290 (FAIL) | 200 | **PASS** |  |
| FIN-01l | summary.sales.netSales (net sales after the coupon) | 900 | 1000 (FAIL) | 900 | **PASS** |  |
| FIN-01m | summary.sales.discounts (order-level 100) | 100 | 0 (FAIL) | 100 | **PASS** |  |
| FIN-01n | summary.sales.shippingRevenue | 35 | 35 (PASS) | 35 | **PASS** |  |
| FIN-01o | summary.sales.billedTotal | 935 | 935 (PASS) | 935 | **PASS** |  |
| FIN-01p | summary gross profit in INTERNAL_BUY_LIST (net sales − product cost) | 200 | null (FAIL) | 200 | **PASS** |  |
| FIN-01q | overview.netRealizedSales (goods net of discount, fee excluded) | 900 | 900 (PASS) | 900 | **PASS** |  |
| FIN-01r | cash the hub counted (summary.cash.settlements.counted) | 935 | 935 (PASS) | 935 | **PASS** |  |
| FIN-01s | cash still in the courier custody after the count | 0 | 0 (PASS) | 0 | **PASS** |  |
| FIN-01t | overview cash card: in courier custody while declared but not counted | 935 | 0 (FAIL) | 935 | **PASS** | the Admin Overview card now reads the shared cash position |
| FIN-01u | summary cash in custody while declared, not counted | 935 | 935 (PASS) | 935 | **PASS** |  |
| FIN-01w | a delivered order keeps its cost: a damage cannot be confirmed on it | 409 | — (new row) | 409 | **PASS** |  |
| FIN-01v | declared cash is not also counted as expected-on-road (no double counting) | 0 | — (new row) | 0 | **PASS** |  |

#### FIN-02

| ID | Metric | Ideal (hand, approved model) | Before | After | Verdict | Note |
|---|---|---:|---:|---:|---|---|
| FIN-02a | order.subtotal (5 × 100) | 500 | 500 (PASS) | 500 | **PASS** |  |
| FIN-02b | Σ orderItem.discountAmount (5 × (120 − 100), informational) | 100 | 100 (PASS) | 100 | **PASS** |  |
| FIN-02c | profit.revenue.netSales | 500 | 500 (PASS) | 500 | **PASS** |  |
| FIN-02d | summary.sales.netSales | 500 | 500 (PASS) | 500 | **PASS** |  |
| FIN-02e | summary.sales.discounts (coupons only: the compare-at saving is already inside the price, so it is never deducted again) | 0 | 100 (PASS) | 0 | **PASS** | ideal redefined (was 100) |
| FIN-02f | distributable profit | 150 | 140 (FAIL) | 150 | **PASS** |  |
| FIN-02g | orders list shows the compare-at saving as information only (listPriceSaving) | 100 | — (new row) | 100 | **PASS** |  |

#### FIN-03

| ID | Metric | Ideal (hand, approved model) | Before | After | Verdict | Note |
|---|---|---:|---:|---:|---|---|
| FIN-03a | order.shippingFee with a free-shipping promotion | 0 | 0 (PASS) | 0 | **PASS** |  |
| FIN-03b | profit.costs.delivery | 25 | 25 (PASS) | 25 | **PASS** |  |
| FIN-03c | distributable profit | 115 | 115 (PASS) | 115 | **PASS** |  |
| FIN-03d | delivery margin (shipping revenue 0 − delivery cost 25) | -25 | — (new row) | -25 | **PASS** |  |

#### FIN-04

| ID | Metric | Ideal (hand, approved model) | Before | After | Verdict | Note |
|---|---|---:|---:|---:|---|---|
| FIN-04a | the quote is never written into the cost record as if it were actual (courierCost stays empty) | 0 | 35 (PASS) | 0 | **PASS** | ideal redefined (was 35) — the estimate is read from the checkout quote and labelled |
| FIN-04b | distributable profit (delivery counted at the quote estimate) | 150 | 150 (PASS) | 150 | **PASS** |  |
| FIN-04c | profit.delivery.estimatedOrders (the delivery cost is marked estimated) | 1 | — (new row) | 1 | **PASS** |  |
| FIN-04d | profit.delivery.estimatedAmount | 35 | — (new row) | 35 | **PASS** |  |
| FIN-04e | once the actual cost 20 is recorded it replaces the estimate (400 − 240 + 35 − 20 − 10) | 165 | — (new row) | 165 | **PASS** |  |
| FIN-04f | no estimated order is left | 0 | — (new row) | 0 | **PASS** |  |

#### FIN-05

| ID | Metric | Ideal (hand, approved model) | Before | After | Verdict | Note |
|---|---|---:|---:|---:|---|---|
| FIN-05a | profit.costs.damages (goods bought for a cancelled order are not an automatic loss) | 0 | 280 (PASS) | 0 | **PASS** | ideal redefined (was 280) |
| FIN-05b | effect on the distributable profit | 0 | -280 (PASS) | 0 | **PASS** | ideal redefined (was -280) |
| FIN-05c | capital tied up in recoverable goods (shown, not deducted) | 280 | null (FAIL) | 280 | **PASS** | ideal redefined (was -280) |
| FIN-05i | a damage above what was paid for the goods (280) is refused | 400 | — (new row) | 400 | **PASS** |  |
| FIN-05j | only an Admin confirms a damage | 403 | — (new row) | 403 | **PASS** |  |
| FIN-05d | confirm damage → accepted | 200 | — (new row) | 200 | **PASS** |  |
| FIN-05e | profit.costs.damages after the confirmation | 280 | — (new row) | 280 | **PASS** |  |
| FIN-05f | distributable profit after the confirmation | -280 | — (new row) | -280 | **PASS** |  |
| FIN-05g | recoverable goods after the confirmation | 0 | — (new row) | 0 | **PASS** |  |
| FIN-05k | the same confirmation sent again is a harmless replay | 200 | — (new row) | 200 | **PASS** |  |
| FIN-05l | the replay does not count the damage twice | 280 | — (new row) | 280 | **PASS** |  |
| FIN-05h | a second, different confirmation is refused (counted at most once) | 409 | — (new row) | 409 | **PASS** |  |

#### FIN-06

| ID | Metric | Ideal (hand, approved model) | Before | After | Verdict | Note |
|---|---|---:|---:|---:|---|---|
| FIN-06a | COD collection after the order is returned | 0 | 0 (PASS) | 0 | **PASS** | status voided |
| FIN-06b | effect on the distributable profit (courier 25 + packaging 10; goods are recoverable) | -35 | 135 (PASS) | -35 | **PASS** | ideal redefined (was 135) |
| FIN-06c | orders counted as sales | 0 | 0 (PASS) | 0 | **PASS** |  |
| FIN-06d | capital tied up in the recoverable goods | 100 | — (new row) | 100 | **PASS** |  |
| FIN-06e | profit.costs.damages | 0 | — (new row) | 0 | **PASS** |  |

#### FIN-07

| ID | Metric | Ideal (hand, approved model) | Before | After | Verdict | Note |
|---|---|---:|---:|---:|---|---|
| FIN-07a | refund above the value of the returned item (1 unit = 100) is refused | 400 | 201 (FAIL) | 400 | **PASS** | code REFUND_EXCEEDS_GOODS |
| FIN-07f | the exact refund of 100 is accepted | 201 | — (new row) | 201 | **PASS** |  |
| FIN-07g | a duplicate refund request for the same return is refused | 400 | — (new row) | 400 | **PASS** |  |
| FIN-07b | profit.revenue.productRefunds | 100 | 250 (FAIL) | 100 | **PASS** |  |
| FIN-07c | summary.sales.productRefunds | 100 | 250 (FAIL) | 100 | **PASS** |  |
| FIN-07d | overview.netRealizedSales (400 − refund) | 300 | 150 (FAIL) | 300 | **PASS** |  |
| FIN-07e | returned sealed unit re-enters stock (COGS adjusted) | 180 | 240 (FAIL) | 180 | **PASS** |  |
| FIN-07h | distributable profit (300 + 35 − 180 − 25 − 10) | 120 | — (new row) | 120 | **PASS** |  |

#### FIN-08

| ID | Metric | Ideal (hand, approved model) | Before | After | Verdict | Note |
|---|---|---:|---:|---:|---|---|
| FIN-08a | collection after DELIVERED is "collected" (declared, not counted) | 0 | 0 (PASS) | 0 | **PASS** |  |
| FIN-08b | profit page cash.inCourierCustody | 235 | 235 (PASS) | 235 | **PASS** |  |
| FIN-08c | Admin Overview «تحصيل لم يُسوَّ» (cash in courier custody) | 235 | 0 (FAIL) | 235 | **PASS** |  |
| FIN-08d | summary cash.inCourierCustody | 235 | 235 (PASS) | 235 | **PASS** |  |
| FIN-08e | cash counted so far | 0 | 0 (PASS) | 0 | **PASS** |  |
| FIN-08f | the same cash is not also "expected on the road" | 0 | — (new row) | 0 | **PASS** |  |
| FIN-08g | profit not yet payable (the order awaits its cash count) | 1 | — (new row) | 1 | **PASS** |  |

#### FIN-09

| ID | Metric | Ideal (hand, approved model) | Before | After | Verdict | Note |
|---|---|---:|---:|---:|---|---|
| FIN-09a | collection.collectedAmount equals what the hub counted (200) | 200 | 200 (PASS) | 200 | **PASS** | HTTP 201; status short; declared 235 |
| FIN-09c | settlement.totalDeclared keeps what the courier declared (235) | 235 | — (new row) | 235 | **PASS** |  |
| FIN-09d | settlement.variance = counted − declared (the shortage is recorded at settlement level) | -35 | — (new row) | -35 | **PASS** |  |

#### FIN-09b

| ID | Metric | Ideal (hand, approved model) | Before | After | Verdict | Note |
|---|---|---:|---:|---:|---|---|
| FIN-09b-a | the order keeps the amount the customer paid / the courier declared (235); no shortage is pushed onto it | 235 | 235 (FAIL) | 235 | **PASS** | ideal redefined (was 200) — status settled; declared 235 |
| FIN-09b-b | the order is not marked "short" without order-level evidence | 0 | 0 (FAIL) | 0 | **PASS** | ideal redefined (was 1) |
| FIN-09b-c | summary cash counted (what the hub physically counted) | 200 | 235 (FAIL) | 200 | **PASS** |  |
| FIN-09b-d | summary cash declared by the courier | 235 | 235 (FAIL) | 235 | **PASS** | ideal redefined (was 200) |
| FIN-09b-e | settlement variance (counted − declared) | -35 | -35 (PASS) | -35 | **PASS** |  |
| FIN-09b-f | the batch stores the counted amount (200) | 200 | — (new row) | 200 | **PASS** |  |
| FIN-09b-i | the batch stores the declared amount (235) | 235 | — (new row) | 235 | **PASS** |  |
| FIN-09b-g | the shortage (counted 200 vs declared 235) is on the settlement batch | -35 | — (new row) | -35 | **PASS** | recorded at settlement level only |
| FIN-09b-h | cash left in the courier custody after the round | 0 | — (new row) | 0 | **PASS** |  |

#### FIN-10

| ID | Metric | Ideal (hand, approved model) | Before | After | Verdict | Note |
|---|---|---:|---:|---:|---|---|
| FIN-10a | three concurrent DELIVERED events → one delivery event | 1 | 1 (PASS) | 1 | **PASS** | statuses 409,409,201 |
| FIN-10b | one cost record, courier cost recorded once | 25 | 25 (PASS) | 25 | **PASS** |  |
| FIN-10c | two concurrent counts with different references settle once | 1 | 1 (PASS) | 1 | **PASS** | statuses 409,201 |
| FIN-10d | COGS counted once | 100 | 100 (PASS) | 100 | **PASS** |  |
| FIN-10e | cash counted once (summary.cash.settlements.counted) | 235 | 235 (PASS) | 235 | **PASS** |  |
| FIN-10f | the cash in custody is not counted twice either | 0 | — (new row) | 0 | **PASS** |  |

#### FIN-11

| ID | Metric | Ideal (hand, approved model) | Before | After | Verdict | Note |
|---|---|---:|---:|---:|---|---|
| FIN-11a | summary: order at 23:59:59.999 Cairo on Jan 31 belongs to January | 1 | 1 (PASS) | 1 | **PASS** |  |
| FIN-11b | summary: order at 00:00:00.000 Cairo on Feb 1 belongs to February | 1 | 1 (PASS) | 1 | **PASS** |  |
| FIN-11c | profit: January has the first order only | 1 | 1 (PASS) | 1 | **PASS** |  |
| FIN-11d | profit: February has the second order only | 1 | 1 (PASS) | 1 | **PASS** |  |
| FIN-11e | rounding: 3 × 33.33 = 99.99 in summary net sales | 99.99 | 99.99 (PASS) | 99.99 | **PASS** |  |
| FIN-11f | rounding: 3 × 33.33 = 99.99 in profit net sales | 99.99 | 99.99 (PASS) | 99.99 | **PASS** |  |

#### FIN-12

| ID | Metric | Ideal (hand, approved model) | Before | After | Verdict | Note |
|---|---|---:|---:|---:|---|---|
| FIN-12a | COGS = 2 × 60 + 2 × 80 | 280 | 280 (PASS) | 280 | **PASS** |  |
| FIN-12b | distributable profit (400 + 35 − 280 − 25 − 10) | 120 | 110 (FAIL) | 120 | **PASS** |  |

## What closed each root cause

| Root cause (audit finding) | Closed by | Rows |
|---|---|---|
| FIN-F1 order-level discount not deducted | net sales = what the customer was billed for goods (order total − delivery fee), coupons pro-rated across lines for refunds | FIN-01e, 01g, 01k, 01l, 01m |
| FIN-F6 delivery surplus dropped | delivery revenue and delivery cost are separate lines; `delivery.margin` | FIN-01j, FIN-02f, FIN-03d, FIN-12b |
| FIN-F5 `summary` cannot compute in Buy List mode | `summary` now returns the same figures as the Finance page | FIN-01p |
| FIN-F2 Overview card ignores declared cash | one shared cash position (`readCashPosition`): expected on the road / declared in courier custody / disputed / counted | FIN-01s–v, FIN-08b–g, FIN-10f |
| FIN-F3 rounds settlement stores declared, not counted | settlement keeps `totalDeclared`, `totalCollected` (counted) and `variance`; no shortage on an order | FIN-09c–d, FIN-09b-a…i |
| FIN-F4 refund unbounded | refund capped by goods, delivery fee and cash received, inside one transaction holding the order row lock | FIN-07a, 07f, 07g |
| FIN-F7 returned/cancelled goods booked as lost | recoverable goods vs Admin-confirmed damage; a sealed returned unit reverses its cost | FIN-05, FIN-06, FIN-07e, FIN-07h |

## Not covered by these 13 scenarios (covered elsewhere or not run)

- Refund edge cases (coupon pro-rata, delivery-fee-only refund, concurrent and duplicate requests, failed refund releasing balance, no-cash and cash-received cap): `refund-caps.e2e-spec.ts` (9 tests).
- Expense kind/approval and the `DUPLICATES_ORDER_COST` rule, empty periods, series and transactions: `admin-finance.e2e-spec.ts`; month close (`PERIOD_INCOMPLETE`, `PERIOD_CASH_PENDING`, frozen percentage): `profit-share.e2e-spec.ts`; the pure model: `profit-model.spec.ts`.
- Not run: refunds in an already closed month, supplier-PO money flow (out of MVP scope), production-sized data volumes.

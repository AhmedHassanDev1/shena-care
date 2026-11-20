# ShinaCare — Financial logic and reporting audit (read from the code, verified on data)

Branch `qa/e2e-lifecycle-audit`, 2026-11-20. **Nothing financial was changed**: no formula, no data, no setting. The only additions are a test suite
(`apps/api/test/integration/financial-audit-scenarios.e2e-spec.ts`) and these reports. Every number below marked "verified" was produced by that suite on a
disposable database (`fin_audit_test`), with real HTTP, the MVP's `INTERNAL_BUY_LIST` sourcing, and the three Admin report sources.

## الملخص التنفيذي (بالعربي)

- **اللي بيظهر في صفحة «المالية» للأدمن**: الإيراد، التكاليف الفعلية، صافي الربح، حصة الأرباح، «تحصيل لم يُسوَّ»، المصروفات. كلهم من تقرير واحد اسمه `profit`. تقرير `summary` موجود في الـAPI بس مفيش أي شاشة بتعرضه، ولا يقدر يحسب ربح أصلاً في وضع «قائمة الشراء الداخلية» لأنه بيقرأ فواتير موردين ما بنستخدمهاش.
- **أرقام التكاليف موثوقة**: سعر الشراء بيتسجل فعلياً لكل عملية شراء (مع خصم المورد)، وتكلفة التغليف والتوصيل بتتسجل لكل أوردر، والنظام مش بيحط صفر مكان رقم ناقص — بيعرض «غير مكتمل».
- **لكن رقم الربح مش موثوق 100% دلوقتي**، لأربع أسباب اتأكدت منها بأرقام (طلب بـ1,000 جنيه، خصم 100، شراء 700، توصيل 35 محصّل و25 فعلي، تغليف 10):
  1. **خصم الكوبون على مستوى الطلب مش بيتخصم من المبيعات في تقرير الربح**: الربح الصحيح 200 والنظام بيعرض 290.
  2. **شاشة النظرة العامة «تحصيل لم يُسوَّ» مش بتحسب الكاش اللي المندوب سلّمه ولسه ما اتعدّش** (بتعرض 0 بدل 935).
  3. **تسوية الكاش من شاشة المخزن بتسجل على الأوردر المبلغ اللي المندوب أعلنه مش المبلغ اللي اتعدّ فعلاً**؛ العجز بيظهر على مستوى التسوية بس، فتقارير «المحصّل» ممكن تزيد عن الكاش الحقيقي.
  4. **الاسترداد ممكن يتسجل بأي مبلغ لحد إجمالي الأوردر**، حتى لو الصنف المرتجع تمنه 100 والمبلغ 250.
- لا يوجد في اللي اتجرّب **P0** (فقدان فلوس أو فساد بيانات). التوصية: **READY WITH BLOCKERS** — أربع إصلاحات صغيرة قبل الإطلاق (تفاصيلها في `production-readiness.md`)، ولا تحتاج نظام محاسبي جديد.
- **مطابقة نموذج توزيع الأرباح (القسم 9، أُضيف بعد توضيحك)**: النظام الحالي بيطبّق جزء من النموذج بس. **مطبّق**: تكلفة البضاعة الفعلية، التغليف، منع الازدواج، تثبيت النسبة عند قفل الشهر، وفصل الربح عن التحصيل النقدي. **غير مطبّق**: خصم الكوبون، إيراد التوصيل كبند مستقل، «التالف»، «التكاليف المباشرة المعتمدة» (كل المصروفات بتتخصم من غير تصنيف ولا اعتماد)، ونصيب مسؤول المخزن (بيتعرض نصيب واحد بس)، وإرجاع المرتجع السليم للمخزون (بيتسجل خسارة). **الربح الموزَّع الصحيح للأوردر المرجعي 200 والنظام بيعرض 290.**
- ممنوع التنفيذ قبل موافقتك: كل المعادلات والتعريفات المقترحة هنا مجرد مقترحات. **ولم يُغيَّر أي منطق لتوزيع الأرباح.**

---

## 1. How money moves, stage by stage

Legend: **S** stored when the event happens · **C** computed when a report is asked · all amounts `Decimal(10,2)` in the database, integer cents in the report code.

| # | Stage | Money data | Model.field (schema line) | Created / changed by | S / C | Changeable later? | Cancel / return | Double-count risk |
|---|---|---|---|---|---|---|---|---|
| 1 | **Order created** | Unit price, list-vs-price saving, line total; subtotal; delivery fee; total; COD amount; applied promotions | `OrderItem.price/discountAmount/lineTotal` (schema 1518), `Order.subtotal/shippingFee/totalAmount/codAmount/appliedPromotions` (1431); `CheckoutQuote.snapshot` JSON incl. `deliveryFeeBase`, `deliveryDiscount` (1400) | `OrdersService.currentSnapshot` (`ordering.service.ts` 118–168) prices lines and the fee; checkout creates the order (`ordering.service.ts` ≈317–345) from the accepted quote | S | Only through the customer-agreed availability amendment workflow; Hub/Delivery cannot edit | Cancel keeps the row, status `cancelled` | No: one order per idempotency key |
| 1a | Item "discount" | `discountAmount = (compareAt − price) × qty`: **informational**, already inside `price` | `OrderItem.discountAmount` | `currentSnapshot` line 130 | S | No | – | A reader can subtract it twice (FIN-02e) |
| 1b | **Order-level promotion** | Coupon / automatic discount | **Only** `Order.appliedPromotions[].valueApplied` (JSON); `Order.subtotal` and every `lineTotal` stay *before* the discount | `PromotionService.evaluatePromotions` (`promotion.service.ts` 116–216) → `finalSubtotal = subtotal − orderDiscountAmount`, `totalAmount = finalSubtotal + shippingFee` | S (JSON) | No | – | See finding **FIN-F1** |
| 1c | Customer delivery fee | distance band minus invoice-size discount, free above a threshold | `Order.shippingFee`; base fee and the company's part in `CheckoutQuote.snapshot.deliveryFeeBase/deliveryDiscount` | `computeDeliveryFee` (`delivery-fee.ts` 80–92) | S | No | – | – |
| 2 | **Confirmed / sourcing** | Demand per SKU, no money | `SupplyRequirement` | `order.placed` event → supply plan | S | Released on cancel | `releaseForCancelledOrder` (`supply-plan.service.ts` ≈439) | – |
| 3 | **Procurement (Buy List)** | Real purchase cost per purchase batch: list price, supplier discount, final unit cost; every order line covered inherits it | `PurchaseCostBatch.listUnitPrice/discountPerUnit/finalUnitCost/history` (3934); allocation link `SourceAllocation.evidenceRef = buylist:<key>` (868) | `BuyListService.acquire` (`buy-list.service.ts` 180–230) → `PurchaseCostService.createInTx` (`purchase-cost.service.ts` 41); cost can be entered later (`record` 63) | S | Correctable only with a reason and a version check, previous values kept in `history` (`correct` 83); closed months frozen | Cancelled order: units stay "bought"; `boughtUnits` raises an exception (BUG-08); no re-allocation | One cost per batch; an order line uses Buy List cost first, PO cost only if no Buy List cost (`orderPurchaseCost`) → no double |
| 3b | Procurement (supplier PO, not MVP) | Invoice lots, payable at the PO cost snapshot | `AcquisitionCostLot` (1268), `SupplierPayable` (1317) | `AcquisitionCostService` | S | Frozen snapshot | – | – |
| 4 | **Hub receipt / preparation** | Packaging type + its cost frozen at the Settings price of that moment; order cannot be marked packed without it | `OrderCostRecord.packagingType/packagingCost/...` (3955) | `OrderCostService.record` (`order-cost.service.ts` 61); gate `PackingReadinessService.assertPackable` (`order-profitability.service.ts` 87) | S | Overwrite only by Admin with a reason, logged in `corrections` | Cost stays on the record; counted as a loss if the order is cancelled/returned | – |
| 5 | **Out for delivery** | Expected COD cash fixed per order; the hub that released the run | `PaymentCollection.expectedAmount/locationId/status='expected'` (1868) | `releaseBatch` → `ensureExpectedCollection` (`fulfillment.service.ts` ≈1687; `reconciliation.service.ts` 361) | S | Never rewritten by callers | `voidExpectedCollection` (418) before cash is declared | `ON CONFLICT DO NOTHING` → once |
| 5b | Courier delivery cost (company side) | One cost per order. Manual by Hub/Admin, or automatic at delivery = the quote's `deliveryFeeBase` (fallback Settings value) | `OrderCostRecord.courierCost/courierRecordedBy` | `OrderCostService.record` / `snapshotCourierCost` (117) via `OrderCostDeliveryListener` on `order.delivered` | S | Admin with a reason | Counted in the loss of a cancelled/returned order | Auto never overwrites a manual value (FIN-01f) |
| 6a | **Delivered** | Courier declares the cash at the door; collection → `collected` | `PaymentCollection.declaredAmount/declaredAt/courierId/status='collected'` | `recordDriverDeclaration` (390) inside the DELIVERED event (`fulfillment.service.ts` ≈214–222) | S | Replay returns the same; conflicting rewrite = 409 | – | Concurrent DELIVERED → one event (FIN-10a) |
| 6b | **Failed** | Reason only; order stays `shipped`; cash stays `expected`; parcel stays with the courier | `ShipmentEvent.reasonCode`, `DeliveryStop.status='failed'` | DELIVERED/FAILED events | S | – | – | – |
| 6c | **Returned (given up)** | Collection voided; order `returned`; one human exception | `PaymentCollection.status='voided'` | `fulfillment.service.ts` ≈735 → `voidExpectedCollection` | S | – | Loss = purchase + courier + packaging recorded for the order | – |
| 6d | **Cancelled** | Collection voided; supply released | – | `OrderCancellationService.cancel` | S | – | Same loss rule | Concurrent cancels → once (BUG-06) |
| 7 | **COD settlement** | Hub counts the cash: either per order (`POST settlements/batch`) or one total per courier round (`POST settlements/rounds`) | `CourierSettlementBatch.totalExpected/totalCollected/fees/netSettled` (1893); `PaymentCollection.collectedAmount/status settled|short|over/settlementBatchId` | `createSettlementBatch` (462) and **`settleRound` (585–671)** | S | Reference is the idempotency key; one settlement per collection | – | Concurrent counts → one (FIN-10c) |
| 8 | **Refund** | Resolution then a refund transaction (pending → processing → succeeded/failed); manual COD refund needs a payout reference | `OrderResolution` (1715), `RefundTransaction.amount/status` (1775) | `initiateRefund` (215–270), `updateRefundStatus` (272) | S | Forward-only statuses | The returned goods are **not** valued or restocked anywhere | One refund per resolution (unique) |
| 9 | **Expenses** | Operating expenses, one-off or recurring, voided (never deleted) with a reason | `FinanceExpense` (3880) | `FinanceExpenseService` (create 95, void 112, occurrences 58–92) | S | Void only | – | – |
| 10 | **Reports** | Everything below is **computed at request time** from the rows above; only a closed month is frozen | `FinancePeriodClose.figures` (3978) | `ProfitService.close` (`profit.service.ts` 194–214) | C (S when closed) | Closed month never rewritten | – | See section 3 |

## 2. What the Admin actually sees

| Admin screen | Endpoint | What it shows |
|---|---|---|
| المالية (Finance) `apps/business/app/(workspace)/admin/finance/page.tsx` | `GET /operations/finance/profit?month`, `/profit/trend`, `/expenses` | الإيراد · التكاليف الفعلية · صافي الربح · حصة الأرباح (40 % setting) · تحصيل لم يُسوَّ · monthly trend · expenses |
| النظرة العامة (Overview) `admin/page.tsx` | `GET /operations/dashboard/overview` | order counts and stages, «تحصيل لم يُسوَّ» (`pendingCod`), cash variance cases. **Not rendered even though the API returns them:** `totalRevenue`, `revenueToday`, `netRealizedSales`, `contributionProfit` |
| (no screen) | `GET /operations/finance/summary`, `/series`, `/orders`, `/transactions` | Verified: no Business-app page calls them. They are API-only and still covered by tests (`admin-finance`) |

**Consequence:** the profit number the Admin reads is `ProfitService` (`profit.service.ts` + the pure model `profit-model.ts`). `summary` is an orphan.

## 3. KPI table (every indicator, defined from the code)

Status handled by all three sources: delivered orders only for sales and costs; cancelled/returned only as "losses" in `profit`.
Date basis: **the first `delivered` `OrderStatusEvent`** (`firstEventOrders`, `profit.service.ts` 56–66; `deliveredOrders`, `finance-report.service.ts` 51–76), in Cairo calendar days/months (`finance-dates.ts`); refunds are dated by `RefundTransaction.updatedAt`.
Verified date boundaries: an order delivered at 23:59:59.999 Cairo falls in the earlier day/month and 00:00:00.000 in the next, in both reports (FIN-11a–d).

| # | KPI | Shown as | Current definition and formula | Source | Correct? | Problems found | Proposed (not implemented) |
|---|---|---|---|---|---|---|---|
| 1 | **Gross sales** | not shown; API `summary.sales.goodsRevenue` | Σ `Order.subtotal` of delivered orders (`finance-report.service.ts` 69, 90) | `Order.subtotal` | **Partly**: it is the price before the order discount, which is a fair "gross", but it is *labelled goods revenue* | Not reduced by coupons → reads 1,000 on the reference order whose customer paid 900 for goods | Name it Gross sales; add Discounts and Net sales next to it |
| 2 | **Discounts** | API `summary.sales.discountsGiven` | Σ `OrderItem.discountAmount` (compare-at savings) (`finance-report.service.ts` 70) | `OrderItem` | **No**: ignores the order-level coupon (FIN-01m: 0 vs 100) and is informational for compare-at | Two different meanings, coupon invisible | Discounts = Σ `appliedPromotions[].valueApplied`; show compare-at saving separately as "list-price saving" |
| 3 | **Net sales** | Finance «الإيراد» = `revenue.net` | productSales − refunds, where productSales = Σ delivered `lineTotal` (`profit.service.ts` 96, 107, 123; `profit-model.ts` 81, 110) | `OrderItem.lineTotal` | **No when an order-level discount exists**: FIN-01g 1,000 vs 900 | Overstates revenue and profit by every coupon / automatic order discount. Same bug in `evaluateOrderProfit` / loss flag (`order-profitability.service.ts` 38) | `productSales = Σ (totalAmount − shippingFee)` of delivered orders (net of discount), or allocate the order discount to lines at checkout (decision) |
| 4 | **Shipping revenue** | API `summary.sales.deliveryFeeRevenue`; `profit.delivery.customerFees` (info) | Σ `Order.shippingFee` | `Order.shippingFee` | **Yes (value)**; the *profit model* deliberately does not treat it as revenue | Surplus (fee 35 > cost 25) is dropped from profit: FIN-02f 140 vs 150 | Report delivery margin = fees − courier cost (can be positive) |
| 5 | **Total revenue** | Overview API `totalRevenue` (not rendered) | Σ `totalAmount` of **all orders not cancelled**, all time, any status (`dashboard.service.ts` 129–148) | `Order.totalAmount` | **No** (as a revenue figure): includes placed, shipped, returned, shipping | Would mislead if ever shown | Remove or define as "billed, delivered" |
| 6 | **Collected COD** | Finance page `cod.settled`, summary `cod.reconciled` | Σ `PaymentCollection.collectedAmount` of settled/short/over rows | `PaymentCollection` | **Wrong on the hub-desk path**: the round writes `collectedAmount = declared`, not the counted cash (FIN-09b: 235 reported vs 200 counted) | Settled cash can exceed counted cash; shortage only on the batch | Round must either require per-order counts or distribute the counted total and mark short/over per order |
| 7 | **Outstanding COD** | Finance «تحصيل لم يُسوَّ» = `profit.cod.outstanding`; Overview «تحصيل لم يُسوَّ» = `financialSummary.pendingCod` | Finance: expected + collected + disputed of **delivered orders of that month**; Overview: Σ expected of collections in status `expected` only (`dashboard.service.ts` 438–441, 612–617) | `PaymentCollection` | **Two meanings under one name.** Overview excludes cash the courier already declared (FIN-08c: 0 vs 235); Finance is month-scoped | The headline cash-risk figure hides money in couriers' hands | One definition: expected + collected + disputed, all months, with a split "on the road / declared / counted" |
| 8 | **Refunds** | Finance `revenue.refunds`; summary `costs.refunds` | Σ succeeded `RefundTransaction.amount` with `updatedAt` in the period (profit also requires order still `delivered`) | `RefundTransaction` | **Mechanically yes; the amount is not validated against the returned goods** (FIN-07a: 250 accepted for a 100 return) | Overstates refunds / understates revenue when typed wrongly | Cap a refund at the value of the approved return lines (+ optionally the delivery fee) unless an Admin overrides with a reason |
| 9 | **Cancelled orders** | no KPI; `profit.costs.losses` | Cancelled/returned orders (first such event in the month): purchase cost of units bought + recorded courier + recorded packaging (`profit.service.ts` 112–121) | `OrderCostRecord`, Buy List | **Yes, with a policy**: the bought goods are written off at once, no inventory asset (FIN-05a 280) | Policy D5 undecided | Keep as is for the MVP; track bought-for-cancelled units as "recoverable" until decided |
| 10 | **COGS** | Finance «التكاليف» → purchase | Σ final unit cost of the Buy List purchases that covered the delivered lines (Σ over allocations; prorated if more units were bought than ordered); null if any unit is uncosted (`purchase-cost.service.ts` 165–184; `profit.service.ts` 95–103) | `PurchaseCostBatch` | **Yes** (700 verified, FIN-01h; supplier discount included: list 80 − 10 = 70) | Returned goods keep full COGS | Fine for the MVP |
| 11 | **Delivery cost** | Finance «التكاليف» → company-funded delivery | Σ max(0, courierCost − customerFee) per order (`profit-model.ts` 95–100) | `OrderCostRecord.courierCost` | **Definition**, not arithmetic: 0 when the fee covers the cost (FIN-01j) | Surplus ignored; one cost per order, a failed attempt followed by a retry is not costed twice | Show gross delivery cost and the fee separately |
| 12 | **Packaging cost** | Finance «التكاليف» → packaging | Σ `OrderCostRecord.packagingCost` (Settings bag/box price frozen at preparation) | `OrderCostRecord` | **Yes** (10 verified) | – | – |
| 13 | **Gross profit** | not shown | API `summary.profitability.grossProfitRecorded` = Σ (net price − PO invoice cost); overview `contributionProfit.goodsMarginOnly` | `AcquisitionCostLot` (supplier PO invoices) | **Unavailable in the MVP**: null for every order in `INTERNAL_BUY_LIST` (FIN-01p) | Looks implemented, never computes | Compute from Buy List costs like `profit` does, or hide |
| 14 | **Net profit** | Finance «صافي الربح» | revenue.net − (purchase + company-funded delivery + packaging + losses + expenses) (`profit-model.ts` 80–127); withheld (`INCOMPLETE`) while any cost is missing | `ProfitService` | **Arithmetic yes, inputs overstated** by F1 and understated by delivery surplus: reference order 290 vs 200 | See FIN-F1, FIN-F6 | After F1 is fixed it is exact for the approved model |
| 15 | **Profit margin** | not shown | API only `summary.grossMarginPercent` (PO costs) | – | **NOT IMPLEMENTED** for the MVP | – | margin = net profit ÷ net sales |
| 16 | **Operational expenses** | Finance «المصروفات» and cost line | Σ occurrences of recorded, non-voided expenses in the month (recurring included) | `FinanceExpense` | **Yes** | Voiding after a month is closed does not change the frozen month (by design) | – |
| 17 | Profit share (40 %) | «حصة الأرباح» | net profit × configured % when positive, else 0 | `shareOf` `profit-model.ts` 77 | **Yes** | Rounds on cents | – |

## 4. Product cost and procurement

| Question | Answer from the code | Verified |
|---|---|---|
| When is the purchase price recorded? | At the Buy List count (`acquire` with `cost`) or later (`record`); a purchase without a cost stays *pending*, never zero | FIN-01 (cost at count) |
| Actual or estimated? | **Actual only.** Nothing estimates from a retail price or an earlier purchase (`purchase-cost.service.ts` header; `lastCostBySku` is only a suggestion) | yes |
| Same product bought at different prices? | Each purchase is its own batch with its own unit cost; each order line takes the units that covered it, oldest orders first. A line spanning two batches mixes them exactly (Σ units × batch cost) | by code (`costForOrderItems`) |
| Quantity cost | `Σ allocation.confirmedQuantity × batch.finalUnitCost`; prorated if more units than ordered | yes |
| Supplier discount | `final = list − discount` per unit, discount must stay below the list price | FIN-01 (80 − 10 = 70) |
| Bought, then the customer cancels | Units stay as `confirmed` allocations; an exception with the unit count is opened (BUG-08); profit books the purchase cost as a **loss** of that month immediately; no asset, no re-allocation | FIN-05 (280) |
| Loss at once or tracked as an asset? | Loss at once. There is no inventory model | FIN-05a |
| Can the cost be counted twice? | Order line cost: Buy List first, PO only if no Buy List cost → no. A later `correct` changes the unit cost for every order the batch covered (open months only) | by code |
| Cash spent on purchases vs COGS | **Not separated in any report.** Purchase cash exists only as batch cost rows; COGS appears when the order is delivered, losses when it is cancelled/returned. Money spent on goods for orders still in flight is visible nowhere | **GAP (FIN-F8)** |

Policy options for bought-then-cancelled goods (no change made): **(A) current**: immediate loss, simple and conservative (e.g. 4 × 70 = 280 lost even if the units sell next week). **(B)** hold as "recoverable" until a deadline (e.g. 7 days) then write off; needs a status on the allocation and an expiry rule. **(C)** manual re-allocation to the oldest open order for that SKU, with the purchase cost moving with the unit. Recommendation: keep (A) for launch, add a read-only "bought for cancelled orders" figure so it is visible, decide (B)/(C) after real volumes.

## 5. Delivery, packaging and COD

| Topic | Behaviour (verified) |
|---|---|
| Customer fee vs actual cost | Fee on the order (35); actual cost per order in `OrderCostRecord` (manual 25 kept, FIN-01f; automatic = quote base fee 35, FIN-04a, `system:QUOTE_BASE_FEE`) |
| Free delivery | Fee 0, company funds the whole cost: net 115 on a 300 order (FIN-03) |
| Packaging | Bag/box price from Settings frozen at preparation; mandatory before PACKED (FIN-01i) |
| Failed attempt | Order stays `shipped`, COD stays `expected`, uncollected, parcel with the courier (FIN-06, `lifecycle-delivery-failure`). **A failed trip has no cost of its own**: one courier cost per order, so a retry's second trip is not costed (**NOT IMPLEMENTED**) |
| Not received (returned) | Collection voided; loss = purchase 100 + courier 25 + packaging 10 = 135 (FIN-06b) |
| Manual vs automatic cost | Manual wins; automatic fills only an empty record; Admin may overwrite with a reason, kept in `corrections` |
| Delivered ≠ cash in the treasury | **Confirmed.** DELIVERED sets `collected` (declared by the courier). It becomes `settled/short/over` only when the hub counts it. Until then Finance «تحصيل لم يُسوَّ» shows it (FIN-08b 235) but the Overview card does not (FIN-08c 0) |
| Counted vs declared | `settlements/batch` stores the **counted** per-order amount (FIN-09a 200, `short`); `settlements/rounds`, the hub desk's path, stores the **declared** amount on the order and the counted total only on the batch (FIN-09b-a/-b: 235, `settled`; shortage −35 only on the batch, FIN-09b-e) |
| Courier fees | `CourierSettlementBatch.fees` is subtracted from the count (`netSettled`) and used by `summary` as "courier fees"; `profit` ignores it and uses per-order courier cost → two different courier-cost sources |

## 6. Returns, refunds and cancellations: where each amount goes

| Scenario | Sales | Costs | Cash / collected | Executed |
|---|---|---|---|---|
| Cancel before purchase | none | none | collection voided | `lifecycle-cancellation-matrix`, `glo-240` |
| Cancel after purchase | none | purchase becomes a **loss** (FIN-05a) | voided | FIN-05 |
| Cancel during preparation / packed | none | loss incl. packaging and any recorded courier cost | voided | `lifecycle-cancellation-matrix` |
| Cancel after out for delivery | refused (`CANCELLATION_TOO_LATE`) | – | unchanged | `lifecycle-cancellation-matrix` |
| Failed delivery | none yet | none yet | stays expected | FIN-06 |
| Failed → returned to sender | none | loss 135 | voided | FIN-06 |
| Delivered, full return | revenue stays in its month; refund reduces the refund month | COGS unchanged; goods not valued back | refund bounded by cash received | covered by `glo-206-returns-refunds` (bounds); amounts FIN-07 |
| Partial return | as above | COGS unchanged (240 even if 1 unit resold, FIN-07e) | refund typed freely up to the order total (FIN-07a/b) | FIN-07 |
| Refund to customer | `revenue.refunds`, `summary.costs.refunds`, `overview.refundsSubtracted` all subtract the typed amount | – | manual COD refund needs a payout reference | FIN-07b–d |
| Resellable returned product | **NOT IMPLEMENTED**: no stock value comes back | – | – | FIN-07e |
| Damaged returned product | same: no write-off record beyond the retained COGS | – | – | by code |

## 7. `summary` vs `profit`: the suspected difference, traced to the source

Both read delivered orders by first delivered event in Cairo time, so the order population and date handling **agree** (FIN-11). They differ by design in four places:

| Aspect | `summary` (`finance-report.service.ts`) | `profit` (`profit.service.ts` + `profit-model.ts`) | Intended? |
|---|---|---|---|
| Sales | Σ `Order.subtotal` (pre-order-discount) and shows `deliveryFeeRevenue` as revenue | Σ `lineTotal` (also pre-order-discount); delivery fee **not** revenue | Different definitions (fee as revenue vs not); **the shared omission of the coupon is a bug** |
| Cost of goods | supplier-PO invoice lots only → **null for every Buy List order** | Buy List batch costs, PO fallback | Mode mismatch: `summary` belongs to the supplier-PO mode |
| Delivery / packaging | courier *settlement fees* of batches; per-order costs only as configured **estimates** | per-order recorded courier + packaging | Different sources; `profit` is the approved one |
| Refunds | any succeeded refund in the period, any order status | only for orders still `delivered` | Minor; same in practice |
| Result | `operatingResult` withheld until every delivered order has an invoice cost (never, in the MVP) | `netProfit` withheld until every cost is recorded | Intended safety |
| Rounding | integer cents | integer cents | same (FIN-11e/f: 99.99 in both) |
| Overview | floats rounded with `roundMoney`; sales = collection expected − shipping fee, so **net of the order discount** (FIN-01q 900) | – | the only source that is right about the coupon |

Unified example (FIN-01: goods 1,000, coupon 100, fee 35, purchase 700, courier 25, packaging 10, cash counted 935), same order, three sources:

| Metric | Ideal (by hand) | `profit` | `summary` | Overview API |
|---|---|---|---|---|
| Net sales | 900 | **1,000** | **1,000** (goods) | 900 |
| Discounts | 100 | – | **0** | – |
| Shipping revenue | 35 | 35 (info) | 35 | excluded |
| Billed total | 935 | – | 935 | – |
| COGS | 700 | 700 | **null** (no PO invoices) | – |
| Delivery cost | 25 | 0 (fee covers it) | settlement fees only | – |
| Packaging | 10 | 10 | estimate only | – |
| Gross / net profit | 200 / 200 | **290** (net) | **null** | – |

Conclusion: the difference is **partly intended** (two definitions of delivery revenue, two procurement modes) and **partly a bug** (neither handles the order-level coupon, except the overview). Proposed single source of truth, no refactor now: one pure function `orderFinancials(order)` returning `{grossSales, discounts, netSales, shippingRevenue, billed, cogs, deliveryCost, packaging}` used by `profit`, `summary`, `overview` and the order-level loss flag; `summary` either adopts the Buy List costs or is removed from the API until the supplier-PO mode returns.

## 8. Findings by severity

No **P0** (loss of money or corruption) was found in the executed scenarios.

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| FIN-F1 | **P1** | Order-level discount/coupon is not deducted from product sales in `profit` (and the order-level loss flag); profit overstated by the discount (reference order 290 vs 200) | FIN-01e/g/k; `profit.service.ts` 96, `order-profitability.service.ts` 38; checkout stores subtotal/lineTotal before the promotion |
| FIN-F2 | **P1** | Overview «تحصيل لم يُسوَّ» excludes cash already declared by couriers (0 instead of 935/235) | FIN-01t, FIN-08c; `dashboard.service.ts` 438–441 |
| FIN-F3 | **P1** | Hub-desk settlement (`rounds`) records the declared amount as the order's collected cash; counted shortage lives only on the batch; "settled cash" in `profit`/`summary` can exceed counted cash | FIN-09b-a…d; `reconciliation.service.ts` 652–658 |
| FIN-F4 | **P1** | A refund can be any amount up to the order total regardless of the returned items' value | FIN-07a (250 accepted for a 100 return); `reconciliation.service.ts` 237–257 |
| FIN-F5 | P2 | `summary`/`contributionProfit` can never compute in `INTERNAL_BUY_LIST` (PO invoice lots only); not shown in any screen today | FIN-01p |
| FIN-F6 | P2 | Profit model drops delivery surplus (fee 35 > cost 25) and treats the fee as non-revenue: profit understated by the surplus (FIN-02f 140 vs 150). Approved model, but no screen shows delivery margin | FIN-01j, FIN-02f |
| FIN-F7 | P2 | No inventory/asset: bought-then-cancelled and returned-resellable goods are written off (loss) / keep full COGS | FIN-05, FIN-07e |
| FIN-F8 | P2 | No report of cash spent on purchases for orders still in flight; purchase cash and COGS are not separated | code |
| FIN-F9 | P2 | One courier cost per order: a failed attempt followed by a retry is not costed twice (NOT IMPLEMENTED) | code |
| FIN-F10 | P2 | Finance «تحصيل لم يُسوَّ» counts only orders delivered *in the selected month*; earlier months' open cash is invisible when browsing a later month | `profit.service.ts` 133–148 |
| FIN-F11 | P2 | `summary.discountsGiven` mixes meanings (informational compare-at savings, coupon ignored) and can be subtracted twice | FIN-01m, FIN-02e |
| FIN-F12 | P3 | Stale code comment/flags: overview `contributionProfit` claims courier/packaging costs "do not exist in schema yet" (`dashboard.service.ts` 588–591) though `OrderCostRecord` exists | code |
| FIN-F13 | P3 | `Overview.totalRevenue` (not rendered) sums every non-cancelled order of all time incl. shipping | `dashboard.service.ts` 129–148 |

Verified **correct** (executed): order totals and COD arithmetic (FIN-01a–d), supplier discount in COGS (FIN-01h), packaging snapshot (FIN-01i), manual courier cost kept over the automatic one (FIN-01f), automatic cost from the quote (FIN-04), free-shipping company funding (FIN-03), cancelled and returned orders as losses once with the cash voided (FIN-05/06), refunds subtracting once from net sales in the month they succeed, exactly-once on duplicate and concurrent DELIVERED events and settlements (FIN-10), Cairo midnight boundaries and cent rounding in both reports (FIN-11), Admin-only access to finance, refunds and cost overwrite (`finance.controller.ts` `@Roles('ADMIN')`, `ordering.controller.ts` refund routes `@Roles('ADMIN')`, `order-cost.controller.ts`).

---

## 9. Conformance with the profit-distribution model (added after the owner's clarification)

**Model as stated by the owner:** the Hub manager funds the purchases and recovers the capital; *distributable profit* = sales after discounts **+ delivery revenue − cost of goods sold − actual delivery − packaging − damaged goods − approved direct costs**; the platform takes a percentage of that profit and the rest goes to the Hub manager; the percentage is editable in Admin Settings without touching old settlements; sound returns go back to stock (not a loss) while the real expenses they caused are counted; nothing is counted twice; profit is separate from cash collection and COD settlement.

**Nothing was changed.** This is the gap analysis, from the code and the scenario data (`financial-scenarios.md`). Status: ✅ implemented · ⚠️ partly · ❌ not implemented.

| # | Model rule | What the system does today | Status | Evidence | Change needed (proposed, waiting for approval) |
|---|---|---|---|---|---|
| 1 | Manager funds purchases, recovers capital | No funder or capital concept. Purchase cost enters profit as COGS only when the order is delivered (`profit-model.ts` header: "initial capital … returns through purchase costs"). Money spent on goods for orders in flight, or on goods that were cancelled, is visible nowhere | ⚠️ consistent in principle, not tracked | `profit.service.ts` 95–103; FIN-F8 | A read-only "capital out / recovered / tied up" figure (bought − COGS recognised − goods recoverable). No new accounting system |
| 2a | + sales after discounts | Net sales = Σ line totals: **order-level coupons are not deducted** | ❌ | FIN-01g: 1,000 instead of 900 | M1 |
| 2b | + delivery revenue | The customer fee is **not revenue**; it only offsets the courier cost, the surplus is dropped | ❌ | FIN-01j, FIN-02f, FIN-12b | M2 |
| 2c | − COGS | Actual Buy List batch cost (list − supplier discount), exact across several price batches | ✅ | FIN-01h, FIN-12a | – |
| 2d | − actual delivery | Actual cost per order, or the quote's base fee written as if it were actual; netted against the fee instead of shown in full | ⚠️ | FIN-01f, FIN-04a | M2 |
| 2e | − packaging | Bag/box price frozen at preparation, mandatory before PACKED | ✅ | FIN-01i | – |
| 2f | − damaged goods | **No damaged-goods record.** `PACKAGE_DAMAGED` is only a failure reason, a safety report quarantines goods; no cost is ever written off | ❌ | delivery failure reasons; `hub-corrections-returns` | M3 |
| 2g | − approved direct costs | `FinanceExpense` has no direct/general flag and **no approval**; **every** expense (rent, software, marketing…) is subtracted before the share | ❌ | `schema.prisma` 3880; `finance-expense.service.ts` 6; `profit-model.ts` 111 | M4 |
| 3 | Platform % of profit after costs, remainder to the manager | `profitShare = net × %` when net > 0, else 0 (`shareOf`). The label «حصة الأرباح» does not say whose share it is; **the manager's remainder is neither computed nor shown** | ⚠️ | `profit-model.ts` 77; Finance page | M5 |
| 4 | % editable in Settings, old settlements untouched | `finance.profit_share_percent` (0–100, 2 decimals), every change logged in `app_setting_changes`; closing a month **freezes the percentage and every figure** (`FinancePeriodClose`) and never rewrites them. An **open** month uses the current percentage for the whole month | ✅ closed months · ⚠️ open month not split at the day the % changed | `profit.service.ts` 168–214; `profit-share.e2e-spec` | Keep; decide D-9b below |
| 5a | Sound returns go back to stock, not a loss | **No stock.** Failed delivery returned to the hub: the purchase cost is booked as a **loss** (135 in FIN-06). Delivered then partially returned: COGS stays whole, the refund reduces revenue (FIN-07e). Cancelled after purchase: loss at once (FIN-05a) | ❌ contradicts the model | FIN-05/06/07 | M3 |
| 5b | Count the real expenses a return causes | One courier cost per order: a **return trip or retry has no cost of its own** | ❌ | FIN-F9 | M6 |
| 6a | No cost twice | One cost per purchase batch, Buy List cost before PO cost, one courier and one packaging cost per order, losses and sales exclusive per order, one settlement per collection | ✅ | FIN-10, FIN-12 | – |
| 6b | | **Manual expenses can duplicate order-level costs**: `FinanceExpense.category` offers `PACKAGING` and `DELIVERY`, which the per-order records already carry; nothing prevents entering both | ⚠️ risk | `finance-expense.service.ts` 6 | M6 |
| 6c | | A purchase-cost correction changes every open order the batch covered (intended); closed months stay frozen | ✅ | `purchase-cost.service.ts` 83 | – |
| 7 | Profit separate from cash and COD settlement | Profit is computed from delivered orders and cost records, **never from collection or settlement status**; COD is a separate block (FIN-08: profit unchanged while cash is declared-not-counted). The cash views are wrong in three places (FIN-F2, F3, F10) and **nothing links distributable profit to capital recovery or payout cash** | ✅ separation · ⚠️ cash views | FIN-08, FIN-09b | B2/B3 + M7 |
| 8 | Negative months | No carry-forward: a loss month gives share 0 and the next month starts clean | ⚠️ the model is silent | `shareOf` | D-9 |

### What this means for the displayed profit

- «صافي الربح» is **not** the distributable profit of the model: it ignores the order coupon (+), ignores the delivery surplus (−), books bought-then-cancelled and returned goods as lost (−), subtracts general overhead (−), and has no damaged-goods or approved-direct-cost concept.
- On the reference order (goods 1,000, coupon 100, fee 35, purchase 700, courier 25, packaging 10) the model's distributable profit is **200**; the system shows **290**. With a 40 % platform share: platform 80 and manager 120 under the model; the system shows 116 and does not show the manager's part.
- Already matching the model: COGS, packaging, capture of actual delivery cost, no double counting, percentage freezing, profit independent of cash.

### Required changes (none implemented)

| Step | Change | Touches | Size |
|---|---|---|---|
| M1 | Net sales after discounts: order-level coupon deducted once; compare-at savings are already inside the price | `profit.service.ts`, `order-profitability.service.ts` | small |
| M2 | Delivery fee as its own revenue line; full actual delivery cost; the quote only as a labelled estimate | `profit-model.ts`, `order-cost.service.ts` | small |
| M3 | Goods disposition `RECOVERABLE` / `WRITTEN_OFF` / `DAMAGED` for cancelled, returned and damaged goods; only written-off and damaged goods are losses; a restocked returned unit reverses its COGS | new nullable fields on `OrderCostRecord` (schema change, **no data migration**) | medium |
| M4 | Expense `kind` DIRECT/GENERAL plus approval; distributable profit uses approved DIRECT only; general overhead shown below the line | `FinanceExpense` (+2 fields), `profit-model.ts` | medium |
| M5 | Platform share and manager share both shown, one rounding rule, frozen at close | `profit-model.ts`, Finance page | small |
| M6 | Per-attempt courier cost; remove the `PACKAGING` / `DELIVERY` expense categories | `OrderCostRecord`, expense DTO | medium |
| M7 | Capital view: bought, recovered through COGS, tied up in recoverable goods | read-only report | small |

B2–B4 (unsettled cash card, counted-vs-declared settlement, refund validation) do not depend on the model and stay valid.
**B1 must be re-specified as M1 + M2 + M4 + M5**, because the earlier wording split "order contribution" from "company net after general expenses", while the owner's model deducts only approved direct costs before the split.

### Open questions (approval needed)

| # | Question | Why it matters |
|---|---|---|
| D-8 | Are rent, utilities, software and marketing "approved direct costs"? | Decides whether general overhead reduces the profit that is shared |
| D-9 | Do loss months carry forward? And does a mid-month percentage change apply from its date? | Today neither: a loss month gives share 0, and an open month uses the current % for all of it |
| D-10 | Are returned or cancelled goods "sound" automatically, or does the Hub inspect and decide? | Today no inspection result is recorded |
| D-11 | Is the manager's capital recovery only reported, or is a payout schedule needed? | Decides whether M7 stays read-only |

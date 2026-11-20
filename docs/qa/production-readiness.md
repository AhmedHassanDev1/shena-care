# ShinaCare — financial production readiness

Branch `qa/e2e-lifecycle-audit`, 2026-11-20. Basis: `financial-audit.md` (code and data flow), `financial-scenarios.md` (67 values checked by hand and on data),
`final-e2e-report.md` (regression). **No financial formula, setting or data was changed.** Everything marked "proposed" waits for your approval.

## الملخص التنفيذي (بالعربي)

**التوصية: READY WITH BLOCKERS** — النظام المالي سليم في الأساس (تسجيل التكاليف الفعلية، منع الحساب المزدوج، تتبّع الكاش، التقارير بتوقيت القاهرة)، لكن فيه **4 مشاكل بتخلّي رقم الربح أو الكاش المعروض للأدمن مضلّل ماديًا**، لازم تتصلّح قبل الإطلاق. مفيش **P0** (فقدان فلوس أو فساد بيانات) في اللي اتجرّب.

- **هل رقم الربح المعروض موثوق؟ لسه لأ.** هو صح لما مفيش كوبون على مستوى الطلب ورسوم التوصيل ≤ تكلفتها. مع كوبون، الربح بيطلع أعلى من الحقيقة بقيمة الخصم بالظبط (مثال: 290 بدل 200). ومع رسوم توصيل أعلى من التكلفة بيطلع أقل بقيمة الفرق.
- **اللي شغّال صح**: الإجماليات، الـCOD، تكلفة الشراء الفعلية بخصم المورد، التغليف، تكلفة التوصيل (يدوي وتلقائي)، الشحن المجاني، خسارة الإلغاء بعد الشراء، فشل التسليم والمرتجع، منع التكرار والتزامن، حدود الأيام والشهور، التقريب، وصلاحيات الأدمن.
- **اللي بيتحسب غلط أو مضلّل**: (1) كوبون الطلب مش بيتخصم من المبيعات، (2) كارت «تحصيل لم يُسوَّ» في النظرة العامة بيتجاهل الكاش اللي عند المناديب بعد التسليم، (3) تسوية الكاش من شاشة المخزن بتسجل مبلغ المندوب مش المعدود على الأوردر، (4) الاسترداد بدون ربط بقيمة الصنف المرتجع.
- **اللي مش بيتسجل أصلاً**: قيمة البضاعة المرتجعة القابلة لإعادة البيع، أصل/مخزون للبضاعة المشتراة لأوردر اتلغى، كاش الشراء لأوردرات لسه في الطريق، تكلفة محاولة التوصيل الفاشلة المتكررة، مؤشرات الربح الإجمالي والهامش في وضع قائمة الشراء.
- **الحد الأدنى للإطلاق**: الإصلاحات الأربعة (B1–B4 أدناه) + قرارين منك (الخصم، فرق التوصيل). **بدون نظام محاسبي جديد وبدون Features إضافية.**
- **تحديث بعد توضيح نموذج توزيع الأرباح (القسم 8)**: النظام مش بيطبّق النموذج كامل. الربح الموزَّع الصحيح للأوردر المرجعي 200 والمعروض 290. الفروقات: الكوبون، إيراد التوصيل كبند مستقل، «التالف»، «التكاليف المباشرة المعتمدة» (مفيش تصنيف ولا اعتماد للمصروفات)، نصيب مسؤول المخزن مش بيتعرض، المرتجع السليم والبضاعة المشتراة لطلب ملغي بتتسجل خسارة بدل ما ترجع للمخزون، وتكلفة رحلة المرتجع مش بتتسجل. لذلك **الإصلاح B1 اتعاد تعريفه** (M1+M2+M4+M5). **التوصيف النهائي بيفضل READY WITH BLOCKERS لكن لحد ما توافق على القسم 8 ما ينفعش يتعرض رقم الربح الموزَّع على أنه نهائي.** لم يُنفَّذ أي تعديل على منطق توزيع الأرباح، ولم يُنشأ فرع إصلاحات بعد.

## 1. Verdict

| | |
|---|---|
| Recommendation | **READY WITH BLOCKERS** |
| P0 | none found |
| P1 | 4 (FIN-F1 … FIN-F4) → launch blockers |
| P2 | 7 → fix soon or accept consciously |
| P3 | 2 |
| Is the profit figure shown to the Admin reliable? | **Not yet.** Exact when the order has no order-level discount and fee ≤ delivery cost; otherwise off by the discount (+) or the fee surplus (−). Cost inputs themselves are reliable |
| Is the Overview cash card reliable? | **No** — it omits declared-but-uncounted cash |
| Is "settled cash" reliable? | **Only for the per-order settlement path**; the hub desk's round path records the declaration |

## 2. What works correctly (executed, not read)

Order totals/COD arithmetic · supplier discount in the purchase cost (80 − 10 = 70) · one product bought in two batches at different prices (280) · packaging frozen at preparation and mandatory before PACKED ·
manual courier cost kept over the automatic one, automatic cost from the quote (35) · free shipping carried by the company (net 115) · cancel after purchase = loss 280 once, cash voided ·
failed delivery leaves order open and cash expected; returned = loss 135, cash voided · delivered ≠ cash in the treasury (collected only after the hub counts) ·
duplicate and concurrent DELIVERED, settlements and cancellations act once · Cairo day/month boundaries and cent rounding in both reports · Admin-only finance, refunds and cost overwrite.

## 3. Assessment by dimension

| Dimension | Rating | Why |
|---|---|---|
| Accuracy | **Medium** | Arithmetic exact; inputs wrong in 3 places (coupon, delivery surplus rule, refund amount) |
| Data integrity | **Good** | Transactions, unique keys, idempotency keys, row locks (cancel/dispatch deadlock fixed), forward-only statuses, voids not deletes |
| Auditability | **Good** | Cost corrections need an Admin reason and are logged; purchase-cost history; settlement references; refund proof required; closed months frozen. Gap: no stored reason for a refund amount |
| Financial reconciliation | **Medium** | Expected / declared / counted exist per order; the round path loses the counted amount per order (FIN-F3); outstanding cash is defined three ways |
| Double counting | **Good** | None found: one cost per batch, Buy List cost before PO cost, one courier cost per order, one settlement per collection |
| Missing-cost tracking | **Good with gaps** | A missing cost makes the month INCOMPLETE (never zero). Gaps: purchase cash for orders in flight, failed-attempt cost |
| Access control | **Good** | Finance and refunds Admin-only; Hub/Admin record costs and count cash; overwriting a recorded cost needs Admin + reason; drivers cannot set cash expectations |
| Data migration risk | **Medium** | Orders created before the cost records have no `OrderCostRecord` → their months stay INCOMPLETE until costs are recorded (a backfill exists, **not run**); `Order.subtotal` is nullable for old rows; `deliveryFeeBase` exists only for quotes made after it was stored. Any formula fix leaves already **closed** months at their frozen (old) figures — decide whether to re-close |
| Reporting consistency | **Poor → Medium** | Three sources, three definitions (profit, summary, overview); only `profit` and the cash card reach the Admin screens |

## 4. Launch blockers (minimum financial scope)

| # | Fix (proposed, not done) | Size | Why it blocks |
|---|---|---|---|
| **B1** (re-specified, see section 8) | Net sales in `profit` (and the order-level loss flag) = Σ (`totalAmount` − `shippingFee`) of delivered orders, i.e. net of the order-level discount; keep line prices as they are | small: one source of "goods net" in `profit.service.ts` and `order-profitability.service.ts` | Every coupon overstates profit by its value |
| **B2** | Overview «تحصيل لم يُسوَّ» = status `expected` + `collected` + `disputed` (same as the Finance page), with the split shown | small: one query in `dashboard.service.ts` | The riskiest cash (delivered, in the courier's hands) is invisible on the headline card |
| **B3** | Hub-desk round settlement: store the counted amount per order (or mark orders `short/over` when the batch is short) so `settled` cash never exceeds counted cash | small–medium: `settleRound` in `reconciliation.service.ts` | Reports can show cash as settled that never reached the treasury |
| **B4** | Refund ≤ value of the approved return lines (+ optionally the delivery fee); Admin can exceed it only with a written reason | small: validation in `initiateRefund` | Prevents over-refunds; keeps refunds linked to returned goods |

Not blockers: everything in section 5.

## 5. Decisions needed from you

| # | Decision | Options | Recommendation |
|---|---|---|---|
| D-1 | Order-level discount in profit (B1) | (a) subtract at order level, (b) allocate to lines at checkout | (a) now, (b) later if per-product margin is needed |
| D-2 | Delivery fee surplus (fee 35 > cost 25) | (a) keep the approved model (not revenue, surplus ignored), (b) show delivery margin (fee − cost) as its own line and count it | (b): same cost data, no new inputs, profit matches accounting |
| D-3 | Bought-then-cancelled goods | (A) loss at once (today), (B) hold 7 days then write off, (C) re-allocate to the oldest open order | (A) for launch + a read-only "bought for cancelled orders" figure |
| D-4 | Which finance view is the truth | (a) `profit`; hide/remove `summary` and the unrendered overview KPIs until the supplier-PO mode returns, (b) rebuild `summary` on Buy List costs | (a); define one `orderFinancials()` later |
| D-5 | Automatic courier cost default | quote base fee (today, my earlier change) vs the Settings flat value vs none | keep the quote base fee; confirm |
| D-6 | Closed months after formula fixes | leave frozen, or re-close with a dated adjustment | leave frozen (none closed yet in production data we know of) |
| D-7 | Round settlement semantics (B3) | per-order counted / pro-rata / short flag only | per-order counted when counted per order, pro-rata otherwise, plus a flag |

## 6. Fixes before production vs later

**Before production:** B1–B4; run `backfillDeliveredCourierCosts` only if real delivered orders exist (approval needed); one real-API walk of Finance page and Overview with the reference order after the fixes.
**Soon after:** D-2 delivery margin line; hide or rebase `summary`; "purchases for orders in flight" figure; outstanding COD across all months on the Finance page (FIN-F10); per-attempt courier cost (FIN-F9); remove stale comments.
**Later:** inventory/asset model for returned and cancelled goods (FIN-F7); gross margin and margin % KPIs; allocation of order discounts to lines.

## 7. What was not verified

Browser walk-through of the Finance page and Overview (no API/mock was run for them; findings come from the API and the page source); supplier-PO mode money flow (out of MVP scope); concurrent refunds; refunds in a closed month; production data volume (the dev database was reset on 2026-11-20 per project notes, so no legacy-data profile was measured).

## 8. Conformance with the owner's profit-distribution model (added 2026-11-20)

Full table in `financial-audit.md` §9. Summary for the decision:

| Model rule | System | Verdict |
|---|---|---|
| Manager funds purchases, recovers capital | no funder/capital concept; capital returns through COGS; purchases in flight or cancelled are invisible | ⚠️ not tracked |
| + sales after discounts | order-level coupon not deducted (290 shown vs 200 correct) | ❌ |
| + delivery revenue | fee only offsets the courier cost, surplus dropped | ❌ |
| − COGS, − packaging | actual, frozen, exact across price batches | ✅ |
| − actual delivery | recorded or quote value written as if actual; netted | ⚠️ |
| − damaged goods | no record | ❌ |
| − approved direct costs | every expense is deducted; no direct/general flag, no approval; `PACKAGING`/`DELIVERY` categories can duplicate per-order costs | ❌ |
| Platform % of profit, rest to the manager | one «حصة الأرباح»; manager's part not shown | ⚠️ |
| % editable, old settlements untouched | frozen at month close, changes logged | ✅ (open month not split by date) |
| Sound returns back to stock, not a loss | no stock; returned/cancelled goods booked as a loss immediately; partial returns keep full COGS | ❌ |
| Return-caused real expenses counted | one courier cost per order; a return trip is not costed | ❌ |
| No double counting | verified across the scenarios; one risk: manual expenses vs per-order costs | ✅ / ⚠️ |
| Profit separate from cash and COD | yes (profit never reads settlement status); cash views still wrong (B2/B3) | ✅ / ⚠️ |

**Effect on the verdict.** The recommendation stays **READY WITH BLOCKERS**, but the blocker list changes:

| Blocker | Before | Now |
|---|---|---|
| B1 | net sales after coupon | **re-specified as distributable profit** = M1 (net sales after discounts) + M2 (delivery revenue, full actual delivery cost) + M4 (approved direct costs only) + M5 (platform and manager shares) |
| B2 | cash card | unchanged |
| B3 | round settlement keeps declared and counted apart, variance on the settlement | unchanged |
| B4 | refund cap by returned value and delivery fee | unchanged |
| B5 (new) | – | goods disposition (M3): sound returned or cancelled goods are not a loss; damaged goods are a written-off record |

The Finance page must **not** present «صافي الربح» or «حصة الأرباح» as the final distributable profit/share until B1 and B5 are approved and done: today the number is 90 EGP too high on the reference order, and the manager's share is not shown at all.

**Not done on purpose:** no profit-distribution logic, formula, percentage, expense model or schema was changed, no fix branch was created. B2–B4 do not depend on the model and can start as soon as you say so; B1/B5 start after you answer D-8 to D-11 (`financial-audit.md` §9).

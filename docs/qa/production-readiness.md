# ShinaCare — financial production readiness (after the closure fixes)

Branch `fix/financial-closure`, 2026-11-21. Basis: `financial-audit.md` (closure map + original audit), `financial-scenarios.md` (98 values, before/after),
`final-e2e-report.md` (regression and browser check). The section **"Original assessment"** at the end is the 2026-11-20 verdict before the fixes, kept as the record.

## الملخص التنفيذي (بالعربي)

**التوصية: READY FOR LAUNCH (النواة المالية)** بشرطين تشغيليين خارج الكود، مفيش **P0** ولا **P1** مفتوح.

- **الربح المعروض بقى موثوق**: الأوردر المرجعي (مبيعات 1,000، كوبون 100، رسوم توصيل 35، شراء 700، توصيل فعلي 25، تغليف 10) بيطلع **200** (كان 290)، والتوزيع بنسبة 40% = منصة 80 وشريك 120. الـ13 سيناريو مالي: **98 قيمة مطابقة، 0 فرق** (كانت 46 من 67).
- **اتقفل B1–B5**: خصم الكوبون وإيراد الشحن ككيان مستقل وتكلفة التوصيل الفعلية (والتقديرية متعلّمة)، كارت «تحصيل لم يُسوَّ» (الكاش مع المندوب) من تعريف واحد، المبلغ المعدود والمُعلَن والفرق على التسوية، منع الاسترداد الزائد/المكرر/المتزامن بقفل وقيود، والبضاعة المشتراة لأوردر ملغي/مرتجع مش خسارة تلقائية (التلف المؤكد بس).
- **الشرطان قبل الإطلاق الفعلي** (مش مشاكل في الكود):
  1. **الـ migration `20261121090000_finance_closure` لازم تتطبّق على القاعدة المستهدفة بموافقتك** — اتطبّقت على قواعد محلية معزولة بس، **مش على Supabase**، وهي إضافية بالكامل (أعمدة جديدة قابلة للـ null أو بقيمة افتراضية + قيود CHECK، بدون لمس بيانات قديمة).
  2. **الأوردرات القديمة بدون سجل تكلفة** هتخلّي شهرها «غير مكتمل» لحد ما التكاليف تتسجّل (مفيش ترحيل ولا backfill اتعمل بقرار منك). الأدمن لازم كمان يعتمد أي «تكلفة مباشرة» عشان تدخل في الحساب.
- **قرارات لسه مفتوحة (مش بتمنع الإطلاق)**: ترحيل الخسارة (حاليًا لأ: شهر خسارة = حصة منصة صفر)، تقسيم الشهر المفتوح عند تغيير النسبة، تكلفة المحاولة الفاشلة المتكررة، وطريقة إعادة إغلاق شهور اتقفلت بالنموذج القديم.
- **حدود الفحص**: التشغيل الكامل للاختبارات والمتصفح على بيانات محلية؛ مفيش بيانات إنتاج، ولا نشر، ولا تطبيق على Supabase.

## 1. Verdict

| | |
|---|---|
| Recommendation | **READY FOR LAUNCH (financial core)**, subject to the two operational conditions below |
| P0 / P1 open | **none** (the four P1 of the original audit, FIN-F1…F4, are closed and covered by tests) |
| P2 | 5 open, accepted consciously (section 4) |
| Is the profit figure shown to the Admin reliable? | **Yes** for recorded data: distributable profit = net sales + shipping revenue − actual product cost − delivery − packaging − confirmed damages − approved direct costs; it is withheld (INCOMPLETE) instead of guessed when a cost is missing |
| Is the Overview cash card reliable? | **Yes** — one shared definition: cash the courier declared and the hub has not counted yet |
| Is "settled cash" reliable? | **Yes** on both settlement paths: counted, declared and variance are kept apart on the settlement |
| Can a refund exceed what is owed? | **No** — goods, delivery-fee and cash-received caps inside one transaction with the order row locked (partial, concurrent and duplicate requests tested) |

Conditions before real launch: **(1)** apply the additive migration `20261121090000_finance_closure` on the target database (needs your approval; not applied on Supabase); **(2)** record the costs of any existing orders that must appear in a profit month (no backfill was run) and have the Admin approve direct costs.

## 2. What works correctly (executed)

Order totals and COD arithmetic · coupon deducted once from sales · supplier discount in the purchase cost (80 − 10 = 70) and exact cost across batches at different prices (280) ·
packaging frozen at preparation · manual courier cost kept; the quote only as a labelled estimate until the actual cost is recorded · free shipping carried by the company (delivery margin −25) ·
cancelled-after-purchase goods recoverable, a confirmed damage counted once · failed delivery returned to the hub costs only the courier and the bag · sealed returned unit reverses its cost ·
cash declared by the courier visible as courier custody, never double counted with the expected cash · counted, declared and variance on the settlement, no shortage pushed on an order ·
refund caps under partial, concurrent and duplicate requests · duplicate and concurrent DELIVERED, settlements and cancellations act once · Cairo day/month boundaries and cent rounding · Admin-only finance, refunds, damage confirmation and expense approval ·
month close refused while data is missing or cash is still with couriers, frozen figures and percentage afterwards.

## 3. Assessment by dimension

| Dimension | Before | After | Why |
|---|---|---|---|
| Accuracy | Medium | **Good** | one profit model; 98/98 values match the hand calculation |
| Data integrity | Good | **Good** | refund and settlement writes under row locks / unique keys; CHECK constraints (refund fee ≤ amount, damage ≥ 0, expense kind) |
| Auditability | Good | **Good** | damage has actor, reason, time; expense approval has actor and time; settlement keeps declared + counted + variance; closed months frozen |
| Financial reconciliation | Medium | **Good** | expected / declared / counted / variance all stored and reported; outstanding cash defined once |
| Double counting | Good | **Good** | per-order costs refused as general expenses (`DUPLICATES_ORDER_COST`); estimate replaced, not added, by the actual cost |
| Missing-cost tracking | Good with gaps | **Good** | missing purchase / courier / packaging / unapproved direct cost → INCOMPLETE with counts |
| Access control | Good | **Good** | damage confirmation and expense approval Admin-only |
| Data migration risk | Medium | **Medium** | additive migration, no historic rewrite; old orders without cost records stay INCOMPLETE; months closed in the old shape need re-closing |
| Reporting consistency | Poor → Medium | **Good** | `summary` returns the same figures as the Finance page; Overview reads the same cash position |

## 4. Open items (accepted, none blocks launch)

| # | Item | Effect |
|---|---|---|
| P2-1 | Per-attempt courier cost (a failed trip followed by a retry is one cost record) | understates delivery cost for retried orders until recorded by hand |
| P2-2 | No "cash spent on purchases for orders in flight" figure | capital view shows recovered / tied up / recoverable only |
| P2-3 | Loss months do not carry forward (no policy decided) | a loss month gives platform share 0; the next month starts clean |
| P2-4 | An open month uses the current percentage for the whole month; closed months are frozen | a mid-month change is not split by date |
| P2-5 | Months closed in the old frozen shape are read with a fallback by the trend but not by the Finance page | re-close after the migration if any exists |

## 5. Decisions that were applied (from your messages)

Distributable profit model and the percentage from Admin Settings · platform personal technical expenses are not deducted from the shared profit (kind `PLATFORM`) ·
approved direct costs only (kind `DIRECT` + Admin approval) · recovered capital shown apart from the partner's profit share · old closed settlements untouched when the percentage changes ·
sound returns are not a loss; goods bought for a cancelled order are not an automatic loss if reusable · actual delivery cost when present, the quote as a labelled estimate otherwise ·
no shortage distributed to an individual order without evidence; the customer's paid amount is never changed by a courier shortage · no historical data migration or backfill · profit and summary use one definition.

## 6. What was not verified

Production data volume and legacy-data behaviour (no production data was touched) · refunds in an already closed month · supplier-PO mode money flow (out of MVP scope) ·
the capital-partner portal (explicitly out of scope) · any deployment or Supabase migration (forbidden by the instructions).

---

# Original assessment (2026-11-20, before the fixes)

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

# ShinaCare — final E2E report (financial closure pass on top of the lifecycle pass)

Branch `fix/financial-closure`, 2026-11-21. This file starts with the **closure pass**; the report of the previous pass (2026-11-20, `qa/e2e-lifecycle-audit`) follows unchanged under "Previous pass".
Companion documents: `financial-audit.md`, `financial-scenarios.md`, `production-readiness.md`, `e2e-scenario-matrix.md`, `bugs-and-fixes.md`, `ux-ui-audit.md`, `screenshots/`.

## الملخص التنفيذي (بالعربي) — جولة إغلاق النظام المالي

- **اتقفل B1–B5**: خصم الكوبون، إيراد الشحن وتكلفة التوصيل كبنود مستقلة، «تحصيل لم يُسوَّ» من تعريف واحد، المعدود/المُعلَن/الفرق على التسوية، منع الاسترداد الزائد والمكرر والمتزامن بقفل وقيود، والبضاعة المشتراة لأوردر ملغي أو مرتجع مش خسارة تلقائية (التلف المؤكد من الأدمن بس). الأوردر المرجعي بيطلع **200** (كان 290).
- **السيناريوهات المالية**: 13 سيناريو، **98 قيمة مطابقة و0 فرق** (قبل: 46 من 67). أي تعريف اتغيّر «متوقعه» موضّح بسببه في `financial-scenarios.md`.
- **الـRegression الكامل** (196 ملف، قاعدة محلية معزولة `auto_dispatch_test`): 178 نجح و18 فشل؛ 1483 اختبار، 1427 نجح و55 فشل. **15 ملف من الـ18 فشلوا بنفس العدد بالظبط على نسخة نضيفة من الـmain** (الـbaseline). الـ3 الباقيين اتحلّلوا بالدليل: `dashboard-metrics` (من تعديلي: الـKPI اتشال) **اتصلّح (9/9)**، و`research-fetcher-security` بيفشل بس في الـworktree لأن ملف `.env` المحلي (قائمة نطاقات الوسائط المعتمدة) مش موجود فيه، **وينجح 9/9 بنفس القيمة**، والكود مطابق للـmain، و`interventions` بيفشل **بنفس الطريقة على نسخة نضيفة من الـmain** (قاعدة الاختبار فيها آلاف الأوردرات المتأخرة والقائمة بتقف عند 500).
- **مفيش فشل متقطع في PostgreSQL المرة دي**: الأربع ملفات اللي كانت بتفشل متقطعة (order-tracking، supply-plan، cash-round-settlement، brand-product-line) نجحوا في التشغيل الكامل. سبب التعطل القديم ما اتحددش، فمفيش ادّعاء إنه اتحل.
- **المتصفح** (بيانات حقيقية من API محلي على القاعدة المعزولة): صفحة المالية والنظرة العامة على Desktop (1440) وMobile (390): الأرقام متطابقة بين الصفحتين (كاش مع المناديب 26,345)، شهر مقفول بنموذج جديد بيعرض 430 / 275 / 155 / منصة 62 / شريك 93، مفيش تمرير أفقي، النصوص العربية سليمة. اللقطات في `screenshots/finance-closure-*`.
- **الحالة**: مفيش نشر ولا Migration على Supabase؛ الـmigration إضافية ومحلية بس. التفاصيل والتوصية في `production-readiness.md`.

## Closure pass results

| Check | Result |
|---|---|
| API `tsc --noEmit` | clean |
| API lint on every changed file | clean, except 6 pre-existing `no-explicit-any` in `ordering.controller.ts` (untouched lines) |
| Financial scenarios (13 tests, 98 values) | **13/13, 98 PASS, 0 FAIL** (before: 46/67) |
| New / rewritten finance suites | `profit-model.spec` (unit, 14), `refund-caps` (9), `admin-finance` (8), `profit-share` (7), `hub-orders-preparation` (12), `c2c-backend-acceptance` (12), `dashboard-metrics` (9): all pass |
| Full API regression | 196 suites / 1483 tests: 178 / 1427 passed; 18 / 55 failed → 15 suites identical to clean `main`, 1 identical on clean `main` (`interventions`), 1 environmental (`research-fetcher-security`, passes with the local `.env` value), 1 mine and fixed (`dashboard-metrics`) |
| Business `tsc --noEmit` | clean |
| Business tests (`node --test`, 10 files) | 52/52 |
| Business `check-contrast` | 173/177: the 4 failures are raw palette classes in `driver/*` pages, files not touched by this work |
| Web | no file changed; not re-run |
| Browser (built-in, real API on the isolated DB) | Finance + Overview, Desktop 1440 and Mobile 390, no horizontal overflow (console not re-inspected after the final reload) |

### Baseline comparison (same method as before: clean copy of `main` `b968a59`, same scratch database)

Failing suites and failed-test counts identical on the clean copy and on this branch: brand-research 12, care-consultation 1, cart-reorder 5, catalog-enhancement-pending 1, catalog-intake 1, catalog-policy 6, glo-205-security-regressions 1, glo-77-candidate-review-publish 1, glo285-media-service 3, media-editorial 1, product-read-performance 1, product-search-provider 1, product-sku-media 5, rc-smoke 1, sourcing 11. `interventions` (1) fails identically on the clean copy. `ai-client-privacy`, which failed in the previous pass, passed in this run.

### Concurrency and isolation

The refund suite runs 6 concurrent refunds of 100 against a 400 balance (exactly 4 accepted), two concurrent 400 refunds (one accepted), and three identical requests (one row). Everything ran on the local scratch PostgreSQL (`*_test` databases only); no Supabase, no production data, no deployment.

### Not executed

Production data volume; refunds in an already closed month; supplier-PO mode money flow; the capital-partner portal (out of scope); the Finance page with a completed *open* month was checked through a closed month and the API (the scratch database's current month has older orders without cost records, so it is correctly INCOMPLETE).

---

# Previous pass (2026-11-20, `qa/e2e-lifecycle-audit`)

Branch `qa/e2e-lifecycle-audit` (from `perf/cart-backend-optimization` at `f6aa2b4`), 2026-11-20. `main` untouched. Not merged, not pushed.
Companion documents: `e2e-scenario-matrix.md`, `bugs-and-fixes.md`, `ux-ui-audit.md`, `financial-audit.md`, `financial-scenarios.md`, `production-readiness.md`, `screenshots/`.

## الملخص التنفيذي (بالعربي)

- **دورة حياة الطلب**: اتصلّحت 8 عيوب حقيقية (سباق الإلغاء/الخروج، ضياع البضاعة المشتراة عند الإلغاء، الإلغاء المتزامن، المشوار العالق، خروج المشوار التلقائي، أسباب تعذر التسليم، باركود الاختبار، تكلفة التوصيل) ولكل عيب اختبار يمنع رجوعه.
- **الـRegression الكامل النهائي**: 195 ملف اختبار، 174 نجحوا و21 فشلوا؛ 1471 اختبار، 1397 نجحوا و74 فشلوا.
  - **15 ملف فشلوا بنفس العدد بالظبط على نسخة نضيفة من `f6aa2b4`** (يعني قديمين وغير ناتجين عن شغلي).
  - **2 من تأثير اختباراتي أنا** وتم إصلاحهم: `financial-audit-scenarios` (مفترض قاعدة بيانات لوحدها) و`admin-finance` (التواريخ كانت بتتداخل). بعد الإصلاح ينجحوا على قاعدة مشتركة (13/13 و8/8).
  - **4 ملفات** (`order-tracking`، `supply-plan`، `cash-round-settlement`، `brand-product-line`) فشلوا بأخطاء 500 / «Can't reach database server» داخل التشغيل الكامل ونجحوا كلهم لما اتشغلوا لوحدهم (4 و6 و4 و14 اختبار). سبب التعطل المؤقت لم يتأكد، وسجل PostgreSQL مفيهوش إعادة تشغيل ولا نفاد اتصالات في الفترة دي.
- **PostgreSQL المحلي** وقع مرة واحدة (حوالي 19:57) وأُعيد تشغيله بـ`pg_ctl`، وقواعد الاختبار الثلاث سليمة.
- **الحالة**: الـ4 commits موجودة، لا Merge ولا Push. تعديلات الـAuth والـAccounts والـRecommendations (العمل الآخر) لم تُلمس ولم تدخل أي commit.
- **المالية**: التدقيق المالي والإصلاحات المقترحة في `financial-audit.md` و`production-readiness.md`؛ **لم يُنفَّذ أي إصلاح مالي بعد** بانتظار الموافقة على نموذج توزيع الأرباح.

## Final regression (API, full run, `--runInBand`, scratch PostgreSQL `auto_dispatch_test`)

| Scope | Result |
|---|---|
| Suites | **195**: 174 passed, 21 failed |
| Tests | **1471**: 1397 passed, 74 failed |
| Of the 21 failed suites | 15 identical to clean HEAD · 2 caused by my own tests (fixed) · 4 not reproducible in isolation |
| New tests added in this branch | 41: `lifecycle-cancellation-matrix` 11, `lifecycle-delivery-failure` 4, `lifecycle-buylist-cancellation` 3, `financial-audit-scenarios` 13, `order-tracking-custody` 5, `delivery-failure-reasons` 2, `profit-share` +1, web `order-stages` +2 |
| Web | last run: 44 suites, 256/256 pass; `tsc` and `npm run check:design` clean (not re-run in this pass, no web file changed since) |
| Business | `tsc --noEmit` clean (not re-run, no file changed since) |

### Baseline comparison (evidence, not assumption)

Method: `git archive f6aa2b4` (the commit before this branch, no working-tree changes) extracted to a temporary folder, same scratch database, the failing suites run on it and on this branch with `--json`, then compared per test.

| Failing suite | Clean HEAD (failed tests) | This branch | Verdict |
|---|---|---|---|
| ai-client-privacy.spec | 1 | 1 | old |
| brand-research.e2e | 12 | 12 | old |
| care-consultation.e2e | 1 | 1 | old |
| cart-reorder.spec | 5 | 5 | old (stale mock: no `getSellingTermsBatch`) |
| catalog-enhancement-pending.e2e | 1 | 1 | old |
| catalog-intake.e2e | 1 | 1 | old |
| catalog-policy.e2e | 6 | 6 | old |
| glo-205-security-regressions.e2e | 1 | 1 | old |
| glo-77-candidate-review-publish.e2e | 1 | 1 | old |
| glo285-media-service.e2e | 3 | 3 | old |
| media-editorial.e2e | 1 | 1 | old |
| product-read-performance.spec | 1 | 1 | old |
| product-search-provider.e2e | 1 | 1 | old |
| product-sku-media.e2e | 5 | 5 | old |
| rc-smoke.e2e | 1 | 1 | old |
| sourcing.e2e | 11 | 11 | old |
| accounts.e2e | 0 | 0 on the committed branch (22/22, twice) | not a regression: the working tree carries another person's uncommitted edits to `accounts.service.ts` and its test (it passed 23/23 on the last run) |

Not on the clean-HEAD list, handled one by one:

| Suite | In the full run | Cause | Evidence |
|---|---|---|---|
| financial-audit-scenarios | 2 failed (FIN-03/04) | my suite assumed a dedicated database; other suites' delivered orders keep the current month INCOMPLETE so `netProfit` was null | delta now computed from components; 13/13 on the shared and on the dedicated database |
| admin-finance | 1 failed | my FIN-11 created two delivered orders in Jan 2031, inside admin-finance's weekly window | moved to 2032, polluting rows deleted; 8/8 |
| order-tracking, supply-plan, cash-round-settlement, brand-product-line | 4 / 1 / 1 / 14 failed | HTTP 500 or "Can't reach database server" in the middle of the long run | all pass in isolation (4, 6, 4, 14 tests); PostgreSQL log shows no restart and no connection-limit error in that window; cause **not confirmed** |

## Lifecycle results (unchanged)

The nine lifecycle suites pass together (57/57 at the last targeted run): the 3 lifecycle suites, `c2c-backend-acceptance`, `delivery-mvp`, `glo-240`, `order-tracking`, `buy-list`, `profit-share`.
Defects fixed and their regression tests: `bugs-and-fixes.md`. Scenario matrix: `e2e-scenario-matrix.md`.

## Financial checks (executed)

The 13 financial scenarios compare 67 values with hand calculations (`financial-scenarios.md`): 46 match, 21 differ and every difference is explained there and in `financial-audit.md`. The profit-distribution model gap analysis is `financial-audit.md` §9. No financial formula was changed.

## Not executed or unverified (nothing here is claimed as passed)

- Browser E2E for storefront checkout, Admin, Hub and Driver (no Playwright/Cypress in the repo); the Finance page and the Overview were not opened in a browser in this pass.
- Camera scanning on a real phone; poor-network and offline behavior in the UI.
- Concurrent refunds and refunds inside a closed month (financial side).
- The four intermittent suites above in a clean full run.
- Supabase and shared databases: deliberately untouched.
- Google Drive: no upload was attempted.

## Remaining risks

1. The displayed profit is not the owner's distributable profit yet (see `production-readiness.md` §8).
2. Auto-release of delivery runs depends on checks that can refuse; the log line `Run … stays in planning` is the only signal.
3. The working tree holds another person's uncommitted changes; the full run includes them. Re-run after merging.
4. The local PostgreSQL is not stable under a long run (one crash, one unexplained intermittent failure group).

## How to repeat

Scratch PostgreSQL (`shenacare`, port 5434), database name ending `_test`, `DATABASE_URL` = `DIRECT_URL`, then from `apps/api`: `npx jest --runInBand --forceExit` (full), `npx jest test/integration/lifecycle-` (lifecycle), `npx jest test/integration/financial-audit-scenarios.e2e-spec.ts` (finance; writes its ledger to `FIN_LEDGER_PATH`).

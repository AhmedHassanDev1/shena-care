# ShinaCare — UX/UI audit

Branch `qa/e2e-lifecycle-audit`, 2026-11-20. Arabic-first RTL, mobile-first, the Sahel design system (`docs/frontend/design-system.md`).

**Evidence level, stated plainly**
- Order confirmation page: rebuilt and checked in a real browser at 1440 px and 375 px, Arabic RTL, against a **mock API** with three realistic order shapes (the real API was not running). Screenshots below.
- Courier, Hub and Admin workspaces: **code-level review only**. The Business app dev server on `:3002` belongs to the user's running stack and no API was reachable, so no screenshots were taken and these screens were not exercised visually in this audit.
- English spot check of the confirmation page: not done (all strings exist in both languages; `messages.test.ts` passes).

## Order confirmation page (Storefront)

Files: `apps/web/src/features/orders/components/OrderConfirmation.tsx`, `lib/order-stages.ts` (+ tests), `lib/i18n/messages.ts` (12 keys × 2 languages).
Screenshots: before `screenshots/confirmation-before-desktop.jpg`, `confirmation-before-mobile.jpg`; after `confirmation-after-desktop.jpg`,
`confirmation-after-mobile-top.jpg`, `confirmation-after-mobile-items.jpg`.

| ID | Sev | Before | Change | After |
|---|---|---|---|---|
| E2E-001 | P1 | Product images never shown: the thumbnail was hard-coded `src={null}` (placeholder only) | Uses the same catalog lookup as the order page (`useSkuCatalog`) → real catalog photo; the shared labelled placeholder when the catalog has none (the third item in the screenshots) | Photos on every line that has one |
| E2E-002 | P1 | Names and quantity chips only, plus one total | Per line: unit price, quantity, line total. Summary: subtotal, discount ("وفّرت ٥٠ ج.م", only when > 0), delivery (or «مجاني»), **total = what the courier collects**; "was" amount if it changed. Discount derived as list price × qty − server subtotal, never negative (unit-tested) | Complete, arithmetic reads top to bottom |
| E2E-003 | P1 | A "3-stage ladder" mixed the payment method («الدفع: كاش») with order progress | Payment is its own card (method, amount to pay, "have cash ready"). Progress is the order page's own backend-derived timeline (`trackingSteps`) with the payment row removed | Method and progress separated; nothing inferred beyond the server's stages |
| E2E-004 | P2 | One narrow centered column, large dead space beside it on desktop | Desktop: two columns (items + summary beside payment / delivery / progress / next); phone: payment → delivery → items + summary → progress → next | Content fills the width; phone page is shorter to the key facts |
| E2E-005 | P2 | Many 11–13 px labels, light grey secondary text | Body copy 14–15 px, labels 13 px minimum, headings 17–20 px; secondary text kept to the design-system `stone` ink | More readable at arm's length |
| E2E-006 | P2 | The long technical number appeared twice (pill and the first stage) | Shown once in the pill, grouped for reading (`ORD-1A2B-3C4D-5E6F-7A8B`), one-tap copy of the **full stored number** (tracking lookup and internal ids unchanged); copy confirmation announced with `role="status"` | One readable reference |
| E2E-007 | P2 | Latin product names inside RTL text with no direction handling | `dir="auto"` + `text-match-parent` on names, recipient and address (same treatment as the order page) | Arabic and English names both align correctly (see the English serum next to the Arabic wash) |
| E2E-008 | P3 | A bright yellow glowing dot on the success badge | Removed; flat success badge | Calm |
| E2E-009 | P2 | A date or the generic promise, with no hint whether it is firm | `delivery.certainty` drives the wording: confirmed → «موعد التوصيل المؤكد: …»; estimated → «التوصيل المتوقع: …» plus «ده تقدير مش وعد نهائي…»; unknown → «الميعاد بيتأكد بعد ما نأكد المنتجات» | Estimate and commitment can no longer be confused |

Answers the page now gives (the four questions): *what happened* — title and reference; *what to do next* — «تابع الطلب», and "have the cash ready";
*what happens after* — the "What happens next" card; *can it be reversed* — the cancel line appears only when the server says `canCancel`.

Verified in the browser: desktop, phone, image + fallback + English/Arabic names, free shipping, discount row, estimated vs confirmed vs unknown date, cancel hint present/absent.
Checks run: `tsc`, `npm run check:design` (contrast, hex, palette, icons, direction, assets), the whole web suite (44 suites, 256 tests), eslint on the touched folder.

## Courier workspace (code-level)

| Finding | Action |
|---|---|
| «باركود اختبار» on the stop page and courier home, «مسح تجريبي» in the handoff modal and the hub return scan | Removed (BUG-03). Camera now fills the code from the printed waybill and submits |
| «تعذر التسليم» errored for 3 of the courier's own reasons | Fixed in the API (BUG-02) |
| Stop page told the courier to wait for the hub to confirm the run, which is no longer the normal case | Copy rewritten: the run leaves by itself when the last parcel is scanned; if all are scanned and it did not leave, call the hub. Buttons appear when it leaves (page polls every 8 s) |
| Map tap before the run left silently did nothing | Honest warning explaining why; the stop becomes "active" only on a real success |
| Reason picker uses emoji as icons | Not changed: `apps/business` is outside the storefront design-system rules. Decide if emoji stay |

## Hub workspace (code-level)

| Finding | Action |
|---|---|
| Dispatch tab note said the run cannot leave until the courier scans every parcel | Copy updated: it leaves automatically at the last scan; the «خروج المشوار» button is the fallback |
| After auto-release the run appears in «جاري التوصيل» without a hub action | No change needed; covered by `delivery-mvp` |
| Return scan and handoff modal carried a test shortcut | Removed (BUG-03) |

## Admin workspace (code-level)

| Finding | Action |
|---|---|
| Cancelling an order whose goods were bought raised no alert (money spent, nothing visible) | The existing exceptions queue now receives one high-priority case with the unit count (BUG-08). Wording of the case text is English in the data layer; its display language in the Admin queue was not reviewed |
| Two finance views can show different results | Not a UI change: decision D3 in `bugs-and-fixes.md` |

## Cross-cutting

- **Dates use Latin digits in the Arabic storefront** (`format.ts`, `ar-EG-u-nu-latn`), while the project rule asks for Arabic-Indic digits for dates (D4). Prices and counts already use Arabic-Indic digits, so a price and a date on one screen use different numerals.
- **Not audited**: storefront checkout, cart, product pages, Admin finance and dashboard screens, the returns/refund screens, empty/error/loading states of the Business app, keyboard/screen-reader pass, English layouts. These are open items, not passes.

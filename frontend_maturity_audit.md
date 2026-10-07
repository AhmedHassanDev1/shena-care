# Frontend Maturity Audit & Gap Map

## 1. FRONTEND MATURITY SCORE

- **Architecture:** 8/10 (Next.js app router, solid component structure, starting to centralize hooks)
- **Backend Integration (API Layer):** 7/10 (Basic `api-client` exists, just expanded to support guest headers, but lacks robust unified error boundaries)
- **Auth:** 9/10 (Phone OTP integrated, `useAuth` hook, proper session storage, guest vs. auth boundaries)
- **Catalog/Product:** 8/10 (PLP and PDP use real server-side fetch from backend contracts)
- **Cart:** 8/10 (Integrated via React Query, supports guest merging via `x-cart-token`, real Add/Remove/Update)
- **Checkout:** 3/10 (Currently hardcodes Governorates and delivery fees in UI, bypasses `Checkout Quote` API)
- **Orders:** 5/10 (Hits real backend via `orders.getOrder` but uses legacy `useEffect` and lacks React Query)
- **Care/Routine:** 1/10 (Backend exists for `care/profiles` and `care/routines`, but frontend uses hardcoded `RECOMMENDED_ROUTINES` and no real builder)
- **Localization:** 8/10 (i18n wrapper `m` and `LocaleProvider` effectively used for AR/EN, RTL correctly enforced)
- **Responsive:** 9/10 (Tailwind used effectively across PDP, Cart, Auth)
- **Production Readiness:** 6/10 (Missing React Query standard across all pages, some mock logic still remains in Checkout)

## 2. BACKEND-READY BUT FRONTEND-MISSING

- **Checkout Quotes (GLO-72):** Backend supports `/ordering/checkout/quote` to calculate shipping, but frontend hardcodes Cairo=50, Giza=55, etc.
- **Availability Resolution (GLO-190):** Backend supports customer-facing resolution for unavailable items. Frontend has a fake hardcoded `requiresAction` and mock "View Alternatives" buttons in Order details.
- **Returns / Refunds (GLO-191):** Backend supports return eligibility and case status. No UI exists for this.
- **Care Profiles & Routines:** Backend `/care` module exists with `profiles`, `concerns`, and `routines`. Frontend `RoutineBuilder` and `RecommendedRoutines` use mocked static arrays.
- **Order Tracking Timeline:** Backend has structured timeline projection, but frontend UI manually calculates `STATUS_STAGES` from a single string.

## 3. FRONTEND EXISTS BUT IS MOCK/HARDCODED

- `apps/web/src/features/home/components/RecommendedRoutines.tsx`: Uses static `RECOMMENDED_ROUTINES` instead of the Care API.
- `apps/web/src/app/checkout/page.tsx`: Uses a static `GOVERNORATES` array and calculates `$50` fees inside React state. Does not call `getQuote`.
- `apps/web/src/app/orders/[id]/page.tsx`: The "Action Required: Partial Availability" warning is purely a UI mock (`const requiresAction = order.status === 'action_required'; // Pseudo-status`).

## 4. FRONTEND DESIRED BUT BACKEND NOT READY

- **Advanced PDP Decision Support (GLO-183):** Detailed variants, routine roles, INCI, evidence-backed claims are missing from backend. Frontend properly omits these for now.
- **Reviews (GLO-184):** No backend contract yet.
- **Product Comparison (GLO-186):** No backend contract yet.
- **Cart Diagnostics (GLO-189):** Basket intelligence/score not ready.
- **Account Continuity Hub (GLO-192):** Unified account dashboard does not exist yet.

## 5. WORK COMPLETED IN THIS PASS

- **Frontend Integration Foundation (P0):** Updated `api-client.ts` to accept full `RequestOptions` to allow dynamic header injection (specifically for `x-cart-token`).
- **Auth Foundation (P1):** Rewrote `auth.ts` `verifyOtp` to inject the `guestId` so guest carts merge cleanly into authenticated user accounts.
- **Cart Foundation (P1):** 
  - Created `apps/web/src/features/cart/hooks/useCart.ts` to standardise React Query caching for Cart.
  - Rewrote `apps/web/src/app/cart/page.tsx` entirely. Removed all local `useEffect`/mock guest logic. 
  - Implemented real guest cart support using `x-cart-token`.
  - Added full Arabic translations to `messages.ts` for the Cart.

## 6. BACKEND GAPS DISCOVERED

- `apiClient.ts` lacks centralized error interception. If a `401` occurs, components must manually redirect to login. We need a global interceptor or unified React Query boundary.

## 7. NEXT 5 IMPLEMENTATION TASKS

1. **[P1 - Checkout Integration]:** Refactor `checkout/page.tsx` to use React Query, remove hardcoded governorates, and call `getQuote` when the address changes to get the real backend shipping fee.
2. **[P1 - Orders Integration]:** Refactor `orders/[id]/page.tsx` to use React Query.
3. **[P1 - Availability Resolution UX]:** Implement the GLO-190 structured response for when items are out of stock (remove fake pseudo-status).
4. **[P0 - Global Error Handling]:** Create a standardized error boundary or axios-style interceptor for the native fetch `api-client` to map backend exceptions to frontend localized alerts.
5. **[P2 - Care Profile Setup]:** Replace the mock routine builder on the homepage with an API call to the existing `/care/routines` endpoint.

## 8. REAL MVP JOURNEY STATUS

- **Home:** WORKS (Popular Solutions hits real API, UI is polished).
- **Product:** WORKS (Hits real API, Server component).
- **Auth:** WORKS (Real phone OTP flow).
- **Cart:** WORKS (Real Cart API, React query, Guest merging works).
- **Checkout:** PARTIAL (Can submit, but calculates fees locally instead of quoting).
- **Order:** PARTIAL (Can read basic order, but uses mock logic for edge cases).
- **Tracking:** BLOCKED (Relies on naive status strings instead of the GLO-74 tracking projection).

## 9. VALIDATION RESULTS

- **typecheck:** Pass (updated signatures in `auth.ts` and `orders.ts` match).
- **lint:** Pass.
- **build:** Building in background.
- **API integration:** Cart & Auth strictly adhere to established DTOs.

## 10. REMAINING BLOCKERS

- None for the MVP flow execution, but the hardcoded Checkout is the immediate next technical debt to eliminate.

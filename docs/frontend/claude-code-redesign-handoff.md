# ShinaCare Frontend Redesign Handoff for Claude Code

> **Update:** the redesign foundation now exists. The active visual rules, shared components, asset rules and checks are in [`design-system.md`](design-system.md); the homepage image provenance and missing assets are in [`homepage-image-manifest.md`](homepage-image-manifest.md). Sections below describe the pre-redesign baseline.

## 1. Executive Summary

The ShinaCare frontend (`apps/web`) has been prepared for a complete UI/UX redesign. The influence of previous visual marketing layouts, mock presentation sections, and board-specific visual chrome (SAHEL V18 boards, billboard heroes, tilted cards, floating capsule navigation) has been safely removed.

All core application functionality, business logic, state management, routing, and backend integrations remain **100% intact and verified**.

---

## 2. Clean Architecture Overview

The storefront application is organized under `apps/web/src/` with a clean separation of concerns:

```
apps/web/src/
├── app/                  # Next.js App Router routes & root layout
├── components/
│   ├── layout/           # Neutral layout containers (e.g. PageContainer)
│   ├── map/              # Mapbox GL integration component for delivery selection
│   ├── ui/               # Reusable, accessible UI primitives (dialog, sheet, button, field, stepper, etc.)
│   └── redesign-placeholder.tsx # Standard neutral scaffold for incomplete routes
├── features/             # Feature slices (Domain-driven boundaries)
│   ├── account/          # Address book & customer address management
│   ├── auth/             # Phone number normalization, OTP challenge/verification, session auth context
│   ├── cart/             # Shopping cart state, price change review, undo toast, mutations
│   ├── catalog/          # Discovery API, product queries, card model, listing filters, PLP, PDP
│   ├── checkout/         # COD checkout flow, server quotes, Mapbox pin picking, idempotency, draft persistence
│   ├── home/             # Homepage functional container (ready for new design composition)
│   ├── orders/           # Order tracking, detail, confirmation, reorder, problem reporting
│   └── shell/            # Application chrome (SiteHeader, SiteFooter, StorefrontShell, FocusHeader)
├── lib/
│   ├── api-client.ts     # Axios instance with auth headers, error typing (ApiError)
│   ├── addresses.ts      # Customer addresses contracts & helpers
│   ├── auth.ts           # Customer session token persistence
│   ├── cart.ts           # Cart types, quantity constraints, payload helpers
│   ├── orders.ts         # Orders API contract, checkout payload, quote endpoints
│   ├── routes.ts         # Canonical route definitions
│   └── i18n/             # Arabic RTL first Intl formatters & translation messages
└── styles/
    └── tokens.generated.css # Design token custom properties
```

---

## 3. Preserved Functional Modules & Business Logic

| Module | Core Logic & Preserved Files | Responsibilities |
| :--- | :--- | :--- |
| **Authentication** | `src/features/auth/AuthContext.tsx`<br>`src/features/auth/lib/auth-helpers.ts`<br>`src/features/auth/lib/otp-challenge.ts`<br>`src/features/auth/lib/auth-return.ts`<br>`src/features/auth/components/PhoneLoginForm.tsx`<br>`src/features/auth/components/OtpVerificationForm.tsx` | - Egyptian phone validation (`01XXXXXXXXX`) & normalization<br>- Request OTP code (`POST /auth/phone/otp/challenge`)<br>- Verify code & establish session (`POST /auth/phone/otp/verify`)<br>- Return-to URL handling & guest-to-customer cart merge notification |
| **Catalog & Discovery** | `src/features/catalog/api/discovery.ts`<br>`src/features/catalog/api/products.ts`<br>`src/features/catalog/queries/catalog.queries.ts`<br>`src/features/catalog/lib/listing.ts`<br>`src/features/catalog/lib/card-model.ts`<br>`src/features/catalog/hooks/useQuickAdd.ts`<br>`src/features/catalog/components/ProductListing.tsx`<br>`src/features/catalog/components/ProductDetailView.tsx` | - Infinite scroll pagination via TanStack Query<br>- Multi-faceted filtering (categories, brands, concerns)<br>- URL query string synchronization<br>- Variant selection via `?sku=`<br>- Quick Add to cart with single-variant instant add & multi-variant size selector |
| **Cart** | `src/features/cart/hooks/useCart.ts`<br>`src/features/cart/lib/cart-review.ts`<br>`src/features/cart/components/CartView.tsx`<br>`src/features/cart/components/CartLine.tsx` | - Cart state query & cache invalidation<br>- Line item quantity updates, additions, and deletions<br>- Removal undo toast with timer<br>- Stale/changed price review gating before checkout |
| **Checkout** | `src/features/checkout/hooks/useCheckoutQuote.ts`<br>`src/features/checkout/lib/checkout-draft.ts`<br>`src/features/checkout/lib/service-area.ts`<br>`src/features/checkout/components/CheckoutView.tsx`<br>`src/features/checkout/components/CheckoutSections.tsx`<br>`src/features/checkout/components/CheckoutSummary.tsx`<br>`src/features/checkout/components/DeliveryLocationPicker.tsx` | - Address book selection & new address creation<br>- Mapbox delivery pin picker with service area validation<br>- Live quote calculations (`POST /commerce/checkout/quote`)<br>- Coupon code validation and application<br>- Cryptographic idempotency key generation & retry logic<br>- One-page Cash on Delivery (`COD`) submission |
| **Orders** | `src/features/orders/hooks/useSkuCatalog.ts`<br>`src/features/orders/lib/order-stages.ts`<br>`src/features/orders/components/MyOrdersView.tsx`<br>`src/features/orders/components/OrdersList.tsx`<br>`src/features/orders/components/OrderDetail.tsx`<br>`src/features/orders/components/OrderTrackingView.tsx`<br>`src/features/orders/components/OrderConfirmation.tsx`<br>`src/features/orders/components/ReportProblem.tsx` | - Order tracking status & timeline<br>- Order confirmation view<br>- Customer orders list with reorder capability<br>- Problem reporting modal |
| **Address Book** | `src/features/account/hooks/useAddresses.ts`<br>`src/features/account/components/AddressBookView.tsx` | - Saved delivery addresses listing, creation, updates, and default destination setting |
| **I18n & Formatters** | `src/lib/i18n/format.ts`<br>`src/lib/i18n/messages.ts`<br>`src/lib/i18n/LocaleProvider.tsx` | - Arabic-Indic digit formatting (`ar-EG`) and English western numerals<br>- Currency (`ج.م` / `EGP`), pack sizes, relative dates, and counts<br>- Full translation dictionary |

---

## 4. Removed Legacy Visual Artifacts

The following 11 obsolete presentation files were confirmed safe to delete and have been removed:
1. `src/features/home/components/HomeHero.tsx` (SAHEL billboard hero with serif campaign lines)
2. `src/features/home/components/HeroProduct.tsx` (SAHEL hero spotlight card)
3. `src/features/home/components/Departments.tsx` (SAHEL colored department tiles with tilted camera mockups)
4. `src/features/home/components/BrandShelf.tsx` (SAHEL brand shelf grid)
5. `src/features/home/components/PersonalSlot.tsx` (SAHEL routine slot banner)
6. `src/features/home/components/RoutineEntries.tsx` (SAHEL routine & Shina cards)
7. `src/features/home/components/SeasonPicks.tsx` (SAHEL seasonal 2-column feature pick card)
8. `src/features/home/home-data.ts` (mock editorial categories & brand fixtures)
9. `src/features/shell/FloatingNav.tsx` (SAHEL 68px night capsule bottom navigation bar)
10. `src/features/shell/NavReveal.tsx` (scroll reveal listener tied to FloatingNav)
11. `src/components/ui/section-header.tsx` (obsolete section header created for deleted marketing shelves)

Additionally, obsolete visual CSS rules and legacy clearance padding were neutralized in `src/app/globals.css`:
- Removed `.shutter-light`, `.field-sahel`, `.contact-shadow`, `.sun-orb`, `.floating-nav`, and `.nav-reveal`.
- Neutralized `.pb-nav-safe` from artificial 112px clearance (`var(--nav-h) + var(--nav-gap) + var(--nav-clearance)`) down to standard safe-area padding `env(safe-area-inset-bottom, 0px)`.
- Neutralized legacy SAHEL design comments across `globals.css` and `AuthShell.tsx`.

---

## 5. Legacy Design Documentation Deprecation

The legacy SAHEL V18 visual design documentation has been formally marked as **DEPRECATED**:
- `apps/web/design-system/README.md`: Flagged with a deprecation banner. It specifies that SAHEL visual guidelines are obsolete, and future visual truth will come exclusively from new **Stitch design references**.
- `CLAUDE.md`: Updated Section 4 to mark SAHEL V18 as deprecated for the upcoming redesign. Existing tokens and verification scripts serve solely as transitional technical guardrails.
- Any references to SAHEL boards, campaign palettes, or editorial mockups in project documentation must be ignored as active design references.

---

## 6. Route Status and Touchpoints for Redesign

All application routes are registered, functional, and return the required Arabic-first RTL document contract (`lang="ar"` `dir="rtl"`).

### Routes Ready for New UI/UX Implementation (Stitch Source of Truth):
1. **Home (`/`)** — `src/features/home/components/HomePage.tsx`:
   - Currently a neutral functional container with direct navigation to catalog, cart, and account.
   - Claude Code should implement the new homepage design and composition here using Stitch references.
2. **Product Catalog & Search (`/products`)** — `src/features/catalog/components/ProductListing.tsx`:
   - Infinite scroll, faceted search, category navigation, and product card grid.
   - All state and data fetching are handled; styling and layout can be redesigned freely.
3. **Product Detail (`/products/[slug]`)** — `src/features/catalog/components/ProductDetailView.tsx`:
   - Complete PDP with variant switcher (`?sku=`), gallery, and cart integration.
4. **Cart (`/cart`)** — `src/features/cart/components/CartView.tsx`:
   - Line items, quantity changes, undo toast, and price-review gating.
5. **Checkout (`/checkout`)** — `src/features/checkout/components/CheckoutView.tsx`:
   - Address selection, Mapbox pin, quote summary, coupon entry, and COD confirmation.
6. **Orders (`/orders`, `/orders/[id]`)** — `src/features/orders/components/`:
   - `OrderConfirmation.tsx`, `OrderTrackingView.tsx`, `MyOrdersView.tsx`.
7. **Authentication (`/auth`, `/auth/verify`)** — `src/features/auth/components/`:
   - `AuthShell.tsx` (now a clean layout container), `PhoneLoginForm.tsx`, `OtpVerificationForm.tsx`.
8. **Shell Navigation** — `src/features/shell/`:
   - `SiteHeader.tsx`, `SiteFooter.tsx`, and `StorefrontShell.tsx`.

### Incomplete Routes (Awaiting backend capabilities):
These routes deliberately render `<RedesignPlaceholder route="..." />` and are checked by `scripts/check-ui-reset.mjs`:
- `/account`
- `/account/profile`
- `/account/routine`
- `/routine/builder`
- `/shina`

---

## 7. Remaining Legacy Design Dependencies (Transitional Infrastructure)

The following token infrastructure remains in place to support existing functional components and satisfy guardrails until Claude Code replaces them with the new Stitch design system:
1. `design-system/tokens.json` & `design-system/tokens.app.json`: Base tokens (colors, type ramps, shadows, radii) powering Tailwind preset (`tailwind-preset.ts`).
2. `scripts/build-tokens.mjs`: Token compiler generating `src/styles/tokens.generated.css` and `src/styles/design-scales.generated.ts`.
3. `scripts/check-design-system.mjs`: Design guardrails script enforcing WCAG contrast, logical direction (no physical left/right), and no raw palette classes.
4. `src/styles/contrast-pairs.json`: WCAG accessible contrast definitions.

When implementing the Stitch redesign, update `tokens.json` / `tokens.app.json` with the new design tokens and re-run `npm run tokens`.

---

## 8. Verification Commands & Baseline Status

All verification suites in `apps/web` pass with zero errors:
- `npm run tokens:check`: **PASS** (tokens in sync)
- `npm run check:design`: **PASS** (WCAG contrast pairs, zero hardcoded hex, zero physical directions)
- `npm run typecheck`: **PASS** (`tsc --noEmit` clean)
- `npm run lint`: **PASS** (0 warnings, 0 errors)
- `npm test`: **PASS** (11/11 test suites passed, 58/58 tests passed)
- `npm run build`: **PASS** (production bundle generated cleanly for all 16 static/dynamic routes)
- `npm run check:ui-reset`: **PASS** (all 5 pending and 8 implemented routes pass document contract and scaffold check)

# ShinaCare frontend reset

Status: implemented on `main` from recovery checkpoint `3730ba0517704e0619c2a5ebe8ecdf7752bb9abd`.

This reset deliberately keeps route contracts and non-visual capabilities while customer-facing screens await a separately directed custom design. Every affected route renders the shared `redesign-pending` scaffold and must be treated as incomplete.

## Audit classification

### A — Preserved unchanged

- API clients, environment parsing, session token handling, and idempotency support under `src/lib/`.
- Catalog contracts, API adapters, query keys, and React Query hooks under `src/features/catalog/`.
- Cart API projection and mutations under `src/lib/cart.ts` and `src/features/cart/hooks/useCart.ts`.
- Checkout quotes and order services under `src/features/checkout/` and `src/lib/orders.ts`.
- Authentication provider, OTP API integration, redirect safety, and Egyptian mobile normalization.
- Care profile service, locale providers, route constants, application providers, and error handling.

### B — Refactored and preserved

- Checkout request typing now describes the existing payload instead of accepting `any`.
- Generic request option objects and API error data use explicit safe types.
- Root layout retains providers, Arabic-first direction, strict route composition, and accessible skip navigation without storefront chrome.
- Alexandria is the first semantic font-family target with an offline-safe system fallback.

### C — Removed or replaced

- Homepage composition, promotional sections, mock routine content, and generated home imagery.
- Product-card, product-detail, cart, checkout, order-tracking, account, routine-builder, and OTP presentation layers.
- Generic header, brand-logo treatment, legacy global component CSS, and the proposal-only design lab.
- The obsolete visual-foundation implementation log and design-lab middleware.

### D — Preserved pending verification

- Semantic design tokens and Tailwind mappings.
- Accessible UI primitives (`button`, `dialog`, `sheet`, fields, feedback, and sequence steps).
- Brand-direction and review documents that record proposals without declaring them approved.

## Incomplete routes

- `/products`
- `/products/[slug]`
- `/cart`
- `/checkout`
- `/account`
- `/account/profile`
- `/account/routine`
- `/routine/builder`
- `/orders/[id]`

These routes are intentionally unavailable as customer journeys. The supporting services and contracts remain in source for their future implementations.

## Rebuilt routes

- `/auth` — phone sign-in, "Modern Beauty Discovery" design (`src/features/auth/components/`).
- `/auth/verify` — verification code step of the same flow.
- `/` — Home (`src/features/home/`): header and search, featured-routine hero, concerns, products, suggested routines, categories, routine discovery zone (banner + three steps), phone bottom navigation and desktop footer. Products, cart and prices come from the real catalog and cart APIs. Sections whose backend is missing (published routines, public concerns, the guided builder) render typed fixtures in design preview only; see `docs/home-api-integration-gaps.md`.

Account setup (name, optional email) is not part of the flow: the accounts API creates the customer during code verification and exposes no endpoint to update name or email.

## Guardrail

Run `npm run check:ui-reset --workspace=web` to verify that all preserved paths return an Arabic-first RTL document and explicitly expose the redesign-pending state, and that rebuilt routes keep the RTL contract without the scaffold.

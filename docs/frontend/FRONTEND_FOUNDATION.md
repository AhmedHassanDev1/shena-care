# Frontend foundation

## Current architecture and decisions

`apps/web` is a Next.js 14 App Router application. `src/app` owns routes and route states; `src/features/catalog` already separates catalog API and UI; `src/lib` contains the shared API client plus existing auth, cart, order, and care calls. There is no UI component library, query library, global state store, frontend test suite, asset collection, or `DESIGN.md`. Existing styling is global CSS with a small token set. Most non-catalog routes are client components with local form/UI state and direct calls to `src/lib` functions. Some supplier, delivery, and routine pages are temporary demonstration content.

Phase 1 kept this structure. It added shared locale resources, formatting, route helpers, environment configuration, responsive and focus defaults, and a single catalog API path through `apiClient`. It did not introduce a dependency or a second state system. Existing backend contracts and temporary screens were left in place.

## Ownership and data flow

- `src/app`: route composition, metadata, and App Router loading/error/not-found boundaries. Keep business logic out of page JSX.
- `src/features/<feature>/api`: typed backend operations for a feature. `catalog` is the current example. Use server components for public initial reads where possible.
- `src/features/<feature>/ui`: feature-specific UI. Keep a component here until a real second use warrants promotion.
- `src/components`: currently shared layout (`Header`). Add `ui` or `shared` folders only when actual components need them.
- `src/lib/api-client.ts`: the HTTP boundary. Feature API modules and existing domain clients use it. It preserves backend paths, performs uncached reads, and throws `ApiError` with the HTTP status. Encode URL path parameters. Do not call `fetch` from presentation components.
- `src/lib/i18n`: locale resources, server cookie selection, client context, and number/currency/date formatting. `src/lib/config.ts` owns the API URL; `src/lib/routes.ts` owns frequently reused routes.

Public catalog pages use server fetch through `features/catalog/api/products.ts`. Existing authenticated pages use client-local UI/form state and `lib` API methods. No server-state cache is installed; add one only when a concrete client feature needs cache/invalidation across screens. Keep server responses out of a duplicate global client store. For each server-backed screen, provide loading, error, empty, and success states. App Router boundaries cover server routes; client features should use explicit status in their feature hook or component and must not turn API failures into empty results.

## Localization and direction

English is the fallback; Arabic is selected by the `shena-locale` cookie. Root layout sets `lang`, `dir`, and metadata from the locale. The header switch updates the cookie and refreshes the route. Add a key to both `messages.ts` dictionaries for every new frontend-owned string, including accessibility labels and validation. Use the same component for both directions, CSS logical properties, and the helpers in `format.ts` for dates, numbers, and backend-provided currency codes. Keep product names, descriptions, and other server content sourced from the API; the backend currently provides no localized content fields. Existing legacy pages still contain English strings and ad hoc `$` formatting; translate them as each page is brought into an approved screen implementation. Do not copy those patterns into new work.

## Styling, responsive layout, and accessibility

The existing CSS variables in `src/app/globals.css` are the provisional design tokens until an approved `DESIGN.md` exists. Add semantic colors, spacing, radii, and typography there; primitives use tokens, shared components use primitives, and feature code should not invent repeated visual values. The current header, catalog grid, and product detail start with mobile layouts and expand at the shared `48rem` breakpoint. Use fluid sizing and logical alignment; check 320px mobile, normal mobile, tablet, desktop, and Arabic RTL on every approved screen. Use semantic HTML, labels and alt text, keyboard controls, and visible focus states.

## Hardcoding and assets

Do not embed user-facing copy, API hosts, prices, product/category/brand lists, locale formatting, or repeated design values in presentation code. Compile-time implementation constants may stay local. `NEXT_PUBLIC_API_URL` is required in production and defaults to `http://localhost:3001` only during local development. Configure the backend `FRONTEND_URL` CORS allowlist for the deployed origin.

There are currently no files under `apps/web/public`. Create `public/assets/<purpose>/` when an approved asset is added: `brand/logo`, `products`, `categories`, `routines`, `illustrations`, `content`, or `placeholders` as needed. Use descriptive filenames and prefer local optimized WebP/AVIF for raster images or SVG for vectors. Brand logos and product packshots require authentic sources. Backend product media URLs are currently rendered as ordinary images because the allowed media host and optimization policy have not been established; do not add arbitrary Next image domains or temporary external URLs. Keep text in HTML.

## Remaining risks and Phase 2 rules

1. **Commerce contract mismatch:** `cart.ts`, `orders.ts`, and cart/checkout/order pages predate the current guest-cart and quote/revision checkout API. The backend cart returns `totalAmount`, `revision`, and sparse SKU lines; checkout requires `governorate`, `area`, `idempotencyKey`, `quoteVersion`, and `cartRevision`. The current UI expects richer cart lines and submits an older checkout shape. Treat cart, checkout, and order screens as blocked for production use until their API adapters and UX are aligned with the current backend. Do not mask API errors with an empty cart.
2. **Legacy localization:** auth, account, cart, checkout, order, routine, supplier, delivery, and hub pages still have English copy, hardcoded currency, and some physical-direction CSS/inline styles. Migrate them when each screen is approved. Frontend-owned errors must use translation keys; backend error messages require a separate localization contract.
3. **Auth and media:** existing auth keeps a session token in `localStorage`; changing that requires a dedicated security/product decision. Product media provenance and host allowlist need confirmation before adopting `next/image` for remote images. No authentic asset set or approved `DESIGN.md` is present.
4. **Rendering tradeoff:** reading the locale cookie in the root layout makes all current routes dynamic. This keeps existing URLs and avoids duplicate page trees for the MVP; revisit locale URL routing and cache strategy if public catalog traffic warrants static rendering.

For every approved Phase 2 screen: inspect its backend contract; use the existing API client and feature boundary; add both locale strings; format monetary/date values with locale helpers and server currency; apply design tokens and logical CSS; implement real loading/error/empty/success behavior; verify keyboard use, 320px layout, and RTL. Preserve API contracts and avoid mock product/pricing data in production paths.

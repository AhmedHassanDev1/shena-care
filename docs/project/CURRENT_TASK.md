# Current Task: GLO-102 — Implement Listing management APIs

## Goal
Manage the commercial decision to offer a SKU for sale through dedicated Commerce APIs rather than manual database edits.

---

## Scope
- DTOs for Listing operations (`CreateListingDto`, `ListSkuDto`, `UnlistSkuDto`, query filters).
- Listing management methods in `CommerceService`:
  - `createListing(skuId)` / `ensureListing(skuId)` with SKU validation against Catalog via `catalogService.validateSku(skuId)`.
  - `listSku(skuId)`: set `isListed = true`, `listedAt = now`, `unlistedAt = null` (idempotent).
  - `unlistSku(skuId)`: set `isListed = false`, `unlistedAt = now` (idempotent).
  - `getListing(skuId)`: retrieve current listing state with timestamps.
  - `getListings(filters)`: list listings with pagination and `isListed` filter.
- Commerce controller in composition layer (`ListingController` or `CommerceController`) exposing:
  - `POST /commerce/listings` (create listing for SKU)
  - `GET /commerce/listings` (list listings)
  - `GET /commerce/listings/:skuId` (get listing by SKU)
  - `PATCH /commerce/listings/:skuId/list` or `POST /commerce/listings/:skuId/list` (list command)
  - `PATCH /commerce/listings/:skuId/unlist` or `POST /commerce/listings/:skuId/unlist` (unlist command)
- Public contract export in `modules/commerce/public.ts`.
- Maintain strict module boundaries (Catalog does not import Commerce; Composition imports only from `public.ts`).
- Comprehensive integration tests covering:
  - Create listing for valid SKU -> succeeds.
  - Create listing for non-existent SKU -> 404 / NotFound.
  - List/unlist toggles update `isListed`, `listedAt`, `unlistedAt` correctly.
  - Idempotency when calling list or unlist repeatedly.
  - Listing queries and filters.

---

## Out of Scope
- SellingPrice CRUD commands (reserved for GLO-103).
- Sourcing availability / suppliers (Milestone B3).
- Frontend / Admin UI screens (Milestone B8).
- Cart / Checkout / Orders (Milestone B4).

---

## Definition of Done
- Listing can be created, activated (`list`), deactivated (`unlist`), and queried via API.
- Attempting to create a listing for an invalid/non-existent Catalog SKU fails with appropriate validation error.
- All architecture and integration tests pass cleanly (`npm test`).
- NestJS compiles with zero lint errors (`npm run lint`, `npm run build`).

# Current Task: GLO-103 — Implement SellingPrice commands + price history rules

## Goal
Manage SKU selling prices with historical tracking, currency validation, interval conflict checks, and compareAtAmount support rather than treating price as a static scalar.

---

## Scope
- DTOs for SellingPrice operations (`CreateSellingPriceDto`, `UpdateSellingPriceDto`, query/filter DTOs).
- Currency validation (e.g. ISO 3-letter currency code, default 'EGP' or 'USD').
- SellingPrice commands in `CommerceService`:
  - `createSellingPrice(dto)`: validate SKU existence in Catalog via `catalogService.validateSku(skuId)`, ensure non-negative amount, compareAtAmount >= amount if provided, validate date range (`validFrom < validUntil` if `validUntil` provided), prevent conflicting active overlapping intervals.
  - `updateSellingPrice(id, dto)`: update price record (amount, compareAtAmount, validFrom, validUntil, isActive).
  - `deactivateSellingPrice(id)`: set `isActive = false` to expire or remove a price without deleting history.
  - `getSellingPrices(skuId)`: list all price records (active & historical) for a SKU.
  - `getCurrentSellingPrice(skuId)`: deterministic resolution of the current active price.
- Controller in composition layer (`PriceController` or endpoints under `ListingController` / `CommerceController`):
  - `POST /commerce/prices` (create selling price)
  - `GET /commerce/prices/skus/:skuId` (list prices for SKU)
  - `GET /commerce/prices/skus/:skuId/current` (get current active price)
  - `PATCH /commerce/prices/:id` (update price interval / values)
  - `DELETE /commerce/prices/:id` or `PATCH /commerce/prices/:id/deactivate` (deactivate price)
- Export public contracts in `modules/commerce/public.ts`.
- Comprehensive integration tests covering:
  - Create selling price for valid SKU -> succeeds.
  - Reject non-existent Catalog SKU -> NotFoundException.
  - Interval validation: `validFrom <= validUntil`, active overlap handling.
  - compareAtAmount validation.
  - Historical resolution picking the currently valid price window.

---

## Out of Scope
- Dynamic discounts / promotional coupon engine (future milestone).
- Sourcing cost / supplier margins (Milestone B3).
- Frontend price rendering UI (Milestone B8).

---

## Definition of Done
- Prices can be added and updated via API while retaining historical audit records.
- Deterministic price resolution functions accurately across time windows.
- All integration tests and architecture tests pass cleanly.

# Current Task: GLO-105 — Implement Supplier + SupplierOffer management APIs

## Goal
Manage suppliers and their offers internally via a structured Backend schema before implementing any UI or automation.

---

## Scope
- Create `sourcing` schema in Prisma.
- `Supplier` model (id, name, slug, isActive, timestamps).
- `SupplierOffer` model (id, supplierId, skuId, costPrice, currency, isAvailable, lastObservedAt, lastConfirmedAt, timestamps).
- Create `SourcingModule` and `SourcingService`.
- Supplier endpoints:
  - `POST /sourcing/suppliers`
  - `GET /sourcing/suppliers`
  - `GET /sourcing/suppliers/:id`
  - `PATCH /sourcing/suppliers/:id`
- SupplierOffer endpoints:
  - `POST /sourcing/offers` (validates `skuId` exists via Catalog public contract)
  - `GET /sourcing/offers` (filterable by `skuId` and `supplierId`)
  - `PATCH /sourcing/offers/:id`
- Export public contracts in `modules/sourcing/public.ts`.
- Write unit and integration tests.

---

## Out of Scope
- Exposing suppliers to customers in the Storefront.
- UI for Supplier Management (Milestone B8).
- Automated integration with external supplier APIs (Milestone B6).

---

## Definition of Done
- Prisma migration created and applied.
- `SourcingModule` can create suppliers and multiple offers for the same SKU.
- Validation prevents creating offers for non-existent SKUs.
- Timestamps and evidence of availability are tracked clearly.
- Integration tests pass cleanly.

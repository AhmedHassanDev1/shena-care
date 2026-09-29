# Sourcing API

## Overview
The Sourcing module manages suppliers and the offers they provide for SKUs in the catalog. It is primarily an internal backend capability used before implementing any UI or automated supplier integrations. Supplier data is not exposed to customers.

## Endpoints

### Suppliers

`POST /sourcing/suppliers`
- Creates a new supplier.
- Body: `{ name: string, slug: string, isActive?: boolean }`
- Returns: Supplier object.

`GET /sourcing/suppliers`
- Returns: List of all suppliers.

`GET /sourcing/suppliers/:id`
- Returns the supplier matching the given ID.

`PATCH /sourcing/suppliers/:id`
- Updates a supplier.
- Body: `{ name?: string, slug?: string, isActive?: boolean }`

### Supplier Offers

`POST /sourcing/offers`
- Creates a new offer from a supplier for a specific SKU. Validates the `skuId` against the Catalog.
- Body: `{ supplierId: string, skuId: string, costPrice: number, currency: string, isAvailable?: boolean }`
- Returns: SupplierOffer object.

`GET /sourcing/offers`
- Query parameters: `supplierId` (optional UUID), `skuId` (optional UUID).
- Returns: List of supplier offers matching the given filters.

`PATCH /sourcing/offers/:id`
- Updates the details of a specific supplier offer.
- Body: `{ costPrice?: number, currency?: string, isAvailable?: boolean }`
- Automatically updates `lastObservedAt` to the current time.

`PATCH /sourcing/offers/:id/confirm`
- Confirms the availability status of an offer without updating price details.
- Body: `{ isAvailable: boolean }`
- Updates `lastObservedAt` to current time. If `isAvailable` is true, updates `lastConfirmedAt` to current time.

## Rules
- Suppliers and Offers belong to the `sourcing` schema and shouldn't be exposed directly to storefront APIs.
- Offers cannot be created for invalid or non-existent SKUs in the Catalog.
- Only one offer per supplier per SKU can exist.

# Commerce API

## Overview
The Commerce module provides APIs to manage sellability, listings, and selling prices. 

## Endpoints

### Listings

`POST /commerce/listings`
- Creates a new listing for a SKU.
- Body: `{ skuId: string, isListed?: boolean }`
- Returns: Listing object.

`GET /commerce/listings`
- Query parameters: `isListed` (boolean), `page` (number), `limit` (number).
- Returns: Paginated listings.

`GET /commerce/listings/:skuId`
- Returns the listing for a specific SKU.

`PATCH /commerce/listings/:skuId`
- Updates the listing status.
- Body: `{ isListed: boolean }`

`PATCH /commerce/listings/:skuId/list`
- Sets `isListed = true` for the SKU.

`PATCH /commerce/listings/:skuId/unlist`
- Sets `isListed = false` for the SKU.

### Prices

`POST /commerce/prices`
- Creates a new selling price for a SKU.
- Body: `{ skuId: string, amount: number, currency?: string, compareAtAmount?: number, validFrom?: Date, validUntil?: Date, autoClosePrevious?: boolean }`
- Returns: SellingPrice object.

`GET /commerce/prices/skus/:skuId/current`
- Resolves and returns the currently active price for the given SKU based on current date and time.
- Returns: SellingPrice object or 404.

`GET /commerce/prices/skus/:skuId`
- Returns the entire chronological price history for the SKU, ordered by `validFrom` descending.

`PATCH /commerce/prices/:id`
- Updates a specific price record.
- Body: `{ amount?: number, currency?: string, compareAtAmount?: number, validFrom?: Date, validUntil?: Date, isActive?: boolean }`

`PATCH /commerce/prices/:id/deactivate`
- Deactivates a specific price record (`isActive = false`).

## Sellability Rules
A SKU is considered orderable (`canOrder = true`) when fetched via Product composition if:
1. It has an active listing (`isListed = true`).
2. It has an active price covering the current date (`validFrom <= now` and `validUntil >= now` or `null`).
3. The SKU and its parent product are valid and active in the Catalog.

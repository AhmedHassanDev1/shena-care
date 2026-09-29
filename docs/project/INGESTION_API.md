# Ingestion API

The Ingestion module is responsible for accepting bulk product data from suppliers, attempting to match them to the existing Shena Care Catalog, and allowing administrators to review and approve the matches before publishing them to the Sourcing module.

## Endpoints

### Create Ingestion Job
`POST /ingestion/jobs`
```json
{
  "supplierId": "uuid",
  "items": [
    {
      "supplierSkuCode": "string",
      "name": "string",
      "brand": "string",
      "barcode": "string?",
      "price": 100.0,
      "currency": "EGP"
    }
  ]
}
```
Creates an Ingestion Job in `pending` state and kicks off the background matching process. Matches are attempted via barcode. Unmatched items require manual review.

### Get Jobs
`GET /ingestion/jobs`

### Get Job Details
`GET /ingestion/jobs/:id`

### Approve Item
`PATCH /ingestion/items/:id/approve`
```json
{
  "matchedSkuId": "uuid"
}
```
Manually maps an ingestion item to a Catalog SKU. Status becomes `approved`.

### Reject Item
`PATCH /ingestion/items/:id/reject`
Rejects an ingestion item.

### Publish Job
`POST /ingestion/jobs/:id/publish`
Takes all `approved` items in the job and creates or updates `SupplierOffer` records in the Sourcing module. Marks the job as `published`.

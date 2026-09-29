# Fulfillment API

## Locations

### Create Location
`POST /fulfillment/locations`
```json
{
  "name": "string",
  "address": "string",
  "isActive": "boolean"
}
```

### Get Locations
`GET /fulfillment/locations`

## Shipments

### Allocate Shipment
`POST /fulfillment/shipments/allocate`
```json
{
  "orderId": "uuid",
  "locationId": "uuid"
}
```
Verifies the order exists and is in `placed` or `confirmed` status.
Changes the order status to `packing` and creates a `Shipment` tied to the order and location, in `pending` status.

### Get Shipment
`GET /fulfillment/shipments/:id`

### Get Shipment by Order
`GET /fulfillment/orders/:orderId/shipment`

### Update Shipment Status
`PATCH /fulfillment/shipments/:id/status`
```json
{
  "status": "pending | packing | dispatched | delivered | failed",
  "trackingNumber": "string?"
}
```
If status changes to `dispatched`, sets `dispatchedAt` timestamp and updates the linked order status to `shipped`.
If status changes to `delivered`, sets `deliveredAt` timestamp and updates the linked order status to `delivered`.
If status changes to `failed`, updates the linked order status to `cancelled`.

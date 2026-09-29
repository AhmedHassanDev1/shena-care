# Ordering API

## Cart Management

### Get Cart
`GET /ordering/cart/:sessionId`
Returns the current cart for the given session ID, creating a new empty cart if it doesn't exist.
Enriches items with current `price` and `canOrder` status based on Commerce sellability and Sourcing availability.

### Add to Cart
`POST /ordering/cart/add`
```json
{
  "sessionId": "string",
  "skuId": "uuid",
  "quantity": "integer"
}
```
Validates sellability before adding.

### Remove from Cart
`POST /ordering/cart/remove`
```json
{
  "sessionId": "string",
  "skuId": "uuid"
}
```

### Clear Cart
`DELETE /ordering/cart/:sessionId`

## Checkout & Orders

### Checkout
`POST /ordering/checkout`
```json
{
  "sessionId": "string",
  "customerName": "string",
  "customerPhone": "string",
  "shippingAddress": "string"
}
```
Validates that the cart is not empty and all items are currently sellable (`canOrder` is true and `price` is not null). Creates an order, snapshots the prices, sets status to `placed` (for COD flow), and clears the cart.

### Get Order
`GET /ordering/orders/:idOrOrderNumber`
Returns the order details including items.

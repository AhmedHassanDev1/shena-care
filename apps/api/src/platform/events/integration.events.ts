export class OrderPlacedEvent {
  constructor(
    public readonly orderId: string,
    public readonly orderNumber: string,
    public readonly customerId: string,
    public readonly items: Array<{ skuId: string; quantity: number }>,
    public readonly shippingAddress: string
  ) {}
}

export class OrderDeliveredEvent {
  constructor(
    public readonly orderId: string,
    public readonly customerId: string,
    public readonly items: Array<{ productId: string }>,
    public readonly deliveredAt: Date
  ) {}
}

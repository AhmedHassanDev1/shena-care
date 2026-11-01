export class OrderDeliveredEvent {
  constructor(
    public readonly orderId: string,
    public readonly customerId: string,
    public readonly items: Array<{ productId: string }>,
    public readonly deliveredAt: Date
  ) {}
}

import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { OrderDeliveredEvent } from '../../../platform/events/integration.events';
import { OrderCostService } from './order-cost.service';

/**
 * When an order is delivered its delivery cost is frozen from the price the system quoted at checkout, so the profit report is
 * complete without anyone typing it. Best effort: a failure here is logged and the Hub queue still lets staff record it by hand.
 */
@Injectable()
export class OrderCostDeliveryListener {
  private readonly logger = new Logger(OrderCostDeliveryListener.name);

  constructor(private readonly costs: OrderCostService) {}

  @OnEvent('order.delivered', { async: true })
  async onDelivered(event: OrderDeliveredEvent) {
    try {
      await this.costs.snapshotCourierCost(event.orderId);
    } catch (error) {
      this.logger.warn(`Could not record the delivery cost of order ${event.orderId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

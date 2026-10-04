import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { OrderPlacedEvent } from '../../../platform/events/integration.events';
import { SupplyPlanService } from './supply-plan.service';

@Injectable()
export class SourcingEventListener {
  private readonly logger = new Logger(SourcingEventListener.name);

  constructor(private readonly supplyPlan: SupplyPlanService) {}

  @OnEvent('order.placed', { async: true })
  async handleOrderPlacedEvent(event: OrderPlacedEvent) {
    this.logger.log(`Received order.placed for Order ${event.orderNumber}. Evaluating sourcing needs...`);
    try {
      await this.supplyPlan.initiateForOrder(event.orderId);
    } catch (error: any) {
      this.logger.error(`Failed to process sourcing for order ${event.orderId}: ${error.message}`);
    }
  }
}

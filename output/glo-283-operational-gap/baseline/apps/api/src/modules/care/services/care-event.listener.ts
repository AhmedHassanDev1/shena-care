import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { OrderDeliveredEvent } from '../../../platform/events/integration.events';
import { LifecycleTriggerService } from './lifecycle-trigger.service';

@Injectable()
export class CareEventListener {
  private readonly logger = new Logger(CareEventListener.name);

  constructor(private readonly lifecycleTriggerService: LifecycleTriggerService) {}

  @OnEvent('order.delivered', { async: true })
  async handleOrderDeliveredEvent(event: OrderDeliveredEvent) {
    this.logger.log(`Received order.delivered for Order ${event.orderId}. Registering lifecycle triggers...`);
    try {
      for (const item of event.items) {
        await this.lifecycleTriggerService.registerPostPurchaseDelivery(
          event.customerId,
          event.orderId,
          item.productId,
          event.deliveredAt
        );
      }
    } catch (error: any) {
      this.logger.error(`Failed to register lifecycle trigger for order ${event.orderId}: ${error.message}`);
    }
  }
}

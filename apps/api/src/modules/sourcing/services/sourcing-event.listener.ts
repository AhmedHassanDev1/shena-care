import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { OrderPlacedEvent } from '../../../../platform/events/integration.events';
import { PurchaseOrderService } from './purchase-order.service';

@Injectable()
export class SourcingEventListener {
  private readonly logger = new Logger(SourcingEventListener.name);

  constructor(private readonly purchaseOrderService: PurchaseOrderService) {}

  @OnEvent('order.placed', { async: true })
  async handleOrderPlacedEvent(event: OrderPlacedEvent) {
    this.logger.log(`Received order.placed for Order ${event.orderNumber}. Evaluating sourcing needs...`);
    try {
      this.logger.log(`Evaluating sourcing requirements for ${event.items.length} items from order ${event.orderId}.`);
      for (const item of event.items) {
        try {
          await this.purchaseOrderService.autoSourceDemand(item.skuId, item.quantity);
        } catch (itemError) {
          this.logger.warn(`Failed to auto-source item ${item.skuId} for order ${event.orderId}: ${itemError.message}`);
        }
      }
    } catch (error) {
      this.logger.error(`Failed to process sourcing for order ${event.orderId}: ${error.message}`);
    }
  }
}

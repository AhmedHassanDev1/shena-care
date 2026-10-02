import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { OrderPlacedEvent } from '../../../platform/events/integration.events';
import { FulfillmentService } from './fulfillment.service';

@Injectable()
export class FulfillmentEventListener {
  private readonly logger = new Logger(FulfillmentEventListener.name);

  constructor(private readonly fulfillmentService: FulfillmentService) {}

  @OnEvent('order.placed', { async: true })
  async handleOrderPlacedEvent(event: OrderPlacedEvent) {
    this.logger.log(`Received order.placed for Order ${event.orderNumber}. Creating shipment...`);
    try {
      // In a real MVP, we'd map order items to a single shipment. 
      // The allocateShipment method doesn't exist out of the box with these parameters, so let's call the appropriate method or Prisma directly.
      // Assuming a generic default warehouse location logic.
      await this.fulfillmentService.createShipmentFromOrder(event);
    } catch (error: any) {
      this.logger.error(`Failed to create shipment for order ${event.orderId}: ${error.message}`);
    }
  }
}

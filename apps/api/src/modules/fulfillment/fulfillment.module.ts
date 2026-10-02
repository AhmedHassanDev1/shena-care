import { Module } from '@nestjs/common';
import { FulfillmentService } from './services/fulfillment.service';
import { FulfillmentController } from './fulfillment.controller';
import { OrderingModule } from '../ordering/public';
import { FulfillmentEventListener } from './services/fulfillment-event.listener';

@Module({
  imports: [OrderingModule],
  controllers: [FulfillmentController],
  providers: [FulfillmentService, FulfillmentEventListener],
  exports: [FulfillmentService],
})
export class FulfillmentModule {}

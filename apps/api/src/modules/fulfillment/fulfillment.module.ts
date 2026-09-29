import { Module } from '@nestjs/common';
import { FulfillmentService } from './services/fulfillment.service';
import { FulfillmentController } from './fulfillment.controller';
import { OrderingModule } from '../ordering/public';

@Module({
  imports: [OrderingModule],
  controllers: [FulfillmentController],
  providers: [FulfillmentService],
  exports: [FulfillmentService],
})
export class FulfillmentModule {}

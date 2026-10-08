import { Module } from '@nestjs/common';
import { FulfillmentService } from './services/fulfillment.service';
import { FulfillmentController } from './fulfillment.controller';
import { OrderingModule } from '../ordering/public';
import { OperationsModule } from '../operations/operations.module';
import { FulfillmentEventListener } from './services/fulfillment-event.listener';
import { CatalogModule } from '../catalog/public';
import { SourcingModule } from '../sourcing/public';

@Module({
  imports: [OrderingModule, OperationsModule, CatalogModule, SourcingModule],
  controllers: [FulfillmentController],
  providers: [FulfillmentService, FulfillmentEventListener],
  exports: [FulfillmentService],
})
export class FulfillmentModule {}

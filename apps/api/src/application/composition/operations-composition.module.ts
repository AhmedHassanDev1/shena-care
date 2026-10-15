import { Module } from '@nestjs/common';
import { OrderingModule } from '../../modules/ordering/public';
import { FulfillmentModule } from '../../modules/fulfillment/public';
import { CashSettlementController } from './controllers/cash-settlement.controller';

/**
 * Cross-module operational HTTP endpoints (GLO-238+): composes Ordering facts with Fulfillment
 * scope. Kept apart from CompositionModule so catalog-only compositions do not load fulfillment.
 */
@Module({
  imports: [OrderingModule, FulfillmentModule],
  controllers: [CashSettlementController],
})
export class OperationsCompositionModule {}

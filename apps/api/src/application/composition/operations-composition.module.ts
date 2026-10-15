import { Module } from '@nestjs/common';
import { OrderingModule } from '../../modules/ordering/public';
import { FulfillmentModule } from '../../modules/fulfillment/public';
import { SourcingModule } from '../../modules/sourcing/public';
import { OperationsModule } from '../../modules/operations/operations.module';
import { AccountsModule } from '../../modules/accounts/public';
import { CatalogModule } from '../../modules/catalog/public';
import { WorkspaceController } from './controllers/workspace.controller';
import { AdminOrdersController } from './controllers/admin-orders.controller';
import { CustomerOrderActionsController } from './controllers/customer-order-actions.controller';
import { CashSettlementController } from './controllers/cash-settlement.controller';
import { OrderCancellationController } from './controllers/order-cancellation.controller';
import { OperationsQueueController } from './controllers/operations-queue.controller';
import { OrderCancellationService } from './services/order-cancellation.service';

/**
 * Cross-module operational HTTP endpoints (GLO-238+): composes Ordering facts with Fulfillment
 * scope. Kept apart from CompositionModule so catalog-only compositions do not load fulfillment.
 */
@Module({
  imports: [OrderingModule, FulfillmentModule, SourcingModule, OperationsModule, AccountsModule, CatalogModule],
  controllers: [CashSettlementController, OrderCancellationController, OperationsQueueController, WorkspaceController, AdminOrdersController, CustomerOrderActionsController],
  providers: [OrderCancellationService],
})
export class OperationsCompositionModule {}

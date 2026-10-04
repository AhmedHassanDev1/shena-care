import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module';
import { CatalogModule } from '../catalog/public';
import { SourcingService } from './services/sourcing.service';
import { PurchaseOrderService } from './services/purchase-order.service';
import { PayablesService } from './services/payables.service';
import { RankingService } from './services/ranking.service';
import { SourcingController } from './controllers/sourcing.controller';
import { SourcingEventListener } from './services/sourcing-event.listener';
import { SupplyPlanService } from './services/supply-plan.service';
import { SupplyPlanController } from './controllers/supply-plan.controller';

import { OperationsModule } from '../operations/operations.module';

@Module({
  imports: [DatabaseModule, CatalogModule, OperationsModule],
  controllers: [SourcingController, SupplyPlanController],
  providers: [SourcingService, PurchaseOrderService, PayablesService, RankingService, SupplyPlanService, SourcingEventListener],
  exports: [SourcingService, PurchaseOrderService, PayablesService, RankingService, SupplyPlanService],
})
export class SourcingModule {}

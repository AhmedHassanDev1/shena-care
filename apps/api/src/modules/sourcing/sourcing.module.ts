import { OfferIntakeService } from './services/offer-intake.service';
import { DomainEventsModule } from '../../platform/events/domain-events.module';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module';
import { CatalogModule } from '../catalog/public';
import { CommerceModule } from '../commerce/public';
import { SourcingService } from './services/sourcing.service';
import { PurchaseOrderService } from './services/purchase-order.service';
import { PayablesService } from './services/payables.service';
import { AcquisitionCostService } from './services/acquisition-cost.service';
import { SupplierEnrollmentService } from './services/supplier-enrollment.service';
import { RankingService } from './services/ranking.service';
import { SourcingController } from './controllers/sourcing.controller';
import { SourcingEventListener } from './services/sourcing-event.listener';
import { SupplyPlanService } from './services/supply-plan.service';
import { SupplyPlanController } from './controllers/supply-plan.controller';
import { RfqService } from './services/rfq.service';
import { BuyListService } from './services/buy-list.service';

import { OperationsModule } from '../operations/operations.module';

@Module({
  imports: [DomainEventsModule, DatabaseModule, CatalogModule, CommerceModule, OperationsModule],
  controllers: [SourcingController, SupplyPlanController],
  providers: [SourcingService, PurchaseOrderService, PayablesService, RankingService, SupplyPlanService, SourcingEventListener, RfqService, AcquisitionCostService, SupplierEnrollmentService, OfferIntakeService, BuyListService],
  exports: [BuyListService, SourcingService, PurchaseOrderService, PayablesService, RankingService, SupplyPlanService, RfqService, AcquisitionCostService, SupplierEnrollmentService, OfferIntakeService],
})
export class SourcingModule {}

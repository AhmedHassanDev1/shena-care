import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module';
import { CatalogModule } from '../catalog/public';
import { SourcingService } from './services/sourcing.service';
import { PurchaseOrderService } from './services/purchase-order.service';
import { PayablesService } from './services/payables.service';
import { RankingService } from './services/ranking.service';
import { SourcingController } from './controllers/sourcing.controller';
import { SourcingEventListener } from './services/sourcing-event.listener';

@Module({
  imports: [DatabaseModule, CatalogModule],
  controllers: [SourcingController],
  providers: [SourcingService, PurchaseOrderService, PayablesService, RankingService, SourcingEventListener],
  exports: [SourcingService, PurchaseOrderService, PayablesService, RankingService],
})
export class SourcingModule {}

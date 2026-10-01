import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module';
import { CatalogModule } from '../catalog/public';
import { SourcingService } from './services/sourcing.service';
import { PurchaseOrderService } from './services/purchase-order.service';
import { PayablesService } from './services/payables.service';
import { SourcingController } from './controllers/sourcing.controller';

@Module({
  imports: [DatabaseModule, CatalogModule],
  controllers: [SourcingController],
  providers: [SourcingService, PurchaseOrderService, PayablesService],
  exports: [SourcingService, PurchaseOrderService, PayablesService],
})
export class SourcingModule {}

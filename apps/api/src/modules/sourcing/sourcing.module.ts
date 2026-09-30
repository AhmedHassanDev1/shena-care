import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module';
import { CatalogModule } from '../catalog/public';
import { SourcingService } from './services/sourcing.service';
import { PurchaseOrderService } from './services/purchase-order.service';

@Module({
  imports: [DatabaseModule, CatalogModule],
  providers: [SourcingService, PurchaseOrderService],
  exports: [SourcingService, PurchaseOrderService],
})
export class SourcingModule {}

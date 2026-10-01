import { Module } from '@nestjs/common';
import { OrderingService } from './services/ordering.service';
import { CartService } from './services/cart.service';
import { ReconciliationService } from './services/reconciliation.service';
import { CommerceModule } from '../commerce/public';
import { SourcingModule } from '../sourcing/public';
import { OrderingController } from './ordering.controller';

@Module({
  imports: [CommerceModule, SourcingModule],
  controllers: [OrderingController],
  providers: [OrderingService, CartService, ReconciliationService],
  exports: [OrderingService, CartService, ReconciliationService],
})
export class OrderingModule {}

import { Module } from '@nestjs/common';
import { OrderingService } from './services/ordering.service';
import { CartService } from './services/cart.service';
import { ReconciliationService } from './services/reconciliation.service';
import { CommerceModule } from '../commerce/public';
import { SourcingModule } from '../sourcing/public';
import { OrderingController } from './ordering.controller';
import { CartController } from './cart.controller';

import { CheckoutController } from './checkout.controller';
import { GuestOrderTrackingController } from './guest-order-tracking.controller';
import { OrderTrackingService } from './services/order-tracking.service';

@Module({
  imports: [CommerceModule, SourcingModule],
  controllers: [OrderingController, CartController, CheckoutController, GuestOrderTrackingController],
  providers: [OrderingService, CartService, ReconciliationService, OrderTrackingService],
  exports: [OrderingService, CartService, ReconciliationService],
})
export class OrderingModule {}

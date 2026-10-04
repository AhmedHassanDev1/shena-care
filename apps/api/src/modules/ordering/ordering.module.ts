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
import { CatalogModule } from '../catalog/public';
import { AvailabilityResolutionService } from './services/availability-resolution.service';
import { AvailabilityDecisionController, GuestAvailabilityDecisionController } from './availability-decision.controller';
import { CustomerReturnsController } from './customer-returns.controller';
import { GuestReturnsController } from './guest-returns.controller';
import { ReturnEligibilityService } from './services/return-eligibility.service';
import { OperationsModule } from '../operations/operations.module';
@Module({
  imports: [CommerceModule, SourcingModule, CatalogModule, OperationsModule],
  controllers: [OrderingController, CartController, CheckoutController, GuestOrderTrackingController,
    AvailabilityDecisionController, GuestAvailabilityDecisionController,
    CustomerReturnsController, GuestReturnsController],
  providers: [OrderingService, CartService, ReconciliationService, OrderTrackingService, AvailabilityResolutionService, ReturnEligibilityService],
  exports: [OrderingService, CartService, ReconciliationService],
})
export class OrderingModule {}

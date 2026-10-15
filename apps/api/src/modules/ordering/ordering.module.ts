import { DomainEventsModule } from '../../platform/events/domain-events.module';
import { Module } from '@nestjs/common';
import { OrderingService } from './services/ordering.service';
import { CartService } from './services/cart.service';
import { ReconciliationService } from './services/reconciliation.service';
import { PaymentsService } from './services/payments.service';
import { PaymentWebhookController } from './payment-webhook.controller';
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
  imports: [DomainEventsModule, CommerceModule, SourcingModule, CatalogModule, OperationsModule],
  controllers: [OrderingController, CartController, CheckoutController, GuestOrderTrackingController,
    AvailabilityDecisionController, GuestAvailabilityDecisionController,
    CustomerReturnsController, GuestReturnsController, PaymentWebhookController],
  providers: [OrderingService, CartService, ReconciliationService, OrderTrackingService, AvailabilityResolutionService, ReturnEligibilityService, PaymentsService],
  exports: [OrderingService, CartService, ReconciliationService, PaymentsService],
})
export class OrderingModule {}

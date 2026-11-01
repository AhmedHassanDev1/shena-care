import { Injectable, OnModuleInit } from '@nestjs/common';
import { DomainEventsService } from '../../../platform/events/domain-events.service';
import { SupplyPlanService } from './supply-plan.service';

export const SUPPLY_PLAN_CONSUMER = 'sourcing.supply-plan';

/**
 * Durable consumer of `order.placed` (GLO-236): the supply plan is created exactly once per order
 * (unique supply request + per-order lock), so redelivery after a crash or retry is harmless. A
 * failure is rethrown so the row is retried instead of being logged and lost.
 */
@Injectable()
export class SourcingEventListener implements OnModuleInit {
  constructor(private readonly supplyPlan: SupplyPlanService, private readonly events: DomainEventsService) {}

  onModuleInit() {
    this.events.registerHandler(SUPPLY_PLAN_CONSUMER, async event => {
      await this.supplyPlan.initiateForOrder(event.aggregateId);
    });
  }
}

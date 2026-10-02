import { Injectable, Logger } from '@nestjs/common';
import { CareReminderOrchestrator, ReminderContext } from './reminder-orchestrator.service';

export interface LifecycleStateRecord {
  customerId: string;
  productId: string;
  orderId: string;
  deliveredAt: Date;
  startedAt?: Date;
  lastCheckInAt?: Date;
  problemReportedAt?: Date;
  snoozedUntil?: Date;
  stoppedAt?: Date;
  reorderedAt?: Date;
  // To prevent duplicate actions
  lastActionDispatchedAt?: Date;
  lastActionType?: string;
}

@Injectable()
export class LifecycleTriggerService {
  private readonly logger = new Logger(LifecycleTriggerService.name);

  // Mock DB for MVP testing
  private activeLifecycles: LifecycleStateRecord[] = [];

  constructor(private readonly orchestrator: CareReminderOrchestrator) {}

  /**
   * Registers a new product into the customer's active lifecycle post-delivery.
   */
  registerPostPurchaseDelivery(customerId: string, orderId: string, productId: string, deliveredAt: Date) {
    this.logger.log(`Registering delivery for customer ${customerId}, product ${productId}`);
    
    // Check for existing state to avoid duplicates
    const existing = this.activeLifecycles.find(
      l => l.customerId === customerId && l.productId === productId && !l.stoppedAt && !l.reorderedAt
    );

    if (existing) {
      this.logger.warn(`Active lifecycle already exists for customer ${customerId} product ${productId}`);
      return;
    }

    this.activeLifecycles.push({
      customerId,
      orderId,
      productId,
      deliveredAt
    });
  }

  /**
   * Evaluates all active lifecycles and triggers appropriate reminders.
   * Designed to be called by a cron job or external scheduler.
   */
  async evaluateTriggers(currentDate: Date = new Date()): Promise<number> {
    this.logger.log(`Evaluating lifecycle triggers at ${currentDate.toISOString()}`);
    let dispatchedCount = 0;

    for (const record of this.activeLifecycles) {
      // 1. Skip terminal/paused states
      if (record.stoppedAt || record.reorderedAt || record.problemReportedAt) {
        continue;
      }
      if (record.snoozedUntil && record.snoozedUntil > currentDate) {
        continue;
      }

      // 2. Determine intent based on time elapsed since delivery / last check-in
      const daysSinceDelivery = Math.floor((currentDate.getTime() - record.deliveredAt.getTime()) / (1000 * 60 * 60 * 24));
      
      let intent: 'first-use-checkin' | 'progress-checkin' | 'replenishment-due' | null = null;

      if (!record.startedAt && !record.lastCheckInAt && daysSinceDelivery >= 3 && daysSinceDelivery <= 7) {
        intent = 'first-use-checkin';
      } else if (record.startedAt && !record.lastCheckInAt && daysSinceDelivery >= 14 && daysSinceDelivery <= 21) {
        intent = 'progress-checkin';
      } else if (record.startedAt && daysSinceDelivery >= 50) { // Naive threshold for demo, should use ReplenishmentEstimator
        intent = 'replenishment-due';
      }

      if (!intent) continue;

      // 3. Idempotency check: don't dispatch same intent if already dispatched recently
      if (record.lastActionType === intent && record.lastActionDispatchedAt) {
        const daysSinceAction = Math.floor((currentDate.getTime() - record.lastActionDispatchedAt.getTime()) / (1000 * 60 * 60 * 24));
        if (daysSinceAction < 7) { // 7 day frequency cap per intent
          continue;
        }
      }

      // 4. Dispatch via orchestrator
      const context: ReminderContext = {
        customerId: record.customerId,
        productId: record.productId,
        intent,
        userReportedProblem: !!record.problemReportedAt,
        userSnoozed: record.snoozedUntil !== undefined,
        productActive: true
      };

      const result = await this.orchestrator.evaluateAndDispatch(context);

      if (result.dispatched) {
        record.lastActionType = intent;
        record.lastActionDispatchedAt = currentDate;
        dispatchedCount++;
      }
    }

    this.logger.log(`Finished evaluation. Dispatched ${dispatchedCount} reminders.`);
    return dispatchedCount;
  }
}

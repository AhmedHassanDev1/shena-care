import { Injectable, Logger } from '@nestjs/common';
import { MessagingRouterService, MessageIntent } from '../../messaging/services/router.service';

export type ReminderIntentType = 'first-use-checkin' | 'progress-checkin' | 'replenishment-due' | 'snooze-wakeup';

export interface ReminderContext {
  customerId: string;
  orderSource?: any;
  productId: string;
  intent: ReminderIntentType;
  openReturns?: boolean;
  deliveryFailed?: boolean;
  userReportedProblem?: boolean;
  userSnoozed?: boolean;
  productActive?: boolean;
  daysSinceLastReminder?: number;
}

export interface EligibilityDecision {
  eligible: boolean;
  reason?: string; // suppression reason
}

@Injectable()
export class CareReminderOrchestrator {
  private readonly logger = new Logger(CareReminderOrchestrator.name);

  constructor(private readonly messagingRouter: MessagingRouterService) {}

  /**
   * Evaluates business eligibility and applies suppression rules before dispatching reminder.
   * Resolves GLO-176 Smart Reminder Orchestration rules.
   */
  async evaluateAndDispatch(context: ReminderContext): Promise<{ dispatched: boolean; reason: string }> {
    const decision = this.evaluateEligibility(context);
    
    if (!decision.eligible) {
      this.logger.log(`Reminder suppressed for customer ${context.customerId}: ${decision.reason}`);
      return { dispatched: false, reason: decision.reason || 'Suppressed by policy' };
    }

    const payload = this.buildReminderPayload(context);

    const intent: MessageIntent = {
      recipientId: context.customerId,
      orderSource: context.orderSource,
      templateId: payload.templateId,
      payload: payload.variables
    };

    try {
      const result = await this.messagingRouter.routeMessage(intent);
      return { dispatched: result.success, reason: result.success ? 'Dispatched successfully' : 'Routing failed' };
    } catch (e) {
      this.logger.error(`Failed to dispatch reminder to ${context.customerId}`, e);
      return { dispatched: false, reason: 'Provider delivery failed' };
    }
  }

  private evaluateEligibility(context: ReminderContext): EligibilityDecision {
    // 1. Suppression: open return/cancellation
    if (context.openReturns) return { eligible: false, reason: 'Open return/resolution exists for product' };
    
    // 2. Suppression: delivery failure/damage
    if (context.deliveryFailed) return { eligible: false, reason: 'Delivery failure/damaged item unresolved' };

    // 3. Suppression: user reported irritation
    if (context.userReportedProblem) return { eligible: false, reason: 'User reported problem/stopped using' };

    // 4. Suppression: user snoozed
    if (context.userSnoozed && context.intent !== 'snooze-wakeup') return { eligible: false, reason: 'User snoozed reminders' };

    // 5. Suppression: product no longer sellable
    if (context.productActive === false) return { eligible: false, reason: 'Product no longer sellable' };

    // 6. Suppression: frequency cap
    if (context.daysSinceLastReminder !== undefined && context.daysSinceLastReminder < 7) {
      return { eligible: false, reason: 'Frequency cap exceeded (less than 7 days since last reminder)' };
    }

    return { eligible: true };
  }

  private buildReminderPayload(context: ReminderContext): { templateId: string; variables: any } {
    // Uses short Egyptian Arabic copy mapping
    switch (context.intent) {
      case 'first-use-checkin':
        return {
          templateId: 'first_use_checkin_v1',
          variables: {
            text: `أخبارك إيه مع الروتين الجديد؟ طمنا لو في أي حرقان أو احمرار.`,
            actions: ['تمام جداً', 'في شوية احمرار', 'وقفته']
          }
        };
      case 'replenishment-due':
        return {
          templateId: 'replenishment_due_v1',
          variables: {
            text: `الغسول بتاعك قرب يخلص؟ تحب نبعتلك واحد جديد بنفس السعر قبل ما يغلى؟`,
            actions: ['ابعتلي واحد', 'لسه مخلصش', 'وقف التذكير']
          }
        };
      case 'snooze-wakeup':
        return {
          templateId: 'snooze_wakeup_v1',
          variables: {
            text: `كنا مأجلين التذكير.. حابب تجدد الروتين دلوقتي؟`,
            actions: ['تجديد', 'تأجيل كمان', 'إلغاء']
          }
        };
      case 'progress-checkin':
      default:
        return {
          templateId: 'progress_checkin_v1',
          variables: {
            text: `إيه الأخبار؟ حاسس بفرق في بشرتك بعد شهر استخدام؟`,
            actions: ['في تحسن', 'مفيش فرق', 'محتاج مساعدة']
          }
        };
    }
  }
}

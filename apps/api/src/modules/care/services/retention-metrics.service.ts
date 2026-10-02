import { Injectable, Logger } from '@nestjs/common';

export type RetentionEventType = 
  | 'lifecycle_started' 
  | 'checkin_prompted'
  | 'checkin_completed'
  | 'checkin_skipped'
  | 'checkin_snoozed'
  | 'checkin_stopped'
  | 'problem_escalated'
  | 'replenishment_suggested'
  | 'replenishment_suppressed'
  | 'reorder_converted';

export interface RetentionEvent {
  customerId: string;
  orderId?: string;
  productId?: string;
  eventType: RetentionEventType;
  policyVersion?: string; // e.g. 'v1_first_use' to compare cohort performance
  metadata?: Record<string, any>;
  timestamp: Date;
}

@Injectable()
export class RetentionMetricsService {
  private readonly logger = new Logger(RetentionMetricsService.name);

  // In a real MVP, this would persist to a timeseries DB or a structured analytics table.
  private events: RetentionEvent[] = [];

  /**
   * Records a fixed-schema event for lifecycle actions to measure funnel conversion.
   * GLO-178 Retention Metrics v1
   */
  trackEvent(event: RetentionEvent) {
    this.events.push(event);
    this.logger.log(`[Retention Event] ${event.eventType} for customer ${event.customerId}`);
  }

  /**
   * Compute basic cohort metrics (e.g. check-in completion rate).
   * Safe for offline/online evaluation without heavy BI tools.
   */
  getBasicMetrics() {
    const checkinPrompted = this.events.filter(e => e.eventType === 'checkin_prompted').length;
    const checkinCompleted = this.events.filter(e => e.eventType === 'checkin_completed').length;
    
    const replenishmentSuggested = this.events.filter(e => e.eventType === 'replenishment_suggested').length;
    const reorderConverted = this.events.filter(e => e.eventType === 'reorder_converted').length;
    
    const problemEscalated = this.events.filter(e => e.eventType === 'problem_escalated').length;

    return {
      checkinCompletionRate: checkinPrompted > 0 ? (checkinCompleted / checkinPrompted) : 0,
      reorderConversionRate: replenishmentSuggested > 0 ? (reorderConverted / replenishmentSuggested) : 0,
      problemEscalationCount: problemEscalated,
      totalEventsTracked: this.events.length,
    };
  }
}

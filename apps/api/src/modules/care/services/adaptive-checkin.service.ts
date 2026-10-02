import { Injectable, Logger } from '@nestjs/common';

export type CheckinResponse = 
  | 'started' 
  | 'not_started' 
  | 'consistent' 
  | 'inconsistent' 
  | 'perceived_progress' 
  | 'problem_irritation' 
  | 'stopped' 
  | 'wants_help'
  | 'snooze'
  | 'stop_followups';

export interface CheckinEvent {
  customerId: string;
  routineId: string;
  productId?: string;
  response: CheckinResponse;
  timestamp: Date;
}

export interface LifecycleStateUpdate {
  suppressPromotions: boolean;
  suppressReorders: boolean;
  needsSupportEscalation: boolean;
  snoozedUntil?: Date;
  stopFollowups: boolean;
}

@Injectable()
export class AdaptiveCheckinService {
  private readonly logger = new Logger(AdaptiveCheckinService.name);

  /**
   * Processes a check-in response and derives lifecycle state updates.
   * GLO-174 Adaptive Check-ins v1
   */
  processCheckin(event: CheckinEvent): LifecycleStateUpdate {
    this.logger.log(`Processing check-in from customer ${event.customerId}: ${event.response}`);

    const stateUpdate: LifecycleStateUpdate = {
      suppressPromotions: false,
      suppressReorders: false,
      needsSupportEscalation: false,
      stopFollowups: false,
    };

    switch (event.response) {
      case 'problem_irritation':
        // Suppress promotional/reorder reminders and route to support/guidance
        stateUpdate.suppressPromotions = true;
        stateUpdate.suppressReorders = true;
        stateUpdate.needsSupportEscalation = true;
        break;
      
      case 'wants_help':
        stateUpdate.needsSupportEscalation = true;
        break;
      
      case 'stopped':
        stateUpdate.suppressReorders = true;
        break;
      
      case 'snooze':
        // Snooze for 7 days
        stateUpdate.snoozedUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        break;

      case 'stop_followups':
        stateUpdate.stopFollowups = true;
        break;

      case 'not_started':
      case 'started':
      case 'consistent':
      case 'inconsistent':
      case 'perceived_progress':
      default:
        // Normal progress states do not require aggressive suppression
        break;
    }

    // In a real implementation, persist stateUpdate to DB
    this.logger.log(`Derived state update for ${event.customerId}: ${JSON.stringify(stateUpdate)}`);
    return stateUpdate;
  }
}

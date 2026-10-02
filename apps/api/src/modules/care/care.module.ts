import { Module } from '@nestjs/common';
import { CareService } from './services/care.service';
import { CareProfileService } from './services/care-profile.service';
import { CareController } from './care.controller';
import { CatalogModule } from '../catalog/public';

import { MessagingModule } from '../messaging/messaging.module';
import { CareReminderOrchestrator } from './services/reminder-orchestrator.service';
import { ReplenishmentEstimatorService } from './services/replenishment-estimator.service';
import { AdaptiveCheckinService } from './services/adaptive-checkin.service';
import { LifecycleTriggerService } from './services/lifecycle-trigger.service';
import { RetentionMetricsService } from './services/retention-metrics.service';
import { CareEventListener } from './services/care-event.listener';

@Module({
  imports: [CatalogModule, MessagingModule],
  controllers: [CareController],
  providers: [CareService, CareProfileService, CareReminderOrchestrator, ReplenishmentEstimatorService, AdaptiveCheckinService, LifecycleTriggerService, RetentionMetricsService, CareEventListener],
  exports: [CareService, CareProfileService, CareReminderOrchestrator, ReplenishmentEstimatorService, AdaptiveCheckinService, LifecycleTriggerService, RetentionMetricsService],
})
export class CareModule {}

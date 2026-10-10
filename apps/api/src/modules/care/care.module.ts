import { Module } from '@nestjs/common';
import { CareService } from './services/care.service';
import { CareProfileService } from './services/care-profile.service';
import { CareController } from './care.controller';
import { CatalogModule } from '../catalog/public';
import { GuidanceModule } from '../guidance/guidance.module';
import { AiModule } from '../../platform/ai/ai.module';

import { MessagingModule } from '../messaging/messaging.module';
import { CareReminderOrchestrator } from './services/reminder-orchestrator.service';
import { ReplenishmentEstimatorService } from './services/replenishment-estimator.service';
import { AdaptiveCheckinService } from './services/adaptive-checkin.service';
import { LifecycleTriggerService } from './services/lifecycle-trigger.service';
import { RetentionMetricsService } from './services/retention-metrics.service';
import { CareEventListener } from './services/care-event.listener';
import { RoutineWorkspaceService } from './services/routine-workspace.service';
import { RoutineProposalService } from './services/routine-proposal.service';
import { RoutineWorkspaceController } from './routine-workspace.controller';

@Module({
  imports: [CatalogModule, MessagingModule, GuidanceModule, AiModule],
  controllers: [CareController, RoutineWorkspaceController],
  providers: [
    CareService, CareProfileService, CareReminderOrchestrator, 
    ReplenishmentEstimatorService, AdaptiveCheckinService, LifecycleTriggerService, 
    RetentionMetricsService, CareEventListener, RoutineWorkspaceService, RoutineProposalService
  ],
  exports: [
    CareService, CareProfileService, CareReminderOrchestrator, 
    ReplenishmentEstimatorService, AdaptiveCheckinService, LifecycleTriggerService, 
    RetentionMetricsService, RoutineWorkspaceService, RoutineProposalService
  ],
})
export class CareModule {}

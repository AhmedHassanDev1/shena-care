import { Module } from '@nestjs/common';
import { CareService } from './services/care.service';
import { CareProfileService } from './services/care-profile.service';
import { CareController } from './care.controller';
import { CareTaxonomyController } from './care-taxonomy.controller';
import { CatalogModule } from '../catalog/public';
import { CommerceModule } from '../commerce/public';
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
import { RoutineEngineService } from './services/routine-engine.service';
import { MyRoutinesService } from './services/my-routines.service';
import { RoutineCatalogService } from './services/routine-catalog.service';
import { MyRoutinesController } from './my-routines.controller';
import { RoutineAdminController, RoutineCatalogController } from './routine-catalog.controller';
import { RoutineContentService } from './services/routine-content.service';
import { RoutineStudioService } from './services/routine-studio.service';
import { PersonalRoutinesService, ReadyRoutinesService } from './services/personal-routines.service';
import { RoutineStudioController } from './routine-studio.controller';
import { PersonalRoutinesController, ReadyRoutinesController } from './personal-routines.controller';

@Module({
  imports: [CatalogModule, CommerceModule, MessagingModule, GuidanceModule, AiModule],
  // RoutineCatalogController before CareController: GET care/routines/featured must not reach GET care/routines/:id.
  controllers: [
    CareTaxonomyController, RoutineCatalogController, RoutineAdminController, CareController, RoutineWorkspaceController,
    MyRoutinesController, RoutineStudioController, ReadyRoutinesController, PersonalRoutinesController,
  ],
  providers: [
    CareService, CareProfileService, CareReminderOrchestrator,
    ReplenishmentEstimatorService, AdaptiveCheckinService, LifecycleTriggerService,
    RetentionMetricsService, CareEventListener, RoutineWorkspaceService, RoutineProposalService,
    RoutineEngineService, MyRoutinesService, RoutineCatalogService,
    RoutineContentService, RoutineStudioService, ReadyRoutinesService, PersonalRoutinesService,
  ],
  exports: [
    CareService, CareProfileService, CareReminderOrchestrator,
    ReplenishmentEstimatorService, AdaptiveCheckinService, LifecycleTriggerService,
    RetentionMetricsService, RoutineWorkspaceService, RoutineProposalService, MyRoutinesService,
  ],
})
export class CareModule {}

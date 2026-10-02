import { Module } from '@nestjs/common';
import { CareService } from './services/care.service';
import { CareProfileService } from './services/care-profile.service';
import { CareController } from './care.controller';
import { CatalogModule } from '../catalog/public';

import { MessagingModule } from '../messaging/messaging.module';
import { CareReminderOrchestrator } from './services/reminder-orchestrator.service';
import { ReplenishmentEstimatorService } from './services/replenishment-estimator.service';

@Module({
  imports: [CatalogModule, MessagingModule],
  controllers: [CareController],
  providers: [CareService, CareProfileService, CareReminderOrchestrator, ReplenishmentEstimatorService],
  exports: [CareService, CareProfileService, CareReminderOrchestrator, ReplenishmentEstimatorService],
})
export class CareModule {}

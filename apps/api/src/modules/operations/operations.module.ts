import { DomainEventsModule } from '../../platform/events/domain-events.module';
import { Module } from '@nestjs/common';
import { OperationsController } from './controllers/operations.controller';
import { DomainEventsController } from './controllers/domain-events.controller';
import { SupportService } from './services/support.service';
import { OutboxService } from './services/outbox.service';
import { DashboardService } from './services/dashboard.service';
import { FinanceService } from './services/finance.service';
import { DataRetentionService } from './services/data-retention.service';

@Module({
  imports: [DomainEventsModule],
  controllers: [OperationsController, DomainEventsController],
  providers: [SupportService, OutboxService, DashboardService, FinanceService, DataRetentionService],
  exports: [OutboxService, SupportService] // exported for other modules to enqueue notifications
})
export class OperationsModule {}

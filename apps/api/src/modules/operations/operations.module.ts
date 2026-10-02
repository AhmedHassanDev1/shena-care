import { Module } from '@nestjs/common';
import { OperationsController } from './controllers/operations.controller';
import { SupportService } from './services/support.service';
import { OutboxService } from './services/outbox.service';
import { DashboardService } from './services/dashboard.service';
import { FinanceService } from './services/finance.service';
import { DataRetentionService } from './services/data-retention.service';

@Module({
  controllers: [OperationsController],
  providers: [SupportService, OutboxService, DashboardService, FinanceService, DataRetentionService],
  exports: [OutboxService] // exported for other modules to enqueue notifications
})
export class OperationsModule {}

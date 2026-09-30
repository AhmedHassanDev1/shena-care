import { Module } from '@nestjs/common';
import { GuidanceService } from './services/guidance.service';
import { GuidanceController } from './guidance.controller';
import { AiModule } from '../../platform/ai/ai.module';

@Module({
  imports: [AiModule],
  controllers: [GuidanceController],
  providers: [GuidanceService],
  exports: [GuidanceService],
})
export class GuidanceModule {}

import { Module } from '@nestjs/common';
import { GuidanceService } from './services/guidance.service';
import { GuidanceController } from './guidance.controller';
import { AiModule } from '../../platform/ai/ai.module';
import { CatalogModule } from '../catalog/public';
import { CommerceModule } from '../commerce/public';
import { RecommendationValidatorService } from './services/recommendation-validator.service';

@Module({
  imports: [AiModule, CatalogModule, CommerceModule],
  controllers: [GuidanceController],
  providers: [GuidanceService, RecommendationValidatorService],
  exports: [GuidanceService],
})
export class GuidanceModule {}

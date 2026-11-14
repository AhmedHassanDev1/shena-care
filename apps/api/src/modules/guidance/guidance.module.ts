import { Module } from '@nestjs/common';
import { AiModule } from '../../platform/ai/ai.module';
import { CatalogModule } from '../catalog/public';
import { CommerceModule } from '../commerce/public';
import { CareModule } from '../care/public';
import { ConsultationService } from './consultation/consultation.service';
import { CareIntelligenceController, GuidanceAdminController, GuidanceController } from './guidance.controller';
import { KnowledgeService } from './knowledge/knowledge.service';
import { RecommendationService } from './recommendation/recommendation.service';

/**
 * Guidance: the advisory layer. It reads Catalog (verified facts), Commerce (what can be ordered) and Care (concerns,
 * ingredient rules, the customer's care profile) through their public contracts and never mutates any of them.
 */
@Module({
  imports: [AiModule, CatalogModule, CommerceModule, CareModule],
  controllers: [CareIntelligenceController, GuidanceAdminController, GuidanceController],
  providers: [KnowledgeService, RecommendationService, ConsultationService],
  exports: [KnowledgeService, RecommendationService, ConsultationService],
})
export class GuidanceModule {}

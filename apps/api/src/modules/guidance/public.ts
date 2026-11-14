// Public contract of the Guidance module (care intelligence: knowledge, recommendations, consultation).
export { GuidanceModule } from './guidance.module';
export { KnowledgeService } from './knowledge/knowledge.service';
export type { KnowledgeView } from './knowledge/knowledge.service';
export { RecommendationService } from './recommendation/recommendation.service';
export type { RecommendationInput, RecommendationResult, RecommendedItem } from './recommendation/recommendation.service';
export { ConsultationService } from './consultation/consultation.service';
export type { ConsultPayload } from './consultation/consultation.service';
export { RECOMMENDATION_ENGINE_VERSION } from './recommendation/recommendation-engine';

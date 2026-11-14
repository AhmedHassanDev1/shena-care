import {
  AiClient, AiClientError, AiErrorKind,
  ConsultRespondRequest, ConsultRespondResult, ConsultUnderstandRequest, ConsultUnderstandResult,
  GuidanceRecommendationRequest, GuidanceRecommendationResult,
  ProductEnrichmentResult, ProductContentGenerationResult,
} from '../../src/platform/ai';

/**
 * In-process stand-in for the AI service in its `AI_PROVIDER=mock` mode
 * (services/ai/app/providers/mock_provider.py), so the API suite never needs the
 * Python service or a provider key. `down = true` simulates a provider outage.
 *
 * The consultation calls are scriptable: a test sets `understand` / `respond` to say what "the model" answers,
 * and reads `understandCalls` / `respondCalls` to assert exactly what the API sent it.
 */
export class DeterministicAiClient extends AiClient {
  down = false;
  understandCalls: ConsultUnderstandRequest[] = [];
  respondCalls: ConsultRespondRequest[] = [];
  understand: ((input: ConsultUnderstandRequest) => Partial<ConsultUnderstandResult>) | null = null;
  respond: ((input: ConsultRespondRequest) => Partial<ConsultRespondResult>) | null = null;

  private ensureUp() {
    if (this.down) throw new AiClientError(AiErrorKind.UNAVAILABLE, 'AI service unreachable');
  }

  async recommendRoutine(input: GuidanceRecommendationRequest): Promise<GuidanceRecommendationResult> {
    this.ensureUp();
    const proposes = input.chatHistory.length > 1 || input.profile.skinType === 'oily';
    return proposes
      ? { schemaVersion: '1', type: 'proposal', message: 'Based on your profile, here is a suggested routine.',
          proposal: { title: 'Recommended Balancing Routine', careArea: 'skin', steps: [] } }
      : { schemaVersion: '1', type: 'answer', message: 'Could you tell me more about your specific goals?', proposal: null };
  }

  async enrichProduct(): Promise<ProductEnrichmentResult> {
    this.ensureUp();
    throw new AiClientError(AiErrorKind.UNAVAILABLE, 'Enrichment is not simulated');
  }

  async generateContent(): Promise<ProductContentGenerationResult> {
    this.ensureUp();
    throw new AiClientError(AiErrorKind.UNAVAILABLE, 'Content generation is not simulated');
  }

  async consultUnderstand(input: ConsultUnderstandRequest): Promise<ConsultUnderstandResult> {
    this.understandCalls.push(input);
    this.ensureUp();
    return {
      schemaVersion: '1', intent: 'recommend_products', language: input.locale, context: input.knownContext,
      mentionedProducts: [], mentionedIngredients: [], redFlags: [], missing: [], needsClarification: false,
      providerMetadata: { provider: 'test', model: 'deterministic-understand', promptTokens: 100, completionTokens: 20, costUsd: 0.0001, latencyMs: 5 },
      ...(this.understand?.(input) ?? {}),
    };
  }

  async consultRespond(input: ConsultRespondRequest): Promise<ConsultRespondResult> {
    this.respondCalls.push(input);
    this.ensureUp();
    return {
      schemaVersion: '1', message: input.mustClarify ? 'محتاجة أعرف حاجة واحدة الأول.' : 'دي أنسب الاختيارات من الكتالوج.',
      followUpQuestion: input.mustClarify ? 'بشرتك نوعها إيه؟' : null, quickReplies: input.mustClarify ? ['دهنية', 'جافة'] : [],
      recommendations: input.mustClarify ? [] : input.candidates.slice(0, 3).map(c => ({ ref: c.ref, why: c.reasons[0]?.text ?? c.name })),
      routine: input.routineDraft.length
        ? { title: 'روتين مقترح', steps: input.routineDraft.map(s => ({ ref: s.ref, slot: s.slot, why: 'خطوة أساسية', howToUse: null })) }
        : null,
      citations: input.knowledge.slice(0, 2).map(k => k.ref),
      providerMetadata: { provider: 'test', model: 'deterministic-respond', promptTokens: 800, completionTokens: 150, costUsd: 0.004, latencyMs: 9 },
      ...(this.respond?.(input) ?? {}),
    };
  }
}

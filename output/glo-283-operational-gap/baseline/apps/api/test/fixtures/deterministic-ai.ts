import {
  AiClient, AiClientError, AiErrorKind,
  GuidanceRecommendationRequest, GuidanceRecommendationResult,
  ProductEnrichmentResult, ProductContentGenerationResult,
} from '../../src/platform/ai';

/**
 * In-process stand-in for the AI service in its `AI_PROVIDER=mock` mode
 * (services/ai/app/providers/mock_provider.py), so the API suite never needs the
 * Python service or a provider key. `down = true` simulates a provider outage.
 */
export class DeterministicAiClient extends AiClient {
  down = false;

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
}

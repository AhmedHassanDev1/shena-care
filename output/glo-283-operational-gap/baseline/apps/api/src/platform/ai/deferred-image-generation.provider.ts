import { Injectable, Logger } from '@nestjs/common';
import { ImageGenerationProvider, ImageGenerationRequest, ImageGenerationResult } from './image-generation.port';

/**
 * Deferred AI Image Generation Provider.
 * Enforces the strict $0 external cost policy:
 * - AI image generation is disabled by default.
 * - Real authentic packshots and official logos only.
 * - Never invents packaging, logos, or claims.
 */
@Injectable()
export class DeferredImageGenerationProvider implements ImageGenerationProvider {
  private readonly logger = new Logger(DeferredImageGenerationProvider.name);

  isConfigured(): boolean {
    return process.env.ENABLE_AI_IMAGE_GENERATION === 'true';
  }

  async generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    this.logger.log(`AI Image generation deferred ($0 cost policy gate) for product="${request.productName}"`);
    return {
      status: 'DEFERRED_COST_GATE',
      provider: 'none_cost_gate',
      reason: 'AI image generation is disabled ($0 external cost policy; real verified packshots only)',
      generatedAt: new Date().toISOString(),
      metadata: {
        candidateId: request.candidateId,
        productId: request.productId,
        productName: request.productName,
        deferredByPolicy: 'COST_GATE_20261019',
      },
    };
  }
}

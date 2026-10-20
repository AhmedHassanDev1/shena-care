export type ImageGenerationStatus = 'DEFERRED_COST_GATE' | 'NOT_CONFIGURED' | 'COMPLETED' | 'FAILED';

export interface ImageGenerationRequest {
  candidateId?: string;
  productId?: string;
  productName: string;
  brandName: string;
  lineName?: string;
  category?: string;
  prompt: string;
  aspectRatio?: '1:1' | '4:5' | '16:9';
  stylePreset?: string;
  correlationId?: string;
}

export interface ImageGenerationResult {
  status: ImageGenerationStatus;
  imageUrl?: string;
  provider: string;
  reason?: string;
  metadata?: Record<string, unknown>;
  generatedAt: string;
}

export const IMAGE_GENERATION_PROVIDER = Symbol('IMAGE_GENERATION_PROVIDER');

export interface ImageGenerationProvider {
  isConfigured(): boolean;
  generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult>;
}

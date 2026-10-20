import { Module } from '@nestjs/common';
import { AiClient } from './ai-client.contract';
import { HttpAiClient } from './http-ai.client';
import { IMAGE_GENERATION_PROVIDER } from './image-generation.port';
import { DeferredImageGenerationProvider } from './deferred-image-generation.provider';

@Module({
  providers: [
    {
      provide: AiClient,
      useFactory: (): AiClient => {
        const baseUrl = process.env.AI_SERVICE_URL ?? 'http://localhost:8000';
        const timeoutMs = Number(process.env.AI_SERVICE_TIMEOUT_MS ?? 5000);
        return new HttpAiClient(baseUrl, timeoutMs);
      },
    },
    {
      provide: IMAGE_GENERATION_PROVIDER,
      useClass: DeferredImageGenerationProvider,
    },
    DeferredImageGenerationProvider,
  ],
  exports: [AiClient, IMAGE_GENERATION_PROVIDER, DeferredImageGenerationProvider],
})
export class AiModule {}


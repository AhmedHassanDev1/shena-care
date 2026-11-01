import { Logger, Module } from '@nestjs/common';
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
        const serviceToken = process.env.AI_SERVICE_TOKEN || undefined;
        const pseudonymSecret = process.env.AI_PSEUDONYM_SECRET || undefined;
        const logger = new Logger(AiModule.name);
        if (!serviceToken) logger.warn('AI_SERVICE_TOKEN is not set: the AI service will refuse every /v1 call');
        if (!pseudonymSecret) logger.warn('AI_PSEUDONYM_SECRET is not set: customer pseudonyms change on every restart');
        return new HttpAiClient(baseUrl, timeoutMs, serviceToken, pseudonymSecret);
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

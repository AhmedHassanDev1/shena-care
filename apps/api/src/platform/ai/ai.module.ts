import { Module } from '@nestjs/common';
import { AiClient } from './ai-client.contract';
import { HttpAiClient } from './http-ai.client';

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
  ],
  exports: [AiClient],
})
export class AiModule {}

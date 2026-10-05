const fs = require('fs');
let code = fs.readFileSync('apps/api/src/platform/ai/http-ai.client.ts', 'utf8');

// We want to replace recommendRoutine method
const startIdx = code.indexOf('async recommendRoutine');
const endIdx = code.indexOf('private toTransportRequest');
if (startIdx !== -1 && endIdx !== -1) {
  const newMethod = `  async recommendRoutine(input: GuidanceRecommendationRequest, correlationId?: string): Promise<GuidanceRecommendationResult> {
    const url = \`\${this.baseUrl.replace(/\\/$/, '')}/v1/guidance/recommend\`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const startTime = Date.now();
    const resolvedCorrelationId = correlationId || require('crypto').randomUUID();

    this.logger.log(
      \`AI guidance attempt customer=\${input.customerId} correlation=\${resolvedCorrelationId}\`,
    );

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Correlation-ID': resolvedCorrelationId,
        },
        body: JSON.stringify(input),
        signal: controller.signal,
      });
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      this.logger.error(\`AI guidance network failure latencyMs=\${latencyMs} correlation=\${resolvedCorrelationId}\`);
      throw this.mapNetworkError(err, input.customerId);
    } finally {
      clearTimeout(timer);
    }

    const latencyMs = Date.now() - startTime;

    if (response.status === 503) {
      this.logger.error(\`AI guidance provider error latencyMs=\${latencyMs} status=\${response.status} correlation=\${resolvedCorrelationId}\`);
      throw new AiClientError(AiErrorKind.UNAVAILABLE, 'AI service reported provider unavailable', 503);
    }

    if (!response.ok) {
      this.logger.error(\`AI guidance invalid response latencyMs=\${latencyMs} status=\${response.status} correlation=\${resolvedCorrelationId}\`);
      throw new AiClientError(
        AiErrorKind.INVALID_RESPONSE,
        \`AI service returned unexpected status \${response.status}\`,
        response.status,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      this.logger.error(\`AI guidance malformed response latencyMs=\${latencyMs} correlation=\${resolvedCorrelationId}\`);
      throw new AiClientError(AiErrorKind.INVALID_RESPONSE, 'AI service returned non-JSON body', response.status);
    }

    const raw = body as any;
    if (raw.schemaVersion !== '1') {
      this.logger.error(\`AI guidance schema mismatch latencyMs=\${latencyMs} version=\${raw.schemaVersion} correlation=\${resolvedCorrelationId}\`);
      throw new AiClientError(
        AiErrorKind.INCOMPATIBLE_SCHEMA,
        \`Unsupported AI guidance schemaVersion \${String(raw.schemaVersion)} for \${input.customerId}\`,
      );
    }

    this.logger.log(\`AI guidance success latencyMs=\${latencyMs} correlation=\${resolvedCorrelationId}\`);
    return raw as GuidanceRecommendationResult;
  }

  `;
  code = code.substring(0, startIdx) + newMethod + code.substring(endIdx);
  fs.writeFileSync('apps/api/src/platform/ai/http-ai.client.ts', code);
  console.log("Updated http-ai.client.ts successfully!");
} else {
  console.log("Could not find bounds");
}

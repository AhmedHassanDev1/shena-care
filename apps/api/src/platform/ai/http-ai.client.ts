import { Injectable, Logger } from '@nestjs/common';
import { createHmac, randomBytes, randomUUID } from 'crypto';
import {
  AiClient,
  AiClientError,
  AiErrorKind,
  AiSizeUnit,
  ProductEnrichmentInput,
  ProductEnrichmentResult,
  GuidanceRecommendationRequest,
  GuidanceRecommendationResult,
  ProductContentGenerationInput,
  ProductContentGenerationResult,
  ConsultRespondRequest,
  ConsultRespondResult,
  ConsultStreamHandlers,
  ConsultUnderstandRequest,
  ConsultUnderstandResult,
} from './ai-client.contract';
import { validateSafeUrl } from '../security/url-validator';

const SIZE_UNITS = new Set(['ml', 'l', 'g', 'kg', 'oz', 'unit']);

interface TransportSuggestion {
  normalizedTitle?: string | null;
  brand?: string | null;
  description?: string | null;
  size?: { value?: unknown; unit?: unknown } | null;
  barcode?: string | null;
  ingredients?: unknown;
  benefits?: unknown;
  usage?: unknown;
  warnings?: unknown;
}

interface TransportResult {
  schemaVersion?: unknown;
  suggestions?: TransportSuggestion;
  confidence?: unknown;
  warnings?: unknown;
  providerMetadata?: unknown;
}

@Injectable()
export class HttpAiClient implements AiClient {
  private readonly logger = new Logger(HttpAiClient.name);

  private readonly pseudonymKey: Buffer;

  constructor(
    private readonly baseUrl: string = process.env.AI_SERVICE_URL ?? 'http://localhost:8000',
    private readonly timeoutMs: number = Number(process.env.AI_SERVICE_TIMEOUT_MS ?? 5000),
    /** Shared secret the AI service requires on every /v1 call (AI_SERVICE_TOKEN). */
    private readonly serviceToken: string | undefined = process.env.AI_SERVICE_TOKEN || undefined,
    /** Key for the customer pseudonyms the model sees (AI_PSEUDONYM_SECRET); a per-process key when unset. */
    pseudonymSecret: string | undefined = process.env.AI_PSEUDONYM_SECRET || undefined,
  ) {
    this.pseudonymKey = pseudonymSecret ? Buffer.from(pseudonymSecret) : randomBytes(32);
  }

  async enrichProduct(input: ProductEnrichmentInput, correlationId?: string): Promise<ProductEnrichmentResult> {
    if (input.sourceUrl) {
      validateSafeUrl(input.sourceUrl);
    }
    
    const url = `${this.baseUrl.replace(/\/$/, '')}/v1/enrichment/product`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    this.logger.log(
      `AI enrichment attempt candidate=${input.candidateRef}${correlationId ? ` correlation=${correlationId}` : ''}`,
    );

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: this.requestHeaders(correlationId),
        body: JSON.stringify(this.toTransportRequest(input)),
        signal: controller.signal,
      });
    } catch (err) {
      throw this.mapNetworkError(err, input.candidateRef);
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 503) {
      this.logger.warn(`AI provider unavailable candidate=${input.candidateRef}`);
      throw new AiClientError(AiErrorKind.UNAVAILABLE, 'AI service reported provider unavailable', 503);
    }

    if (!response.ok) {
      throw new AiClientError(
        AiErrorKind.INVALID_RESPONSE,
        `AI service returned unexpected status ${response.status}`,
        response.status,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new AiClientError(AiErrorKind.INVALID_RESPONSE, 'AI service returned non-JSON body', response.status);
    }

    const result = this.validateResult(body, input.candidateRef);
    this.logger.log(`AI enrichment success candidate=${input.candidateRef}`);
    return result;
  }

    async recommendRoutine(input: GuidanceRecommendationRequest, correlationId?: string): Promise<GuidanceRecommendationResult> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/v1/guidance/recommend`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const startTime = Date.now();
    const resolvedCorrelationId = correlationId || randomUUID();
    const transport = this.toGuidanceTransport(input);

    this.logger.log(
      `AI guidance attempt subject=${transport.customerId} correlation=${resolvedCorrelationId}`,
    );

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: this.requestHeaders(resolvedCorrelationId),
        body: JSON.stringify(transport),
        signal: controller.signal,
      });
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      this.logger.error(`AI guidance network failure latencyMs=${latencyMs} correlation=${resolvedCorrelationId}`);
      throw this.mapNetworkError(err, resolvedCorrelationId);
    } finally {
      clearTimeout(timer);
    }

    const latencyMs = Date.now() - startTime;

    if (response.status === 503) {
      this.logger.error(`AI guidance provider error latencyMs=${latencyMs} status=${response.status} correlation=${resolvedCorrelationId}`);
      throw new AiClientError(AiErrorKind.UNAVAILABLE, 'AI service reported provider unavailable', 503);
    }

    if (!response.ok) {
      this.logger.error(`AI guidance invalid response latencyMs=${latencyMs} status=${response.status} correlation=${resolvedCorrelationId}`);
      throw new AiClientError(
        AiErrorKind.INVALID_RESPONSE,
        `AI service returned unexpected status ${response.status}`,
        response.status,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      this.logger.error(`AI guidance malformed response latencyMs=${latencyMs} correlation=${resolvedCorrelationId}`);
      throw new AiClientError(AiErrorKind.INVALID_RESPONSE, 'AI service returned non-JSON body', response.status);
    }

    const raw = body as any;
    if (raw.schemaVersion !== '1') {
      this.logger.error(`AI guidance schema mismatch latencyMs=${latencyMs} version=${raw.schemaVersion} correlation=${resolvedCorrelationId}`);
      throw new AiClientError(
        AiErrorKind.INCOMPATIBLE_SCHEMA,
        `Unsupported AI guidance schemaVersion ${String(raw.schemaVersion)} (correlation ${resolvedCorrelationId})`,
      );
    }

    this.logger.log(`AI guidance success latencyMs=${latencyMs} correlation=${resolvedCorrelationId}`);
    return raw as GuidanceRecommendationResult;
  }

  async generateContent(input: ProductContentGenerationInput, correlationId?: string): Promise<ProductContentGenerationResult> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/v1/content/generate`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs * 2); // content gen takes longer
    const startTime = Date.now();
    const resolvedCorrelationId = correlationId || randomUUID();

    this.logger.log(`AI content generation attempt candidate=${input.candidateId} correlation=${resolvedCorrelationId}`);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: this.requestHeaders(resolvedCorrelationId),
        body: JSON.stringify(input),
        signal: controller.signal,
      });
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      this.logger.error(`AI content generation network failure latencyMs=${latencyMs} correlation=${resolvedCorrelationId}`);
      throw this.mapNetworkError(err, input.candidateId);
    } finally {
      clearTimeout(timer);
    }

    const latencyMs = Date.now() - startTime;

    if (response.status === 503) {
      this.logger.error(`AI content generation provider error latencyMs=${latencyMs} status=${response.status} correlation=${resolvedCorrelationId}`);
      throw new AiClientError(AiErrorKind.UNAVAILABLE, 'AI service reported provider unavailable', 503);
    }

    if (!response.ok) {
      this.logger.error(`AI content generation invalid response latencyMs=${latencyMs} status=${response.status} correlation=${resolvedCorrelationId}`);
      throw new AiClientError(
        AiErrorKind.INVALID_RESPONSE,
        `AI service returned unexpected status ${response.status}`,
        response.status,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      this.logger.error(`AI content generation malformed response latencyMs=${latencyMs} correlation=${resolvedCorrelationId}`);
      throw new AiClientError(AiErrorKind.INVALID_RESPONSE, 'AI service returned non-JSON body', response.status);
    }

    const raw = body as any;
    if (raw.schemaVersion !== '1') {
      this.logger.error(`AI content generation schema mismatch latencyMs=${latencyMs} version=${raw.schemaVersion} correlation=${resolvedCorrelationId}`);
      throw new AiClientError(
        AiErrorKind.INCOMPATIBLE_SCHEMA,
        `Unsupported AI content generation schemaVersion ${String(raw.schemaVersion)} for ${input.candidateId}`,
      );
    }

    this.logger.log(`AI content generation success latencyMs=${latencyMs} correlation=${resolvedCorrelationId}`);
    return raw as ProductContentGenerationResult;
  }

  /**
   * Care consultation, step 1: read the conversation into structured needs. The model sees a pseudonym, the turns and
   * the care context only; never the customer id, name, phone or address.
   */
  async consultUnderstand(input: ConsultUnderstandRequest, correlationId?: string): Promise<ConsultUnderstandResult> {
    const { customerId, ...rest } = input;
    const body = await this.postConsult('understand', { subject: this.pseudonymize(customerId), ...rest }, correlationId);
    if (!body.context || typeof body.context !== 'object' || typeof body.intent !== 'string') {
      throw new AiClientError(AiErrorKind.INVALID_RESPONSE, 'AI understanding is missing intent or context');
    }
    return body as unknown as ConsultUnderstandResult;
  }

  /** Care consultation, step 2: word the answer from what the API retrieved. Products travel as opaque refs (P1, K2). */
  async consultRespond(input: ConsultRespondRequest, correlationId?: string): Promise<ConsultRespondResult> {
    const { customerId, ...rest } = input;
    const body = await this.postConsult('respond', { subject: this.pseudonymize(customerId), ...rest }, correlationId);
    if (typeof body.message !== 'string' || !body.message.trim() || !Array.isArray(body.recommendations)) {
      throw new AiClientError(AiErrorKind.INVALID_RESPONSE, 'AI response is missing its message or recommendations');
    }
    return body as unknown as ConsultRespondResult;
  }

  /**
   * consultRespond over server-sent events (services/ai /v1/consult/respond/stream): `onDelta` gets the answer text
   * as it is written, and the returned result is the same grounded object consultRespond would have returned.
   * Aborting `handlers.signal` closes the connection, which stops generation at the model provider.
   */
  async consultRespondStream(input: ConsultRespondRequest, handlers: ConsultStreamHandlers, correlationId?: string): Promise<ConsultRespondResult> {
    const { customerId, ...rest } = input;
    const url = `${this.baseUrl.replace(/\/$/, '')}/v1/consult/respond/stream`;
    const resolvedCorrelationId = correlationId || randomUUID();
    const controller = new AbortController();
    const forwardAbort = () => controller.abort();
    if (handlers.signal?.aborted) controller.abort();
    else handlers.signal?.addEventListener('abort', forwardAbort, { once: true });
    // Idle timeout, not a total one: a long answer may keep streaming as long as bytes keep arriving.
    const idleMs = this.timeoutMs * 2;
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;
    const arm = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timedOut = true; controller.abort(); }, idleMs);
    };
    const startTime = Date.now();
    let firstDeltaMs: number | null = null;
    const failure = (err: unknown): AiClientError => {
      if (err instanceof AiClientError) return err;
      if (handlers.signal?.aborted) return new AiClientError(AiErrorKind.CANCELLED, 'AI consult respond stream was cancelled');
      if (timedOut) return new AiClientError(AiErrorKind.TIMEOUT, 'AI consult respond stream timed out');
      return new AiClientError(AiErrorKind.UNAVAILABLE, 'AI service unreachable');
    };
    try {
      arm();
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { ...this.requestHeaders(resolvedCorrelationId), Accept: 'text/event-stream' },
          body: JSON.stringify({ subject: this.pseudonymize(customerId), ...rest }),
          signal: controller.signal,
        });
      } catch (err) {
        throw failure(err);
      }
      if (response.status === 429) throw new AiClientError(AiErrorKind.LIMITED, 'AI gateway limit reached', 429);
      if (response.status === 503) throw new AiClientError(AiErrorKind.UNAVAILABLE, 'AI service reported provider unavailable', 503);
      if (!response.ok || !response.body) {
        throw new AiClientError(AiErrorKind.INVALID_RESPONSE, `AI service returned unexpected status ${response.status}`, response.status);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let final: Record<string, unknown> | null = null;
      const handle = (block: string) => {
        let event = 'message';
        const data: string[] = [];
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
        }
        if (!data.length) return;
        let parsed: Record<string, unknown>;
        try { parsed = JSON.parse(data.join('\n')) as Record<string, unknown>; } catch { return; }
        if (event === 'delta' && typeof parsed.text === 'string') {
          if (firstDeltaMs === null) firstDeltaMs = Date.now() - startTime;
          handlers.onDelta(parsed.text);
        } else if (event === 'reset') {
          handlers.onReset();
        } else if (event === 'final') {
          final = parsed;
        } else if (event === 'error') {
          const status = Number(parsed.status);
          throw new AiClientError(
            status === 429 ? AiErrorKind.LIMITED : status === 502 ? AiErrorKind.INVALID_RESPONSE : AiErrorKind.UNAVAILABLE,
            `AI stream failed: ${String(parsed.detail ?? 'unknown')}`.slice(0, 200), Number.isFinite(status) ? status : undefined,
          );
        }
      };
      for (;;) {
        let chunk: { done: boolean; value?: Uint8Array };
        try {
          chunk = await reader.read();
        } catch (err) {
          throw failure(err);
        }
        if (chunk.done) break;
        arm();
        buffer += decoder.decode(chunk.value, { stream: true });
        let boundary: number;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          handle(block);
        }
      }
      if (buffer.trim()) handle(buffer);

      const body = final as Record<string, unknown> | null;
      if (!body) throw failure(new AiClientError(AiErrorKind.INVALID_RESPONSE, 'AI stream ended without a result'));
      if (body.schemaVersion !== '1') {
        throw new AiClientError(AiErrorKind.INCOMPATIBLE_SCHEMA, `Unsupported AI consult schemaVersion ${String(body.schemaVersion)}`);
      }
      if (typeof body.message !== 'string' || !body.message.trim() || !Array.isArray(body.recommendations)) {
        throw new AiClientError(AiErrorKind.INVALID_RESPONSE, 'AI response is missing its message or recommendations');
      }
      this.logger.log(`AI consult respond stream success firstDeltaMs=${firstDeltaMs ?? 'none'} latencyMs=${Date.now() - startTime} correlation=${resolvedCorrelationId}`);
      return body as unknown as ConsultRespondResult;
    } finally {
      if (timer) clearTimeout(timer);
      handlers.signal?.removeEventListener('abort', forwardAbort);
      controller.abort(); // a no-op once the stream is complete; closes the connection on every early exit
    }
  }

  private async postConsult(step: 'understand' | 'respond', payload: Record<string, unknown>, correlationId?: string): Promise<Record<string, unknown>> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/v1/consult/${step}`;
    const resolvedCorrelationId = correlationId || randomUUID();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs * 2);
    const startTime = Date.now();
    let response: Response;
    try {
      response = await fetch(url, { method: 'POST', headers: this.requestHeaders(resolvedCorrelationId), body: JSON.stringify(payload), signal: controller.signal });
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError';
      this.logger.warn(`AI consult ${step} ${aborted ? 'timeout' : 'network failure'} latencyMs=${Date.now() - startTime} correlation=${resolvedCorrelationId}`);
      throw new AiClientError(aborted ? AiErrorKind.TIMEOUT : AiErrorKind.UNAVAILABLE, aborted ? `AI consult ${step} timed out` : 'AI service unreachable');
    } finally {
      clearTimeout(timer);
    }
    const latencyMs = Date.now() - startTime;
    if (response.status === 429) {
      this.logger.warn(`AI consult ${step} limited latencyMs=${latencyMs} correlation=${resolvedCorrelationId}`);
      throw new AiClientError(AiErrorKind.LIMITED, 'AI gateway limit reached', 429);
    }
    if (response.status === 503) {
      this.logger.warn(`AI consult ${step} provider unavailable latencyMs=${latencyMs} correlation=${resolvedCorrelationId}`);
      throw new AiClientError(AiErrorKind.UNAVAILABLE, 'AI service reported provider unavailable', 503);
    }
    if (!response.ok) {
      this.logger.error(`AI consult ${step} unexpected status=${response.status} latencyMs=${latencyMs} correlation=${resolvedCorrelationId}`);
      throw new AiClientError(AiErrorKind.INVALID_RESPONSE, `AI service returned unexpected status ${response.status}`, response.status);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new AiClientError(AiErrorKind.INVALID_RESPONSE, 'AI service returned non-JSON body', response.status);
    }
    const raw = body as Record<string, unknown>;
    if (!raw || raw.schemaVersion !== '1') {
      throw new AiClientError(AiErrorKind.INCOMPATIBLE_SCHEMA, `Unsupported AI consult schemaVersion ${String(raw?.schemaVersion)}`);
    }
    this.logger.log(`AI consult ${step} success latencyMs=${latencyMs} correlation=${resolvedCorrelationId}`);
    return raw;
  }

  private requestHeaders(correlationId?: string): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      ...(this.serviceToken ? { Authorization: `Bearer ${this.serviceToken}` } : {}),
      ...(correlationId ? { 'X-Correlation-ID': correlationId } : {}),
    };
  }

  /**
   * What the model may see of a customer: a keyed pseudonym instead of the customer or guest id, and only the
   * draft fields that shape a routine. Never the id, guest token hash or anything else on the draft row.
   */
  private toGuidanceTransport(input: GuidanceRecommendationRequest) {
    const draft = input.routineDraft;
    const budget = draft?.budget === null || draft?.budget === undefined ? null : Number(draft.budget);
    return {
      customerId: this.pseudonymize(input.customerId),
      profile: {
        skinType: input.profile.skinType ?? null,
        sensitivities: input.profile.sensitivities ?? null,
        concerns: input.profile.concerns,
      },
      chatHistory: input.chatHistory.map(({ role, content }) => ({ role, content })),
      routineDraft: draft
        ? {
            careArea: draft.careArea ?? null,
            primaryConcern: draft.primaryConcern ?? null,
            secondaryGoals: Array.isArray(draft.secondaryGoals) ? draft.secondaryGoals : [],
            budget: budget !== null && Number.isFinite(budget) ? budget : null,
            isBudgetStrict: Boolean(draft.isBudgetStrict),
            maxSteps: draft.maxSteps ?? null,
          }
        : null,
      catalogProducts: input.catalogProducts ?? [],
    };
  }

  /** Stable per subject for log correlation, and not reversible without AI_PSEUDONYM_SECRET. */
  private pseudonymize(subjectId: string): string {
    return `subj_${createHmac('sha256', this.pseudonymKey).update(subjectId).digest('hex').slice(0, 32)}`;
  }

  private toTransportRequest(input: ProductEnrichmentInput): Record<string, unknown> {
    return {
      candidateRef: input.candidateRef,
      sourceType: input.sourceType,
      rawTitle: input.rawTitle,
      brand: input.brand ?? null,
      barcode: input.barcode ?? null,
      packageText: input.packageText ?? null,
      description: input.description ?? null,
      sourceUrl: input.sourceUrl ?? null,
      existingFields: input.existingFields ?? {},
      imageRefs: input.imageRefs ?? [],
    };
  }

  private mapNetworkError(err: unknown, candidateRef: string): AiClientError {
    const aborted = err instanceof Error && err.name === 'AbortError';
    if (aborted) {
      this.logger.warn(`AI enrichment timeout candidate=${candidateRef}`);
      return new AiClientError(AiErrorKind.TIMEOUT, `AI enrichment timed out after ${this.timeoutMs}ms`);
    }
    this.logger.warn(`AI enrichment network failure candidate=${candidateRef}`);
    return new AiClientError(AiErrorKind.UNAVAILABLE, 'AI service unreachable');
  }

  private validateResult(body: unknown, candidateRef: string): ProductEnrichmentResult {
    const failure = (reason: string): AiClientError =>
      new AiClientError(AiErrorKind.INVALID_RESPONSE, `Invalid AI enrichment response for ${candidateRef}: ${reason}`);

    if (typeof body !== 'object' || body === null) throw failure('not an object');
    const raw = body as TransportResult;

    if (raw.schemaVersion !== '1') {
      throw new AiClientError(
        AiErrorKind.INCOMPATIBLE_SCHEMA,
        `Unsupported AI enrichment schemaVersion ${String(raw.schemaVersion)} for ${candidateRef}`,
      );
    }

    const s = raw.suggestions;
    if (typeof s !== 'object' || s === null) throw failure('missing suggestions');

    if (s.normalizedTitle !== undefined && s.normalizedTitle !== null && typeof s.normalizedTitle !== 'string') {
      throw failure('normalizedTitle is not a string');
    }
    if (s.brand !== undefined && s.brand !== null && typeof s.brand !== 'string') {
      throw failure('brand is not a string');
    }
    if (s.description !== undefined && s.description !== null && typeof s.description !== 'string') {
      throw failure('description is not a string');
    }
    if (s.barcode !== undefined && s.barcode !== null) {
      if (typeof s.barcode !== 'string' || !/^\d{8,14}$/.test(s.barcode)) {
        throw failure('barcode is malformed');
      }
    }

    let size: ProductEnrichmentResult['suggestions']['size'] = null;
    if (s.size !== undefined && s.size !== null) {
      if (typeof s.size !== 'object') throw failure('size is not an object');
      const value = s.size.value;
      const unit = s.size.unit;
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw failure('size.value is invalid');
      }
      if (typeof unit !== 'string' || !SIZE_UNITS.has(unit)) {
        throw failure('size.unit is invalid');
      }
      size = { value, unit: unit as AiSizeUnit };
    }

    const stringList = (value: unknown, field: string): string[] => {
      if (value === undefined || value === null) return [];
      if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
        throw failure(`${field} is not a string list`);
      }
      return value;
    };

    const confidence = this.validateStringNumberMap(raw.confidence, 'confidence', failure);
    const providerMetadata = this.validateStringMap(raw.providerMetadata, 'providerMetadata', failure);
    const warnings = stringList(raw.warnings, 'warnings');

    return {
      schemaVersion: '1',
      suggestions: {
        normalizedTitle: s.normalizedTitle ?? null,
        brand: s.brand ?? null,
        description: s.description ?? null,
        size,
        barcode: s.barcode ?? null,
        ingredients: stringList(s.ingredients, 'ingredients'),
        benefits: stringList(s.benefits, 'benefits'),
        usage: stringList(s.usage, 'usage'),
        warnings: stringList(s.warnings, 'suggestions.warnings'),
      },
      confidence,
      warnings,
      providerMetadata,
    };
  }

  private validateStringNumberMap(
    value: unknown,
    field: string,
    failure: (reason: string) => AiClientError,
  ): Record<string, number> {
    if (value === undefined || value === null) return {};
    if (typeof value !== 'object' || Array.isArray(value)) throw failure(`${field} is not an object`);
    const out: Record<string, number> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (typeof entry !== 'number' || !Number.isFinite(entry)) {
        throw failure(`${field}.${key} is not a number`);
      }
      out[key] = entry;
    }
    return out;
  }

  private validateStringMap(
    value: unknown,
    field: string,
    failure: (reason: string) => AiClientError,
  ): Record<string, string> {
    if (value === undefined || value === null) return {};
    if (typeof value !== 'object' || Array.isArray(value)) throw failure(`${field} is not an object`);
    const out: Record<string, string> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (typeof entry !== 'string') {
        throw failure(`${field}.${key} is not a string`);
      }
      out[key] = entry;
    }
    return out;
  }
}

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

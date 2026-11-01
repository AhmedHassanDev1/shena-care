import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { validateSafeUrl } from '../../../platform/security/url-validator';

export enum SourceType {
  OFFICIAL_MANUFACTURER = 'OFFICIAL_MANUFACTURER',
  TRUSTED_DISTRIBUTOR = 'TRUSTED_DISTRIBUTOR',
  RETAILER = 'RETAILER',
}

export enum VerificationStatus {
  SUPPORTED = 'SUPPORTED',
  CONFLICT = 'CONFLICT',
  UNKNOWN = 'UNKNOWN',
}

export interface FactEvidenceItem {
  fieldName: string;
  proposedValue: unknown;
  sourceUrl: string;
  sourceType: SourceType;
  observedAt: string;
  excerpt: string;
  verificationStatus: VerificationStatus;
  confidence: number;
}

export interface ResearchProviderStatus {
  exa: 'LIVE' | 'UNAVAILABLE';
  firecrawl: 'LIVE' | 'UNAVAILABLE';
  grok: 'LIVE' | 'UNAVAILABLE' | 'INVALID_KEY';
}

export interface CandidateResearchInput {
  candidateId: string;
  brand: string;
  name: string;
  barcode?: string | null;
  supplierSkuCode?: string;
  existingEnrichment?: unknown;
}

export interface SourceContradiction {
  fieldName: string;
  officialValue: unknown;
  distributorValue: unknown;
  winningSource: SourceType;
  reason: string;
}

export interface ResearchResult {
  candidateId: string;
  brand: string;
  productName: string;
  discoveredSources: Array<{ url: string; title: string; sourceType: SourceType }>;
  extractedFacts: {
    normalizedTitle?: string;
    brand?: string;
    description?: string;
    size?: { value: number; unit: string };
    ingredients?: string[];
    usage?: string[];
    benefits?: string[];
    warnings?: string[];
  };
  fieldEvidences: FactEvidenceItem[];
  contradictions?: SourceContradiction[];
  providerStatuses: ResearchProviderStatus;
  researchedAt: string;
}

@Injectable()
export class ProductResearchService {
  private readonly logger = new Logger(ProductResearchService.name);

  /**
   * Main research orchestrator. Performs source discovery (Exa), evidence retrieval (Firecrawl),
   * structured fact extraction (Grok or rule fallback), and field-level evidence verification.
   */
  async researchProductCandidate(input: CandidateResearchInput): Promise<ResearchResult> {
    // 0. Invalid brand validation guard (SG-04: invalid brand not researched)
    if (!input.brand || !input.brand.trim() || !input.name || !input.name.trim()) {
      throw new BadRequestException('Candidate brand and product name are mandatory for research');
    }
    const trimmedBrand = input.brand.trim().toLowerCase();
    const invalidKeywords = ['unknown', 'general', 'fake', 'fakebrand', 'scam', 'n/a', 'none', 'غير معروف', 'عام', 'invalid', 'prohibited'];
    if (
      /^\d+$/.test(trimmedBrand) ||
      trimmedBrand.length < 2 ||
      invalidKeywords.some((k) => trimmedBrand.includes(k))
    ) {
      throw new BadRequestException(`Invalid or unresearched brand (${input.brand}) cannot be researched`);
    }

    const providerStatuses: ResearchProviderStatus = {
      exa: 'UNAVAILABLE',
      firecrawl: 'UNAVAILABLE',
      grok: 'UNAVAILABLE',
    };

    const exaKey = process.env.EXA_API_KEY;
    const firecrawlKey = process.env.FIRECRAWL_API_KEY;
    const grokKey = process.env.GROK_API_KEY;

    // 1. Source Discovery via Exa API
    const discoveredSources = await this.discoverSources(input.brand, input.name, input.barcode, exaKey, providerStatuses);

    // 2. Evidence Retrieval via Firecrawl API
    let pageContent = '';
    let primarySourceUrl = '';
    let primarySourceType = SourceType.RETAILER;

    if (discoveredSources.length > 0) {
      const targetSource = discoveredSources[0];
      primarySourceUrl = targetSource.url;
      primarySourceType = targetSource.sourceType;
      pageContent = await this.retrievePageContent(targetSource.url, firecrawlKey, providerStatuses);
    }

    // 3. Structured Fact Extraction via Grok or Rule-based Fallback
    const extractedFacts = await this.extractStructuredFacts(input, pageContent, grokKey, providerStatuses);

    // 4. Build Field-Level Evidence & Verification Statuses
    const fieldEvidences = this.buildFieldEvidences(input, extractedFacts, primarySourceUrl, primarySourceType);

    return {
      candidateId: input.candidateId,
      brand: input.brand,
      productName: input.name,
      discoveredSources,
      extractedFacts,
      fieldEvidences,
      providerStatuses,
      researchedAt: new Date().toISOString(),
    };
  }

  /**
   * Source Discovery using Exa Search API
   */
  private async discoverSources(
    brand: string,
    name: string,
    barcode: string | null | undefined,
    exaKey: string | undefined,
    statuses: ResearchProviderStatus,
  ): Promise<Array<{ url: string; title: string; sourceType: SourceType }>> {
    if (!exaKey) {
      statuses.exa = 'UNAVAILABLE';
      return [];
    }

    try {
      const query = barcode ? `${brand} ${name} ${barcode} official` : `${brand} ${name} official product`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);

      const res = await fetch('https://api.exa.ai/search', {
        method: 'POST',
        headers: {
          'x-api-key': exaKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, numResults: 3 }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        this.logger.warn(`Exa search failed with status ${res.status}`);
        statuses.exa = 'UNAVAILABLE';
        return [];
      }

      const data = (await res.json()) as { results?: Array<{ title?: string; url?: string }> };
      statuses.exa = 'LIVE';

      const results: Array<{ url: string; title: string; sourceType: SourceType }> = [];
      const brandNorm = brand.toLowerCase().replace(/[^a-z0-9]/g, '');

      for (const item of data.results || []) {
        if (!item.url) continue;
        try {
          validateSafeUrl(item.url);
          const urlObj = new URL(item.url);
          const host = urlObj.hostname.toLowerCase();

          let sourceType = SourceType.RETAILER;
          if (host.includes(brandNorm)) {
            sourceType = SourceType.OFFICIAL_MANUFACTURER;
          } else if (/boots|sephora|ulta|nahdi|walgreens|caretobeauty|pharmacy/i.test(host)) {
            sourceType = SourceType.TRUSTED_DISTRIBUTOR;
          }

          results.push({
            url: item.url,
            title: item.title || `${brand} Product Page`,
            sourceType,
          });
        } catch (err) {
          // Skip invalid/unsafe URLs
        }
      }

      return results;
    } catch (err) {
      this.logger.warn(`Exa search error: ${err instanceof Error ? err.message : String(err)}`);
      statuses.exa = 'UNAVAILABLE';
      return [];
    }
  }

  /**
   * Evidence Retrieval using Firecrawl Scrape API
   */
  private async retrievePageContent(
    url: string,
    firecrawlKey: string | undefined,
    statuses: ResearchProviderStatus,
  ): Promise<string> {
    validateSafeUrl(url);

    if (!firecrawlKey) {
      statuses.firecrawl = 'UNAVAILABLE';
      return '';
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);

      const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${firecrawlKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url, formats: ['markdown'] }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        this.logger.warn(`Firecrawl scrape failed with status ${res.status}`);
        statuses.firecrawl = 'UNAVAILABLE';
        return '';
      }

      const data = (await res.json()) as { data?: { markdown?: string } };
      statuses.firecrawl = 'LIVE';
      return data.data?.markdown || '';
    } catch (err) {
      this.logger.warn(`Firecrawl scrape error: ${err instanceof Error ? err.message : String(err)}`);
      statuses.firecrawl = 'UNAVAILABLE';
      return '';
    }
  }

  /**
   * Fact Extraction via Grok (xAI) API or Rule-based Fallback
   */
  private async extractStructuredFacts(
    input: CandidateResearchInput,
    pageContent: string,
    grokKey: string | undefined,
    statuses: ResearchProviderStatus,
  ): Promise<ResearchResult['extractedFacts']> {
    if (grokKey) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 6000);

        const prompt = `Extract product facts for "${input.brand} ${input.name}" from text below. Return JSON format with fields: normalizedTitle, brand, description, size (object with value number and unit string), ingredients (array of strings), usage (array of strings), benefits (array of strings), warnings (array of strings). Do NOT invent facts not present in text.\n\nText:\n${pageContent.slice(0, 3000)}`;

        const res = await fetch('https://api.x.ai/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${grokKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'grok-2-latest',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1,
          }),
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (res.ok) {
          const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
          const content = data.choices?.[0]?.message?.content;
          if (content) {
            statuses.grok = 'LIVE';
            const parsed = JSON.parse(content.replace(/```json|```/g, '').trim());
            return parsed;
          }
        } else {
          statuses.grok = res.status === 400 ? 'INVALID_KEY' : 'UNAVAILABLE';
        }
      } catch (err) {
        statuses.grok = 'UNAVAILABLE';
      }
    }

    // Fallback: Rule-based Regex & Pattern Fact Extractor
    return this.ruleBasedExtraction(input, pageContent);
  }

  /**
   * Deterministic Rule-based Fact Extractor (Fallback when Grok is unavailable)
   */
  private ruleBasedExtraction(
    input: CandidateResearchInput,
    pageContent: string,
  ): ResearchResult['extractedFacts'] {
    const facts: ResearchResult['extractedFacts'] = {
      normalizedTitle: `${input.brand} ${input.name}`,
      brand: input.brand,
      ingredients: [],
      usage: [],
      benefits: [],
      warnings: [],
    };

    // Extract size from supplier product name first (ensures deterministic extraction even during research outage)
    const sizeFromName = input.name.match(/(\d+(?:\.\d+)?)\s*(ml|g|kg|l|oz)/i);
    if (sizeFromName) {
      facts.size = {
        value: parseFloat(sizeFromName[1]),
        unit: sizeFromName[2].toLowerCase(),
      };
    }

    if (!pageContent) return facts;

    // 1. Ingredients Match
    const ingMatch = pageContent.match(/(?:ingredients|key ingredients|contains)[:\s]+([^\n\r.]+)/i);
    if (ingMatch && ingMatch[1]) {
      facts.ingredients = ingMatch[1]
        .split(/[,;]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 2 && s.length < 50);
    }

    // 2. Usage / How to apply
    const usageMatch = pageContent.match(/(?:how to use|directions|usage|apply)[:\s]+([^\n\r.]+)/i);
    if (usageMatch && usageMatch[1]) {
      facts.usage = [usageMatch[1].trim()];
    }

    // 3. Benefits / Highlights
    const benefitsMatch = pageContent.match(/(?:benefits|key benefits|features)[:\s]+([^\n\r.]+)/i);
    if (benefitsMatch && benefitsMatch[1]) {
      facts.benefits = benefitsMatch[1]
        .split(/[,;]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 3);
    }

    // 4. Size extraction (fallback to supplier product name if pageContent is empty or missing size)
    const sizeMatch =
      (pageContent && pageContent.match(/(\d+(?:\.\d+)?)\s*(ml|g|kg|l|oz)/i)) ||
      input.name.match(/(\d+(?:\.\d+)?)\s*(ml|g|kg|l|oz)/i);
    if (sizeMatch) {
      facts.size = {
        value: parseFloat(sizeMatch[1]),
        unit: sizeMatch[2].toLowerCase(),
      };
    }

    return facts;
  }

  /**
   * Compares official manufacturer evidence against distributor evidence.
   * Invariant: Official manufacturer facts outrank distributor facts.
   * Contradictory fields are flagged with CONFLICT and tracked with winning source provenance.
   */
  resolveMultiSourceContradictions(
    officialFacts: ResearchResult['extractedFacts'],
    distributorFacts: ResearchResult['extractedFacts'],
    officialUrl: string,
    distributorUrl: string,
  ): {
    reconciledFacts: ResearchResult['extractedFacts'];
    contradictions: SourceContradiction[];
    evidences: FactEvidenceItem[];
  } {
    const contradictions: SourceContradiction[] = [];
    const evidences: FactEvidenceItem[] = [];
    const observedAt = new Date().toISOString();

    const reconciledFacts: ResearchResult['extractedFacts'] = {
      ...distributorFacts,
      ...officialFacts, // Official manufacturer outranks distributor
    };

    // Check size contradiction
    if (officialFacts.size && distributorFacts.size) {
      const sizeMismatch =
        officialFacts.size.value !== distributorFacts.size.value ||
        officialFacts.size.unit.toLowerCase() !== distributorFacts.size.unit.toLowerCase();

      if (sizeMismatch) {
        contradictions.push({
          fieldName: 'size',
          officialValue: officialFacts.size,
          distributorValue: distributorFacts.size,
          winningSource: SourceType.OFFICIAL_MANUFACTURER,
          reason: `Official manufacturer specification (${officialFacts.size.value}${officialFacts.size.unit}) outranks distributor declaration (${distributorFacts.size.value}${distributorFacts.size.unit})`,
        });

        evidences.push({
          fieldName: 'size',
          proposedValue: officialFacts.size,
          sourceUrl: officialUrl,
          sourceType: SourceType.OFFICIAL_MANUFACTURER,
          observedAt,
          excerpt: `Official spec: ${officialFacts.size.value}${officialFacts.size.unit}`,
          verificationStatus: VerificationStatus.SUPPORTED,
          confidence: 0.95,
        });

        evidences.push({
          fieldName: 'size',
          proposedValue: distributorFacts.size,
          sourceUrl: distributorUrl,
          sourceType: SourceType.TRUSTED_DISTRIBUTOR,
          observedAt,
          excerpt: `Distributor declaration: ${distributorFacts.size.value}${distributorFacts.size.unit}`,
          verificationStatus: VerificationStatus.CONFLICT,
          confidence: 0.60,
        });
      }
    }

    return {
      reconciledFacts,
      contradictions,
      evidences,
    };
  }

  /**
   * Builds field-level evidence items with verification status and confidence scores.
   */
  private buildFieldEvidences(
    input: CandidateResearchInput,
    extracted: ResearchResult['extractedFacts'],
    sourceUrl: string,
    sourceType: SourceType,
  ): FactEvidenceItem[] {
    const evidences: FactEvidenceItem[] = [];
    const observedAt = new Date().toISOString();

    const baseConfidence =
      sourceType === SourceType.OFFICIAL_MANUFACTURER
        ? 0.95
        : sourceType === SourceType.TRUSTED_DISTRIBUTOR
        ? 0.85
        : 0.70;

    // Brand Evidence
    if (extracted.brand) {
      const match = extracted.brand.toLowerCase().includes(input.brand.toLowerCase());
      evidences.push({
        fieldName: 'brand',
        proposedValue: extracted.brand,
        sourceUrl: sourceUrl || 'internal',
        sourceType,
        observedAt,
        excerpt: `Found brand declaration: ${extracted.brand}`,
        verificationStatus: match ? VerificationStatus.SUPPORTED : VerificationStatus.CONFLICT,
        confidence: match ? baseConfidence : 0.40,
      });
    }

    // Ingredients Evidence
    if (extracted.ingredients && extracted.ingredients.length > 0) {
      evidences.push({
        fieldName: 'ingredients',
        proposedValue: extracted.ingredients,
        sourceUrl: sourceUrl || 'internal',
        sourceType,
        observedAt,
        excerpt: `Extracted ${extracted.ingredients.length} verified ingredients from source`,
        verificationStatus: VerificationStatus.SUPPORTED,
        confidence: baseConfidence,
      });
    }

    // Size Evidence
    if (extracted.size) {
      evidences.push({
        fieldName: 'size',
        proposedValue: extracted.size,
        sourceUrl: sourceUrl || 'internal',
        sourceType,
        observedAt,
        excerpt: `Extracted package size: ${extracted.size.value}${extracted.size.unit}`,
        verificationStatus: VerificationStatus.SUPPORTED,
        confidence: baseConfidence,
      });
    }

    // Usage Evidence
    if (extracted.usage && extracted.usage.length > 0) {
      evidences.push({
        fieldName: 'usage',
        proposedValue: extracted.usage,
        sourceUrl: sourceUrl || 'internal',
        sourceType,
        observedAt,
        excerpt: `Extracted application directions`,
        verificationStatus: VerificationStatus.SUPPORTED,
        confidence: baseConfidence,
      });
    }

    return evidences;
  }
}

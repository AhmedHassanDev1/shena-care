import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { AiClient } from '../../../platform/ai';
import { CatalogService } from '../../catalog/public';
import { ReviewCandidateContentDto, RecordCandidateEvidenceDto } from '../dto/ingestion.dto';
import { isTrustedMediaSource, requireMediaReview } from '../../../platform/security/media-review';
import { Prisma } from '@prisma/client';
import { FactEvidenceItem } from './product-research.service';

interface StoredContentReview {
  language: string;
  fields: Array<ReviewCandidateContentDto['fields'][number] & { sourceValue: unknown }>;
  reviewedBy: string;
  reviewedAt: string;
  identity: { barcode: string | null; name: string; brand: string; size: number; sizeUnit: string; variantName: string };
}

interface CandidateEnrichment {
  research?: { fieldEvidences?: FactEvidenceItem[] };
  media?: Array<{ originType: string; isTest?: boolean; review?: unknown }>;
  contentReview?: StoredContentReview | null;
}

export interface PublishedContent {
  language: 'ar';
  name: string | null;
  description: string | null;
  ingredients: string | null;
  usage: string | null;
  warnings: string | null;
  verifiedFacts: Array<{ skuId: string; field: string; value: string; sourceUrl: string; sourceType: string; verifiedAt: string }>;
}

@Injectable()
export class ProductContentService {
  private readonly logger = new Logger(ProductContentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiClient: AiClient,
    private readonly catalog: CatalogService,
  ) {}

  async recordSourceEvidence(candidateId: string, dto: RecordCandidateEvidenceDto, reviewerId: string) {
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`candidate:${candidateId}`}))`;
      const item = await tx.ingestionItem.findUnique({ where: { id: candidateId } });
      if (!item) throw new NotFoundException('Candidate not found');
      if (item.status === 'published' || item.status === 'rejected') throw new BadRequestException('Candidate evidence is immutable in this state');
      const reviewer = await tx.customer.findUnique({ where: { id: reviewerId } });
      if (!reviewer?.roles.some(role => role === 'ADMIN' || role === 'HUB_OPERATOR')) throw new BadRequestException('Authorized evidence reviewer required');
      if (new Set(dto.fields.map(f => f.field)).size !== dto.fields.length || dto.fields.some(f => !isTrustedMediaSource(f.sourceUrl))) {
        throw new BadRequestException('Distinct fields and trusted source evidence are required');
      }
      const enrichment = (item.enrichment as unknown as CandidateEnrichment) || {};
      const observedAt = new Date().toISOString();
      const recorded = dto.fields.map(f => ({ fieldName: f.field, proposedValue: f.field === 'size' ? { value: f.size!, unit: f.sizeUnit! } : f.value!,
        sourceUrl: f.sourceUrl, sourceType: f.sourceType, excerpt: f.excerpt, observedAt, verificationStatus: 'SUPPORTED',
        confidence: 1, reviewedBy: reviewerId, reviewedAt: observedAt }));
      const previous = Array.isArray(enrichment.research?.fieldEvidences) ? enrichment.research!.fieldEvidences! : [];
      const changesIdentity = dto.fields.some(f => ['name', 'brand', 'barcode', 'size'].includes(f.field));
      const media = Array.isArray(enrichment.media) ? enrichment.media.map(m => changesIdentity ?
        { ...m, originType: m.isTest ? 'test' : 'unverified', review: null } : m) : [];
      const changed = await tx.ingestionItem.updateMany({ where: { id: candidateId, updatedAt: item.updatedAt }, data: {
        status: 'review_required', enrichment: { ...enrichment, contentReview: null, media,
          research: { ...enrichment.research, fieldEvidences: [...previous.filter(e => !dto.fields.some(f => f.field === e.fieldName)), ...recorded] } } as unknown as Prisma.InputJsonValue,
      } });
      if (!changed.count) throw new ConflictException('Candidate changed while recording evidence; retry');
      await tx.ingestionJob.updateMany({ where: { id: item.jobId, status: 'approved' }, data: { status: 'review_required' } });
      return { id: candidateId, recordedFields: recorded.map(f => f.fieldName), observedAt };
    }, { timeout: 30000, maxWait: 10000 });
  }

  async reviewContent(candidateId: string, dto: ReviewCandidateContentDto, reviewerId: string) {
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`candidate:${candidateId}`}))`;
      return this.reviewContentLocked(candidateId, dto, reviewerId);
    }, { timeout: 30000, maxWait: 10000 });
  }

  private async reviewContentLocked(candidateId: string, dto: ReviewCandidateContentDto, reviewerId: string) {
    const item = await this.prisma.ingestionItem.findUnique({ where: { id: candidateId } });
    if (!item) throw new NotFoundException('Candidate not found');
    if (item.status === 'published' || item.status === 'rejected') throw new BadRequestException('Candidate cannot be reviewed in this state');
    const reviewer = await this.prisma.customer.findUnique({ where: { id: reviewerId } });
    if (!reviewer?.roles.some(role => role === 'ADMIN' || role === 'HUB_OPERATOR')) throw new BadRequestException('Authorized content reviewer required');
    if (new Set(dto.fields.map(f => f.field)).size !== dto.fields.length) throw new BadRequestException('Duplicate reviewed content fields');
    const enrichment = (item.enrichment as unknown as CandidateEnrichment) || {};
    const evidence = enrichment.research?.fieldEvidences;
    const media = Array.isArray(enrichment.media) ? enrichment.media.find(m => m.originType === 'verified') : undefined;
    const identity = requireMediaReview(media?.review);
    if (identity.candidateId !== candidateId || identity.barcode !== item.barcode) throw new BadRequestException('Content review requires reviewed candidate identity');
    const fields = dto.fields.map(field => {
      const fact = Array.isArray(evidence) && evidence.find(e => e.fieldName === field.field &&
        e.sourceUrl === field.sourceUrl && e.sourceType === field.sourceType && e.verificationStatus === 'SUPPORTED' &&
        e.proposedValue !== null && e.proposedValue !== undefined && e.proposedValue !== '');
      if (!fact || !isTrustedMediaSource(field.sourceUrl)) throw new BadRequestException('Content requires matching trusted source evidence for every field');
      return { ...field, sourceValue: fact.proposedValue };
    });
    const review = { language: 'ar', fields, reviewedBy: reviewerId, reviewedAt: new Date().toISOString(),
      identity: { barcode: item.barcode, name: item.name, brand: item.brand, size: identity.size, sizeUnit: identity.sizeUnit, variantName: identity.variantName } };
    const changed = await this.prisma.ingestionItem.updateMany({ where: { id: candidateId, updatedAt: item.updatedAt, status: { notIn: ['published', 'rejected'] } },
      data: { enrichment: { ...enrichment, contentReview: review } as unknown as Prisma.InputJsonValue } });
    if (!changed.count) throw new ConflictException('Candidate changed during review; reload and review again');
    return { id: candidateId, language: 'ar', reviewedFields: fields.map(f => f.field), reviewedAt: review.reviewedAt };
  }

  async getPublishedContent(skuIds: string[]): Promise<Map<string, PublishedContent>> {
    const result = new Map<string, PublishedContent>();
    if (!skuIds.length) return result;
    const items = await this.prisma.ingestionItem.findMany({ where: { status: 'published', matchedSkuId: { in: skuIds } },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }] });
    const identities = new Map(await Promise.all(skuIds.map(async id => [id, await this.catalog.getSkuIdentity(id)] as const)));
    for (const item of items) {
      const review = (item.enrichment as unknown as CandidateEnrichment)?.contentReview;
      const sku = identities.get(item.matchedSkuId!);
      if (!sku?.isActive || result.has(sku.id) || !review || review.language !== 'ar' || !Array.isArray(review.fields) ||
        review.identity?.barcode !== sku.barcode || review.identity.name !== item.name || review.identity.brand !== item.brand ||
        review.identity.size !== sku.size || review.identity.sizeUnit !== sku.sizeUnit || review.identity.variantName !== sku.variantName) continue;
      const fields = review.fields.filter(f => ['name', 'description', 'ingredients', 'usage', 'warnings'].includes(f.field) &&
        typeof f.value === 'string' && isTrustedMediaSource(f.sourceUrl));
      if (!fields.length) continue;
      const value = (field: string): string | null => fields.find(f => f.field === field)?.value ?? null;
      result.set(sku.id, { language: 'ar', name: value('name'), description: value('description'), ingredients: value('ingredients'),
        usage: value('usage'), warnings: value('warnings'), verifiedFacts: fields.map(f => ({ skuId: sku.id, field: f.field,
          value: f.value, sourceUrl: f.sourceUrl, sourceType: f.sourceType, verifiedAt: review.reviewedAt })) });
    }
    return result;
  }

  async generateContent(candidateId: string) {
    const candidate = await this.prisma.ingestionItem.findUnique({
      where: { id: candidateId },
    });

    if (!candidate) {
      throw new NotFoundException(`Candidate ${candidateId} not found`);
    }

    const facts = candidate.enrichment || {};
    // Extract research evidence if available
    const researchEvidence = (facts as any).fieldEvidences || [];

    this.logger.log(`Generating content for candidate ${candidateId}`);

    // Call AI provider to generate AR/EN content based on facts
    const result = await this.aiClient.generateContent({
      candidateId,
      facts,
      researchEvidence,
    });

    const content = result.content;
    const providerMetadata = result.providerMetadata;

    // Persist draft in database
    const draft = await this.prisma.productContentDraft.upsert({
      where: { candidateId },
      create: {
        candidateId,
        language: 'mixed', // Contains both AR/EN in the same record
        titleEn: content.titleEn,
        titleAr: content.titleAr,
        shortDescriptionEn: content.shortDescriptionEn,
        shortDescriptionAr: content.shortDescriptionAr,
        descriptionEn: content.descriptionEn,
        descriptionAr: content.descriptionAr,
        benefitsEn: content.benefitsEn || [],
        benefitsAr: content.benefitsAr || [],
        usageEn: content.usageInstructionsEn || [],
        usageAr: content.usageInstructionsAr || [],
        routineStepEn: content.routineStepEn,
        routineStepAr: content.routineStepAr,
        keywords: content.keywords || [],
        seoTitleEn: content.seoTitleEn,
        seoTitleAr: content.seoTitleAr,
        seoDescriptionEn: content.seoDescriptionEn,
        seoDescriptionAr: content.seoDescriptionAr,
        evidenceVersion: 'v1', // Should ideally be a hash of facts, simplified here
        modelVersion: providerMetadata.model || 'unknown',
        isApproved: false,
      },
      update: {
        titleEn: content.titleEn,
        titleAr: content.titleAr,
        shortDescriptionEn: content.shortDescriptionEn,
        shortDescriptionAr: content.shortDescriptionAr,
        descriptionEn: content.descriptionEn,
        descriptionAr: content.descriptionAr,
        benefitsEn: content.benefitsEn || [],
        benefitsAr: content.benefitsAr || [],
        usageEn: content.usageInstructionsEn || [],
        usageAr: content.usageInstructionsAr || [],
        routineStepEn: content.routineStepEn,
        routineStepAr: content.routineStepAr,
        keywords: content.keywords || [],
        seoTitleEn: content.seoTitleEn,
        seoTitleAr: content.seoTitleAr,
        seoDescriptionEn: content.seoDescriptionEn,
        seoDescriptionAr: content.seoDescriptionAr,
        evidenceVersion: 'v1',
        modelVersion: providerMetadata.model || 'unknown',
        isApproved: false,
      },
    });

    this.logger.log(`Draft content saved for candidate ${candidateId}`);

    return {
      candidateId,
      draft,
      metadata: providerMetadata,
    };
  }
}

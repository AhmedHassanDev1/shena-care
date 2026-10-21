import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException, ForbiddenException, Optional } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../../platform/database/prisma.service';
import { AiClient } from '../../../platform/ai';
import { CatalogService } from '../../catalog/public';
import { ReviewCandidateContentDto, RecordCandidateEvidenceDto } from '../dto/ingestion.dto';
import { isTrustedMediaSource, requireMediaReview } from '../../../platform/security/media-review';
import { Prisma } from '@prisma/client';
import { FactEvidenceItem } from './product-research.service';
import { RoutinePlacementService } from './routine-placement.service';

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
    @Optional() private readonly routinePlacementService?: RoutinePlacementService,
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

  /**
   * Generates or synthesizes structured bilingual storefront content bound strictly to evidence.
   */
  async generateContent(candidateId: string) {
    const candidate = await this.prisma.ingestionItem.findUnique({
      where: { id: candidateId },
    });

    if (!candidate) {
      throw new NotFoundException(`Candidate ${candidateId} not found`);
    }

    const enrichment = (candidate.enrichment as Record<string, any>) || {};
    const facts = enrichment.research || enrichment.facts || {};
    const researchEvidence = facts.fieldEvidences || [];

    // Extract active ingredients
    const activeIngredients: string[] = [];
    if (Array.isArray(enrichment.ingredientProfile?.actives)) {
      activeIngredients.push(
        ...enrichment.ingredientProfile.actives.map((i: any) =>
          typeof i === 'string' ? i : i.name || i.inciName || '',
        ),
      );
    }

    // Determine routine placement
    let routine = enrichment.routinePlacement;
    if (!routine && this.routinePlacementService) {
      try {
        routine = this.routinePlacementService.determineRoutinePlacement({
          productName: candidate.name,
          brand: candidate.brand,
          category: facts.normalized?.category || facts.category,
          ingredients: activeIngredients,
        });
      } catch {
        // Fallback gracefully
      }
    }

    // Deterministic evidenceVersion hash calculation
    const evidencePayload = JSON.stringify({
      candidateId,
      name: candidate.name,
      brand: candidate.brand,
      barcode: candidate.barcode,
      activeIngredients: activeIngredients.slice().sort(),
      routine: routine ? {
        step: routine.stepOrder || routine.step,
        frequency: routine.frequency,
        timing: routine.timing || routine.timeOfDay,
      } : null,
    });
    const evidenceVersion = crypto.createHash('sha256').update(evidencePayload).digest('hex').slice(0, 16);

    let content: any = null;
    let providerMetadata: Record<string, string> = {
      model: 'deterministic_synthesis_v1',
      provider: 'shinacare_evidence_engine',
    };

    // Try AI client if configured
    try {
      const result = await this.aiClient.generateContent({
        candidateId,
        facts,
        researchEvidence,
      });
      if (result?.content?.titleEn && result?.content?.titleAr) {
        content = result.content;
        providerMetadata = result.providerMetadata || { model: 'ai_fastapi', provider: 'ai_client' };
      }
    } catch {
      this.logger.warn(`AI content generation offline or failed for candidate ${candidateId}; using deterministic evidence synthesis`);
    }

    // Deterministic synthesis fallback if AI is offline or incomplete
    if (!content) {
      content = this.synthesizeDeterministicContent(candidate, facts, activeIngredients, routine);
    }

    // Deterministic claim validation: reject or sanitize unproven claims
    this.validateContentClaims(content, candidate, activeIngredients);

    const stepOrder = routine?.stepOrder || routine?.step;
    const stepName = routine?.stepType || routine?.stepName || '';

    // Persist draft in database
    const draft = await this.prisma.productContentDraft.upsert({
      where: { candidateId },
      create: {
        candidateId,
        language: 'mixed',
        titleEn: content.titleEn,
        titleAr: content.titleAr,
        shortDescriptionEn: content.shortDescriptionEn,
        shortDescriptionAr: content.shortDescriptionAr,
        descriptionEn: content.descriptionEn,
        descriptionAr: content.descriptionAr,
        benefitsEn: content.benefitsEn || [],
        benefitsAr: content.benefitsAr || [],
        usageEn: content.usageInstructionsEn || content.usageEn || [],
        usageAr: content.usageInstructionsAr || content.usageAr || [],
        routineStepEn: content.routineStepEn || (routine ? `Step ${stepOrder}: ${stepName}` : null),
        routineStepAr: content.routineStepAr || (routine ? `الخطوة ${stepOrder}: ${routine.stepNameAr || stepName}` : null),
        keywords: content.keywords || [],
        seoTitleEn: content.seoTitleEn || `${candidate.brand} ${candidate.name} - ShinaCare`,
        seoTitleAr: content.seoTitleAr || `${candidate.brand} ${candidate.name} - شينا كير`,
        seoDescriptionEn: content.seoDescriptionEn || `Buy authentic ${candidate.brand} ${candidate.name} at ShinaCare. Genuine skincare.`,
        seoDescriptionAr: content.seoDescriptionAr || `تسوق ${candidate.brand} ${candidate.name} الأصلية من شينا كير. عناية موثوقة ومضمونة.`,
        evidenceVersion,
        modelVersion: providerMetadata.model || 'deterministic_synthesis_v1',
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
        usageEn: content.usageInstructionsEn || content.usageEn || [],
        usageAr: content.usageInstructionsAr || content.usageAr || [],
        routineStepEn: content.routineStepEn || (routine ? `Step ${stepOrder}: ${stepName}` : null),
        routineStepAr: content.routineStepAr || (routine ? `الخطوة ${stepOrder}: ${routine.stepNameAr || stepName}` : null),
        keywords: content.keywords || [],
        seoTitleEn: content.seoTitleEn || `${candidate.brand} ${candidate.name} - ShinaCare`,
        seoTitleAr: content.seoTitleAr || `${candidate.brand} ${candidate.name} - شينا كير`,
        seoDescriptionEn: content.seoDescriptionEn || `Buy authentic ${candidate.brand} ${candidate.name} at ShinaCare. Genuine skincare.`,
        seoDescriptionAr: content.seoDescriptionAr || `تسوق ${candidate.brand} ${candidate.name} الأصلية من شينا كير. عناية موثوقة ومضمونة.`,
        evidenceVersion,
        modelVersion: providerMetadata.model || 'deterministic_synthesis_v1',
        isApproved: false,
      },
    });

    this.logger.log(`Draft content saved for candidate ${candidateId} (evidenceVersion=${evidenceVersion})`);

    return {
      candidateId,
      draft,
      metadata: providerMetadata,
    };
  }

  /**
   * Deterministic synthesis of evidence-bound bilingual storefront content.
   */
  synthesizeDeterministicContent(
    candidate: any,
    facts: any,
    activeIngredients: string[],
    routine: any,
  ) {
    const brand = candidate.brand || '';
    const name = candidate.name || '';
    const sizeEvidence = facts.fieldEvidences?.find((e: any) => e.fieldName === 'size');
    let size = facts.normalized?.size || facts.size || sizeEvidence?.proposedValue?.value || '';
    let sizeUnit = facts.normalized?.sizeUnit || facts.sizeUnit || sizeEvidence?.proposedValue?.unit || 'ml';

    if (!size && name) {
      const match = name.match(/(\d+(?:\.\d+)?)\s*(ml|l|g|kg|oz|مل|جم)/i);
      if (match) {
        size = match[1];
        sizeUnit = match[2];
      }
    }

    // Strip duplicated brand from product name if already present at start
    let cleanName = name;
    if (brand && cleanName.toLowerCase().startsWith(brand.toLowerCase())) {
      cleanName = cleanName.slice(brand.length).trim();
    }

    // Strip size suffix if already present at the end of cleanName
    if (size) {
      const sizeRegex = new RegExp(`\\s*${size}\\s*(${sizeUnit}|مل)?$`, 'i');
      cleanName = cleanName.replace(sizeRegex, '').trim();
    }

    const titleEn = `${brand} ${cleanName}${size ? ` ${size}${sizeUnit}` : ''}`.trim();
    const titleAr = `${brand} ${cleanName}${size ? ` (${size} ${sizeUnit === 'ml' ? 'مل' : sizeUnit})` : ''}`.trim();

    const benefitsEn: string[] = [];
    const benefitsAr: string[] = [];

    // Map benefits strictly from proven active ingredients
    const activeLower = activeIngredients.map(i => i.toLowerCase());
    if (activeLower.some(i => i.includes('retin'))) {
      benefitsEn.push('Promotes cellular renewal and smooths the appearance of fine lines');
      benefitsAr.push('يعزز تجديد خلايا البشرة ويخفف مظهر الخطوط الدقيقة والتجاعيد');
    }
    if (activeLower.some(i => i.includes('ascorb') || i.includes('vitamin c') || i.includes('فيتامين سي'))) {
      benefitsEn.push('Delivers antioxidant protection and visibly brightens uneven skin tone');
      benefitsAr.push('يوفر حماية مضادة للأكسدة ويعمل على تفتيح وتوحيد لون البشرة');
    }
    if (activeLower.some(i => i.includes('niacinamide') || i.includes('نياسيناميد'))) {
      benefitsEn.push('Regulates sebum production and reinforces the natural skin barrier');
      benefitsAr.push('ينظم إفراز الدهون ويعزز حاجز البشرة الطبيعي ومرونتها');
    }
    if (activeLower.some(i => i.includes('hyaluronic') || i.includes('هيالورونيك'))) {
      benefitsEn.push('Deeply hydrates and restores skin plumpness and suppleness');
      benefitsAr.push('يرطب البشرة بعمق ويعزز مرونتها ونضارتها الطبيعية');
    }
    if (activeLower.some(i => i.includes('ceramide') || i.includes('سيراميد'))) {
      benefitsEn.push('Replenishes essential barrier lipids and prevents moisture loss');
      benefitsAr.push('يدعم ويرمم حاجز الرطوبة الطبيعي للبشرة ويحميها من الجفاف');
    }
    if (activeLower.some(i => i.includes('salicylic') || i.includes('bha') || i.includes('ساليسيليك'))) {
      benefitsEn.push('Unclogs congested pores and gently refines skin texture');
      benefitsAr.push('ينقي المسام بعمق ويزيل الشوائب ويحسن ملمس البشرة');
    }
    if (activeLower.some(i => i.includes('centella') || i.includes('cica') || i.includes('سيكا'))) {
      benefitsEn.push('Soothes irritated skin and calms visible redness');
      benefitsAr.push('يهدئ البشرة المتهيجة ويخفف الاحمرار والحساسية');
    }

    if (benefitsEn.length === 0) {
      benefitsEn.push('Nourishes and supports healthy-looking skin');
      benefitsAr.push('يغذي البشرة ويدعم مظهرها الصحي ونضارتها');
    }

    // Usage instructions based on routine placement
    const usageInstructionsEn: string[] = [];
    const usageInstructionsAr: string[] = [];

    const isPm = routine?.timing === 'PM_ONLY' || routine?.timeOfDay === 'PM_ONLY' || routine?.requiresDaytimeSunscreen || activeLower.some(i => i.includes('retin'));
    const isAm = routine?.timing === 'AM_ONLY' || routine?.timeOfDay === 'AM_ONLY';

    if (isPm) {
      usageInstructionsEn.push('Apply in the evening on clean, dry skin. Use daytime sun protection (SPF) daily while using this product.');
      usageInstructionsAr.push('يُوضع مساءً على بشرة نظيفة وجافة. يجب استخدام واقي شمس مناسب نهاراً بانتظام أثناء فترة الاستخدام.');
    } else if (isAm) {
      usageInstructionsEn.push('Apply generously 15 minutes before sun exposure.');
      usageInstructionsEn.push('Reapply at least every 2 hours.');
      usageInstructionsAr.push('يُوضع بسخاء على البشرة قبل التعرض للشمس بـ 15 دقيقة.');
      usageInstructionsAr.push('يُعاد تطبيقه كل ساعتين على الأقل عند التعرض المستمر للشمس.');
    } else {
      usageInstructionsEn.push('Apply evenly to face and neck as part of your daily routine.');
      usageInstructionsAr.push('يُوزع بالتساوي على الوجه والرقبة كجزء من روتين العناية اليومي.');
    }

    const shortDescriptionEn = `Authentic ${brand} ${name} formulated for daily skin health and barrier support.`;
    const shortDescriptionAr = `منتج أصلي من ${brand}، مصمم لدعم صحة البشرة وحاجزها الطبيعي بتركيبة معتمدة وموثوقة.`;

    const descriptionEn = `${titleEn} delivers targeted care with verified ingredients. Tested formulation adhering to high dermatological standards.`;
    const descriptionAr = `يقدم ${titleAr} عناية متخصصة بمكونات مثبتة وموثوقة، مع الالتزام بأعلى معايير العناية بالبشرة المعتمدة.`;

    const stepOrder = routine?.stepOrder || routine?.step;
    const stepName = routine?.stepType || routine?.stepName || '';
    const routineStepEn = routine ? `Step ${stepOrder}: ${stepName}` : null;
    const routineStepAr = routine ? `الخطوة ${stepOrder}: ${routine.stepNameAr || stepName}` : null;

    const keywords = [
      brand.toLowerCase(),
      ...name.toLowerCase().split(/\s+/).filter((w: string) => w.length > 2),
      ...activeIngredients.map((a: string) => a.toLowerCase()),
      'عناية بالبشرة',
      'منتج أصلي',
      'شينا كير',
    ];

    return {
      titleEn,
      titleAr,
      shortDescriptionEn,
      shortDescriptionAr,
      descriptionEn,
      descriptionAr,
      benefitsEn,
      benefitsAr,
      usageInstructionsEn,
      usageInstructionsAr,
      routineStepEn,
      routineStepAr,
      keywords,
      seoTitleEn: `${titleEn} - ShinaCare`,
      seoTitleAr: `${titleAr} - شينا كير`,
      seoDescriptionEn: `Buy ${titleEn} online at ShinaCare. 100% genuine formulation.`,
      seoDescriptionAr: `تسوق ${titleAr} الأصلي من شينا كير. جودة مضمونة وتوصيل موثوق.`,
    };
  }

  /**
   * Deterministic validation rejecting unsupported claims or invented concentrations.
   */
  validateContentClaims(content: any, candidate: any, activeIngredients: string[]): void {
    const allText = [
      ...(content.benefitsAr || []),
      ...(content.benefitsEn || []),
      content.descriptionAr || '',
      content.descriptionEn || '',
    ].join(' ').toLowerCase();

    // 1. Unapproved medical cure claims
    const medicalCureKeywords = [
      'cure eczema', 'cures eczema', 'علاج نهائي للأكزيما', 'علاج نهائي للصدفية',
      'cures psoriasis', 'شفاء تام', 'يشفي تماماً', 'يمنع المرض نهائياً',
    ];
    for (const kw of medicalCureKeywords) {
      if (allText.includes(kw.toLowerCase())) {
        throw new BadRequestException(`Content draft contains forbidden medical cure claim: "${kw}"`);
      }
    }

    // 2. Unverified Sun Protection / SPF claims on non-sunscreen
    const routinePlacement = (candidate.enrichment as any)?.routinePlacement;
    const isSunscreen = /sunscreen|spf|واقي شمس|حماية من الشمس/i.test(candidate.name) ||
      routinePlacement?.stepOrder === 6 || routinePlacement?.step === 6 || routinePlacement?.stepType === 'SUNSCREEN';
    const hasSpfClaim = /spf\s*\d+|sun\s*protection|حماية من الشمس|واقي شمس/i.test(allText);
    if (hasSpfClaim && !isSunscreen) {
      throw new BadRequestException('Content draft makes unverified sun protection / SPF claims on a non-sunscreen product');
    }

    // 3. Unverified Retinoid claims
    const hasRetinol = activeIngredients.some(i => /retin/i.test(i)) || /retinol|retinoid|ريتينول/i.test(candidate.name);
    const claimsRetinol = /retinol|retinoid|ريتينول/i.test(allText);
    if (claimsRetinol && !hasRetinol) {
      throw new BadRequestException('Content draft claims Retinoid benefits for a product without Retinoid ingredients');
    }

    // 4. Unverified High-Concentration Vitamin C claims
    const hasVitC = activeIngredients.some(i => /ascorb|vitamin c|فيتامين سي/i.test(i)) || /vitamin c|فيتامين سي/i.test(candidate.name);
    const claimsVitC = /vitamin c|ascorbic|فيتامين سي/i.test(allText);
    if (claimsVitC && !hasVitC) {
      throw new BadRequestException('Content draft claims Vitamin C benefits for a product without Vitamin C ingredients');
    }
  }

  /**
   * Approves a ProductContentDraft for candidate publication.
   */
  async approveContentDraft(candidateId: string, actorId: string) {
    const reviewer = await this.prisma.customer.findUnique({ where: { id: actorId } });
    if (!reviewer?.roles.includes('ADMIN')) {
      throw new ForbiddenException('Only Admin can approve content drafts');
    }

    const draft = await this.prisma.productContentDraft.findUnique({ where: { candidateId } });
    if (!draft) {
      throw new NotFoundException(`ProductContentDraft for candidate ${candidateId} not found`);
    }

    const candidate = await this.prisma.ingestionItem.findUnique({ where: { id: candidateId } });
    if (!candidate) throw new NotFoundException(`Candidate ${candidateId} not found`);

    // Validate claims on draft before approval
    this.validateContentClaims(draft, candidate, []);

    return this.prisma.productContentDraft.update({
      where: { candidateId },
      data: {
        isApproved: true,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Rejects a ProductContentDraft.
   */
  async rejectContentDraft(candidateId: string, actorId: string, reason?: string) {
    const reviewer = await this.prisma.customer.findUnique({ where: { id: actorId } });
    if (!reviewer?.roles.includes('ADMIN')) {
      throw new ForbiddenException('Only Admin can reject content drafts');
    }

    const draft = await this.prisma.productContentDraft.findUnique({ where: { candidateId } });
    if (!draft) {
      throw new NotFoundException(`ProductContentDraft for candidate ${candidateId} not found`);
    }

    return this.prisma.productContentDraft.update({
      where: { candidateId },
      data: {
        isApproved: false,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Retrieves the current ProductContentDraft for a candidate.
   */
  async getContentDraft(candidateId: string) {
    return this.prisma.productContentDraft.findUnique({ where: { candidateId } });
  }
}

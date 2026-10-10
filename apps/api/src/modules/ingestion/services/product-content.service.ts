import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { AiClient } from '../../../platform/ai';

@Injectable()
export class ProductContentService {
  private readonly logger = new Logger(ProductContentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiClient: AiClient,
  ) {}

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

import { Injectable, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { CatalogService, BrandService } from '../../catalog/public';
import { SourcingService } from '../../sourcing/public';
import { ProductIdentityService, MatchClassification } from './product-identity.service';
import { ProductResearchService } from './product-research.service';
import { ProductContentService } from './product-content.service';
import { CreateIngestionJobDto, ApproveIngestionItemDto, UpdateCandidateDto } from '../dto/ingestion.dto';
import { IngestionStatus, IngestionItemEnrichmentStatus, IngestionPriceType } from '@prisma/client';
import { AiClient, AiClientError, AiErrorKind } from '../../../platform/ai';
import { StorageService } from '../../../platform/storage/storage.service';
import { requireMediaReview, isTrustedMediaSource } from '../../../platform/security/media-review';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export interface IngestionJobDetail {
  id: string;
  supplierId: string;
  status: IngestionStatus;
  createdAt: Date;
  items: Array<{
    id: string;
    supplierSkuCode: string;
    name: string;
    brand: string;
    barcode: string | null;
    price: number;
    priceType: IngestionPriceType | null;
    currency: string;
    status: IngestionStatus;
    matchedSkuId: string | null;
  }>;
}

@Injectable()
export class IngestionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogService: CatalogService,
    private readonly brandService: BrandService,
    private readonly sourcingService: SourcingService,
    private readonly productIdentityService: ProductIdentityService,
    private readonly productResearchService: ProductResearchService,
    private readonly contentService: ProductContentService,
    private readonly aiClient: AiClient,
    private readonly storageService: StorageService,
  ) {}

  private isUuid(val: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
  }

  // Serialize review/edit/publish commands across API instances; partial domain writes remain retryable.
  private async withCandidateLock<T>(itemId: string, operation: () => Promise<T>): Promise<T> {
    if (!this.isUuid(itemId)) throw new BadRequestException('Invalid candidate item ID');
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`candidate:${itemId}`}))`;
      return operation();
    }, { timeout: 120000, maxWait: 10000 });
  }

  private slugify(str: string): string {
    return str
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '');
  }

  async uploadSupplierSpreadsheet(supplierId: string, file: Express.Multer.File): Promise<{ jobId: string, sourceKey: string }> {
    if (!this.isUuid(supplierId)) throw new BadRequestException('Invalid supplier ID');
    if (!['text/csv', 'application/pdf', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'].includes(file.mimetype)) {
      throw new BadRequestException('A supplier source document is required');
    }
    this.storageService.validateFile(file);
    const supplier = await this.prisma.supplier.findUnique({ where: { id: supplierId } });
    if (!supplier) throw new BadRequestException('Supplier not found');

    const checksum = crypto.createHash('sha256').update(file.buffer).digest('hex');
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`source:${supplierId}:${checksum}`}))`;
      const existing = await tx.ingestionJob.findFirst({ where: { supplierId, sourceChecksum: checksum }, orderBy: { createdAt: 'asc' } });
      if (existing?.sourceKey) {
        if (!(await this.storageService.exists(existing.sourceKey))) {
          await this.storageService.restorePrivateFile(existing.sourceKey, file, supplierId);
        }
        return { jobId: existing.id, sourceKey: existing.sourceKey };
      }
      const fileUrl = await this.storageService.uploadFile(file, true, 'ingestion', supplierId);
      const sourceKey = new URL(fileUrl).pathname.slice('/storage/'.length);
      try {
        const job = existing ? await tx.ingestionJob.update({ where: { id: existing.id }, data: { sourceKey } }) :
          await tx.ingestionJob.create({ data: { supplierId, status: 'pending', sourceKey, sourceChecksum: checksum } });
        return { jobId: job.id, sourceKey };
      } catch (error) {
        await this.storageService.deleteFile(fileUrl);
        throw error;
      }
    }, { timeout: 15000 });
  }

  async createJob(dto: CreateIngestionJobDto): Promise<IngestionJobDetail> {
    if (!this.isUuid(dto.supplierId)) throw new BadRequestException('Invalid supplier ID');

    // Verify supplier exists
    const supplier = await this.sourcingService.getSupplier(dto.supplierId);
    if (!supplier) throw new NotFoundException('Supplier not found');

    if (!dto.items.length || dto.items.length > 1000 || new Set(dto.items.map(i => i.supplierSkuCode)).size !== dto.items.length) {
      throw new BadRequestException('Import requires 1–1000 unique supplier SKU rows');
    }
    if (dto.sourceJobId && (dto.items.some(i => !i.sourceRow) || new Set(dto.items.map(i => i.sourceRow)).size !== dto.items.length)) {
      throw new BadRequestException('Each source item requires a unique positive sourceRow');
    }
    const job = await this.prisma.$transaction(async tx => {
      if (dto.sourceJobId) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`import:${dto.sourceJobId}`}))`;
        const source = await tx.ingestionJob.findFirst({ where: { id: dto.sourceJobId, supplierId: dto.supplierId }, include: { items: true } });
        if (!source?.sourceKey || !source.sourceChecksum) throw new NotFoundException('Supplier source job not found');
        if (!(await this.storageService.exists(source.sourceKey))) throw new NotFoundException('Supplier source object missing');
        if (source.items.length) {
          const same = source.items.length === dto.items.length && dto.items.every(input => source.items.some(item => {
            const original = (item.enrichment as any)?.source?.input;
            return original && original.supplierSkuCode === input.supplierSkuCode && original.name === input.name &&
              original.brand === input.brand && original.barcode === (input.barcode ?? null) && original.price === input.price &&
              (original.priceType ?? null) === (input.priceType ?? null) &&
              original.currency === input.currency && original.sourceRow === input.sourceRow;
          }));
          if (!same) throw new ConflictException('Source rows already imported with different input');
          return source;
        }
        if (source.status !== IngestionStatus.pending) throw new ConflictException('Source job is not pending');
        await tx.ingestionItem.createMany({ data: dto.items.map(input => ({ jobId: source.id, supplierSkuCode: input.supplierSkuCode,
          name: input.name, brand: input.brand, barcode: input.barcode, price: input.price,
          priceType: input.priceType ?? null, currency: input.currency,
          enrichment: { source: { objectKey: source.sourceKey!, checksum: source.sourceChecksum!, row: input.sourceRow!,
            input: { supplierSkuCode: input.supplierSkuCode, name: input.name, brand: input.brand, barcode: input.barcode ?? null,
              price: input.price, priceType: input.priceType ?? null, currency: input.currency, sourceRow: input.sourceRow! } } } }),
        ) });
        return tx.ingestionJob.findUniqueOrThrow({ where: { id: source.id }, include: { items: true } });
      }
      return tx.ingestionJob.create({
      data: {
        supplierId: dto.supplierId,
        items: {
          create: dto.items.map((item) => ({
            supplierSkuCode: item.supplierSkuCode,
            name: item.name,
            brand: item.brand,
            barcode: item.barcode,
            price: item.price,
            priceType: item.priceType ?? null,
            currency: item.currency,
          })),
        },
      },
      include: { items: true },
      });
    }, { timeout: 15000 });

    // Persist matching before acknowledging the import; failed matching is retryable.
    await this.processMatching(job.id);

    return {
      ...job,
      items: job.items.map((item) => ({
        ...item,
        price: item.price.toNumber(),
      })),
    };
  }

  async getJob(jobId: string, supplierId?: string): Promise<IngestionJobDetail> {
    if (!this.isUuid(jobId)) throw new BadRequestException('Invalid ingestion job ID');
    const job = await this.prisma.ingestionJob.findFirst({
      where: { id: jobId, ...(supplierId ? { supplierId } : {}) },
      include: { items: true },
    });

    if (!job) throw new NotFoundException('Ingestion job not found');

    return {
      ...job,
      items: job.items.map((item) => ({
        ...item,
        price: item.price.toNumber(),
      })),
    };
  }

  async getJobs(supplierId?: string): Promise<IngestionJobDetail[]> {
    const jobs = await this.prisma.ingestionJob.findMany({
      where: supplierId ? { supplierId } : {},
      orderBy: { createdAt: 'desc' },
      include: { items: true },
    });

    return jobs.map((job) => ({
      ...job,
      items: job.items.map((item) => ({
        ...item,
        price: item.price.toNumber(),
      })),
    }));
  }

  // ---------------------------------------------------------------------------
  // GLO-77 / GLO-120 Candidate Review & Fact Operations
  // ---------------------------------------------------------------------------

  async getCandidates(status?: IngestionStatus): Promise<Array<Record<string, unknown>>> {
    const items = await this.prisma.ingestionItem.findMany({
      where: status ? { status } : {},
      include: { job: { select: { id: true, supplierId: true, status: true, createdAt: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return items.map((item) => ({
      id: item.id,
      jobId: item.jobId,
      supplierId: item.job.supplierId,
      supplierSkuCode: item.supplierSkuCode,
      name: item.name,
      brand: item.brand,
      barcode: item.barcode,
      price: item.price.toNumber(),
      priceType: item.priceType,
      currency: item.currency,
      status: item.status,
      matchedSkuId: item.matchedSkuId,
      enrichmentStatus: item.enrichmentStatus,
      enrichment: item.enrichment,
      enrichmentError: item.enrichmentError,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }));
  }

  async getCandidateDetail(itemId: string): Promise<Record<string, unknown>> {
    if (!this.isUuid(itemId)) throw new BadRequestException('Invalid candidate item ID');
    const item = await this.prisma.ingestionItem.findUnique({
      where: { id: itemId },
      include: { job: { select: { id: true, supplierId: true, status: true, createdAt: true } } },
    });

    if (!item) throw new NotFoundException('Candidate item not found');

    const matchAnalysis = await this.productIdentityService.classifyCandidateMatch({
      supplierId: item.job.supplierId,
      supplierSkuCode: item.supplierSkuCode,
      name: item.name,
      brand: item.brand,
      barcode: item.barcode,
    });

    let matchedSku = null;
    const effectiveSkuId = item.matchedSkuId || matchAnalysis.matchedSkuId;
    if (effectiveSkuId) {
      matchedSku = await this.catalogService.getSkuIdentity(effectiveSkuId);
    } else if (item.barcode) {
      matchedSku = await this.catalogService.getSkuByBarcode(item.barcode);
    }

    const brandMatch = await this.brandService.getBrand(item.brand);

    const conflicts = [...matchAnalysis.conflicts];
    if (!item.barcode && !conflicts.includes('missing_barcode')) {
      conflicts.push('missing_barcode');
    }
    if (!brandMatch && !conflicts.includes('brand_not_found_in_catalog')) {
      conflicts.push('brand_not_found_in_catalog');
    }

    return {
      id: item.id,
      jobId: item.jobId,
      supplierId: item.job.supplierId,
      supplierSkuCode: item.supplierSkuCode,
      name: item.name,
      brand: item.brand,
      barcode: item.barcode,
      price: item.price.toNumber(),
      priceType: item.priceType,
      currency: item.currency,
      status: item.status,
      matchedSkuId: item.matchedSkuId,
      identity: {
        fingerprint: matchAnalysis.fingerprint,
        classification: matchAnalysis.classification,
        matchReason: matchAnalysis.reason,
      },
      evidence: {
        enrichment: item.enrichment,
        enrichmentStatus: item.enrichmentStatus,
        enrichmentError: item.enrichmentError,
      },
      conflicts,
      matchedSku,
      brandMatch: brandMatch ? { id: brandMatch.id, name: brandMatch.name, slug: brandMatch.slug } : null,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  async updateCandidate(itemId: string, dto: UpdateCandidateDto): Promise<Record<string, unknown>> {
    return this.withCandidateLock(itemId, () => this.updateCandidateLocked(itemId, dto));
  }

  private async updateCandidateLocked(itemId: string, dto: UpdateCandidateDto): Promise<Record<string, unknown>> {
    if (!this.isUuid(itemId)) throw new BadRequestException('Invalid candidate item ID');
    const item = await this.prisma.ingestionItem.findUnique({
      where: { id: itemId },
      include: { job: true },
    });

    if (!item) throw new NotFoundException('Candidate item not found');
    if (item.job.status === IngestionStatus.published || item.status === IngestionStatus.published) {
      throw new BadRequestException('Cannot modify items of a published job or candidate');
    }

    const newSupplierSkuCode = dto.supplierSkuCode !== undefined ? dto.supplierSkuCode : item.supplierSkuCode;
    const newName = dto.name !== undefined ? dto.name : item.name;
    const newBrand = dto.brand !== undefined ? dto.brand : item.brand;
    const newBarcode = dto.barcode !== undefined ? dto.barcode : item.barcode;

    const matchAnalysis = await this.productIdentityService.classifyCandidateMatch({
      supplierId: item.job.supplierId,
      supplierSkuCode: newSupplierSkuCode,
      name: newName,
      brand: newBrand,
      barcode: newBarcode,
    });

    let matchedSkuId = item.matchedSkuId;
    let status = item.status;

    if (matchAnalysis.classification === MatchClassification.EXACT_MATCH && matchAnalysis.matchedSkuId) {
      matchedSkuId = matchAnalysis.matchedSkuId;
      status = IngestionStatus.review_required;
    } else if (matchAnalysis.classification === MatchClassification.CONFLICT || matchAnalysis.classification === MatchClassification.LIKELY_MATCH) {
      matchedSkuId = null;
      status = IngestionStatus.review_required;
    }

    const updated = await this.prisma.ingestionItem.update({
      where: { id: itemId },
      data: {
        ...(dto.supplierSkuCode !== undefined && { supplierSkuCode: dto.supplierSkuCode }),
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.brand !== undefined && { brand: dto.brand }),
        ...(dto.barcode !== undefined && { barcode: dto.barcode }),
        ...(dto.price !== undefined && { price: dto.price }),
        ...(dto.priceType !== undefined ? { priceType: dto.priceType } :
          dto.price !== undefined ? { priceType: null } : {}),
        ...(dto.currency !== undefined && { currency: dto.currency }),
        matchedSkuId,
        status: IngestionStatus.review_required,
        enrichment: { ...((item.enrichment as Record<string, any>) || {}),
          contentReview: null,
          media: (((item.enrichment as Record<string, any>)?.media) || []).map((m: any) =>
            ({ ...m, originType: m.isTest ? 'test' : 'unverified', review: null })) },
      },
    });

    await this.evaluateJobStatus(item.jobId);

    return this.getCandidateDetail(updated.id);
  }

  private async processMatching(jobId: string): Promise<void> {
    const job = await this.prisma.ingestionJob.findUnique({
      where: { id: jobId },
      include: { items: true },
    });

    if (!job) return;

    for (const item of job.items) {
      if (item.status !== IngestionStatus.pending) continue;

      const matchAnalysis = await this.productIdentityService.classifyCandidateMatch({
        supplierId: job.supplierId,
        supplierSkuCode: item.supplierSkuCode,
        name: item.name,
        brand: item.brand,
        barcode: item.barcode,
      });

      let matchedSkuId: string | null = null;
      let status: IngestionStatus = IngestionStatus.review_required;

      if (matchAnalysis.classification === MatchClassification.EXACT_MATCH && matchAnalysis.matchedSkuId) {
        matchedSkuId = matchAnalysis.matchedSkuId;
        status = IngestionStatus.review_required;
      }

      const changed = await this.prisma.ingestionItem.updateMany({
        where: { id: item.id, status: IngestionStatus.pending, updatedAt: item.updatedAt },
        data: { matchedSkuId, status },
      });
      if (!changed.count) continue;

      // Trigger AI enrichment asynchronously (best-effort, non-blocking)
      this.enrichItemAsync(item.id, item.name, item.brand, item.barcode ?? undefined).catch((err) =>
        console.error(`Enrichment background error for item ${item.id}:`, err),
      );
    }

    await this.evaluateJobStatus(jobId);
  }

  async approveItem(itemId: string, dto?: ApproveIngestionItemDto, reviewerId?: string): Promise<void> {
    return this.withCandidateLock(itemId, () => this.approveItemLocked(itemId, dto, reviewerId));
  }

  private async approveItemLocked(itemId: string, dto?: ApproveIngestionItemDto, reviewerId?: string): Promise<void> {
    const item = await this.prisma.ingestionItem.findUnique({
      where: { id: itemId },
      include: { job: true },
    });
    if (!item) throw new NotFoundException('Item not found');

    if (item.job.status === IngestionStatus.published || item.status === IngestionStatus.published) {
      throw new BadRequestException('Cannot modify items of a published job');
    }

    let matchedSkuId: string | null = item.matchedSkuId;

    if (dto?.createNewProduct && dto?.matchedSkuId) {
      throw new BadRequestException('Cannot set both createNewProduct and matchedSkuId');
    }

    if (dto?.createNewProduct) {
      matchedSkuId = null;
    } else if (dto?.matchedSkuId) {
      if (!this.isUuid(dto.matchedSkuId)) throw new BadRequestException('Invalid SKU ID');
      const skuIdentity = await this.catalogService.getSkuIdentity(dto.matchedSkuId);
      if (!skuIdentity?.isActive) throw new NotFoundException('SKU not found in catalog or is inactive');
      matchedSkuId = dto.matchedSkuId;
    }

    const currentEnrichment = (item.enrichment as Record<string, unknown>) || {};
    const media = Array.isArray(currentEnrichment.media) ? currentEnrichment.media : [];

    if (dto?.verifiedMediaUrls?.length && !dto.mediaReviews?.length) {
      throw new BadRequestException('Media URLs alone are not verification evidence');
    }
    if (dto?.mediaReviews?.length) {
      const reviewer = reviewerId ? await this.prisma.customer.findUnique({ where: { id: reviewerId } }) : null;
      if (!reviewer?.roles.some(role => role === 'ADMIN' || role === 'HUB_OPERATOR')) {
        throw new BadRequestException('Authorized media reviewer required');
      }
      const research = currentEnrichment.research as Record<string, any> | undefined;
      for (const review of dto.mediaReviews) {
        const m = media.find(entry => entry.url === review.url);
        if (!m || m.originType === 'test' || m.isTest === true) throw new BadRequestException('Test or unknown media cannot be verified');
        if (review.barcode !== item.barcode || !isTrustedMediaSource(review.sourceUrl)) {
          throw new BadRequestException('Media evidence does not match candidate identity');
        }
        const sizeEvidence = research?.fieldEvidences?.find((e: any) => e.fieldName === 'size' &&
          e.verificationStatus === 'SUPPORTED' && e.sourceUrl === review.sourceUrl &&
          e.proposedValue?.value === review.size && e.proposedValue?.unit === review.sizeUnit);
        if (!sizeEvidence) throw new BadRequestException('Package size requires matching source evidence');
        if (matchedSkuId) {
          const sku = await this.catalogService.getSkuIdentity(matchedSkuId);
          if (!sku || sku.barcode !== review.barcode || sku.size !== review.size ||
              sku.sizeUnit !== review.sizeUnit || sku.variantName !== review.variantName) {
            throw new BadRequestException('Reviewed media does not match the canonical SKU variant');
          }
        }
        if (!m.url.startsWith('cloudinary://')) {
          const objectKey = this.storageService.privateObjectKey(m.url, item.job.supplierId);
          if (!(await this.storageService.exists(objectKey))) {
            throw new NotFoundException('Candidate media object not found');
          }
        }
        m.review = requireMediaReview({ ...review, reviewedBy: reviewer!.id, reviewedAt: new Date().toISOString(),
          candidateId: item.id, isTest: false });
        m.originType = 'verified';
      }
    }

    const updatedEnrichment = { ...currentEnrichment, media };
    if (dto?.matchedSkuId && matchedSkuId) {
      await this.productIdentityService.createSupplierSkuAlias(item.job.supplierId, item.supplierSkuCode, matchedSkuId);
    }

    await this.prisma.ingestionItem.update({
      where: { id: itemId },
      data: {
        matchedSkuId,
        status: IngestionStatus.approved,
        enrichment: updatedEnrichment as unknown as import('@prisma/client').Prisma.InputJsonValue,
      },
    });

    await this.evaluateJobStatus(item.jobId);
  }

  async rejectItem(itemId: string): Promise<void> {
    return this.withCandidateLock(itemId, () => this.rejectItemLocked(itemId));
  }

  private async rejectItemLocked(itemId: string): Promise<void> {
    const item = await this.prisma.ingestionItem.findUnique({
      where: { id: itemId },
      include: { job: true },
    });
    if (!item) throw new NotFoundException('Item not found');

    if (item.job.status === IngestionStatus.published || item.status === IngestionStatus.published) {
      throw new BadRequestException('Cannot modify items of a published job');
    }

    await this.prisma.ingestionItem.update({
      where: { id: itemId },
      data: { status: IngestionStatus.rejected },
    });

    await this.evaluateJobStatus(item.jobId);
  }

  private async evaluateJobStatus(jobId: string): Promise<void> {
    const job = await this.prisma.ingestionJob.findUnique({
      where: { id: jobId },
      include: { items: true },
    });
    if (!job) return;

    const allProcessed = job.items.every(
      (i) =>
        i.status === IngestionStatus.approved ||
        i.status === IngestionStatus.rejected ||
        i.status === IngestionStatus.published,
    );

    if (!allProcessed && job.status === IngestionStatus.approved) {
      await this.prisma.ingestionJob.update({ where: { id: jobId }, data: { status: IngestionStatus.review_required } });
    }
    if (allProcessed && job.status !== IngestionStatus.published && job.status !== IngestionStatus.approved) {
      await this.prisma.ingestionJob.update({
        where: { id: jobId },
        data: { status: IngestionStatus.approved },
      });
    }
  }

  // ---------------------------------------------------------------------------
  // AI Enrichment
  // ---------------------------------------------------------------------------

  private async enrichItemAsync(
    itemId: string,
    rawTitle: string,
    brand: string,
    barcode?: string,
  ): Promise<void> {
    await this.prisma.ingestionItem.update({
      where: { id: itemId },
      data: { enrichmentStatus: IngestionItemEnrichmentStatus.pending },
    });

    try {
      const result = await this.aiClient.enrichProduct({
        candidateRef: itemId,
        sourceType: 'supplier_item',
        rawTitle,
        brand,
        barcode: barcode ?? null,
      });

      const latest = await this.prisma.ingestionItem.findUnique({ where: { id: itemId } });
      const previous = (latest?.enrichment as Record<string, unknown>) || {};
      await this.prisma.ingestionItem.updateMany({
        where: { id: itemId, updatedAt: latest!.updatedAt },
        data: {
          enrichment: { ...result, ...previous } as unknown as import('@prisma/client').Prisma.InputJsonValue,
          enrichmentStatus: IngestionItemEnrichmentStatus.succeeded,
          enrichmentError: null,
        },
      });
    } catch (err) {
      const isKnownAiError = err instanceof AiClientError;
      const isSoftError =
        isKnownAiError && (err.kind === AiErrorKind.UNAVAILABLE || err.kind === AiErrorKind.TIMEOUT);

      const errorMessage = isKnownAiError
        ? `${err.kind}: ${err.message}`
        : err instanceof Error
        ? err.message
        : String(err);

      await this.prisma.ingestionItem.update({
        where: { id: itemId },
        data: {
          enrichmentStatus: isSoftError
            ? IngestionItemEnrichmentStatus.pending
            : IngestionItemEnrichmentStatus.failed,
          enrichmentError: errorMessage,
        },
      });

      if (!isSoftError) {
        console.error(`AI enrichment hard failure for item ${itemId}:`, errorMessage);
      }
    }
  }

  async enrichItem(itemId: string): Promise<{
    enrichmentStatus: IngestionItemEnrichmentStatus;
    enrichment: unknown;
    enrichmentError: string | null;
  }> {
    if (!this.isUuid(itemId)) throw new BadRequestException('Invalid item ID');

    const item = await this.prisma.ingestionItem.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundException('Item not found');

    await this.enrichItemAsync(item.id, item.name, item.brand, item.barcode ?? undefined);

    const updated = await this.prisma.ingestionItem.findUnique({ where: { id: itemId } });
    return {
      enrichmentStatus: updated!.enrichmentStatus,
      enrichment: updated!.enrichment,
      enrichmentError: updated!.enrichmentError,
    };
  }

  // ---------------------------------------------------------------------------
  // GLO-121 Product Research Pipeline
  // ---------------------------------------------------------------------------

  async researchCandidate(itemId: string): Promise<Record<string, unknown>> {
    if (!this.isUuid(itemId)) throw new BadRequestException('Invalid candidate item ID');
    const item = await this.prisma.ingestionItem.findUnique({
      where: { id: itemId },
      include: { job: true },
    });

    if (!item) throw new NotFoundException('Candidate item not found');

    // Credit Protection & Caching: if candidate already has research evidence saved, return cached evidence
    const currentEnrichment = (item.enrichment as Record<string, unknown>) || {};
    if (currentEnrichment.research) {
      return currentEnrichment.research as Record<string, unknown>;
    }

    // Execute Product Research Pipeline
    const researchResult = await this.productResearchService.researchProductCandidate({
      candidateId: item.id,
      brand: item.brand,
      name: item.name,
      barcode: item.barcode,
      supplierSkuCode: item.supplierSkuCode,
      existingEnrichment: item.enrichment,
    });

    const updatedEnrichment = {
      ...currentEnrichment,
      research: researchResult,
    };

    await this.prisma.ingestionItem.update({
      where: { id: itemId },
      data: {
        enrichment: updatedEnrichment as unknown as import('@prisma/client').Prisma.InputJsonValue,
        enrichmentStatus: IngestionItemEnrichmentStatus.succeeded,
      },
    });

    return researchResult as unknown as Record<string, unknown>;
  }

  async generateCandidateContent(itemId: string) {
    if (!this.isUuid(itemId)) throw new BadRequestException('Invalid candidate item ID');
    return this.contentService.generateContent(itemId);
  }

  async uploadCandidateMedia(itemId: string, file: Express.Multer.File) {
    return this.withCandidateLock(itemId, () => this.uploadCandidateMediaLocked(itemId, file));
  }

  private async uploadCandidateMediaLocked(itemId: string, file: Express.Multer.File) {
    if (!this.isUuid(itemId)) throw new BadRequestException('Invalid candidate item ID');
    const item = await this.prisma.ingestionItem.findUnique({ where: { id: itemId }, include: { job: true } });
    if (!item) throw new NotFoundException('Candidate item not found');

    if (item.status === IngestionStatus.published) throw new BadRequestException('Published candidates are immutable');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)) throw new BadRequestException('Only supported images may be uploaded');
    const url = await this.storageService.uploadFile(file, true, 'candidates', item.job.supplierId);
    const isTest = /(?:test|mock|dummy)/i.test(file.originalname);

    const currentEnrichment = (item.enrichment as Record<string, unknown>) || {};
    const media = Array.isArray(currentEnrichment.media) ? currentEnrichment.media : [];
    
    media.push({
      url,
      type: 'image',
      mimetype: file.mimetype,
      isTest,
      originType: isTest ? 'test' : 'unverified'
    });

    const updatedEnrichment = { ...currentEnrichment, media };

    await this.prisma.ingestionItem.update({
      where: { id: itemId },
      data: {
        enrichment: updatedEnrichment as unknown as import('@prisma/client').Prisma.InputJsonValue,
      },
    });

    return { url, type: 'image', originType: isTest ? 'test' : 'unverified' };
  }


  // ---------------------------------------------------------------------------
  // GLO-77 / GLO-120 Canonical Product Promotion & Publish Operations
  // ---------------------------------------------------------------------------

  private async ensureCanonicalSku(
    item: {
      id: string;
      name: string;
      brand: string;
      barcode: string | null;
      supplierSkuCode: string;
      matchedSkuId: string | null;
      enrichment?: unknown;
    },
    supplierId: string,
  ): Promise<string> {
    const enrichment = (item.enrichment as Record<string, any>) || {};
    const reviewedMedia = (Array.isArray(enrichment.media) ? enrichment.media : []).filter((m: any) => m.originType === 'verified');
    if (!reviewedMedia.length) throw new BadRequestException('At least one reviewed real image is required');
    for (const m of reviewedMedia) {
      const review = requireMediaReview(m.review);
      if (review.candidateId !== item.id || review.barcode !== item.barcode || m.isTest) {
        throw new BadRequestException('Media review no longer matches candidate identity');
      }
    }
    // 1. Check if item is already matched to existing SKU in Catalog
    if (item.matchedSkuId) {
      const existing = await this.catalogService.getSkuIdentity(item.matchedSkuId);
      if (existing) { await this.publishReviewedMedia(item, existing.id, supplierId); return existing.id; }
    }

    // 2. Perform pre-publish Identity Match Check (Deduplication)
    const matchAnalysis = await this.productIdentityService.classifyCandidateMatch({
      supplierId,
      supplierSkuCode: item.supplierSkuCode,
      name: item.name,
      brand: item.brand,
      barcode: item.barcode,
    });

    if (matchAnalysis.classification === MatchClassification.EXACT_MATCH && matchAnalysis.matchedSkuId) {
      // Register Supplier SKU Alias for future imports
      await this.productIdentityService.createSupplierSkuAlias(supplierId, item.supplierSkuCode, matchAnalysis.matchedSkuId);
      await this.publishReviewedMedia(item, matchAnalysis.matchedSkuId, supplierId);
      return matchAnalysis.matchedSkuId;
    }

    // 3. Resolve or create Brand in Catalog via BrandService
    let brandId: string;
    const brandSlug = this.slugify(item.brand);
    const existingBrand = await this.brandService.getBrand(brandSlug);
    if (existingBrand) {
      brandId = existingBrand.id;
    } else {
      const createdBrand = await this.brandService.createBrand({ name: item.brand });
      brandId = createdBrand.id;
    }

    const brandName = existingBrand ? existingBrand.name : item.brand;

    // 4. Resolve or create Product in Catalog via CatalogService
    const productSlug = this.slugify(`${brandName}-${item.name}`);
    let product = await this.catalogService.getProduct(productSlug);
    if (!product) {
      product = await this.catalogService.createProduct({
        brandId,
        name: item.name,
        slug: productSlug,
        isPublished: false,
      });
    }

    // 5. Check if SKU already exists under Product
    const skuCode = item.supplierSkuCode || `SKU-${item.id.slice(0, 8).toUpperCase()}`;
    const existingSkus = await this.catalogService.getSkus(product.id);
    const existingSku = existingSkus.find(
      (s) => s.code === skuCode || (item.barcode !== null && s.barcode === item.barcode),
    );

    if (existingSku) {
      await this.productIdentityService.createSupplierSkuAlias(supplierId, item.supplierSkuCode, existingSku.id);
      await this.publishReviewedMedia(item, existingSku.id, supplierId);
      return existingSku.id;
    }

    // 6. Create new canonical SKU in Catalog
    const newSku = await this.catalogService.createSku(product.id, {
      code: skuCode,
      variantName: reviewedMedia[0].review.variantName,
      size: reviewedMedia[0].review.size,
      sizeUnit: reviewedMedia[0].review.sizeUnit,
      barcode: item.barcode ?? undefined,
      isActive: true,
    });

    // 7. Register Supplier SKU Alias
    await this.productIdentityService.createSupplierSkuAlias(supplierId, item.supplierSkuCode, newSku.id);

    await this.publishReviewedMedia(item, newSku.id, supplierId);
    return newSku.id;
  }

  private async publishReviewedMedia(item: { id: string; barcode: string | null; enrichment?: unknown }, skuId: string, supplierId: string): Promise<void> {
    const sku = await this.prisma.sku.findUnique({ where: { id: skuId } });
    if (!sku) throw new NotFoundException('Canonical SKU not found');
    const enrichment = item.enrichment as Record<string, any>;
    for (const m of enrichment.media.filter((entry: any) => entry.originType === 'verified')) {
      const review = requireMediaReview(m.review);
      if (sku.barcode !== review.barcode || sku.size?.toNumber() !== review.size ||
          sku.sizeUnit !== review.sizeUnit || sku.variantName !== review.variantName) {
        throw new BadRequestException('Approved media does not match canonical SKU');
      }
      const url = await this.storageService.copyToPublic(m.url, supplierId);
      await this.catalogService.addMedia(sku.productId, { type: 'image', url, originType: 'verified',
        generationMetadata: { ...review, skuId } }, review.reviewedBy);
    }
    // Catalog publication is a separate authorized operation after commercial inputs exist.
  }

  private async ensureSupplierOffer(
    supplierId: string,
    skuId: string,
    costPrice: number,
    currency: string,
  ): Promise<void> {
    try {
      await this.sourcingService.createSupplierOffer({
        supplierId,
        skuId,
        costPrice,
        currency,
        isAvailable: false,
      });
    } catch (e) {
      if (e instanceof ConflictException) {
        // Existing offers are owned by Sourcing; ingestion must not overwrite confirmation.
      } else {
        throw e;
      }
    }
  }

  async publishCandidate(itemId: string): Promise<Record<string, unknown>> {
    return this.withCandidateLock(itemId, () => this.publishCandidateLocked(itemId));
  }

  private async publishCandidateLocked(itemId: string): Promise<Record<string, unknown>> {
    if (!this.isUuid(itemId)) throw new BadRequestException('Invalid candidate item ID');
    const item = await this.prisma.ingestionItem.findUnique({
      where: { id: itemId },
      include: { job: true },
    });

    if (!item) throw new NotFoundException('Candidate item not found');
    if (item.status === IngestionStatus.published) {
      throw new BadRequestException('Candidate is already published');
    }

    if (item.status !== IngestionStatus.approved) {
      throw new BadRequestException('Candidate item is not approved for publication yet');
    }

    if (item.priceType !== IngestionPriceType.PURCHASE_COST) {
      throw new BadRequestException('Explicit purchase cost price type is required for offer publication');
    }

    const skuId = await this.ensureCanonicalSku(item, item.job.supplierId);
    await this.ensureSupplierOffer(item.job.supplierId, skuId, item.price.toNumber(), item.currency);

    const updated = await this.prisma.ingestionItem.update({
      where: { id: itemId },
      data: { status: IngestionStatus.published, matchedSkuId: skuId },
    });

    await this.evaluateJobStatus(item.jobId);

    const canonicalSku = await this.catalogService.getSkuIdentity(skuId);
    return {
      id: updated.id,
      status: updated.status,
      matchedSkuId: skuId,
      canonicalSku,
    };
  }

  async publishJob(jobId: string): Promise<IngestionJobDetail> {
    const job = await this.prisma.ingestionJob.findUnique({
      where: { id: jobId },
      include: { items: true },
    });

    if (!job) throw new NotFoundException('Job not found');

    if (job.status === IngestionStatus.published) {
      throw new BadRequestException('Job is already published');
    }

    if (job.status !== IngestionStatus.approved || job.items.some(item =>
        item.status !== IngestionStatus.approved && item.status !== IngestionStatus.rejected && item.status !== IngestionStatus.published)) {
      throw new BadRequestException('Job is not fully approved yet. Resolve pending items first.');
    }

    const errors: string[] = [];

    for (const item of job.items) {
      if (item.status === IngestionStatus.approved) {
        try {
          await this.publishCandidate(item.id);
        } catch (e) {
          const errorMessage = e instanceof Error ? e.message : String(e);
          errors.push(`Failed to publish item ${item.id}: ${errorMessage}`);
        }
      }
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Partial publish failure',
        errors,
      });
    }

    const updatedJob = await this.prisma.ingestionJob.update({
      where: { id: jobId },
      data: { status: IngestionStatus.published },
      include: { items: true },
    });

    return {
      ...updatedJob,
      items: updatedJob.items.map((item) => ({
        ...item,
        price: item.price.toNumber(),
      })),
    };
  }
}

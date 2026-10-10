import { Injectable, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { CatalogService, BrandService } from '../../catalog/public';
import { SourcingService } from '../../sourcing/public';
import { ProductIdentityService, MatchClassification } from './product-identity.service';
import { CreateIngestionJobDto, ApproveIngestionItemDto, UpdateCandidateDto } from '../dto/ingestion.dto';
import { IngestionStatus, IngestionItemEnrichmentStatus } from '@prisma/client';
import { AiClient, AiClientError, AiErrorKind } from '../../../platform/ai';

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
    private readonly aiClient: AiClient,
  ) {}

  private isUuid(val: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
  }

  private slugify(str: string): string {
    return str
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '');
  }

  async createJob(dto: CreateIngestionJobDto): Promise<IngestionJobDetail> {
    if (!this.isUuid(dto.supplierId)) throw new BadRequestException('Invalid supplier ID');

    // Verify supplier exists
    const supplier = await this.sourcingService.getSupplier(dto.supplierId);
    if (!supplier) throw new NotFoundException('Supplier not found');

    const job = await this.prisma.ingestionJob.create({
      data: {
        supplierId: dto.supplierId,
        items: {
          create: dto.items.map((item) => ({
            supplierSkuCode: item.supplierSkuCode,
            name: item.name,
            brand: item.brand,
            barcode: item.barcode,
            price: item.price,
            currency: item.currency,
          })),
        },
      },
      include: { items: true },
    });

    // Fire-and-forget matching process
    this.processMatching(job.id).catch((err) => console.error('Matching failed:', err));

    return {
      ...job,
      items: job.items.map((item) => ({
        ...item,
        price: item.price.toNumber(),
      })),
    };
  }

  async getJob(jobId: string): Promise<IngestionJobDetail | null> {
    if (!this.isUuid(jobId)) return null;
    const job = await this.prisma.ingestionJob.findUnique({
      where: { id: jobId },
      include: { items: true },
    });

    if (!job) return null;

    return {
      ...job,
      items: job.items.map((item) => ({
        ...item,
        price: item.price.toNumber(),
      })),
    };
  }

  async getJobs(): Promise<IngestionJobDetail[]> {
    const jobs = await this.prisma.ingestionJob.findMany({
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
      status = IngestionStatus.approved;
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
        ...(dto.currency !== undefined && { currency: dto.currency }),
        matchedSkuId,
        status,
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
        status = IngestionStatus.approved;
      }

      await this.prisma.ingestionItem.update({
        where: { id: item.id },
        data: { matchedSkuId, status },
      });

      // Trigger AI enrichment asynchronously (best-effort, non-blocking)
      this.enrichItemAsync(item.id, item.name, item.brand, item.barcode ?? undefined).catch((err) =>
        console.error(`Enrichment background error for item ${item.id}:`, err),
      );
    }

    await this.evaluateJobStatus(jobId);
  }

  async approveItem(itemId: string, dto?: ApproveIngestionItemDto): Promise<void> {
    const item = await this.prisma.ingestionItem.findUnique({
      where: { id: itemId },
      include: { job: true },
    });
    if (!item) throw new NotFoundException('Item not found');

    if (item.job.status === IngestionStatus.published) {
      throw new BadRequestException('Cannot modify items of a published job');
    }

    let matchedSkuId: string | null = item.matchedSkuId;

    if (dto?.matchedSkuId) {
      if (!this.isUuid(dto.matchedSkuId)) throw new BadRequestException('Invalid SKU ID');
      const isValid = await this.catalogService.validateSku(dto.matchedSkuId);
      if (!isValid) throw new NotFoundException('SKU not found in catalog or is inactive');
      matchedSkuId = dto.matchedSkuId;

      // Register Supplier SKU Alias for future imports
      await this.productIdentityService.createSupplierSkuAlias(
        item.job.supplierId,
        item.supplierSkuCode,
        matchedSkuId,
      );
    }

    await this.prisma.ingestionItem.update({
      where: { id: itemId },
      data: {
        matchedSkuId,
        status: IngestionStatus.approved,
      },
    });

    await this.evaluateJobStatus(item.jobId);
  }

  async rejectItem(itemId: string): Promise<void> {
    const item = await this.prisma.ingestionItem.findUnique({
      where: { id: itemId },
      include: { job: true },
    });
    if (!item) throw new NotFoundException('Item not found');

    if (item.job.status === IngestionStatus.published) {
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

      await this.prisma.ingestionItem.update({
        where: { id: itemId },
        data: {
          enrichment: result as unknown as import('@prisma/client').Prisma.InputJsonValue,
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
    // 1. Check if item is already matched to existing SKU in Catalog
    if (item.matchedSkuId) {
      const existing = await this.catalogService.getSkuIdentity(item.matchedSkuId);
      if (existing) return existing.id;
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
      return matchAnalysis.matchedSkuId;
    }

    // 3. Resolve or create Brand in Catalog via BrandService
    let brandId: string;
    const existingBrand = await this.brandService.getBrand(item.brand);
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
      const enrichmentDesc = (item.enrichment as Record<string, unknown>)?.suggestions
        ? ((item.enrichment as Record<string, unknown>).suggestions as Record<string, unknown>).description
        : undefined;
      product = await this.catalogService.createProduct({
        brandId,
        name: item.name,
        slug: productSlug,
        description: typeof enrichmentDesc === 'string' ? enrichmentDesc : undefined,
        isPublished: true,
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
      return existingSku.id;
    }

    // 6. Create new canonical SKU in Catalog
    const newSku = await this.catalogService.createSku(product.id, {
      code: skuCode,
      variantName: 'Default',
      barcode: item.barcode ?? undefined,
      isActive: true,
    });

    // 7. Register Supplier SKU Alias
    await this.productIdentityService.createSupplierSkuAlias(supplierId, item.supplierSkuCode, newSku.id);

    return newSku.id;
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
        isAvailable: true,
      });
    } catch (e) {
      if (e instanceof ConflictException) {
        const offers = await this.sourcingService.getSupplierOffers({ supplierId, skuId });
        if (offers.length > 0) {
          await this.sourcingService.updateSupplierOffer(offers[0].id, {
            costPrice,
            currency,
            isAvailable: true,
          });
        }
      } else {
        throw e;
      }
    }
  }

  async publishCandidate(itemId: string): Promise<Record<string, unknown>> {
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

    if (job.status !== IngestionStatus.approved) {
      throw new BadRequestException('Job is not fully approved yet. Resolve pending items first.');
    }

    const errors: string[] = [];

    for (const item of job.items) {
      if (item.status === IngestionStatus.approved) {
        try {
          const skuId = await this.ensureCanonicalSku(item, job.supplierId);

          await this.ensureSupplierOffer(
            job.supplierId,
            skuId,
            item.price.toNumber(),
            item.currency,
          );

          await this.prisma.ingestionItem.update({
            where: { id: item.id },
            data: { status: IngestionStatus.published, matchedSkuId: skuId },
          });
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

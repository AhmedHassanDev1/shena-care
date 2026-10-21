import { Injectable, BadRequestException, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { CatalogService, BrandService } from '../../catalog/public';
import { SourcingService } from '../../sourcing/public';
import { ProductIdentityService, MatchClassification } from './product-identity.service';
import { ProductResearchService } from './product-research.service';
import { ProductContentService } from './product-content.service';
import { CreateIngestionJobDto, ApproveIngestionItemDto, UpdateCandidateDto, ApplyJobMappingDto } from '../dto/ingestion.dto';
import { CandidateReviewRecord, CorrectCandidateDto, CandidateAuditEntry } from '../contracts/candidate-review.contract';
import { IngestionStatus, IngestionItemEnrichmentStatus, IngestionPriceType, IngestionImportMode, Prisma } from '@prisma/client';
import { AiClient, AiClientError, AiErrorKind } from '../../../platform/ai';
import { StorageService } from '../../../platform/storage/storage.service';
import { requireMediaReview, isTrustedMediaSource } from '../../../platform/security/media-review';
import { SpreadsheetParserService, ParsedSpreadsheet } from './spreadsheet-parser.service';
import { FormatFingerprintService } from './format-fingerprint.service';
import { ExportProfileService, ColumnMappingConfig, currencyFromPriceHeader } from './export-profile.service';
import { RowNormalizationService } from './row-normalization.service';
import { OfferBatchCommitService } from './offer-batch-commit.service';
import { CareService } from '../../care/public';
import { NormalizedRowStatus } from '../contracts/row-normalization.contract';
import * as crypto from 'crypto';

export interface IngestionJobDetail {
  id: string;
  supplierId: string;
  status: IngestionStatus;
  mode: IngestionImportMode;
  formatFingerprint?: string | null;
  profileId?: string | null;
  createdAt: Date;
  items: Array<{
    id: string;
    supplierSkuCode: string;
    name: string;
    brand: string;
    barcode: string | null;
    price: number;
    priceType: IngestionPriceType | null;
    reportedQuantity: number | null;
    currency: string;
    status: IngestionStatus;
    matchedSkuId: string | null;
  }>;
}

export interface IngestionUploadResult {
  jobId: string;
  sourceKey: string;
  formatFingerprint?: string;
  profileId?: string;
  status: IngestionStatus;
  requiresMapping: boolean;
  reused?: boolean;
  totalRows?: number;
  importedItemsCount?: number;
  sampleHeaders?: string[];
  sampleRows?: Record<string, any>[];
  proposedMapping?: Partial<ColumnMappingConfig>;
  confidence?: Record<string, number>;
  unmappedHeaders?: string[];
  isComplete?: boolean;
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
    private readonly spreadsheetParser: SpreadsheetParserService,
    private readonly formatFingerprintService: FormatFingerprintService,
    private readonly exportProfileService: ExportProfileService,
    private readonly rowNormalizationService: RowNormalizationService,
    private readonly offerBatchCommitService: OfferBatchCommitService,
    private readonly careService: CareService,
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

  async uploadSupplierSpreadsheet(
    supplierId: string,
    file: Express.Multer.File,
    mode: IngestionImportMode = IngestionImportMode.PARTIAL_UPDATE,
  ): Promise<IngestionUploadResult> {
    if (!this.isUuid(supplierId)) throw new BadRequestException('Invalid supplier ID');
    if (!['text/csv', 'application/pdf', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'].includes(file.mimetype)) {
      throw new BadRequestException('A supplier source document is required');
    }
    this.storageService.validateFile(file);
    const supplier = await this.prisma.supplier.findUnique({ where: { id: supplierId } });
    if (!supplier) throw new BadRequestException('Supplier not found');

    const isSpreadsheet = file.mimetype !== 'application/pdf';
    let parsed: ParsedSpreadsheet | null = null;
    let formatFingerprint: string | null = null;

    if (isSpreadsheet) {
      parsed = this.spreadsheetParser.parseSpreadsheet(file.buffer, file.originalname);
      formatFingerprint = this.formatFingerprintService.computeFingerprint(parsed.headers, parsed.sheets);
    }

    const checksum = crypto.createHash('sha256').update(file.buffer).digest('hex');
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`source:${supplierId}:${checksum}`}))`;
      const existing = await tx.ingestionJob.findFirst({
        where: { supplierId, sourceChecksum: checksum },
        orderBy: { createdAt: 'asc' },
        include: { items: true },
      });

      if (existing?.sourceKey) {
        if (!(await this.storageService.exists(existing.sourceKey))) {
          await this.storageService.restorePrivateFile(existing.sourceKey, file, supplierId);
        }
        return {
          jobId: existing.id,
          sourceKey: existing.sourceKey,
          formatFingerprint: existing.formatFingerprint ?? undefined,
          profileId: existing.profileId ?? undefined,
          status: existing.status,
          requiresMapping: existing.status === IngestionStatus.review_required,
          reused: true,
          totalRows: existing.items.length,
          importedItemsCount: existing.items.length,
        };
      }

      const fileUrl = await this.storageService.uploadFile(file, true, 'ingestion', supplierId);
      const sourceKey = new URL(fileUrl).pathname.slice('/storage/'.length);

      try {
        if (!isSpreadsheet || !parsed || !formatFingerprint) {
          const job = await tx.ingestionJob.create({
            data: { supplierId, status: IngestionStatus.pending, mode, sourceKey, sourceChecksum: checksum },
          });
          return { jobId: job.id, sourceKey, status: job.status, requiresMapping: false };
        }

        const approvedProfile = await this.exportProfileService.findApprovedProfile(supplierId, formatFingerprint, tx);

        if (approvedProfile) {
          // Layout is recognized & approved! Deterministic extraction without AI
          const job = await tx.ingestionJob.create({
            data: {
              supplierId,
              status: IngestionStatus.pending,
              mode,
              sourceKey,
              sourceChecksum: checksum,
              formatFingerprint,
              profileId: approvedProfile.id,
            },
          });

          const { items: itemsData, rowOutcomes } = this.extractItemsFromParsedSpreadsheet(
            { id: job.id, sourceKey, sourceChecksum: checksum, formatFingerprint },
            parsed,
            approvedProfile.mapping as any,
            supplier.name,
          );

          if (itemsData.length > 0) {
            await tx.ingestionItem.createMany({ data: itemsData });
          }
          await tx.ingestionJob.update({ where: { id: job.id }, data: { rowOutcomes: rowOutcomes as Prisma.InputJsonValue } });

          return {
            jobId: job.id,
            sourceKey,
            formatFingerprint,
            profileId: approvedProfile.id,
            status: IngestionStatus.pending,
            requiresMapping: false,
            totalRows: parsed.totalDataRows,
            importedItemsCount: itemsData.length,
          };
        } else {
          // New/unapproved layout -> Requires mapping review & approval
          const proposal = this.exportProfileService.proposeMapping(parsed.headers);

          const job = await tx.ingestionJob.create({
            data: {
              supplierId,
              status: IngestionStatus.review_required,
              mode,
              sourceKey,
              sourceChecksum: checksum,
              formatFingerprint,
            },
          });

          return {
            jobId: job.id,
            sourceKey,
            formatFingerprint,
            status: IngestionStatus.review_required,
            requiresMapping: true,
            sampleHeaders: parsed.headers,
            sampleRows: parsed.sampleRows,
            totalRows: parsed.totalDataRows,
            proposedMapping: proposal.mapping,
            confidence: proposal.confidence,
            unmappedHeaders: proposal.unmappedHeaders,
            isComplete: proposal.isComplete,
          };
        }
      } catch (error) {
        await this.storageService.deleteFile(fileUrl);
        throw error;
      }
    }, { timeout: 25000 });
  }

  async applyJobMapping(
    jobId: string,
    supplierId: string,
    dto: ApplyJobMappingDto,
    approvedBy: string,
  ): Promise<{ jobId: string; status: IngestionStatus; profileId: string; importedItemsCount: number }> {
    if (!this.isUuid(jobId)) throw new BadRequestException('Invalid job ID');
    const job = await this.prisma.ingestionJob.findUnique({
      where: { id: jobId },
      include: { supplier: true, items: true },
    });

    if (!job) throw new NotFoundException('Ingestion job not found');
    if (job.supplierId !== supplierId) {
      throw new ForbiddenException('Cannot modify an ingestion job belonging to another supplier');
    }
    if (!job.sourceKey || !job.sourceChecksum) {
      throw new BadRequestException('Job has no associated source file');
    }
    if (job.items.length > 0 || (job.status !== IngestionStatus.pending && job.status !== IngestionStatus.review_required)) {
      throw new ConflictException('Mapped or committed source jobs cannot be remapped');
    }

    const buffer = await this.storageService.getFileBuffer(job.sourceKey);
    const parsed = this.spreadsheetParser.parseSpreadsheet(buffer, job.sourceKey);
    const fingerprint = job.formatFingerprint || this.formatFingerprintService.computeFingerprint(parsed.headers, parsed.sheets);

    const profile = await this.exportProfileService.saveProfile({
      supplierId,
      formatFingerprint: fingerprint,
      mapping: dto.mapping,
      name: dto.profileName,
      sampleHeaders: parsed.headers,
      isApproved: true,
      approvedBy,
    });

    const { items: itemsData, rowOutcomes } = this.extractItemsFromParsedSpreadsheet(
      { id: job.id, sourceKey: job.sourceKey, sourceChecksum: job.sourceChecksum, formatFingerprint: fingerprint },
      parsed,
      dto.mapping,
      job.supplier.name,
    );

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mapping:job:${job.id}`}))`;
      const current = await tx.ingestionJob.findUniqueOrThrow({ where: { id: job.id }, include: { items: true } });
      if (current.items.length > 0 || (current.status !== IngestionStatus.pending && current.status !== IngestionStatus.review_required)) {
        throw new ConflictException('Mapped or committed source jobs cannot be remapped');
      }

      if (itemsData.length > 0) {
        await tx.ingestionItem.createMany({ data: itemsData });
      }

      await tx.ingestionJob.update({
        where: { id: job.id },
        data: {
          profileId: profile.id,
          formatFingerprint: fingerprint,
          status: IngestionStatus.pending,
          rowOutcomes: rowOutcomes as Prisma.InputJsonValue,
        },
      });

      return {
        jobId: job.id,
        status: IngestionStatus.pending,
        profileId: profile.id,
        importedItemsCount: itemsData.length,
      };
    });
  }

  async getProfiles(supplierId?: string) {
    return this.exportProfileService.listProfiles(supplierId);
  }

  async getProfile(profileId: string, supplierId?: string) {
    return this.exportProfileService.getProfile(profileId, supplierId);
  }

  async approveProfile(supplierId: string, profileId: string, approvedBy: string) {
    return this.exportProfileService.approveProfile(supplierId, profileId, approvedBy);
  }

  private extractItemsFromParsedSpreadsheet(
    job: { id: string; sourceKey: string; sourceChecksum: string; formatFingerprint?: string | null },
    parsed: ParsedSpreadsheet,
    mapping: ColumnMappingConfig,
    supplierName?: string,
  ) {
    const items: any[] = [];
    const rowOutcomes: Array<Record<string, unknown>> = [];
    const seenSkus = new Set<string>();

    for (const row of parsed.rows) {
      const rawSku = row.data[mapping.supplierSku];
      const rawName = row.data[mapping.name];
      const rawPrice = row.data[mapping.price];

      const norm = this.rowNormalizationService.normalizeRow({
        sourceRowNumber: row.sourceRow,
        supplierSku: rawSku,
        name: rawName,
        brand: mapping.brand ? row.data[mapping.brand] : supplierName,
        barcode: mapping.barcode ? row.data[mapping.barcode] : undefined,
        price: rawPrice,
        retailPrice: mapping.retailPrice ? row.data[mapping.retailPrice] : undefined,
        quantity: mapping.quantity ? row.data[mapping.quantity] : undefined,
        hasQuantityColumn: Boolean(mapping.quantity),
        discount: mapping.discount
          ? (/\(%\)|percent|نسبة/i.test(mapping.discount) && row.data[mapping.discount] !== undefined &&
              row.data[mapping.discount] !== null && String(row.data[mapping.discount]).trim() !== ''
              ? `${row.data[mapping.discount]}%` : row.data[mapping.discount])
          : undefined,
        currency: mapping.currency || (mapping.currencyColumn ? row.data[mapping.currencyColumn] : undefined) ||
          currencyFromPriceHeader(mapping.price) || undefined,
        units: mapping.units ? row.data[mapping.units] : undefined,
        extraAttributes: row.data,
      });

      if (norm.status === NormalizedRowStatus.INVALID) {
        rowOutcomes.push({ sourceRow: row.sourceRow, outcome: 'INVALID', reason: norm.statusReason,
          supplierSku: String(rawSku ?? ''), rawRow: row.data });
        continue;
      }

      if (seenSkus.has(norm.normalizedSku)) {
        rowOutcomes.push({ sourceRow: row.sourceRow, outcome: 'DUPLICATE', reason: 'duplicate_supplier_sku_in_source',
          supplierSku: norm.normalizedSku, rawRow: row.data });
        continue;
      }
      seenSkus.add(norm.normalizedSku);
      rowOutcomes.push({ sourceRow: row.sourceRow, outcome: 'IMPORTED', status: norm.status,
        supplierSku: norm.normalizedSku, rawRow: row.data });

      let itemStatus: IngestionStatus = IngestionStatus.pending;
      if (norm.status === NormalizedRowStatus.REVIEW || norm.status === NormalizedRowStatus.OUT_OF_SCOPE) {
        itemStatus = IngestionStatus.review_required;
      }

      items.push({
        jobId: job.id,
        supplierSkuCode: norm.normalizedSku,
        name: rawName ? String(rawName).trim() : norm.normalizedTitle,
        brand: norm.normalizedBrand || supplierName || 'General',
        barcode: norm.normalizedBarcode,
        price: norm.pricing.purchaseCost!,
        priceType: IngestionPriceType.PURCHASE_COST,
        reportedQuantity: norm.inventory.reportedQuantity,
        currency: norm.pricing.currency,
        status: itemStatus,
        enrichment: {
          source: {
            objectKey: job.sourceKey,
            checksum: job.sourceChecksum,
            row: row.sourceRow,
            formatFingerprint: job.formatFingerprint,
            rawRow: row.data,
            normalized: norm,
            input: {
              supplierSkuCode: norm.normalizedSku,
              name: rawName ? String(rawName).trim() : norm.normalizedTitle,
              brand: norm.normalizedBrand,
              barcode: norm.normalizedBarcode,
              price: norm.pricing.purchaseCost!,
              priceType: IngestionPriceType.PURCHASE_COST,
              reportedQuantity: norm.inventory.reportedQuantity,
              currency: norm.pricing.currency,
              sourceRow: row.sourceRow,
            },
          },
        },
      });
    }

    return { items, rowOutcomes };
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
        if (source.status !== IngestionStatus.pending && source.status !== IngestionStatus.review_required) {
          throw new ConflictException('Source job is no longer open for row admission');
        }
        await tx.ingestionItem.createMany({ data: dto.items.map(input => ({ jobId: source.id, supplierSkuCode: input.supplierSkuCode,
          name: input.name, brand: input.brand, barcode: input.barcode, price: input.price,
          priceType: input.priceType ?? null, reportedQuantity: input.reportedQuantity ?? null, currency: input.currency,
          enrichment: { source: { objectKey: source.sourceKey!, checksum: source.sourceChecksum!, row: input.sourceRow!,
            input: { supplierSkuCode: input.supplierSkuCode, name: input.name, brand: input.brand, barcode: input.barcode ?? null,
              price: input.price, priceType: input.priceType ?? null, reportedQuantity: input.reportedQuantity ?? null, currency: input.currency, sourceRow: input.sourceRow! } } } }),
        ) });
        await tx.ingestionJob.update({ where: { id: source.id }, data: {
          rowOutcomes: dto.items.map(input => ({ sourceRow: input.sourceRow!, outcome: 'IMPORTED_MANUAL',
            supplierSku: input.supplierSkuCode, rawRow: input })) as unknown as Prisma.InputJsonValue,
        } });
        return tx.ingestionJob.findUniqueOrThrow({ where: { id: source.id }, include: { items: true } });
      }
      return tx.ingestionJob.create({
      data: {
        supplierId: dto.supplierId,
        mode: dto.mode ?? IngestionImportMode.PARTIAL_UPDATE,
        items: {
          create: dto.items.map((item) => ({
            supplierSkuCode: item.supplierSkuCode,
            name: item.name,
            brand: item.brand,
            barcode: item.barcode,
            price: item.price,
            priceType: item.priceType ?? null,
            reportedQuantity: item.reportedQuantity ?? null,
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
        reportedQuantity: item.reportedQuantity ?? null,
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
        reportedQuantity: item.reportedQuantity ?? null,
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
        reportedQuantity: item.reportedQuantity ?? null,
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

    const brandMatch = await this.brandService.getBrand(this.slugify(item.brand)) ||
      (matchAnalysis.classification === MatchClassification.EXACT_MATCH && matchAnalysis.canonicalSku
        ? await this.brandService.getBrand(this.slugify(matchAnalysis.canonicalSku.brandName)) : null);

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
      reportedQuantity: item.reportedQuantity ?? null,
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

  /**
   * SG-10: Single comprehensive review record showing original supplier row,
   * source file, normalized identity, Brand/Line/Ingredient/routine dependencies,
   * content/media drafts, policy/quality conflicts, and canPublish gate.
   */
  async getCandidateReviewRecord(itemId: string): Promise<CandidateReviewRecord> {
    if (!this.isUuid(itemId)) throw new BadRequestException('Invalid candidate item ID');
    const item = await this.prisma.ingestionItem.findUnique({
      where: { id: itemId },
      include: {
        job: {
          select: {
            id: true,
            supplierId: true,
            mode: true,
            status: true,
            createdAt: true,
          },
        },
        contentDraft: true,
      },
    });

    if (!item) throw new NotFoundException('Candidate item not found');

    const enrichment = (item.enrichment as Record<string, any>) || {};
    const auditTrail: CandidateAuditEntry[] = Array.isArray(enrichment.auditTrail) ? enrichment.auditTrail : [];

    // Recompute match analysis and fingerprint
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

    // Dependencies: Brand & ProductLine
    const brandMatch = await this.brandService.getBrand(this.slugify(item.brand)) ||
      (matchAnalysis.classification === MatchClassification.EXACT_MATCH && matchAnalysis.canonicalSku
        ? await this.brandService.getBrand(this.slugify(matchAnalysis.canonicalSku.brandName)) : null);
    const brandDraft = await this.prisma.brandDraft.findFirst({
      where: {
        OR: [
          { name: { equals: item.brand, mode: 'insensitive' } },
          { canonicalName: { equals: item.brand, mode: 'insensitive' } },
          { aliases: { has: item.brand.toLowerCase() } },
        ],
      },
    });

    // Dependencies: Ingredients & Routine
    const activeIngredients: string[] = [];
    if (Array.isArray(enrichment.ingredientProfile?.actives)) {
      activeIngredients.push(
        ...enrichment.ingredientProfile.actives.map((i: any) =>
          typeof i === 'string' ? i : i.name || i.inciName || '',
        ),
      );
    }

    const cautions: string[] = Array.isArray(enrichment.ingredientProfile?.cautions)
      ? enrichment.ingredientProfile.cautions
      : [];

    const hasForbiddenSubstances = Boolean(enrichment.ingredients?.hasForbiddenSubstances);

    // Dependencies: Routine placement
    const routinePlacement = enrichment.routinePlacement;

    // Content & Media
    const media = Array.isArray(enrichment.media) ? enrichment.media : [];
    const verifiedPackshots = media.filter((m: any) => m.originType === 'verified');
    const hasVerifiedPackshot = verifiedPackshots.length > 0;
    const newVariantReviewed = matchAnalysis.classification === MatchClassification.LIKELY_MATCH &&
      !item.matchedSkuId && Boolean(item.barcode) && verifiedPackshots.some((m: any) => {
        try {
          const review = requireMediaReview(m.review);
          return review.candidateId === item.id && review.barcode === item.barcode &&
            Array.isArray(enrichment.research?.fieldEvidences) &&
            enrichment.research.fieldEvidences.some((e: any) => e.fieldName === 'size' &&
              e.verificationStatus === 'SUPPORTED' && e.sourceUrl === review.sourceUrl &&
              e.proposedValue?.value === review.size && e.proposedValue?.unit === review.sizeUnit);
        } catch { return false; }
      });

    // Check for policy / quality conflicts
    const policyAndQualityConflicts: string[] = [];

    if (!item.barcode && !effectiveSkuId) {
      policyAndQualityConflicts.push('MISSING_BARCODE');
    }
    if (!hasVerifiedPackshot) {
      policyAndQualityConflicts.push('MISSING_OFFICIAL_PACKSHOT');
    }
    if (brandDraft && brandDraft.status === 'PENDING_REVIEW') {
      policyAndQualityConflicts.push('UNAPPROVED_BRAND_DRAFT');
    }
    if (brandDraft && brandDraft.status === 'REJECTED') {
      policyAndQualityConflicts.push('REJECTED_BRAND_DRAFT');
    }
    if (!brandMatch && !(brandDraft?.status === 'APPROVED' && brandDraft.canonicalBrandId)) {
      policyAndQualityConflicts.push('UNREVIEWED_BRAND');
    }
    if (item.priceType !== IngestionPriceType.PURCHASE_COST) {
      policyAndQualityConflicts.push('INVALID_PRICE_TYPE_PURCHASE_COST_REQUIRED');
    }
    if (hasForbiddenSubstances) {
      policyAndQualityConflicts.push('FORBIDDEN_SUBSTANCE_DETECTED');
    }
    if (matchAnalysis.conflicts && matchAnalysis.conflicts.length > 0 && !newVariantReviewed) {
      policyAndQualityConflicts.push(...matchAnalysis.conflicts);
    }
    if (item.matchedSkuId && (matchAnalysis.classification !== MatchClassification.EXACT_MATCH ||
        matchAnalysis.matchedSkuId !== item.matchedSkuId)) {
      policyAndQualityConflicts.push('MISMATCHED_CANONICAL_SKU');
    }
    if ([MatchClassification.CONFLICT, MatchClassification.INVALID, MatchClassification.OUT_OF_SCOPE].includes(matchAnalysis.classification)) {
      policyAndQualityConflicts.push('IDENTITY_CONFLICT');
    }
    for (const m of verifiedPackshots) {
      try {
        const review = requireMediaReview(m.review);
        const extractedPackCount = this.rowNormalizationService.extractSizeAndPack(item.name).packCount;
        if (m.isTest || review.candidateId !== item.id || review.barcode !== item.barcode ||
            !isTrustedMediaSource(review.sourceUrl) ||
            (extractedPackCount !== null && review.packCount !== extractedPackCount) ||
            (matchedSku && (matchedSku.size !== review.size || matchedSku.sizeUnit !== review.sizeUnit ||
              matchedSku.variantName !== review.variantName || matchedSku.packCount !== (review.packCount ?? null)))) {
          policyAndQualityConflicts.push('INVALID_MEDIA_REVIEW');
        }
      } catch {
        policyAndQualityConflicts.push('INVALID_MEDIA_REVIEW');
      }
    }
    if (item.contentDraft && !item.contentDraft.isApproved) {
      policyAndQualityConflicts.push('UNAPPROVED_CONTENT_DRAFT');
    }
    if (enrichment.safetyHold === true || enrichment.safety?.hold === true) {
      policyAndQualityConflicts.push('SAFETY_HOLD');
    }

    const canPublish = policyAndQualityConflicts.length === 0 && item.status === IngestionStatus.approved;

    return {
      candidateId: item.id,
      status: item.status,
      originalSupplierRow: {
        jobId: item.jobId,
        supplierId: item.job.supplierId,
        supplierSkuCode: item.supplierSkuCode,
        sourceFile: {
          jobId: item.job.id,
          mode: item.job.mode,
          createdAt: item.job.createdAt,
        },
        price: item.price.toNumber(),
        priceType: item.priceType,
        currency: item.currency,
        reportedQuantity: item.reportedQuantity ?? null,
      },
      normalizedIdentity: {
        name: item.name,
        brand: item.brand,
        barcode: item.barcode,
        category: enrichment.category || enrichment.normalized?.category || null,
        size: enrichment.size || enrichment.normalized?.size || null,
        sizeUnit: enrichment.sizeUnit || enrichment.normalized?.sizeUnit || null,
        fingerprint: matchAnalysis.fingerprint,
        matchClassification: matchAnalysis.classification,
        matchReason: matchAnalysis.reason,
        matchedSkuId: item.matchedSkuId,
        matchedSku,
      },
      dependencies: {
        brand: {
          isCanonical: Boolean(brandMatch),
          canonicalBrandId: brandMatch?.id || brandDraft?.canonicalBrandId || undefined,
          draftStatus: brandDraft?.status,
          name: brandMatch?.name || item.brand,
        },
        productLine: {
          isCanonical: false,
        },
        ingredients: {
          canonicalCount: Array.isArray(enrichment.ingredientProfile?.actives)
            ? enrichment.ingredientProfile.actives.length
            : 0,
          activeIngredients,
          cautions,
          hasForbiddenSubstances,
        },
        routinePlacement: routinePlacement
          ? {
              stepOrder: routinePlacement.stepOrder || routinePlacement.step,
              stepType: routinePlacement.stepType || routinePlacement.stepName,
              timing: routinePlacement.timing || routinePlacement.timeOfDay,
              frequency: routinePlacement.frequency,
              requiresDaytimeSunscreen: routinePlacement.requiresDaytimeSunscreen,
              isPhotosensitizing: routinePlacement.isPhotosensitizing,
            }
          : undefined,
        research: enrichment.research
          ? {
              sourceCount: Array.isArray(enrichment.research.sources)
                ? enrichment.research.sources.length
                : 0,
              fieldEvidences: Array.isArray(enrichment.research.fieldEvidences)
                ? enrichment.research.fieldEvidences
                : [],
            }
          : undefined,
      },
      contentAndMedia: {
        contentDraft: item.contentDraft
          ? {
              titleEn: item.contentDraft.titleEn,
              titleAr: item.contentDraft.titleAr,
              shortDescriptionEn: item.contentDraft.shortDescriptionEn,
              shortDescriptionAr: item.contentDraft.shortDescriptionAr,
              benefitsEn: item.contentDraft.benefitsEn,
              benefitsAr: item.contentDraft.benefitsAr,
              usageEn: item.contentDraft.usageEn,
              usageAr: item.contentDraft.usageAr,
              isApproved: item.contentDraft.isApproved,
              evidenceVersion: item.contentDraft.evidenceVersion,
            }
          : null,
        verifiedPackshots,
        hasVerifiedPackshot,
        officialBrandLogo: brandMatch?.logoUrl || brandDraft?.logoUrl || null,
      },
      policyAndQualityConflicts,
      canPublish,
      auditTrail,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  async correctCandidate(
    itemId: string,
    dto: CorrectCandidateDto,
    actorId: string,
  ): Promise<CandidateReviewRecord> {
    return this.withCandidateLock(itemId, () => this.correctCandidateLocked(itemId, dto, actorId));
  }

  private async correctCandidateLocked(
    itemId: string,
    dto: CorrectCandidateDto,
    actorId: string,
  ): Promise<CandidateReviewRecord> {
    if (!this.isUuid(itemId)) throw new BadRequestException('Invalid candidate item ID');
    if (!this.isUuid(actorId)) throw new BadRequestException('Invalid actor ID');

    const item = await this.prisma.ingestionItem.findUnique({
      where: { id: itemId },
      include: { job: true },
    });
    if (!item) throw new NotFoundException('Candidate item not found');
    if (item.status === IngestionStatus.published) {
      throw new BadRequestException('Cannot modify published candidate');
    }

    const currentEnrichment = (item.enrichment as Record<string, any>) || {};
    const auditTrail: CandidateAuditEntry[] = Array.isArray(currentEnrichment.auditTrail)
      ? currentEnrichment.auditTrail
      : [];

    const previousValues = {
      name: item.name,
      brand: item.brand,
      barcode: item.barcode,
      price: item.price.toNumber(),
      priceType: item.priceType,
      currency: item.currency,
      reportedQuantity: item.reportedQuantity,
      category: currentEnrichment.category || currentEnrichment.normalized?.category,
      size: currentEnrichment.size || currentEnrichment.normalized?.size,
      sizeUnit: currentEnrichment.sizeUnit || currentEnrichment.normalized?.sizeUnit,
    };

    auditTrail.push({
      action: 'CORRECTED',
      actorId,
      timestamp: new Date().toISOString(),
      reason: dto.reason || 'Field-level editorial correction',
      previousValues,
      newValues: dto as Record<string, unknown>,
    });

    const newName = dto.name !== undefined ? dto.name.trim() : item.name;
    const newBrand = dto.brand !== undefined ? dto.brand.trim() : item.brand;
    const newBarcode = dto.barcode !== undefined ? dto.barcode.trim() : item.barcode;

    const matchAnalysis = await this.productIdentityService.classifyCandidateMatch({
      supplierId: item.job.supplierId,
      supplierSkuCode: item.supplierSkuCode,
      name: newName,
      brand: newBrand,
      barcode: newBarcode,
    });

    let matchedSkuId: string | null = null;
    if (matchAnalysis.classification === MatchClassification.EXACT_MATCH && matchAnalysis.matchedSkuId) {
      matchedSkuId = matchAnalysis.matchedSkuId;
    }

    const updatedEnrichment = {
      ...currentEnrichment,
      auditTrail,
      catalogReview: null,
      media: (Array.isArray(currentEnrichment.media) ? currentEnrichment.media : []).map((m: any) =>
        ({ ...m, originType: m.isTest ? 'test' : 'unverified', review: null })),
      ...(dto.category !== undefined && { category: dto.category }),
      ...(dto.size !== undefined && { size: dto.size }),
      ...(dto.sizeUnit !== undefined && { sizeUnit: dto.sizeUnit }),
    };

    await this.prisma.ingestionItem.update({
      where: { id: itemId },
      data: {
        name: newName,
        brand: newBrand,
        barcode: newBarcode,
        ...(dto.price !== undefined && { price: dto.price }),
        ...(dto.priceType !== undefined && { priceType: dto.priceType }),
        ...(dto.reportedQuantity !== undefined && { reportedQuantity: dto.reportedQuantity }),
        ...(dto.currency !== undefined && { currency: dto.currency }),
        matchedSkuId,
        status: IngestionStatus.review_required,
        enrichment: updatedEnrichment as unknown as import('@prisma/client').Prisma.InputJsonValue,
      },
    });

    await this.evaluateJobStatus(item.jobId);
    return this.getCandidateReviewRecord(itemId);
  }

  async requestMoreCandidate(
    itemId: string,
    requestedInfo: string,
    actorId: string,
  ): Promise<CandidateReviewRecord> {
    return this.withCandidateLock(itemId, () => this.requestMoreCandidateLocked(itemId, requestedInfo, actorId));
  }

  private async requestMoreCandidateLocked(
    itemId: string,
    requestedInfo: string,
    actorId: string,
  ): Promise<CandidateReviewRecord> {
    if (!this.isUuid(itemId)) throw new BadRequestException('Invalid candidate item ID');
    if (!this.isUuid(actorId)) throw new BadRequestException('Invalid actor ID');
    if (!requestedInfo || !requestedInfo.trim()) {
      throw new BadRequestException('Requested information details are required');
    }

    const item = await this.prisma.ingestionItem.findUnique({
      where: { id: itemId },
      include: { job: true },
    });
    if (!item) throw new NotFoundException('Candidate item not found');
    if (item.status === IngestionStatus.published) {
      throw new BadRequestException('Cannot request info on published candidate');
    }

    const currentEnrichment = (item.enrichment as Record<string, any>) || {};
    const auditTrail: CandidateAuditEntry[] = Array.isArray(currentEnrichment.auditTrail)
      ? currentEnrichment.auditTrail
      : [];

    auditTrail.push({
      action: 'REQUESTED_MORE_INFO',
      actorId,
      timestamp: new Date().toISOString(),
      requestedInfo: requestedInfo.trim(),
    });

    await this.prisma.ingestionItem.update({
      where: { id: itemId },
      data: {
        status: IngestionStatus.review_required,
        enrichment: {
          ...currentEnrichment,
          requestedInfo: requestedInfo.trim(),
          auditTrail,
        } as unknown as import('@prisma/client').Prisma.InputJsonValue,
      },
    });

    return this.getCandidateReviewRecord(itemId);
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

    let matchedSkuId: string | null = null;
    let status = item.status;

    if (matchAnalysis.classification === MatchClassification.EXACT_MATCH && matchAnalysis.matchedSkuId) {
      matchedSkuId = matchAnalysis.matchedSkuId;
      status = IngestionStatus.review_required;
    } else if (matchAnalysis.classification === MatchClassification.CONFLICT || matchAnalysis.classification === MatchClassification.LIKELY_MATCH) {
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
        ...(dto.reportedQuantity !== undefined && { reportedQuantity: dto.reportedQuantity }),
        ...(dto.currency !== undefined && { currency: dto.currency }),
        matchedSkuId,
        status: IngestionStatus.review_required,
        enrichment: { ...((item.enrichment as Record<string, any>) || {}),
          contentReview: null,
          catalogReview: null,
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
      } else if (matchAnalysis.classification === MatchClassification.OUT_OF_SCOPE) {
        await this.prisma.ingestionItem.update({
          where: { id: item.id },
          data: {
            status: IngestionStatus.rejected,
            enrichmentStatus: IngestionItemEnrichmentStatus.failed,
            enrichmentError: matchAnalysis.reason,
            enrichment: {
              identity: {
                fingerprint: matchAnalysis.fingerprint,
                classification: matchAnalysis.classification,
                matchReason: matchAnalysis.reason,
                conflicts: matchAnalysis.conflicts,
              },
            },
          },
        });
        continue;
      } else if (matchAnalysis.classification === MatchClassification.INVALID) {
        await this.prisma.ingestionItem.update({
          where: { id: item.id },
          data: {
            status: IngestionStatus.rejected,
            enrichmentStatus: IngestionItemEnrichmentStatus.failed,
            enrichmentError: matchAnalysis.reason,
            enrichment: {
              identity: {
                fingerprint: matchAnalysis.fingerprint,
                classification: matchAnalysis.classification,
                matchReason: matchAnalysis.reason,
                conflicts: matchAnalysis.conflicts,
              },
            },
          },
        });
        continue;
      }

      const itemEnrichment = {
        ...((item.enrichment as Record<string, any>) || {}),
        identity: {
          fingerprint: matchAnalysis.fingerprint,
          classification: matchAnalysis.classification,
          matchReason: matchAnalysis.reason,
          conflicts: matchAnalysis.conflicts,
          canonicalSku: matchAnalysis.canonicalSku || null,
          existingCandidateId: matchAnalysis.existingCandidateId || null,
        },
      };

      const changed = await this.prisma.ingestionItem.updateMany({
        where: { id: item.id, status: IngestionStatus.pending, updatedAt: item.updatedAt },
        data: {
          matchedSkuId,
          status,
          enrichment: itemEnrichment as unknown as Prisma.InputJsonValue,
        },
      });
      if (!changed.count) continue;

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

    if (reviewerId) {
      const reviewer = await this.prisma.customer.findUnique({ where: { id: reviewerId } });
      if (!reviewer?.roles.includes('ADMIN')) {
        throw new ForbiddenException('Only Admin can approve candidate items');
      }
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
      const analysis = await this.productIdentityService.classifyCandidateMatch({
        supplierId: item.job.supplierId, supplierSkuCode: item.supplierSkuCode,
        name: item.name, brand: item.brand, barcode: item.barcode,
      });
      if (analysis.classification !== MatchClassification.EXACT_MATCH || analysis.matchedSkuId !== dto.matchedSkuId) {
        throw new BadRequestException('Selected SKU conflicts with canonical identity; resolve identity evidence first');
      }
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
        const extractedPackCount = this.rowNormalizationService.extractSizeAndPack(item.name).packCount;
        if (extractedPackCount !== null && review.packCount !== extractedPackCount) {
          throw new BadRequestException('Pack count requires matching official media review');
        }
        const sizeEvidence = research?.fieldEvidences?.find((e: any) => e.fieldName === 'size' &&
          e.verificationStatus === 'SUPPORTED' && e.sourceUrl === review.sourceUrl &&
          e.proposedValue?.value === review.size && e.proposedValue?.unit === review.sizeUnit);
        if (!sizeEvidence) throw new BadRequestException('Package size requires matching source evidence');
        if (matchedSkuId) {
          const sku = await this.catalogService.getSkuIdentity(matchedSkuId);
          if (!sku || sku.barcode !== review.barcode || sku.size !== review.size ||
              sku.sizeUnit !== review.sizeUnit || sku.variantName !== review.variantName ||
              sku.packCount !== (review.packCount ?? null)) {
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

    const currentEnrichmentObj = (item.enrichment as Record<string, any>) || {};
    const hasCatalogSelection = dto && [dto.productLineId, dto.categoryId, dto.concernSlugs,
      dto.routineStepId, dto.approvedIngredientIds].some(value => value !== undefined);
    let catalogReview = currentEnrichmentObj.catalogReview;
    if (hasCatalogSelection) {
      if (!reviewerId) throw new BadRequestException('Admin reviewer required for catalog selections');
      const brand = await this.brandService.getBrand(this.slugify(item.brand));
      if (dto!.productLineId) {
        const line = await this.prisma.productLine.findUnique({ where: { id: dto!.productLineId }, include: { brand: true } });
        if (!line?.isActive || this.productIdentityService.canonicalizeBrand(line.brand.name) !==
            this.productIdentityService.canonicalizeBrand(item.brand)) {
          throw new BadRequestException('Selected product line does not belong to the candidate brand');
        }
      }
      if (dto!.categoryId) {
        const category = await this.prisma.category.findUnique({ where: { id: dto!.categoryId } });
        if (!category?.isActive) throw new BadRequestException('Selected category is not active');
      }
      const concerns = [...new Set(dto!.concernSlugs ?? [])];
      if (concerns.length) {
        const found = await this.prisma.concern.findMany({ where: { slug: { in: concerns }, isActive: true } });
        if (found.length !== concerns.length) throw new BadRequestException('Unknown or inactive concern selection');
      }
      if (dto!.routineStepId) {
        const step = await this.prisma.routineStep.findUnique({ where: { id: dto!.routineStepId }, include: { routine: true } });
        if (!step?.routine.isActive) throw new BadRequestException('Unknown or inactive routine step');
      }
      const ingredientIds = [...new Set(dto!.approvedIngredientIds ?? [])];
      if (ingredientIds.length) {
        const actives = Array.isArray(currentEnrichmentObj.ingredientProfile?.actives)
          ? currentEnrichmentObj.ingredientProfile.actives : [];
        const evidence = (currentEnrichmentObj.research?.fieldEvidences ?? []).filter((entry: any) =>
          entry.fieldName === 'ingredients' && entry.verificationStatus === 'SUPPORTED' &&
          entry.sourceType === 'OFFICIAL_MANUFACTURER' && /^https:\/\//i.test(entry.sourceUrl));
        const selected = await this.prisma.ingredient.findMany({ where: { id: { in: ingredientIds }, status: 'APPROVED' } });
        if (selected.length !== ingredientIds.length || selected.some(ingredient =>
          !actives.some((active: any) => active.id === ingredient.id) ||
          !evidence.some((entry: any) => Array.isArray(entry.proposedValue) &&
            entry.proposedValue.some((name: string) => [ingredient.inciName, ingredient.name].some(value =>
              value.toLowerCase() === String(name).toLowerCase()))))) {
          throw new BadRequestException('Ingredient selection requires canonical ontology and supported manufacturer INCI evidence');
        }
      }
      catalogReview = { productLineId: dto!.productLineId ?? null, categoryId: dto!.categoryId ?? null,
        concernSlugs: concerns, routineStepId: dto!.routineStepId ?? null,
        ingredientIds, reviewedBy: reviewerId, reviewedAt: new Date().toISOString(),
        brandId: brand?.id ?? null };
    }
    const auditTrail: CandidateAuditEntry[] = Array.isArray(currentEnrichmentObj.auditTrail)
      ? currentEnrichmentObj.auditTrail
      : [];

    if (reviewerId) {
      auditTrail.push({
        action: 'APPROVED',
        actorId: reviewerId,
        timestamp: new Date().toISOString(),
      });
    }

    const updatedEnrichment = { ...currentEnrichmentObj, media, auditTrail, catalogReview };

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

  async rejectItem(itemId: string, reason?: string, actorId?: string): Promise<void> {
    return this.withCandidateLock(itemId, () => this.rejectItemLocked(itemId, reason, actorId));
  }

  private async rejectItemLocked(itemId: string, reason?: string, actorId?: string): Promise<void> {
    const item = await this.prisma.ingestionItem.findUnique({
      where: { id: itemId },
      include: { job: true },
    });
    if (!item) throw new NotFoundException('Item not found');

    if (item.job.status === IngestionStatus.published || item.status === IngestionStatus.published) {
      throw new BadRequestException('Cannot modify items of a published job');
    }

    if (actorId) {
      const actor = await this.prisma.customer.findUnique({ where: { id: actorId } });
      if (!actor?.roles.includes('ADMIN')) {
        throw new ForbiddenException('Only Admin can reject candidate items');
      }
    }

    const currentEnrichment = (item.enrichment as Record<string, any>) || {};
    const auditTrail: CandidateAuditEntry[] = Array.isArray(currentEnrichment.auditTrail)
      ? currentEnrichment.auditTrail
      : [];

    if (actorId) {
      auditTrail.push({
        action: 'REJECTED',
        actorId,
        timestamp: new Date().toISOString(),
        reason: reason || 'Item rejected by reviewer',
      });
    }

    await this.prisma.ingestionItem.update({
      where: { id: itemId },
      data: {
        status: IngestionStatus.rejected,
        enrichment: {
          ...currentEnrichment,
          rejectionReason: reason || currentEnrichment.rejectionReason,
          auditTrail,
        } as unknown as import('@prisma/client').Prisma.InputJsonValue,
      },
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
    if (!reviewedMedia.length) {
      throw new BadRequestException('Missing mandatory verified packshot prevents catalog publication');
    }
    for (const m of reviewedMedia) {
      const review = requireMediaReview(m.review);
      if (review.candidateId !== item.id || review.barcode !== item.barcode || m.isTest) {
        throw new BadRequestException('Media review no longer matches candidate identity');
      }
    }

    // 1. Check if item is already matched to existing SKU in Catalog
    if (item.matchedSkuId) {
      const existing = await this.catalogService.getSkuIdentity(item.matchedSkuId);
      if (existing) {
        await this.productIdentityService.createSupplierSkuAlias(supplierId, item.supplierSkuCode, existing.id);
        await this.publishReviewedMedia(item, existing.id, supplierId);
        return existing.id;
      }
    }

    // 2. Barcode-first deduplication inside transaction (prevents two suppliers creating duplicate SKUs)
    if (item.barcode) {
      const existingSku = await this.catalogService.getSkuByBarcode(item.barcode);
      if (existingSku) {
        await this.productIdentityService.createSupplierSkuAlias(supplierId, item.supplierSkuCode, existingSku.id);
        await this.publishReviewedMedia(item, existingSku.id, supplierId);
        return existingSku.id;
      }
    }

    // 3. Perform pre-publish Identity Match Check (Deduplication)
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

    // 4. Admit only an existing or separately approved canonical brand.
    const existingBrand = await this.brandService.getBrand(this.slugify(item.brand));
    const approvedDraft = existingBrand ? null : await this.prisma.brandDraft.findFirst({ where: {
      status: 'APPROVED', canonicalBrandId: { not: null },
      OR: [{ name: { equals: item.brand, mode: 'insensitive' } },
        { canonicalName: { equals: item.brand, mode: 'insensitive' } }],
    } });
    const brandId = existingBrand?.id ?? approvedDraft?.canonicalBrandId;
    if (!brandId) throw new BadRequestException('Canonical brand admission requires review');
    const brandName = existingBrand?.name ?? item.brand;
    const catalogReview = enrichment.catalogReview as Record<string, any> | undefined;

    // 5. Resolve or create Product in Catalog via CatalogService
    const productSlug = this.slugify(`${brandName}-${item.name}`);
    let product = await this.catalogService.getProduct(productSlug);
    if (!product) {
      product = await this.catalogService.createProduct({
        brandId,
        name: item.name,
        slug: productSlug,
        ...(catalogReview?.productLineId && { productLineId: catalogReview.productLineId }),
        ...(catalogReview?.categoryId && { categoryId: catalogReview.categoryId }),
        ...(catalogReview?.concernSlugs?.length && { concerns: catalogReview.concernSlugs }),
        isPublished: false,
      });
    } else if (catalogReview) {
      const current = await this.prisma.product.findUniqueOrThrow({ where: { id: product.id } });
      const additions = {
        ...(!current.productLineId && catalogReview.productLineId && { productLineId: catalogReview.productLineId }),
        ...(!current.categoryId && catalogReview.categoryId && { categoryId: catalogReview.categoryId }),
        ...(!current.concerns.length && catalogReview.concernSlugs?.length && { concerns: catalogReview.concernSlugs }),
      };
      if (Object.keys(additions).length) product = await this.catalogService.updateProduct(product.id, additions);
    }

    // 6. Check if SKU already exists under Product
    const skuCode = item.barcode ? `SKU-${item.barcode}` : (item.supplierSkuCode || `SKU-${item.id.slice(0, 8).toUpperCase()}`);
    const existingSkus = await this.catalogService.getSkus(product.id);
    const existingSku = existingSkus.find(
      (s) => s.code === skuCode || (item.barcode !== null && s.barcode === item.barcode),
    );

    if (existingSku) {
      await this.productIdentityService.createSupplierSkuAlias(supplierId, item.supplierSkuCode, existingSku.id);
      await this.publishReviewedMedia(item, existingSku.id, supplierId);
      return existingSku.id;
    }

    // 7. Create new canonical SKU in Catalog
    const newSku = await this.catalogService.createSku(product.id, {
      code: skuCode,
      variantName: reviewedMedia[0].review.variantName,
      size: reviewedMedia[0].review.size,
      sizeUnit: reviewedMedia[0].review.sizeUnit,
      packCount: reviewedMedia[0].review.packCount ?? undefined,
      barcode: item.barcode ?? undefined,
      isActive: true,
    });

    // 8. Register Supplier SKU Alias
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
          sku.sizeUnit !== review.sizeUnit || sku.variantName !== review.variantName ||
          sku.packCount !== (review.packCount ?? null)) {
        throw new BadRequestException('Approved media does not match canonical SKU');
      }
      const url = await this.storageService.copyToPublic(m.url, supplierId);
      await this.catalogService.addMedia(sku.productId, { type: 'image', url, originType: 'verified',
        generationMetadata: { ...review, skuId } }, review.reviewedBy);
    }
  }

  async publishCandidate(itemId: string, actorId?: string): Promise<Record<string, unknown>> {
    return this.withCandidateLock(itemId, () => this.publishCandidateLocked(itemId, actorId));
  }

  private async publishCandidateLocked(itemId: string, actorId?: string): Promise<Record<string, unknown>> {
    if (!this.isUuid(itemId)) throw new BadRequestException('Invalid candidate item ID');
    const item = await this.prisma.ingestionItem.findUnique({
      where: { id: itemId },
      include: { job: true },
    });

    if (!item) throw new NotFoundException('Candidate item not found');
    if (item.status === IngestionStatus.published) {
      throw new BadRequestException('Candidate is already published');
    }

    if (actorId) {
      const actor = await this.prisma.customer.findUnique({ where: { id: actorId } });
      if (!actor?.roles.includes('ADMIN')) {
        throw new ForbiddenException('Only Admin can publish catalog candidates');
      }
    }

    if (item.status !== IngestionStatus.approved) {
      throw new BadRequestException('Candidate item is not approved for publication yet');
    }

    if (item.priceType !== IngestionPriceType.PURCHASE_COST) {
      throw new BadRequestException('Explicit purchase cost price type is required for offer publication');
    }

    const readiness = await this.getCandidateReviewRecord(itemId);
    if (!readiness.canPublish) {
      if (readiness.policyAndQualityConflicts.includes('MISSING_BARCODE')) {
        throw new BadRequestException('Missing mandatory barcode identity prevents catalog publication');
      }
      if (readiness.policyAndQualityConflicts.includes('MISSING_OFFICIAL_PACKSHOT')) {
        throw new BadRequestException('Missing mandatory verified packshot prevents catalog publication');
      }
      if (readiness.policyAndQualityConflicts.includes('UNAPPROVED_BRAND_DRAFT')) {
        throw new BadRequestException('Brand draft must be approved by Administrator before candidate publication');
      }
      throw new BadRequestException(`Candidate identity, media, content or safety review conflicts: ${readiness.policyAndQualityConflicts.join(', ')}`);
    }

    // Mandatory identity and verified packshot check (GLO-255 acceptance gate)
    if (!item.barcode && !item.matchedSkuId) {
      throw new BadRequestException('Missing mandatory barcode identity prevents catalog publication');
    }

    const enrichment = (item.enrichment as Record<string, any>) || {};
    const reviewedMedia = (Array.isArray(enrichment.media) ? enrichment.media : []).filter((m: any) => m.originType === 'verified');
    if (!reviewedMedia.length) {
      throw new BadRequestException('Missing mandatory verified packshot prevents catalog publication');
    }

    // Brand draft gate
    const brandDraft = await this.prisma.brandDraft.findFirst({
      where: {
        OR: [
          { name: { equals: item.brand, mode: 'insensitive' } },
          { canonicalName: { equals: item.brand, mode: 'insensitive' } },
          { aliases: { has: item.brand.toLowerCase() } },
        ],
      },
    });
    if (brandDraft && brandDraft.status === 'PENDING_REVIEW') {
      throw new BadRequestException('Brand draft must be approved by Administrator before candidate publication');
    }
    if (brandDraft && brandDraft.status === 'REJECTED') {
      throw new BadRequestException('Brand draft was rejected. Candidate cannot be published');
    }

    await this.offerBatchCommitService.assertCandidateOfferSafe(item.id, item.matchedSkuId);
    const skuId = await this.ensureCanonicalSku(item, item.job.supplierId);
    await this.offerBatchCommitService.commitCandidateOffer(item.id, skuId);
    const catalogReview = enrichment.catalogReview as Record<string, any> | undefined;
    if (catalogReview?.reviewedBy) {
      const sku = await this.prisma.sku.findUniqueOrThrow({ where: { id: skuId } });
      await this.catalogService.addReviewedProductIngredients(sku.productId, catalogReview.ingredientIds ?? []);
      if (catalogReview.routineStepId) {
        await this.careService.addReviewedProductStep(sku.productId, catalogReview.routineStepId);
      }
    }

    const auditTrail: CandidateAuditEntry[] = Array.isArray(enrichment.auditTrail) ? enrichment.auditTrail : [];
    if (actorId) {
      auditTrail.push({
        action: 'PUBLISHED',
        actorId,
        timestamp: new Date().toISOString(),
        publishedSkuId: skuId,
      });
    }

    const updated = await this.prisma.ingestionItem.update({
      where: { id: itemId },
      data: {
        status: IngestionStatus.published,
        matchedSkuId: skuId,
        enrichment: {
          ...enrichment,
          auditTrail,
        } as unknown as import('@prisma/client').Prisma.InputJsonValue,
      },
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

  async publishJob(jobId: string, actorId?: string): Promise<IngestionJobDetail> {
    if (actorId) {
      const actor = await this.prisma.customer.findUnique({ where: { id: actorId } });
      if (!actor?.roles.includes('ADMIN')) {
        throw new ForbiddenException('Only Admin can publish catalog jobs');
      }
    }

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

    if (job.mode === IngestionImportMode.FULL_SNAPSHOT && !actorId) {
      // Immediate safety switch (M0 / GLO-246):
      // Unscoped mass-deactivation is blocked pending SG-05 verified assortment coverage & anomaly hold authorization.
      if (process.env.ALLOW_UNSCOPED_FULL_SNAPSHOT_DEACTIVATION !== 'true') {
        throw new BadRequestException(
          'FULL_SNAPSHOT mass-deactivation is guarded pending SG-05 assortment scope verification and anomaly hold authorization. Use PARTIAL_UPDATE or enable verified assortment coverage.',
        );
      }
    }

    const errors: string[] = [];
    const hasCandidateApproval = job.items.some((i) => i.status === IngestionStatus.approved);

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

    if (job.mode === IngestionImportMode.FULL_SNAPSHOT && !hasCandidateApproval) {
      const publishedSkuIds = job.items
        .map((i) => i.matchedSkuId)
        .filter((id): id is string => Boolean(id));

      await this.prisma.supplierOffer.updateMany({
        where: {
          supplierId: job.supplierId,
          skuId: { notIn: publishedSkuIds },
          isAvailable: true,
        },
        data: { isAvailable: false },
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

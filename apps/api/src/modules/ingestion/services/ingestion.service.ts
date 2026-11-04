import { Injectable, BadRequestException, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { CatalogService, BrandService } from '../../catalog/public';
import { SourcingService } from '../../sourcing/public';
import { ProductIdentityService, IdentityBatchContext, IdentityCandidate, MatchClassification, ProductIdentityMatchResult, candidateIdentityInput } from './product-identity.service';
import { ProductResearchService } from './product-research.service';
import { ProductContentService } from './product-content.service';
import { CreateIngestionJobDto, ApproveIngestionItemDto, UpdateCandidateDto, ApplyJobMappingDto } from '../dto/ingestion.dto';
import { CandidateIdentityMatch, CandidateReviewRecord, CorrectCandidateDto, CandidateAuditEntry } from '../contracts/candidate-review.contract';
import { IngestionItem, IngestionStatus, IngestionItemEnrichmentStatus, IngestionPriceType, IngestionImportMode, Prisma } from '@prisma/client';
import { AiClient, AiClientError, AiErrorKind } from '../../../platform/ai';
import { StorageService } from '../../../platform/storage/storage.service';
import { requireMediaReview, isTrustedMediaSource } from '../../../platform/security/media-review';
import { SpreadsheetParserService, ParsedSpreadsheet } from './spreadsheet-parser.service';
import { FormatFingerprintService } from './format-fingerprint.service';
import {
  ExportProfileService, ColumnMappingConfig, MappingSemantics, currencyFromPriceHeader, mappingApprovalProblems, STOCK_QUANTITY_BASES,
} from './export-profile.service';
import { RowNormalizationService } from './row-normalization.service';
import { OfferBatchCommitService } from './offer-batch-commit.service';
import { CareService } from '../../care/public';
import { NormalizedRowStatus } from '../contracts/row-normalization.contract';
import * as crypto from 'crypto';
import { canonicalProductSlug } from './canonical-product-slug';
import { RoutinePlacementService } from './routine-placement.service';
import { IngestionEligibilityService } from './ingestion-eligibility.service';
import { EligibilityDecision } from './ingestion-eligibility.policy';
import { RecheckEligibilityGroupDto } from '../dto/eligibility-policy.dto';
import { UsageRule } from '../contracts/routine-placement.contract';
import { RowAccounting, RowOutcomeSkipCollector, countOutcomeRows, rowAccounting } from '../contracts/row-outcomes.contract';

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

export interface MatchingSummary {
  exactMatches: number;
  needsReview: number;
  newCandidates: number;
  /** Rows of a product already pending as another (older) candidate: linked, not duplicated, no AI (GLO-278). */
  linkedToExistingCandidate: number;
  rejected: number;
  /** Background AI enrichment requests started (new candidates only). */
  aiEnrichmentRequests: number;
  /** New candidates beyond this file's enrichment budget: still reviewable, enriched on demand. */
  enrichmentDeferred: number;
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
  /** True when the file is held on a supplier-proposed mapping awaiting internal approval. */
  awaitingApproval?: boolean;
  /** Identity outcome of the admitted rows (GLO-276); absent when no rows were admitted. */
  matching?: MatchingSummary | { status: 'FAILED_RETRYABLE'; error: string } | { status: 'RUNNING' };
  /** Every parsed row in exactly one bucket, pinned to the policy version that decided it. */
  rowAccounting?: RowAccounting;
}

const MATCHING_BATCH_SIZE = 200;
const ITEM_INSERT_CHUNK = 1000;
const MAX_LISTED_JOBS = 200;
const MAX_ITEMS_PER_LISTED_JOB = 500;
/** Larger admissions match after the receipt returns; POST jobs/:id/match resumes them after a restart. */
const SYNC_MATCHING_MAX_ROWS = Number(process.env.INGESTION_SYNC_MATCH_MAX_ROWS ?? 5000);
/** Concurrent and per-file limits on background AI enrichment; further rows stay reviewable and enrich on demand. */
const ENRICHMENT_CONCURRENCY = Number(process.env.INGESTION_ENRICHMENT_CONCURRENCY ?? 4);
const ENRICHMENT_MAX_PER_JOB = Number(process.env.INGESTION_ENRICHMENT_MAX_PER_JOB ?? 200);
/** Consecutive provider failures that end this file's background enrichment; rows stay pending and retryable. */
const ENRICHMENT_OUTAGE_THRESHOLD = 5;
const MIN_IDENTITY_EVIDENCE = 5;

type MatchingUpdate = {
  id: string; expectedUpdatedAt: string; brand: string; matchedSkuId: string | null; status: IngestionStatus;
  enrichmentStatus: IngestionItemEnrichmentStatus | null; enrichmentError: string | null; enrichment: Record<string, unknown>;
};

@Injectable()
export class IngestionService {
  private readonly backgroundWork = new Set<Promise<unknown>>();

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
    private readonly routinePlacementService: RoutinePlacementService,
    private readonly eligibility: IngestionEligibilityService,
  ) {}

  private assertAdmittedItem(item: { brand: string; enrichment?: unknown }): EligibilityDecision {
    const source = (item.enrichment as { source?: { eligibility?: EligibilityDecision } } | null)?.source;
    const decision = source?.eligibility;
    if (decision?.outcome !== 'ALLOW' || !decision.policyId || !decision.version || !decision.brandId || !decision.categoryId || decision.brandName !== item.brand) {
      throw new ConflictException('ELIGIBILITY_HOLD: row requires approved Brand AND leaf Category policy admission');
    }
    return decision;
  }

  private classifyAdmittedItem(item: { brand: string; enrichment?: unknown }, input: Parameters<ProductIdentityService['classifyCandidateMatch']>[0], batch?: IdentityBatchContext) {
    const decision = this.assertAdmittedItem(item);
    if (input.brand !== decision.brandName) throw new ConflictException('Brand correction requires policy re-admission');
    // A malformed cell stays on the row until a correction replaces it (an explicit null).
    const invalidBarcode = input.invalidBarcode !== undefined ? input.invalidBarcode :
      (item.enrichment as { source?: { normalized?: { invalidBarcode?: string } } } | null)?.source?.normalized?.invalidBarcode;
    return this.productIdentityService.classifyCandidateMatch({ ...input, invalidBarcode, eligibilityApproved: true, brandId: decision.brandId }, batch);
  }

  /** Explicit Admin retry creates a PARTIAL successor; the original pinned audit and admitted rows never change. */
  async recheckEligibilityHolds(jobId: string, actorId: string, reason: string, expectedPolicyId?: string) {
    await this.eligibility.assertAdmin(actorId);
    if (reason.trim().length < 5) throw new BadRequestException('Meaningful review reason required');
    const original = await this.prisma.ingestionJob.findUniqueOrThrow({ where: { id: jobId }, include: { exportProfile: true } });
    let sourceJob = original;
    const ancestry = new Set([original.id]);
    while (!sourceJob.sourceKey) {
      const metadata = (sourceJob.sourceMetadata ?? {}) as { eligibilitySourceJobId?: string; eligibilityRetryOf?: string };
      const parentId = metadata.eligibilitySourceJobId ?? metadata.eligibilityRetryOf;
      if (!parentId || parentId === sourceJob.id) break;
      if (!this.isUuid(parentId) || ancestry.has(parentId)) throw new ConflictException('Invalid retained source ancestry');
      ancestry.add(parentId);
      const parent = await this.prisma.ingestionJob.findFirst({ where: { id: parentId, supplierId: original.supplierId }, include: { exportProfile: true } });
      if (!parent) throw new ConflictException('Retained supplier source is unavailable');
      sourceJob = parent;
    }
    if (sourceJob.sourceKey && !sourceJob.exportProfile?.isApproved) throw new ConflictException('Approve the original column mapping before rechecking');
    const policy = await this.eligibility.current();
    if (!policy) throw new ConflictException('Approve a policy before rechecking holds');
    if (expectedPolicyId && policy.id !== expectedPolicyId) throw new ConflictException('Policy changed during bulk recheck; reload before continuing');
    const holds = ((original.rowOutcomes ?? []) as Array<{ sourceRow: number; outcome: string; rawRow: Record<string, unknown> }>)
      .filter(r => r.outcome === 'POLICY_HOLD');
    if (!holds.length) throw new ConflictException('No held rows to recheck');
    const successor = await this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`eligibility-recheck:${jobId}:${policy.id}`}))`;
      const existing = await tx.ingestionJob.findFirst({ where: { supplierId: original.supplierId,
        eligibilityPolicyId: policy.id, sourceMetadata: { path: ['eligibilityRetryOf'], equals: jobId } } });
      if (existing) return existing;
      const created = await tx.ingestionJob.create({ data: { supplierId: original.supplierId,
        mode: IngestionImportMode.PARTIAL_UPDATE, eligibilityPolicyId: policy.id,
        sourceMetadata: { ...((original.sourceMetadata ?? {}) as Prisma.InputJsonObject),
          eligibilityRetryOf: jobId, eligibilitySourceJobId: sourceJob.id, actorId, reason, originalChecksum: sourceJob.sourceChecksum,
          receivedAt: ((original.sourceMetadata ?? {}) as { receivedAt?: string }).receivedAt ?? original.createdAt.toISOString() } } });
      let items: Prisma.IngestionItemCreateManyInput[];
      let rowOutcomes: Array<Record<string, unknown>>;
      if (sourceJob.exportProfile?.isApproved && sourceJob.sourceKey && sourceJob.sourceChecksum) {
        const parsed = this.spreadsheetParser.parseSpreadsheet(await this.readVerifiedOriginal(sourceJob.sourceKey, sourceJob.sourceChecksum), sourceJob.sourceKey);
        const rowNumbers = new Set(holds.map(r => r.sourceRow));
        const extracted = await this.extractItemsFromParsedSpreadsheet({ id: created.id, supplierId: original.supplierId,
          eligibilityPolicyId: policy.id, sourceKey: sourceJob.sourceKey, sourceChecksum: sourceJob.sourceChecksum },
          { ...parsed, rows: parsed.rows.filter(r => rowNumbers.has(r.sourceRow)) }, sourceJob.exportProfile.mapping as unknown as ColumnMappingConfig);
        items = extracted.items;
        rowOutcomes = extracted.rowOutcomes;
      } else {
        const evaluator = await this.eligibility.compile(policy.id, tx);
        items = [];
        rowOutcomes = [];
        for (const hold of holds) {
          const input = hold.rawRow as unknown as CreateIngestionJobDto['items'][number];
          const eligibility = evaluator.evaluate(original.supplierId, input.brand ?? '', input.category ?? '');
          rowOutcomes.push({ ...hold, outcome: eligibility.outcome === 'ALLOW' ? 'IMPORTED_MANUAL' : `POLICY_${eligibility.outcome}`,
            eligibility, reason: eligibility.reason });
          if (eligibility.outcome === 'ALLOW') items.push({ jobId: created.id, name: input.name, brand: eligibility.brandName!,
            supplierSkuCode: input.supplierSkuCode, price: input.price, priceType: input.priceType ?? null,
            currency: input.currency, barcode: input.barcode, reportedQuantity: input.reportedQuantity ?? null,
            enrichment: { source: { eligibility, input, categoryInput: input.category ?? '', row: hold.sourceRow } } as unknown as Prisma.InputJsonValue });
        }
      }
      if (items.length) await tx.ingestionItem.createMany({ data: items });
      return tx.ingestionJob.update({ where: { id: created.id }, data: { rowOutcomes: rowOutcomes as Prisma.InputJsonValue } });
    }, { timeout: 60000 });
    const outcomes = (successor.rowOutcomes ?? []) as Array<{ outcome?: string }>;
    return { jobId: successor.id, matching: await this.matchAdmittedRows(successor.id), counts: {
      ALLOW: countOutcomeRows(outcomes, 'IMPORTED', 'IMPORTED_MANUAL'),
      SKIP: countOutcomeRows(outcomes, 'POLICY_SKIP'),
      HOLD: countOutcomeRows(outcomes, 'POLICY_HOLD'),
    } };
  }

  async recheckEligibilityGroup(dto: RecheckEligibilityGroupDto, actorId: string) {
    await this.eligibility.assertAdmin(actorId);
    const policy = await this.eligibility.current();
    if (!policy || policy.version !== dto.expectedVersion) throw new ConflictException('Policy changed; reload before bulk recheck');
    const jobs = await this.eligibility.heldGroupJobs(dto.supplierId, dto.brand, dto.category, policy.id);
    const results = [];
    for (const job of jobs.slice(0, 20)) results.push(await this.recheckEligibilityHolds(job.jobId, actorId, dto.reason, policy.id));
    return { policyVersion: policy.version, recheckedJobs: results.length, hasMore: jobs.length > 20, results };
  }

  private isUuid(val: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
  }

  // Serialize review/edit/publish commands across API instances; partial domain writes remain retryable.
  private async withCandidateLock<T>(itemId: string, operation: () => Promise<T>, identityKeys: string[] = []): Promise<T> {
    if (!this.isUuid(itemId)) throw new BadRequestException('Invalid candidate item ID');
    // Locks are always taken in sorted order so two publishers holding overlapping keys cannot deadlock.
    const keys = [...new Set([`candidate:${itemId}`, ...identityKeys])].sort();
    return this.prisma.$transaction(async tx => {
      for (const key of keys) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
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

  /** Strips path components and control characters so a client filename is safe to store and display. */
  private sanitizeSourceFileName(name: string): string {
    const base = String(name ?? '').split(/[\\/]/).pop() ?? '';
    const safe = Array.from(base, ch => (ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f || '<>:"|?*'.includes(ch) ? '_' : ch));
    return safe.join('').trim().slice(0, 255) || 'source';
  }

  private sha256(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  /** Reads a retained supplier original and refuses to use it if its bytes no longer match the receipt checksum. */
  private async readVerifiedOriginal(sourceKey: string, checksum: string): Promise<Buffer> {
    const buffer = await this.storageService.getFileBuffer(sourceKey);
    if (this.sha256(buffer) !== checksum) {
      throw new ConflictException('Retained supplier original failed integrity verification; contact an administrator');
    }
    return buffer;
  }

  async uploadSupplierSpreadsheet(
    supplierId: string,
    file: Express.Multer.File,
    mode: IngestionImportMode = IngestionImportMode.PARTIAL_UPDATE,
    intake: { uploadedBy?: string; documentKind?: string; uniqueRetry?: boolean } = {},
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

    const checksum = this.sha256(file.buffer);
    const receipt = {
      eligibilityPolicyId: (await this.eligibility.current())?.id ?? null,
      uploadedBy: intake.uploadedBy ?? null,
      sourceFileName: this.sanitizeSourceFileName(file.originalname),
      sourceMimeType: file.mimetype,
      sourceSizeBytes: file.buffer.length,
      sourceMetadata: {
        receivedAt: new Date().toISOString(),
        declaredDocumentKind: intake.documentKind ?? null,
        workbookCreatedAt: parsed?.workbookProps?.createdAt ?? null,
        workbookModifiedAt: parsed?.workbookProps?.modifiedAt ?? null,
        sheetNames: parsed?.sheets ?? [],
      } as Prisma.InputJsonValue,
    };
    try {
      const result: IngestionUploadResult = await this.prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`source:${supplierId}:${checksum}`}))`;
        const existing = await tx.ingestionJob.findFirst({
          where: { supplierId, sourceChecksum: checksum },
          orderBy: { createdAt: 'asc' },
          include: { _count: { select: { items: true } } },
        });

        if (existing?.sourceKey) {
          if (!(await this.storageService.exists(existing.sourceKey))) {
            await this.storageService.restorePrivateFile(existing.sourceKey, file, supplierId);
          } else {
            // Never overwrite a retained original; a mismatch is surfaced for investigation instead.
            await this.readVerifiedOriginal(existing.sourceKey, checksum);
          }
          // Only a job that still holds no rows is waiting for a mapping; one already mapped is just a repeat.
          const requiresMapping = existing.status === IngestionStatus.review_required && existing._count.items === 0 &&
            !(Array.isArray(existing.rowOutcomes) && existing.rowOutcomes.length);
          const proposal = requiresMapping && parsed ? this.exportProfileService.proposeMapping(parsed.headers) : null;
          return {
            jobId: existing.id,
            sourceKey: existing.sourceKey,
            formatFingerprint: existing.formatFingerprint ?? undefined,
            profileId: existing.profileId ?? undefined,
            status: existing.status,
            requiresMapping,
            reused: true,
            totalRows: proposal ? parsed!.totalDataRows : existing._count.items,
            importedItemsCount: existing._count.items,
            // A retried upload must reopen the same mapping form, not a blank one.
            ...(proposal && { sampleHeaders: parsed!.headers, sampleRows: parsed!.sampleRows, proposedMapping: proposal.mapping,
              confidence: proposal.confidence, unmappedHeaders: proposal.unmappedHeaders, isComplete: proposal.isComplete }),
          };
        }

        const fileUrl = await this.storageService.uploadFile(file, true, 'ingestion', supplierId);
        const sourceKey = new URL(fileUrl).pathname.slice('/storage/'.length);

        try {
          if (!isSpreadsheet || !parsed || !formatFingerprint) {
            const job = await tx.ingestionJob.create({
              data: { supplierId, status: IngestionStatus.pending, mode, sourceKey, sourceChecksum: checksum, ...receipt },
            });
            return { jobId: job.id, sourceKey, status: job.status, requiresMapping: false };
          }

          const approvedProfile = await this.exportProfileService.findApprovedProfile(
            supplierId, formatFingerprint, tx, intake.documentKind);

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
                ...receipt,
              },
            });

            const { items: itemsData, rowOutcomes, accounting } = await this.extractItemsFromParsedSpreadsheet(
              { id: job.id, supplierId, eligibilityPolicyId: job.eligibilityPolicyId, sourceKey, sourceChecksum: checksum, formatFingerprint },
              parsed,
              approvedProfile.mapping as any,
            );

            await this.insertItems(tx, itemsData);
            const admittedStatus = rowOutcomes.some(r => r.outcome === 'POLICY_HOLD') ? IngestionStatus.review_required : IngestionStatus.pending;
            await tx.ingestionJob.update({ where: { id: job.id }, data: { rowOutcomes: rowOutcomes as Prisma.InputJsonValue, status: admittedStatus,
              sourceMetadata: { ...(receipt.sourceMetadata as Prisma.JsonObject), rowAccounting: accounting } as unknown as Prisma.InputJsonValue } });

            return {
              jobId: job.id,
              sourceKey,
              formatFingerprint,
              profileId: approvedProfile.id,
              status: admittedStatus,
              requiresMapping: false,
              totalRows: parsed.totalDataRows,
              importedItemsCount: itemsData.length,
              rowAccounting: accounting,
            };
          } else {
            // New/unapproved layout -> Requires mapping review & approval
            const proposal = this.exportProfileService.proposeMapping(parsed.headers);
            // A same-layout proposal already awaiting review: hold this file on it so one approval admits both.
            const openProposal = await tx.exportProfile.findFirst({
              where: { supplierId, formatFingerprint, isApproved: false },
              orderBy: { version: 'desc' },
            });

            const job = await tx.ingestionJob.create({
              data: {
                supplierId,
                status: IngestionStatus.review_required,
                mode,
                sourceKey,
                sourceChecksum: checksum,
                formatFingerprint,
                profileId: openProposal?.id ?? null,
                ...receipt,
              },
            });

            return {
              jobId: job.id,
              sourceKey,
              formatFingerprint,
              profileId: openProposal?.id,
              status: IngestionStatus.review_required,
              requiresMapping: true,
              awaitingApproval: Boolean(openProposal),
              sampleHeaders: parsed.headers,
              sampleRows: parsed.sampleRows,
              totalRows: parsed.totalDataRows,
              proposedMapping: openProposal ? (openProposal.mapping as Partial<ColumnMappingConfig>) : proposal.mapping,
              confidence: proposal.confidence,
              unmappedHeaders: proposal.unmappedHeaders,
              isComplete: proposal.isComplete,
            };
          }
        } catch (error) {
          await this.storageService.deleteFile(fileUrl);
          throw error;
        }
        }, { timeout: this.importTimeoutMs(parsed?.totalDataRows ?? 0) });
      // Admitted rows go straight to identity matching (GLO-276); idempotent, so a retried upload resumes it.
      if (result.importedItemsCount) result.matching = await this.startMatching(result.jobId, result.importedItemsCount);
      return result;
    } catch (error) {
      // The (supplier_id, source_checksum) unique index is the backstop if the advisory lock is ever bypassed:
      // the losing request resolves to the winner's receipt instead of a second job.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && !intake.uniqueRetry) {
        return this.uploadSupplierSpreadsheet(supplierId, file, mode, { ...intake, uniqueRetry: true });
      }
      throw error;
    }
  }

  /**
   * GLO-279: official evidence acceptable for product facts — SUPPORTED, from the manufacturer, either an https source
   * (webpage/document) or a human-reviewed authentic label photo, and recorded for THIS candidate's identity (an entry
   * captured for a different barcode/name, e.g. another market or formulation, is ignored).
   */
  private acceptedOfficialEvidence(enrichment: Record<string, any>, item: { barcode: string | null; name: string }): any[] {
    return (enrichment.research?.fieldEvidences ?? []).filter((entry: any) =>
      entry.verificationStatus === 'SUPPORTED' && entry.sourceType === 'OFFICIAL_MANUFACTURER' &&
      (entry.evidenceKind === 'PRODUCT_LABEL' ? Boolean(entry.reviewedBy) : /^https:\/\//i.test(entry.sourceUrl ?? '')) &&
      (!entry.identity || (entry.identity.barcode === item.barcode && entry.identity.name === item.name)));
  }

  private async isInternalReviewer(actorId: string): Promise<boolean> {
    if (!this.isUuid(actorId)) return false;
    const actor = await this.prisma.customer.findUnique({ where: { id: actorId } });
    return Boolean(actor?.isActive && actor.roles.some(role => role === 'ADMIN' || role === 'HUB_OPERATOR'));
  }

  /**
   * GLO-274: a supplier may only PROPOSE how its columns map (cost vs retail, stock vs invoice quantity);
   * an internal reviewer must approve before any row is admitted. Internal reviewers map and approve in one step.
   */
  async applyJobMapping(
    jobId: string,
    supplierId: string,
    dto: ApplyJobMappingDto,
    actorId: string,
  ): Promise<{ jobId: string; status: IngestionStatus; profileId: string; importedItemsCount: number; awaitingApproval: boolean;
    matching?: IngestionUploadResult['matching'] }> {
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

    const buffer = await this.readVerifiedOriginal(job.sourceKey, job.sourceChecksum);
    const parsed = this.spreadsheetParser.parseSpreadsheet(buffer, job.sourceKey);
    const fingerprint = job.formatFingerprint || this.formatFingerprintService.computeFingerprint(parsed.headers, parsed.sheets);
    const reviewer = await this.isInternalReviewer(actorId);

    const profile = await this.exportProfileService.saveProfile({
      supplierId,
      formatFingerprint: fingerprint,
      mapping: reviewer ? dto.mapping : { ...dto.mapping, proposal: { proposedBy: actorId, proposedAt: new Date().toISOString() } },
      name: dto.profileName,
      sampleHeaders: parsed.headers,
      isApproved: reviewer,
      approvedBy: reviewer ? actorId : undefined,
    });

    if (!reviewer) {
      // Pin the job to the proposal; approval of exactly this profile admits its rows.
      await this.prisma.ingestionJob.update({
        where: { id: job.id },
        data: { profileId: profile.id, formatFingerprint: fingerprint, status: IngestionStatus.review_required },
      });
      return { jobId: job.id, status: IngestionStatus.review_required, profileId: profile.id, importedItemsCount: 0, awaitingApproval: true };
    }

    const importedItemsCount = await this.importJobWithProfile(job.id, profile, parsed);
    const matching = await this.matchAdmittedRows(job.id);
    return { jobId: job.id, status: IngestionStatus.pending, profileId: profile.id, importedItemsCount, awaitingApproval: false, matching };
  }

  /** Extracts a held job's rows with one approved profile version, at most once. */
  private async importJobWithProfile(
    jobId: string,
    profile: { id: string; isApproved: boolean; mapping: Prisma.JsonValue },
    parsedSource?: ParsedSpreadsheet,
  ): Promise<number> {
    const mapping = profile.mapping as unknown as ColumnMappingConfig;
    if (!profile.isApproved || mappingApprovalProblems(mapping).length) {
      throw new ConflictException('Rows can only be admitted with an approved mapping');
    }
    const job = await this.prisma.ingestionJob.findUniqueOrThrow({ where: { id: jobId }, include: { supplier: true } });
    if (!job.sourceKey || !job.sourceChecksum) throw new BadRequestException('Job has no associated source file');
    const parsed = parsedSource ?? this.spreadsheetParser.parseSpreadsheet(
      await this.readVerifiedOriginal(job.sourceKey, job.sourceChecksum), job.sourceKey);
    const fingerprint = job.formatFingerprint || this.formatFingerprintService.computeFingerprint(parsed.headers, parsed.sheets);
    const { items: itemsData, rowOutcomes, accounting } = await this.extractItemsFromParsedSpreadsheet(
      { id: job.id, supplierId: job.supplierId, eligibilityPolicyId: job.eligibilityPolicyId, sourceKey: job.sourceKey, sourceChecksum: job.sourceChecksum, formatFingerprint: fingerprint },
      parsed,
      mapping,
    );

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mapping:job:${job.id}`}))`;
      const current = await tx.ingestionJob.findUniqueOrThrow({ where: { id: job.id }, include: { items: true } });
      if (current.items.length > 0 || (current.status !== IngestionStatus.pending && current.status !== IngestionStatus.review_required)) {
        throw new ConflictException('Mapped or committed source jobs cannot be remapped');
      }

      await this.insertItems(tx, itemsData);

      await tx.ingestionJob.update({
        where: { id: job.id },
        data: {
          profileId: profile.id,
          formatFingerprint: fingerprint,
          status: IngestionStatus.pending,
          rowOutcomes: rowOutcomes as Prisma.InputJsonValue,
          sourceMetadata: { ...((current.sourceMetadata ?? {}) as Prisma.JsonObject), rowAccounting: accounting } as unknown as Prisma.InputJsonValue,
        },
      });
      return itemsData.length;
    }, { timeout: this.importTimeoutMs(parsed.totalDataRows) });
  }

  private importTimeoutMs(rows: number): number {
    return Math.max(25000, rows * 4);
  }

  private async insertItems(tx: Prisma.TransactionClient, items: Prisma.IngestionItemCreateManyInput[]): Promise<void> {
    for (let offset = 0; offset < items.length; offset += ITEM_INSERT_CHUNK) {
      await tx.ingestionItem.createMany({ data: items.slice(offset, offset + ITEM_INSERT_CHUNK) });
    }
  }

  async getProfiles(supplierId?: string) {
    return this.exportProfileService.listProfiles(supplierId);
  }

  async getProfile(profileId: string, supplierId?: string) {
    return this.exportProfileService.getProfile(profileId, supplierId);
  }

  /** Internal approval of a proposed mapping; admits the rows of every job held on exactly this profile. */
  async approveProfile(supplierId: string, profileId: string, approvedBy: string, semantics?: MappingSemantics) {
    if (!(await this.isInternalReviewer(approvedBy))) {
      throw new ForbiddenException('Only an internal reviewer can approve supplier mapping semantics');
    }
    const profile = await this.exportProfileService.approveProfile(supplierId, profileId, approvedBy, semantics);
    const heldJobs = await this.prisma.ingestionJob.findMany({
      where: { supplierId, profileId: profile.id, status: IngestionStatus.review_required, items: { none: {} } },
      select: { id: true },
    });
    const importedJobs: Array<{ jobId: string; importedItemsCount: number; matching: IngestionUploadResult['matching'] }> = [];
    for (const held of heldJobs) {
      const importedItemsCount = await this.importJobWithProfile(held.id, profile);
      importedJobs.push({ jobId: held.id, importedItemsCount, matching: await this.matchAdmittedRows(held.id) });
    }
    return { ...profile, importedJobs };
  }

  private async extractItemsFromParsedSpreadsheet(
    job: { id: string; supplierId: string; eligibilityPolicyId: string | null; sourceKey: string; sourceChecksum: string; formatFingerprint?: string | null },
    parsed: ParsedSpreadsheet,
    mapping: ColumnMappingConfig,
  ) {
    const policy = await this.eligibility.compile(job.eligibilityPolicyId);
    const items: any[] = [];
    const rowOutcomes: Array<Record<string, unknown>> = [];
    const skips = new RowOutcomeSkipCollector();
    const seenSkus = new Set<string>();
    const itemIndexBySku = new Map<string, number>();
    // Only an approved stock basis turns the quantity column into availability; invoice/unknown quantities are not stock.
    const quantityColumn = mapping.quantity && STOCK_QUANTITY_BASES.includes(mapping.semantics?.quantityBasis ?? '')
      ? mapping.quantity : undefined;
    const discountBasis = mapping.semantics?.discountBasis;

    for (const row of parsed.rows) {
      const rawSku = row.data[mapping.supplierSku];
      const rawName = row.data[mapping.name];
      let statedBrand = mapping.brand ? String(row.data[mapping.brand] ?? '').trim() : '';
      const rawPrice = row.data[mapping.price];

      const categoryInput = mapping.category ? String(row.data[mapping.category] ?? '') : '';
      const eligibility = policy.evaluate(job.supplierId, statedBrand, categoryInput);
      // The retained original and pinned policy reproduce these rows, so neither outcome stores the raw row.
      if (eligibility.outcome === 'SKIP') {
        skips.add(eligibility.reason, row.sourceRow, statedBrand);
        continue;
      }
      if (eligibility.outcome === 'HOLD') {
        rowOutcomes.push({ sourceRow: row.sourceRow, outcome: 'POLICY_HOLD', reason: eligibility.reason,
          supplierSku: String(rawSku ?? ''), brand: statedBrand, category: categoryInput, name: String(rawName ?? '') });
        continue;
      }
      statedBrand = eligibility.brandName!;
      const norm = this.rowNormalizationService.normalizeRow({
        eligibilityApproved: true,
        sourceRowNumber: row.sourceRow,
        supplierSku: rawSku,
        name: rawName,
        // The supplier is not the product brand; an unmapped brand stays unknown and is inferred during matching.
        brand: mapping.brand ? row.data[mapping.brand] : undefined,
        barcode: mapping.barcode ? row.data[mapping.barcode] : undefined,
        price: rawPrice,
        priceType: mapping.priceType ? String(row.data[mapping.priceType] ?? '') : undefined,
        retailPrice: mapping.retailPrice ? row.data[mapping.retailPrice] : undefined,
        quantity: quantityColumn ? row.data[quantityColumn] : undefined,
        hasQuantityColumn: Boolean(quantityColumn),
        discount: mapping.discount ? row.data[mapping.discount] : undefined,
        discountBasis,
        currency: mapping.currency || (mapping.currencyColumn ? row.data[mapping.currencyColumn] : undefined) ||
          currencyFromPriceHeader(mapping.price) || undefined,
        currencyFromRow: !mapping.currency && Boolean(mapping.currencyColumn),
        units: mapping.units ? row.data[mapping.units] : undefined,
        sourceTimestamp: mapping.sourceTimestamp ? row.data[mapping.sourceTimestamp] : undefined,
        extraAttributes: row.data,
      });

      if (norm.status === NormalizedRowStatus.INVALID) {
        rowOutcomes.push({ sourceRow: row.sourceRow, outcome: 'INVALID', reason: norm.statusReason,
          supplierSku: String(rawSku ?? ''), rawRow: row.data });
        continue;
      }

      if (seenSkus.has(norm.normalizedSku)) {
        // GLO-277: the same supplier code twice with different cost/stock/barcode is a reconciliation question —
        // never let "first row wins" decide the offer. Hold the admitted row for review with both readings.
        const earlier = items[itemIndexBySku.get(norm.normalizedSku) ?? -1];
        const conflicting = earlier && (earlier.price !== norm.pricing.purchaseCost ||
          earlier.reportedQuantity !== norm.inventory.reportedQuantity || earlier.barcode !== norm.normalizedBarcode);
        if (conflicting) {
          earlier.status = IngestionStatus.review_required;
          earlier.enrichment.source.duplicateConflicts = [...(earlier.enrichment.source.duplicateConflicts ?? []),
            { sourceRow: row.sourceRow, price: norm.pricing.purchaseCost, reportedQuantity: norm.inventory.reportedQuantity,
              barcode: norm.normalizedBarcode }];
        }
        rowOutcomes.push({ sourceRow: row.sourceRow, outcome: 'DUPLICATE',
          reason: conflicting ? 'duplicate_supplier_sku_with_conflicting_values' : 'duplicate_supplier_sku_in_source',
          supplierSku: norm.normalizedSku, rawRow: row.data });
        continue;
      }
      seenSkus.add(norm.normalizedSku);
      // GLO-275: a confidently excluded product type is skipped with its reason and never becomes a candidate.
      if (norm.status === NormalizedRowStatus.OUT_OF_SCOPE) {
        rowOutcomes.push({ sourceRow: row.sourceRow, outcome: 'OUT_OF_SCOPE', reason: norm.statusReason,
          supplierSku: norm.normalizedSku, rawRow: row.data });
        continue;
      }
      // The admitted item keeps the raw row in its own source provenance.
      rowOutcomes.push({ sourceRow: row.sourceRow, outcome: 'IMPORTED', status: norm.status, reason: norm.statusReason,
        supplierSku: norm.normalizedSku });

      // A row held only because its category was not recognised still goes to matching: an exact catalog match proves
      // scope. Field doubts (quantity/price/discount) always stay with a human and never reach the fast lane.
      const itemStatus: IngestionStatus = norm.status === NormalizedRowStatus.REVIEW && norm.holds?.fields !== false
        ? IngestionStatus.review_required : IngestionStatus.pending;

      itemIndexBySku.set(norm.normalizedSku, items.length);
      items.push({
        jobId: job.id,
        supplierSkuCode: norm.normalizedSku,
        name: rawName ? String(rawName).trim() : norm.normalizedTitle,
        brand: statedBrand,
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
            eligibility,
            categoryInput,
            normalized: norm,
            // Stored at admission so a concurrent importer's sweep can already see this row (GLO-278).
            fingerprint: this.productIdentityService.rowFingerprint({
              brand: statedBrand, name: rawName ? String(rawName).trim() : norm.normalizedTitle,
              size: norm.extractedSize ?? null, sizeUnit: norm.extractedUnit ?? null, packageCount: norm.extractedPackCount ?? null,
            }),
            input: {
              supplierSkuCode: norm.normalizedSku,
              name: rawName ? String(rawName).trim() : norm.normalizedTitle,
              brand: statedBrand,
              barcode: norm.normalizedBarcode,
              price: norm.pricing.purchaseCost!,
              priceType: IngestionPriceType.PURCHASE_COST,
              reportedQuantity: norm.inventory.reportedQuantity,
              currency: norm.pricing.currency,
              sourceRow: row.sourceRow,
              sourceObservedAt: norm.sourceObservedAt ?? null,
            },
          },
        },
      });
    }

    const allOutcomes = [...skips.toEntries() as unknown as Array<Record<string, unknown>>, ...rowOutcomes];
    const pinned = await this.eligibility.pinnedVersion(job.eligibilityPolicyId);
    return { items, rowOutcomes: allOutcomes, accounting: rowAccounting(allOutcomes, parsed.rows.length, { policyId: job.eligibilityPolicyId, policyVersion: pinned }) };
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
    const inputHash = crypto.createHash('sha256').update(JSON.stringify(dto.items)).digest('hex');
    const job = await this.prisma.$transaction(async tx => {
      const sourceId = dto.sourceJobId;
      if (sourceId) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`import:${sourceId}`}))`;
      const source = sourceId ? await tx.ingestionJob.findFirst({ where: { id: sourceId, supplierId: dto.supplierId }, include: { items: true } }) : null;
      if (sourceId && (!source?.sourceKey || !source.sourceChecksum)) throw new NotFoundException('Supplier source job not found');
      const meta = (source?.sourceMetadata ?? {}) as Record<string, Prisma.JsonValue>;
      if (source && meta.manualInputHash) {
        if (meta.manualInputHash !== inputHash) throw new ConflictException('Source rows already imported with different input');
        return source;
      }
      if (source && (source.items.length || ![IngestionStatus.pending, IngestionStatus.review_required].includes(source.status as 'pending' | 'review_required')))
        throw new ConflictException('Source job is no longer open for row admission');
      if (source?.sourceKey && !(await this.storageService.exists(source.sourceKey))) throw new NotFoundException('Supplier source object missing');
      const policyId = source ? source.eligibilityPolicyId : (await this.eligibility.current(tx))?.id ?? null;
      const policy = await this.eligibility.compile(policyId, tx);
      const admitted: Prisma.IngestionItemCreateWithoutJobInput[] = [];
      const outcomes: Array<Record<string, unknown>> = [];
      for (const [index, input] of dto.items.entries()) {
        const eligibility = policy.evaluate(dto.supplierId, input.brand, input.category ?? '');
        const sourceRow = input.sourceRow ?? index + 1;
        outcomes.push({ sourceRow, supplierSku: input.supplierSkuCode,
          outcome: eligibility.outcome === 'ALLOW' ? 'IMPORTED_MANUAL' : `POLICY_${eligibility.outcome}`,
          reason: eligibility.reason, brand: input.brand, category: input.category ?? '', name: input.name, eligibility, rawRow: input });
        if (eligibility.outcome !== 'ALLOW') continue;
        // A malformed code is kept as evidence, not as a barcode: the raw row and the identity hold both retain it.
        const stated = this.rowNormalizationService.normalizeBarcode(input.barcode);
        const invalidBarcode = input.barcode && !stated.isValid ? String(input.barcode) : undefined;
        admitted.push({ supplierSkuCode: input.supplierSkuCode, name: input.name, brand: eligibility.brandName!,
          barcode: invalidBarcode ? null : stated.barcode, price: input.price, priceType: input.priceType ?? null,
          reportedQuantity: input.reportedQuantity ?? null, currency: input.currency,
          enrichment: { source: { objectKey: source?.sourceKey ?? null, checksum: source?.sourceChecksum ?? null,
            row: sourceRow, eligibility: eligibility as unknown as Prisma.InputJsonObject, ...(invalidBarcode && { normalized: { invalidBarcode } }),
            categoryInput: input.category ?? '', input: { ...input, barcode: input.barcode ?? null } } } as unknown as Prisma.InputJsonValue });
      }
      const rowOutcomes = outcomes as unknown as Prisma.InputJsonValue;
      const status = outcomes.some(r => r.outcome === 'POLICY_HOLD') ? IngestionStatus.review_required : IngestionStatus.pending;
      if (source) return tx.ingestionJob.update({ where: { id: source.id }, data: {
        items: { create: admitted }, rowOutcomes, status, sourceMetadata: { ...meta, manualInputHash: inputHash } as Prisma.InputJsonValue,
      }, include: { items: true } });
      return tx.ingestionJob.create({ data: { supplierId: dto.supplierId, eligibilityPolicyId: policyId, status,
        mode: dto.mode ?? IngestionImportMode.PARTIAL_UPDATE, rowOutcomes,
        items: { create: admitted }, sourceMetadata: { manualInputHash: inputHash } }, include: { items: true } });
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
    // A list never hydrates per-file outcome reports; a 50,000-row file's detail stays on its own endpoint.
    const jobs = await this.prisma.ingestionJob.findMany({
      where: supplierId ? { supplierId } : {},
      orderBy: { createdAt: 'desc' },
      take: MAX_LISTED_JOBS,
      select: { id: true, supplierId: true, status: true, mode: true, sourceKey: true, sourceChecksum: true, uploadedBy: true,
        sourceFileName: true, sourceMimeType: true, sourceSizeBytes: true, sourceMetadata: true, formatFingerprint: true,
        profileId: true, eligibilityPolicyId: true, createdAt: true, updatedAt: true, items: { take: MAX_ITEMS_PER_LISTED_JOB } },
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
      // The review queue holds decisions. A verified link needs none, so it stays out of it and in the unfiltered list.
      where: status === IngestionStatus.review_required ? { status, NOT: { AND: [{ matchedSkuId: { not: null } },
        { enrichment: { path: ['identity', 'route'], equals: 'VERIFIED' } }] } } : status ? { status } : {},
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
    this.assertAdmittedItem(item);

    const matchAnalysis = await this.classifyAdmittedItem(item, {
      candidateItemId: item.id, candidateCreatedAt: item.createdAt,
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

    const brandMatch = await this.brandService.getBrand(this.assertAdmittedItem(item).brandId!) ||
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
            sourceFileName: true,
            mode: true,
            status: true,
            createdAt: true,
          },
        },
        contentDraft: true,
      },
    });

    if (!item) throw new NotFoundException('Candidate item not found');
    this.assertAdmittedItem(item);

    const enrichment = (item.enrichment as Record<string, any>) || {};
    const auditTrail: CandidateAuditEntry[] = Array.isArray(enrichment.auditTrail) ? enrichment.auditTrail : [];

    // Recompute match analysis and fingerprint
    const matchAnalysis = await this.classifyAdmittedItem(item, {
      candidateItemId: item.id, candidateCreatedAt: item.createdAt,
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
    const brandMatch = await this.brandService.getBrand(this.assertAdmittedItem(item).brandId!) ||
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
      identityMatch: await this.storedIdentityMatch(item, enrichment),
      originalSupplierRow: {
        jobId: item.jobId,
        supplierId: item.job.supplierId,
        supplierName: (await this.prisma.supplier.findUnique({ where: { id: item.job.supplierId }, select: { name: true } }))?.name ?? null,
        supplierSkuCode: item.supplierSkuCode,
        statedName: enrichment.source?.input?.name ?? item.name,
        barcode: item.barcode,
        invalidBarcode: enrichment.source?.normalized?.invalidBarcode ?? null,
        sourceFile: {
          jobId: item.job.id,
          fileName: item.job.sourceFileName ?? null,
          mode: item.job.mode,
          createdAt: item.job.createdAt,
          row: enrichment.source?.row ?? null,
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
    this.assertAdmittedItem(item);
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

    const matchAnalysis = await this.classifyAdmittedItem(item, {
      candidateItemId: item.id, candidateCreatedAt: item.createdAt,
      supplierId: item.job.supplierId,
      supplierSkuCode: item.supplierSkuCode,
      name: newName,
      brand: newBrand,
      barcode: newBarcode,
      ...(dto.barcode !== undefined && { invalidBarcode: null }),
    });

    let matchedSkuId: string | null = null;
    if (matchAnalysis.classification === MatchClassification.EXACT_MATCH && matchAnalysis.matchedSkuId) {
      matchedSkuId = matchAnalysis.matchedSkuId;
    }

    const updatedEnrichment = {
      ...this.withoutReplacedBarcode(currentEnrichment, dto.barcode),
      // A corrected row is reviewed against its new wording, not the candidates of the old one.
      identity: this.identityEvidence(matchAnalysis, Boolean(currentEnrichment.identity?.brandInferred)),
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
    this.assertAdmittedItem(item);
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
    this.assertAdmittedItem(item);
    if (item.job.status === IngestionStatus.published || item.status === IngestionStatus.published) {
      throw new BadRequestException('Cannot modify items of a published job or candidate');
    }

    const newSupplierSkuCode = dto.supplierSkuCode !== undefined ? dto.supplierSkuCode : item.supplierSkuCode;
    const newName = dto.name !== undefined ? dto.name : item.name;
    const newBrand = dto.brand !== undefined ? dto.brand : item.brand;
    const newBarcode = dto.barcode !== undefined ? dto.barcode : item.barcode;

    const matchAnalysis = await this.classifyAdmittedItem(item, {
      candidateItemId: item.id, candidateCreatedAt: item.createdAt,
      supplierId: item.job.supplierId,
      supplierSkuCode: newSupplierSkuCode,
      name: newName,
      brand: newBrand,
      barcode: newBarcode,
      ...(dto.barcode !== undefined && { invalidBarcode: null }),
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
        enrichment: { ...this.withoutReplacedBarcode((item.enrichment as Record<string, any>) || {}, dto.barcode),
          // An edited row is reviewed against its new wording, not the candidates of the old one.
          identity: this.identityEvidence(matchAnalysis, Boolean((item.enrichment as Record<string, any>)?.identity?.brandInferred)),
          contentReview: null,
          catalogReview: null,
          media: (((item.enrichment as Record<string, any>)?.media) || []).map((m: any) =>
            ({ ...m, originType: m.isTest ? 'test' : 'unverified', review: null })) } as unknown as Prisma.InputJsonValue,
      },
    });

    await this.evaluateJobStatus(item.jobId);

    return this.getCandidateDetail(updated.id);
  }

  /**
   * GLO-276: classifies every admitted (pending) row of a job against the canonical catalog. Idempotent and retryable:
   * only rows still pending are touched, each guarded by its updatedAt. Known SKUs never trigger AI; only proven
   * NO_MATCH rows (new-candidate slow lane) are sent for enrichment.
   */
  async processMatching(jobId: string): Promise<MatchingSummary> {
    const summary: MatchingSummary = {
      exactMatches: 0, needsReview: 0, newCandidates: 0, linkedToExistingCandidate: 0, rejected: 0, aiEnrichmentRequests: 0, enrichmentDeferred: 0,
    };
    const job = await this.prisma.ingestionJob.findUnique({ where: { id: jobId }, select: { id: true, supplierId: true } });

    if (!job) return summary;

    const enrichmentTasks: Array<() => Promise<{ providerReachable: boolean }>> = [];
    // Identity lookups load per chunk, so a large file does not pay one round of queries per row, and memory stays one chunk.
    let cursor: string | undefined;
    for (;;) {
      const chunk: IngestionItem[] = await this.prisma.ingestionItem.findMany({
        where: { jobId, status: IngestionStatus.pending, ...(cursor && { id: { gt: cursor } }) },
        orderBy: { id: 'asc' },
        take: MATCHING_BATCH_SIZE,
      });
      if (!chunk.length) break;
      cursor = chunk[chunk.length - 1].id;
      const inputs = new Map<string, Parameters<ProductIdentityService['classifyCandidateMatch']>[0]>();
      for (const item of chunk) {
        const decision = this.assertAdmittedItem(item);
        const normalized = (item.enrichment as { source?: { normalized?: { extractedSize?: number | null; extractedUnit?: string | null; extractedPackCount?: number | null; invalidBarcode?: string } } } | null)?.source?.normalized;
        const brand = item.brand?.trim() ? item.brand : (await this.productIdentityService.inferBrandFromName(item.name)) ?? '';
        inputs.set(item.id, {
          candidateItemId: item.id, candidateCreatedAt: item.createdAt,
          supplierId: job.supplierId,
          supplierSkuCode: item.supplierSkuCode,
          name: item.name,
          brand,
          brandId: decision.brandId,
          barcode: item.barcode,
          invalidBarcode: normalized?.invalidBarcode ?? null,
          size: normalized?.extractedSize ?? null,
          sizeUnit: normalized?.extractedUnit ?? null,
          packageCount: normalized?.extractedPackCount ?? null,
        });
      }
      const batch = await this.productIdentityService.prepareBatch([...inputs.values()]);
      const classified: Array<{ item: IngestionItem; matchAnalysis: ProductIdentityMatchResult; normalized: any; brand: string; rejected: boolean; exact: boolean; update: MatchingUpdate }> = [];
      for (const item of chunk) {
        const enrichment = (item.enrichment as Record<string, any>) || {};
        const normalized = enrichment.source?.normalized;
        const input = inputs.get(item.id)!;
        const brand = input.brand;

        const matchAnalysis = await this.classifyAdmittedItem(item, input, batch);

        const identity = this.identityEvidence(matchAnalysis, brand !== item.brand);
        const rejected = matchAnalysis.classification === MatchClassification.OUT_OF_SCOPE ||
          matchAnalysis.classification === MatchClassification.INVALID;
        const exact = matchAnalysis.classification === MatchClassification.EXACT_MATCH && Boolean(matchAnalysis.matchedSkuId);
        classified.push({ item, matchAnalysis, normalized, brand, rejected, exact, update: {
          id: item.id,
          expectedUpdatedAt: item.updatedAt.toISOString(),
          brand,
          matchedSkuId: exact ? matchAnalysis.matchedSkuId! : null,
          status: rejected ? IngestionStatus.rejected : IngestionStatus.review_required,
          enrichmentStatus: rejected ? IngestionItemEnrichmentStatus.failed : null,
          enrichmentError: rejected ? matchAnalysis.reason : null,
          // Merge, never replace: the raw source row and its provenance must survive classification.
          enrichment: { ...enrichment, identity },
        } });
      }
      const applied = await this.applyMatchingUpdates(classified.map(entry => entry.update));
      for (const { item, matchAnalysis, normalized, brand, rejected, exact } of classified) {
        if (!applied.has(item.id)) continue;

        if (rejected) { summary.rejected++; continue; }
        if (exact) { summary.exactMatches++; continue; }
        if (matchAnalysis.classification === MatchClassification.NO_MATCH && matchAnalysis.existingCandidateId) {
          summary.linkedToExistingCandidate++;
          continue;
        }
        // Only a provably new product earns research spend (GLO-278): stated brand, known net content, recognised scope,
        // and no rejected or possibly-duplicate candidate with the same identity. Everything else waits for a human.
        const provablyNew = matchAnalysis.classification === MatchClassification.NO_MATCH &&
          this.productIdentityService.isStatedBrand(brand) && !normalized?.holds?.scope &&
          !matchAnalysis.conflicts.includes('missing_net_content') && !matchAnalysis.previouslyRejectedCandidateId &&
          !matchAnalysis.possibleDuplicateCandidateIds?.length;
        if (!provablyNew) {
          summary.needsReview++;
          continue;
        }
        summary.newCandidates++;
        if (summary.aiEnrichmentRequests >= ENRICHMENT_MAX_PER_JOB) {
          summary.enrichmentDeferred++;
          continue;
        }
        summary.aiEnrichmentRequests++;
        enrichmentTasks.push(() => this.enrichItemAsync(item.id, item.name, brand, item.barcode ?? undefined));
      }
    }

    this.runEnrichmentInBackground(jobId, enrichmentTasks);
    await this.evaluateJobStatus(jobId);
    return summary;
  }

  /** One statement per chunk, holding the same per-row guard as a single update: a row changed meanwhile is left alone. */
  private async applyMatchingUpdates(updates: MatchingUpdate[]): Promise<Set<string>> {
    if (!updates.length) return new Set();
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      UPDATE ingestion.ingestion_items AS i SET
        brand = d.brand,
        matched_sku_id = d."matchedSkuId",
        status = d.status::ingestion."IngestionStatus",
        enrichment_status = COALESCE(d."enrichmentStatus"::ingestion."IngestionItemEnrichmentStatus", i.enrichment_status),
        enrichment_error = CASE WHEN d."enrichmentStatus" IS NULL THEN i.enrichment_error ELSE d."enrichmentError" END,
        enrichment = d.enrichment,
        updated_at = now() AT TIME ZONE 'UTC'
      FROM jsonb_to_recordset(${JSON.stringify(updates)}::jsonb) AS d(
        id uuid, "expectedUpdatedAt" timestamp(3), brand text, "matchedSkuId" uuid, status text,
        "enrichmentStatus" text, "enrichmentError" text, enrichment jsonb)
      WHERE i.id = d.id AND i.status = 'pending' AND i.updated_at = d."expectedUpdatedAt"
      RETURNING i.id`);
    return new Set(rows.map(row => row.id));
  }

  /** Bounded, and a provider outage ends the run instead of walking the rest of the file through failing calls. */
  private runEnrichmentInBackground(jobId: string, tasks: Array<() => Promise<{ providerReachable: boolean }>>): void {
    if (!tasks.length) return;
    let next = 0;
    let consecutiveFailures = 0;
    const worker = async () => {
      while (next < tasks.length && consecutiveFailures < ENRICHMENT_OUTAGE_THRESHOLD) {
        const task = tasks[next++];
        try {
          const { providerReachable } = await task();
          consecutiveFailures = providerReachable ? 0 : consecutiveFailures + 1;
        } catch (err) {
          consecutiveFailures++;
          console.error(`Enrichment background error for job ${jobId}:`, err instanceof Error ? err.message : String(err));
        }
      }
    };
    const run = Promise.all(Array.from({ length: Math.min(ENRICHMENT_CONCURRENCY, tasks.length) }, worker)).then(() => undefined);
    this.backgroundWork.add(run);
    void run.finally(() => this.backgroundWork.delete(run));
  }

  /** Matches a large admission after the receipt returns; every step is idempotent and POST jobs/:id/match resumes it. */
  private async startMatching(jobId: string, admittedRows: number): Promise<NonNullable<IngestionUploadResult['matching']>> {
    if (admittedRows <= SYNC_MATCHING_MAX_ROWS) return this.matchAdmittedRows(jobId);
    const run = this.matchAdmittedRows(jobId).then(outcome => {
      if ('status' in outcome) console.error(`Background matching for job ${jobId} needs a retry: ${outcome.status === 'FAILED_RETRYABLE' ? outcome.error : outcome.status}`);
    });
    this.backgroundWork.add(run);
    void run.finally(() => this.backgroundWork.delete(run));
    return { status: 'RUNNING' };
  }

  /** Settles when in-process background matching and enrichment are finished. */
  async whenBackgroundWorkSettles(): Promise<void> {
    while (this.backgroundWork.size) await Promise.all(this.backgroundWork);
  }

  /** The identity evidence a row keeps from its latest classification, read back by the review record. */
  /** A reviewer's new barcode replaces the malformed cell as identity evidence; the raw source row keeps what was stated. */
  private withoutReplacedBarcode(enrichment: Record<string, any>, barcode?: string): Record<string, any> {
    if (barcode === undefined || !enrichment.source?.normalized?.invalidBarcode) return enrichment;
    const { invalidBarcode: _replaced, ...normalized } = enrichment.source.normalized;
    return { ...enrichment, source: { ...enrichment.source, normalized } };
  }

  private identityEvidence(matchAnalysis: ProductIdentityMatchResult, brandInferred: boolean) {
    return {
      fingerprint: matchAnalysis.fingerprint,
      classification: matchAnalysis.classification,
      matchReason: matchAnalysis.reason,
      conflicts: matchAnalysis.conflicts,
      canonicalSku: matchAnalysis.canonicalSku || null,
      route: matchAnalysis.route ?? null,
      suggestedSkuId: matchAnalysis.suggestedSkuId ?? null,
      candidates: matchAnalysis.candidates ?? [],
      rejectedCandidates: matchAnalysis.rejectedCandidates ?? [],
      existingCandidateId: matchAnalysis.existingCandidateId || null,
      previouslyRejectedCandidateId: matchAnalysis.previouslyRejectedCandidateId ?? null,
      possibleDuplicateCandidateIds: matchAnalysis.possibleDuplicateCandidateIds ?? [],
      brandInferred,
      matchedAt: new Date().toISOString(),
    };
  }

  private async storedIdentityMatch(item: { status: IngestionStatus; matchedSkuId: string | null; name: string; brand: string; barcode: string | null;
    supplierSkuCode: string; job: { status: IngestionStatus; supplierId: string } }, enrichment: Record<string, any>): Promise<CandidateIdentityMatch> {
    const stored = enrichment.identity ?? {};
    const suggestedSkuId: string | null = stored.suggestedSkuId ?? null;
    const candidates: IdentityCandidate[] = Array.isArray(stored.candidates) ? stored.candidates : [];
    const images = await this.catalogService.getVerifiedProductImages([...new Set(candidates.map(candidate => candidate.productId).filter(Boolean))]);
    return {
      route: stored.route ?? null,
      suggestedSkuId,
      suggestedSku: suggestedSkuId && stored.canonicalSku?.id === suggestedSkuId &&
        !candidates.some(candidate => candidate.skuId === suggestedSkuId) ? stored.canonicalSku : null,
      candidates: candidates.map(candidate => ({ ...candidate, imageUrl: images.get(candidate.productId) ?? null })),
      rejectedCandidates: Array.isArray(stored.rejectedCandidates) ? stored.rejectedCandidates : [],
      interpretation: this.productIdentityService.interpretRow(candidateIdentityInput({ ...item, enrichment }, item.job.supplierId)),
      review: enrichment.identityReview ? { decision: enrichment.identityReview.decision ?? 'EXISTING_SKU', skuId: enrichment.identityReview.skuId,
        reviewedBy: enrichment.identityReview.reviewedBy, reviewedAt: enrichment.identityReview.reviewedAt, evidence: enrichment.identityReview.evidence } : null,
      conflicts: Array.isArray(stored.conflicts) ? stored.conflicts : [],
      matchReason: stored.matchReason ?? null,
      matchedAt: stored.matchedAt ?? null,
      confirmable: stored.classification === MatchClassification.LIKELY_MATCH && !item.matchedSkuId &&
        item.status === IngestionStatus.review_required && item.job.status !== IngestionStatus.published &&
        Boolean(suggestedSkuId || candidates.length),
    };
  }

  /** Runs matching after rows are admitted; a failure is reported as retryable instead of failing the receipt. */
  private async matchAdmittedRows(jobId: string): Promise<MatchingSummary | { status: 'FAILED_RETRYABLE'; error: string }> {
    try {
      return await this.processMatching(jobId);
    } catch (error) {
      return { status: 'FAILED_RETRYABLE', error: error instanceof Error ? error.message : String(error) };
    }
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

    // Stored associations are proposals, including when the caller omits matchedSkuId.
    this.assertAdmittedItem(item);
    const proposedSkuId = dto?.matchedSkuId ?? item.matchedSkuId;
    if (proposedSkuId) await this.productIdentityService.assertSkuAssociation(
      candidateIdentityInput(item, item.job.supplierId), proposedSkuId, this.prisma, Boolean(dto?.matchedSkuId));

    if (dto?.createNewProduct && dto?.matchedSkuId) {
      throw new BadRequestException('Cannot set both createNewProduct and matchedSkuId');
    }

    // A row matching could not verify is only settled with a stated reason, which then travels with the decision.
    const evidence = dto?.identityEvidence?.trim();
    const requireEvidence = () => {
      if ((evidence?.length ?? 0) < MIN_IDENTITY_EVIDENCE) throw new BadRequestException('identity_evidence_required');
    };

    if (dto?.createNewProduct) {
      matchedSkuId = null;
      const decided = (item.enrichment as { identityReview?: { decision?: string } } | null)?.identityReview?.decision === 'NEW_PRODUCT';
      const normalized = (item.enrichment as Record<string, any>)?.source?.normalized;
      const analysis = await this.classifyAdmittedItem(item, {
        candidateItemId: item.id, candidateCreatedAt: item.createdAt,
        supplierId: item.job.supplierId, supplierSkuCode: item.supplierSkuCode,
        name: item.name, brand: item.brand, barcode: item.barcode,
        size: normalized?.extractedSize ?? null, sizeUnit: normalized?.extractedUnit ?? null,
        packageCount: normalized?.extractedPackCount ?? null,
      });
      if (analysis.classification === MatchClassification.LIKELY_MATCH && !decided) requireEvidence();
    } else if (dto?.matchedSkuId) {
      if (!this.isUuid(dto.matchedSkuId)) throw new BadRequestException('Invalid SKU ID');
      const skuIdentity = await this.catalogService.getSkuIdentity(dto.matchedSkuId);
      if (!skuIdentity?.isActive) throw new NotFoundException('SKU not found in catalog or is inactive');
      const normalized = (item.enrichment as Record<string, any>)?.source?.normalized;
      const analysis = await this.classifyAdmittedItem(item, {
        candidateItemId: item.id, candidateCreatedAt: item.createdAt,
        supplierId: item.job.supplierId, supplierSkuCode: item.supplierSkuCode,
        name: item.name, brand: item.brand, barcode: item.barcode,
        size: normalized?.extractedSize ?? null, sizeUnit: normalized?.extractedUnit ?? null,
        packageCount: normalized?.extractedPackCount ?? null,
      });
      // A reviewer may confirm the exact match or a retrieved candidate whose hard identity facts all agreed;
      // never an arbitrary SKU, and never one that a veto (size, pack, brand, barcode) rejected.
      const confirmable = (analysis.classification === MatchClassification.EXACT_MATCH && analysis.matchedSkuId === dto.matchedSkuId) ||
        (analysis.classification === MatchClassification.LIKELY_MATCH && (analysis.suggestedSkuId === dto.matchedSkuId ||
          Boolean(analysis.candidates?.some(candidate => candidate.skuId === dto.matchedSkuId))));
      if (!confirmable) {
        throw new BadRequestException('Selected SKU conflicts with canonical identity; resolve identity evidence first');
      }
      if (analysis.classification !== MatchClassification.EXACT_MATCH) requireEvidence();
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
      dto.routineStepId, dto.approvedIngredientIds, dto.confirmUsageRules].some(value => value !== undefined);
    let catalogReview = currentEnrichmentObj.catalogReview;
    if (hasCatalogSelection) {
      if (!reviewerId) throw new BadRequestException('Admin reviewer required for catalog selections');
      const brand = await this.brandService.getBrand(this.assertAdmittedItem(item).brandId!);
      if (dto!.productLineId) {
        const line = await this.prisma.productLine.findUnique({ where: { id: dto!.productLineId }, include: { brand: true } });
        if (!line?.isActive || this.productIdentityService.canonicalizeBrand(line.brand.name) !==
            this.productIdentityService.canonicalizeBrand(item.brand)) {
          throw new BadRequestException('Selected product line does not belong to the candidate brand');
        }
      }
      if (dto!.categoryId && dto!.categoryId !== this.assertAdmittedItem(item).categoryId) throw new ConflictException('Catalog category must match the approved eligibility leaf');
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
        const evidence = this.acceptedOfficialEvidence(currentEnrichmentObj, item).filter((entry: any) => entry.fieldName === 'ingredients');
        const selected = await this.prisma.ingredient.findMany({ where: { id: { in: ingredientIds }, status: 'APPROVED' } });
        // An INCI list may be recorded as an array (research) or one string (human reviewer); stated "N%" is not part of the name.
        const inciNames = (value: unknown) => (Array.isArray(value) ? value.map(String) : typeof value === 'string' ? value.split(/[,;\n]/) : [])
          .map(name => name.replace(/\d+(?:\.\d+)?\s*%/g, '').trim().toLowerCase()).filter(Boolean);
        if (selected.length !== ingredientIds.length || selected.some(ingredient =>
          !actives.some((active: any) => active.id === ingredient.id) ||
          !evidence.some((entry: any) => inciNames(entry.proposedValue).some(name =>
            [ingredient.inciName, ingredient.name].some(value => value.toLowerCase() === name))))) {
          throw new BadRequestException('Ingredient selection requires canonical ontology and supported manufacturer INCI evidence');
        }
      }
      const reviewedAt = new Date().toISOString();
      const officialEvidence = this.acceptedOfficialEvidence(currentEnrichmentObj, item);

      // GLO-279: a concentration is kept only when the official evidence itself states that percentage next to the
      // ingredient's name — never inferred from INCI order or copied from another product. Everything else stays UNKNOWN.
      const concentrations: Array<Record<string, unknown>> = [];
      const unverifiedConcentrations: Array<Record<string, unknown>> = [];
      const actives = Array.isArray(currentEnrichmentObj.ingredientProfile?.actives) ? currentEnrichmentObj.ingredientProfile.actives : [];
      for (const active of actives.filter((a: any) => ingredientIds.includes(a.id) && a.concentration)) {
        const value = String(active.concentration).match(/^(\d+(?:\.\d+)?)\s*%$/)?.[1];
        const names = [active.inciName, active.name].filter(Boolean).map((n: string) => n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        // Every percentage any official source states for this ingredient; disagreement means UNKNOWN, not "pick one".
        const statements = officialEvidence.flatMap((entry: any) => {
          const text = `${JSON.stringify(entry.proposedValue ?? '')} ${entry.excerpt ?? ''}`.toLowerCase();
          return names.flatMap((name: string) => [...text.matchAll(new RegExp(`${name}\\W{0,3}(\\d+(?:\\.\\d+)?)\\s*%|(\\d+(?:\\.\\d+)?)\\s*%\\W{0,3}${name}`, 'g'))]
            .map(match => ({ value: Number(match[1] ?? match[2]), entry })));
        });
        const statedValues = new Set(statements.map(s => s.value));
        const stated = value && statedValues.size === 1 && statedValues.has(Number(value))
          ? statements[0].entry : undefined;
        if (value && statedValues.size > 1) {
          unverifiedConcentrations.push({ ingredientId: active.id, stated: active.concentration, reason: 'contradictory_official_evidence',
            officialValues: [...statedValues] });
          continue;
        }
        if (value && stated) {
          concentrations.push({ ingredientId: active.id, value: Number(value), unit: '%', evidence: {
            sourceUrl: stated.sourceUrl, sourceType: stated.sourceType, evidenceText: `${active.inciName ?? active.name} ${value}%`,
            reviewedBy: reviewerId, reviewedAt } });
        } else {
          unverifiedConcentrations.push({ ingredientId: active.id, stated: active.concentration, reason: 'not_stated_in_official_evidence' });
        }
      }

      // GLO-279: usage rules come only from verified official directions (webpage, document or authentic label),
      // confirmed by this reviewer. No verified directions → no rules (never invented) — but approval is not blocked.
      let usageRules: Array<Record<string, unknown>> | undefined;
      let usageRulesStatus: string | undefined;
      if (dto!.confirmUsageRules) {
        const asLines = (value: unknown) => (Array.isArray(value) ? value.map(String) : typeof value === 'string' ? [value] : []);
        const directions = officialEvidence.find((entry: any) => entry.fieldName === 'usage' && asLines(entry.proposedValue).length);
        const distributor = (currentEnrichmentObj.research?.fieldEvidences ?? []).find((entry: any) =>
          entry.fieldName === 'usage' && entry.sourceType !== 'OFFICIAL_MANUFACTURER' && asLines(entry.proposedValue).length);
        const placement = directions && this.routinePlacementService.determineRoutinePlacement({
          productName: item.name, brand: item.brand, usage: asLines(directions.proposedValue),
          conflictingDistributorUsage: distributor ? asLines(distributor.proposedValue).join(' ') : undefined,
        });
        if (!directions) usageRulesStatus = 'NO_VERIFIED_DIRECTIONS';
        else if (!placement || !placement.usageRules.length) usageRulesStatus = 'DIRECTIONS_STATE_NO_USAGE_FACTS';
        else {
          usageRulesStatus = placement.evidenceSummary.contradictionsFound ? 'CONFIRMED_OFFICIAL_OVER_CONTRADICTING_SOURCE' : 'CONFIRMED';
          usageRules = placement.usageRules.map((rule: UsageRule) => ({ ...rule, sourceUrl: directions.sourceUrl, sourceType: directions.sourceType,
            evidenceKind: directions.evidenceKind ?? 'MANUFACTURER_WEBPAGE', marketVersion: directions.marketVersion ?? null,
            retrievedAt: directions.observedAt ?? null }));
        }
      }

      catalogReview = { productLineId: dto!.productLineId ?? null, categoryId: dto!.categoryId ?? null,
        concernSlugs: concerns, routineStepId: dto!.routineStepId ?? null,
        ingredientIds, reviewedBy: reviewerId, reviewedAt,
        brandId: brand?.id ?? null, concentrations, unverifiedConcentrations,
        ...(usageRulesStatus && { usageRulesStatus }), ...(usageRules && { usageRules }) };
    }
    const auditTrail: CandidateAuditEntry[] = Array.isArray(currentEnrichmentObj.auditTrail)
      ? currentEnrichmentObj.auditTrail
      : [];

    if (reviewerId) {
      auditTrail.push({
        action: 'APPROVED',
        actorId: reviewerId,
        timestamp: new Date().toISOString(),
        ...(dto?.identityEvidence?.trim() && { reason: dto.identityEvidence.trim() }),
      });
    }

    const updatedEnrichment = { ...currentEnrichmentObj, media, auditTrail, catalogReview,
      // Reusable only for the same supplier code, SKU and wording; a stored match without this proves nothing.
      ...(dto?.matchedSkuId && reviewerId && { identityReview: { decision: 'EXISTING_SKU', skuId: dto.matchedSkuId, reviewedBy: reviewerId,
        reviewedAt: new Date().toISOString(), evidence, wordingKey: this.productIdentityService.wordingKeyFor(candidateIdentityInput(item, item.job.supplierId)) } }),
      ...(dto?.createNewProduct && reviewerId && evidence && { identityReview: { decision: 'NEW_PRODUCT', reviewedBy: reviewerId,
        reviewedAt: new Date().toISOString(), evidence,
        rejectedSkuIds: (currentEnrichmentObj.identity?.candidates ?? []).map((candidate: IdentityCandidate) => candidate.skuId) } }) };

    if (matchedSkuId) await this.productIdentityService.assertSkuAssociation(
      candidateIdentityInput({ ...item, enrichment: updatedEnrichment }, item.job.supplierId),
      matchedSkuId, this.prisma, Boolean(dto?.matchedSkuId));
    // Persist a reusable alias only after every identity/media review has succeeded.
    if (dto?.matchedSkuId) await this.productIdentityService.createSupplierSkuAlias(
      item.job.supplierId, item.supplierSkuCode, dto.matchedSkuId);

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
    const job = await this.prisma.ingestionJob.findUnique({ where: { id: jobId } });
    if (!job) return;

    const sourceRows = Array.isArray(job.rowOutcomes) ? job.rowOutcomes as Array<{ outcome?: string }> : [];
    if (sourceRows.some(r => r.outcome === 'POLICY_HOLD') && job.status !== IngestionStatus.published) {
      await this.prisma.ingestionJob.update({ where: { id: jobId }, data: { status: IngestionStatus.review_required } });
      return;
    }

    const allProcessed = !(await this.prisma.ingestionItem.findFirst({
      where: { jobId, status: { notIn: [IngestionStatus.approved, IngestionStatus.rejected, IngestionStatus.published] } },
      select: { id: true },
    }));

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
  ): Promise<{ providerReachable: boolean }> {
    const admitted = await this.prisma.ingestionItem.findUniqueOrThrow({ where: { id: itemId } });
    this.assertAdmittedItem(admitted);
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
      return { providerReachable: true };
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
      // Only a typed answer from the provider proves it was reachable.
      return { providerReachable: isKnownAiError && !isSoftError };
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
    this.assertAdmittedItem(item);

    // Credit Protection & Caching: a settled answer is reused. An outage settled nothing, so it is retried.
    const currentEnrichment = (item.enrichment as Record<string, any>) || {};
    const previous = currentEnrichment.research;
    // Reviewer-recorded evidence alone is not a provider answer, and a result stored before statuses existed counts only if a provider answered it.
    if (previous && (previous.researchStatus === 'COMPLETE' || previous.researchStatus === 'NO_EVIDENCE' || (!previous.researchStatus && previous.providerStatuses?.exa === 'LIVE'))) {
      return previous as Record<string, unknown>;
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

    // Reviewer-recorded evidence is never replaced by a provider run, and an outage leaves stored research untouched.
    const latest = await this.prisma.ingestionItem.findUniqueOrThrow({ where: { id: itemId } });
    const latestEnrichment = (latest.enrichment as Record<string, any>) || {};
    const settled = researchResult.researchStatus !== 'PROVIDER_UNAVAILABLE';
    const reviewedEvidence = (latestEnrichment.research?.fieldEvidences ?? []).filter((entry: { reviewedBy?: string }) => entry.reviewedBy);
    await this.prisma.ingestionItem.update({
      where: { id: itemId },
      data: {
        enrichment: {
          ...latestEnrichment,
          ...(settled && { research: { ...researchResult, fieldEvidences: [...reviewedEvidence, ...researchResult.fieldEvidences] } }),
          researchAttempt: { status: researchResult.researchStatus, providerStatuses: researchResult.providerStatuses, at: researchResult.researchedAt },
        } as unknown as Prisma.InputJsonValue,
        enrichmentStatus: settled ? IngestionItemEnrichmentStatus.succeeded : IngestionItemEnrichmentStatus.pending,
        enrichmentError: settled ? null : 'RESEARCH_PROVIDER_UNAVAILABLE: retry when providers recover',
      },
    });

    return researchResult as unknown as Record<string, unknown>;
  }

  async generateCandidateContent(itemId: string) {
    if (!this.isUuid(itemId)) throw new BadRequestException('Invalid candidate item ID');
    const item = await this.prisma.ingestionItem.findUniqueOrThrow({ where: { id: itemId } });
    this.assertAdmittedItem(item);
    return this.contentService.generateContent(itemId);
  }

  async uploadCandidateMedia(itemId: string, file: Express.Multer.File) {
    return this.withCandidateLock(itemId, () => this.uploadCandidateMediaLocked(itemId, file));
  }

  private async uploadCandidateMediaLocked(itemId: string, file: Express.Multer.File) {
    if (!this.isUuid(itemId)) throw new BadRequestException('Invalid candidate item ID');
    const item = await this.prisma.ingestionItem.findUnique({ where: { id: itemId }, include: { job: true } });
    if (!item) throw new NotFoundException('Candidate item not found');
    this.assertAdmittedItem(item);

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
      createdAt?: Date;
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
      await this.productIdentityService.assertSkuAssociation(candidateIdentityInput(item, supplierId), item.matchedSkuId);
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
        await this.productIdentityService.assertSkuAssociation(candidateIdentityInput(item, supplierId), existingSku.id);
        await this.productIdentityService.createSupplierSkuAlias(supplierId, item.supplierSkuCode, existingSku.id);
        await this.publishReviewedMedia(item, existingSku.id, supplierId);
        return existingSku.id;
      }
    }

    // 3. Perform pre-publish Identity Match Check (Deduplication)
    const matchAnalysis = await this.classifyAdmittedItem(item, {
      candidateItemId: item.id, candidateCreatedAt: item.createdAt,
      supplierId,
      supplierSkuCode: item.supplierSkuCode,
      name: item.name,
      brand: item.brand,
      barcode: item.barcode,
    });

    if (matchAnalysis.classification === MatchClassification.EXACT_MATCH && matchAnalysis.matchedSkuId) {
      await this.productIdentityService.assertSkuAssociation(candidateIdentityInput(item, supplierId), matchAnalysis.matchedSkuId);
      // Register Supplier SKU Alias for future imports
      await this.productIdentityService.createSupplierSkuAlias(supplierId, item.supplierSkuCode, matchAnalysis.matchedSkuId);
      await this.publishReviewedMedia(item, matchAnalysis.matchedSkuId, supplierId);
      return matchAnalysis.matchedSkuId;
    }

    if (matchAnalysis.classification !== MatchClassification.NO_MATCH && !this.productIdentityService.reviewerMayCreateNew(matchAnalysis, enrichment.identityReview)) {
      throw new ConflictException(`Canonical identity requires review: ${matchAnalysis.reason}`);
    }

    // Validate the proposed SKU's reviewed physical identity before creating even its Product.
    const proposed = requireMediaReview(reviewedMedia[0].review);
    const validation = this.productIdentityService.validateIdentity(candidateIdentityInput(item, supplierId), {
      id: 'proposed', productId: 'proposed', code: item.supplierSkuCode, isActive: true,
      product: { name: item.name, brand: { name: item.brand } }, barcode: item.barcode,
      size: { toNumber: () => proposed.size }, sizeUnit: proposed.sizeUnit,
      variantName: proposed.variantName, packCount: proposed.packCount ?? null,
    });
    if (validation.state !== 'VERIFIED_IDENTITY') {
      throw new ConflictException(`${validation.state}: ${validation.conflicts.join(', ')}`);
    }

    // 4. Admit only an existing or separately approved canonical brand.
    const existingBrand = await this.brandService.getBrand(this.assertAdmittedItem(item).brandId!);
    if (!existingBrand) throw new BadRequestException('Approved canonical brand no longer exists; policy review required');
    const brandId = existingBrand.id;
    const brandName = existingBrand.name;
    const catalogReview = enrichment.catalogReview as Record<string, any> | undefined;

    // 5. Resolve or create Product in Catalog via CatalogService. An existing product is reused only for the same
    // brand AND the same normalized base name — never via a slug derived from the title, which collapsed every Arabic
    // title of a brand to "<brand>-" and attached new SKUs to the wrong product (GLO-278).
    const sameBrandProducts = await this.prisma.product.findMany({ where: { brandId }, select: { id: true, name: true }, orderBy: { id: 'asc' } });
    const sameProduct = sameBrandProducts.find(p => this.productIdentityService.sameBaseName(p.name, item.name));
    // Check code reuse before any catalog update or creation.
    const skuCode = item.barcode ? `SKU-${item.barcode}` : (item.supplierSkuCode || `SKU-${item.id.slice(0, 8).toUpperCase()}`);
    const codeMatch = await this.prisma.sku.findUnique({ where: { code: skuCode } });
    if (codeMatch) {
      await this.productIdentityService.assertSkuAssociation(candidateIdentityInput(item, supplierId), codeMatch.id);
      await this.productIdentityService.createSupplierSkuAlias(supplierId, item.supplierSkuCode, codeMatch.id);
      await this.publishReviewedMedia(item, codeMatch.id, supplierId);
      return codeMatch.id;
    }
    const productSlug = canonicalProductSlug(brandName, item.name,
      `${this.productIdentityService.canonicalizeBrand(brandName)}|${this.productIdentityService.normalizeString(item.name)}`);
    let product = sameProduct ? await this.catalogService.getProduct(sameProduct.id) : null;
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
    const existingSkus = await this.catalogService.getSkus(product.id);
    const existingSku = existingSkus.find(
      (s) => s.code === skuCode || (item.barcode !== null && s.barcode === item.barcode),
    );

    if (existingSku) {
      await this.productIdentityService.assertSkuAssociation(candidateIdentityInput(item, supplierId), existingSku.id);
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
      await this.catalogService.addMedia(sku.productId, { type: 'image', url, originType: 'verified', role: 'PRIMARY_PACKSHOT',
        generationMetadata: { ...review, skuId } }, review.reviewedBy);
    }
  }

  async publishCandidate(itemId: string, actorId?: string): Promise<Record<string, unknown>> {
    if (!this.isUuid(itemId)) throw new BadRequestException('Invalid candidate item ID');
    // Serialize publication per product identity, not just per candidate: two candidates of one product (two suppliers)
    // must not both create a SKU; the second sees the first's SKU and links to it (GLO-278).
    const item = await this.prisma.ingestionItem.findUnique({ where: { id: itemId }, select: { barcode: true, enrichment: true } });
    const fingerprint = ((item?.enrichment ?? {}) as { source?: { fingerprint?: string | null } }).source?.fingerprint;
    const identityKeys = [item?.barcode ? `identity:barcode:${item.barcode}` : null, fingerprint ? `identity:fp:${fingerprint}` : null]
      .filter((key): key is string => Boolean(key));
    return this.withCandidateLock(itemId, () => this.publishCandidateLocked(itemId, actorId), identityKeys);
  }

  private async publishCandidateLocked(itemId: string, actorId?: string): Promise<Record<string, unknown>> {
    if (!this.isUuid(itemId)) throw new BadRequestException('Invalid candidate item ID');
    const item = await this.prisma.ingestionItem.findUnique({
      where: { id: itemId },
      include: { job: true },
    });

    if (!item) throw new NotFoundException('Candidate item not found');
    this.assertAdmittedItem(item);
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

    const barcode = this.rowNormalizationService.normalizeBarcode(item.barcode);
    if (item.barcode && !barcode.isValid) throw new ConflictException('EXPLICIT_CONFLICT: invalid_gtin');
    const target = item.matchedSkuId ?? (barcode.barcode ? (await this.catalogService.getSkuByBarcode(barcode.barcode))?.id : null);
    if (target) await this.productIdentityService.assertSkuAssociation(candidateIdentityInput(item, item.job.supplierId), target);
    else {
      const analysis = await this.classifyAdmittedItem(item, { ...candidateIdentityInput(item, item.job.supplierId),
        candidateItemId: item.id, candidateCreatedAt: item.createdAt });
      if ([MatchClassification.CONFLICT, MatchClassification.INVALID, MatchClassification.LIKELY_MATCH].includes(analysis.classification) &&
          !this.productIdentityService.reviewerMayCreateNew(analysis, (item.enrichment as { identityReview?: { decision?: string } } | null)?.identityReview))
        throw new ConflictException(`Canonical identity requires review: ${analysis.reason}`);
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
      await this.catalogService.setStatedConcentrations(sku.productId, catalogReview.concentrations ?? []);
      if (catalogReview.routineStepId) {
        await this.careService.addReviewedProductStep(sku.productId, catalogReview.routineStepId);
      }
      if (Array.isArray(catalogReview.usageRules) && catalogReview.usageRules.length) {
        const stored = await this.catalogService.addReviewedUsageRules(sku.productId, skuId, catalogReview.usageRules.map((rule: any) => ({
          targetArea: rule.targetArea, routinePeriod: rule.routinePeriod, rinseMode: rule.rinseMode, frequencyUnit: rule.frequencyUnit,
          usesMin: rule.usesMin, usesMax: rule.usesMax, contactMinutes: rule.contactMinutes, contactIsMaximum: rule.contactIsMaximum,
          condition: rule.condition, evidenceText: rule.evidenceText, sourceUrl: rule.sourceUrl, sourceType: rule.sourceType,
          retrievedAt: rule.retrievedAt ? new Date(rule.retrievedAt) : null, reviewedBy: catalogReview.reviewedBy,
          reviewedAt: new Date(catalogReview.reviewedAt), sourceCandidateId: item.id,
        })));
        // Existing reviewed rules on this SKU are never silently replaced by another candidate's publication.
        if (!stored) enrichment.usageRulesNotApplied = 'sku_already_has_reviewed_usage_rules';
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

    if (Array.isArray(job.rowOutcomes) && (job.rowOutcomes as Array<{ outcome?: string }>).some(r => r.outcome === 'POLICY_HOLD')) {
      throw new ConflictException('Resolve eligibility HOLD rows before publishing the job');
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

    // GLO-277: publishing never deactivates offers. Absence from a file is not proof an item is gone; FULL_SNAPSHOT
    // deactivation happens only through OfferBatchCommitService.approveDeactivations (coverage confirmation + exact
    // reviewed SKU set + admin), never as a side effect here.

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

import { BadRequestException, ConflictException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AdminCatalogImportRow, CatalogDecision, CatalogExceptionStatus, MediaAsset, MediaOriginType, MediaProcessingStatus, MediaReviewStatus, MediaRightsStatus, MediaRole } from '@prisma/client';
import * as crypto from 'crypto';
import sharp from 'sharp';
import { CatalogIntakeService, MediaTemplateService, ProductMediaService } from '../../../modules/catalog/public';
import {
  AdminCatalogImportService, CanonicalResearchService, CatalogDecisionLogService, chooseIdentityImage, decideEditorial, decideMatchedRow, decideNewProduct, HoldReason,
  ImageCandidate, MAX_AUTOMATIC_ATTEMPTS, nextAttemptDelayMs, rowHold,
} from '../../../modules/ingestion/public';

type Row = AdminCatalogImportRow;
const STAGES = ['MATCHED', 'INTAKE_DONE', 'RESEARCHED', 'FACTS_DONE', 'COMPLETE'] as const;
const reached = (row: Row, stage: (typeof STAGES)[number]) => STAGES.indexOf((row.stage ?? 'MATCHED') as (typeof STAGES)[number]) >= STAGES.indexOf(stage);
const MAX_IMAGE_CANDIDATES = 8;

export interface AutopilotRowResult { rowId: string; rowNumber: number; decision: CatalogDecision | 'WAITING' | 'BUSY'; reasonCode: string; skuId: string | null }
export type ExceptionResolution =
  | { action: 'RESOLVE'; note: string; skuId?: string; factId?: string }
  | { action: 'CORRECT'; note: string; correction: { name?: string; brand?: string; size?: number; sizeUnit?: string; categoryHint?: string; sourceUrl?: string; barcode?: string | null } }
  | { action: 'REJECT'; note: string }
  | { action: 'RETRY'; note: string };

export interface MediaOutcome { primary: string; editorial: string; rejectedSources: Array<{ url: string; reason: string }> }

/**
 * The automatic catalog pipeline for Admin product lists: every matched row ends in exactly one of AUTO_ACCEPT, AUTO_LINK, SKIP, HOLD_CRITICAL or RETRY_AUTOMATIC.
 * It reads and writes each owner only through its public services. It never creates offers, prices, stock or listings, and never publishes a product.
 *
 * New products: the product page is verified against the row before any catalog record exists; only then is the canonical SKU created (unpublished), researched,
 * its facts verified field by field, and its authentic image prepared on the default clean template. Each step is resumable by stage and safe to repeat.
 */
@Injectable()
export class CatalogAutopilotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CatalogAutopilotService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly imports: AdminCatalogImportService,
    private readonly research: CanonicalResearchService,
    private readonly intake: CatalogIntakeService,
    private readonly media: ProductMediaService,
    private readonly templates: MediaTemplateService,
    private readonly log: CatalogDecisionLogService,
  ) {}

  /** Optional background runner for due automatic retries: CATALOG_AUTOPILOT_INTERVAL_SECONDS (off by default). */
  onModuleInit() {
    const seconds = Number(process.env.CATALOG_AUTOPILOT_INTERVAL_SECONDS ?? 0);
    const actor = process.env.CATALOG_AUTOPILOT_ACTOR_ID;
    if (!seconds || !actor) return;
    this.timer = setInterval(() => { void this.runDueRetries(actor).catch(error => this.logger.error(`Retry runner failed: ${error instanceof Error ? error.message : error}`)); }, seconds * 1000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async runDueRetries(actorId: string) {
    for (const jobId of await this.imports.jobsWithDueRetries()) await this.runJob(jobId, actorId);
  }

  /** Decides every undecided row of a job, plus any automatic retry that is due. Repeatable: settled rows are never touched again. */
  async runJob(jobId: string, actorId: string, options: { limit?: number } = {}) {
    const results: AutopilotRowResult[] = [];
    const rows = (await this.imports.rowsForAutopilot(jobId)).slice(0, options.limit ?? 500);
    for (const row of rows) results.push(await this.processRow(row.id, actorId));
    // Rows that repeat an earlier row of the same product wait for that product; once it exists they link to it.
    const waiting = results.filter(result => result.decision === 'WAITING').map(result => result.rowId);
    if (waiting.length) {
      await this.imports.match(jobId, { recheck: true, rowIds: waiting });
      for (const rowId of waiting) {
        const index = results.findIndex(result => result.rowId === rowId);
        results[index] = await this.processRow(rowId, actorId);
        // Still waiting on a row another run is working on: come back automatically, never left undecided.
        if (results[index].decision === 'WAITING') {
          const row = await this.imports.getRow(rowId);
          results[index] = { ...results[index], decision: await this.retryLater(row, 'WAITING_FOR_EARLIER_ROW'), reasonCode: 'WAITING_FOR_EARLIER_ROW' };
        }
      }
    }
    return { jobId, results, totals: (await this.imports.getJob(jobId)).totals };
  }

  async processRow(rowId: string, actorId: string): Promise<AutopilotRowResult> {
    let row = await this.imports.getRow(rowId);
    const done = (decision: AutopilotRowResult['decision'], reasonCode: string, skuId: string | null = row.matchedSkuId): AutopilotRowResult =>
      ({ rowId, rowNumber: row.rowNumber, decision, reasonCode, skuId });
    if (row.decision && row.decision !== CatalogDecision.RETRY_AUTOMATIC) return done(row.decision, row.reasonCode ?? '');
    if (!(await this.imports.claimRow(rowId))) return done('BUSY', 'ROW_IN_PROGRESS');
    try {
      const identity = (row.identity ?? {}) as { suggestedSkuId?: string | null; candidates?: unknown[]; brandSuggestion?: { name: string; brandId: string; score: number } };
      const matched = decideMatchedRow({ outcome: row.outcome, reasonCode: row.reasonCode, matchedSkuId: row.matchedSkuId, resolvedByAdmin: Boolean(row.resolvedBy), suggestedSkuId: identity.suggestedSkuId ?? null });
      if (matched?.hold && matched.reasonCode === 'BRAND_SPELLING_UNCONFIRMED' && identity.brandSuggestion) {
        matched.hold.recommended = { action: 'CORRECT', label: `Use "${identity.brandSuggestion.name}"`, payload: { correction: { brand: identity.brandSuggestion.name }, score: identity.brandSuggestion.score } };
      }
      if (matched) {
        await this.settle(row, matched.decision as CatalogDecision, matched.reasonCode, matched.hold);
        return done(matched.decision as CatalogDecision, matched.reasonCode);
      }
      if (row.outcome === 'REJECTED' && row.reasonCode === 'DUPLICATE_OF_ROW') {
        await this.imports.updateRowProgress(rowId, { releaseLease: true });
        return done('WAITING', 'DUPLICATE_OF_ROW');
      }
      if (row.outcome !== 'NEW_CANDIDATE') {
        await this.imports.updateRowProgress(rowId, { releaseLease: true });
        return done('WAITING', row.outcome);
      }
      const outcome = await this.processNew(row, actorId);
      row = await this.imports.getRow(rowId);
      return done(outcome.decision, outcome.reasonCode, row.matchedSkuId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Row ${rowId} failed: ${message}`);
      row = await this.imports.getRow(rowId);
      const result = await this.retryLater(row, `UNEXPECTED:${message}`.slice(0, 300));
      return done(result, 'UNEXPECTED_ERROR');
    } finally {
      await this.imports.updateRowProgress(rowId, { releaseLease: true }).catch(() => undefined);
    }
  }

  /** A product new to the catalog: verify the page, create the SKU, research, verify facts, prepare media, decide. Resumes at its stage. */
  private async processNew(row: Row, actorId: string): Promise<{ decision: CatalogDecision; reasonCode: string }> {
    const admission = await this.imports.admission(row.id);
    if (!admission) {
      const hold = rowHold('POLICY_NOT_ADMITTED', undefined, 'The current Catalog Policy no longer admits this row; it was matched under an earlier version');
      await this.settle(row, CatalogDecision.HOLD_CRITICAL, hold.reasonCode, hold);
      return { decision: CatalogDecision.HOLD_CRITICAL, reasonCode: hold.reasonCode };
    }
    let skuId = row.matchedSkuId;
    const size = row.size?.toNumber() ?? null;

    if (!skuId || !reached(row, 'INTAKE_DONE')) {
      const productName = this.imports.productNameOf(row.name);
      const checks = row.sourceUrl ? [await this.research.checkSource({ brand: admission.brandName, brandAliases: admission.brandAliases, productName, size, sizeUnit: row.sizeUnit,
        barcode: row.barcode, websiteUrl: admission.websiteUrl }, row.sourceUrl)] : [];
      const verdict = decideNewProduct(checks, { barcode: row.barcode });
      await this.log.record({ subjectType: 'IMPORT_ROW', subjectId: row.id, decision: `SOURCE_${verdict.decision}`, reasonCode: verdict.reasonCode, evidence: { checks }, actorType: 'SYSTEM' });
      if (verdict.decision === 'RETRY_AUTOMATIC') return { decision: await this.retryLater(row, checks.map(check => check.outcome).join(',')), reasonCode: verdict.reasonCode };
      if (verdict.decision !== 'AUTO_ACCEPT') {
        await this.settle(row, CatalogDecision.HOLD_CRITICAL, verdict.reasonCode, verdict.hold, { checks });
        return { decision: CatalogDecision.HOLD_CRITICAL, reasonCode: verdict.reasonCode };
      }
      const key = this.imports.identityKey(row, admission.brandId);
      const skuCode = `IMP-${crypto.createHash('sha256').update(key).digest('hex').slice(0, 16).toUpperCase()}`;
      try {
        skuId = (await this.intake.intake({ brandId: admission.brandId, categoryId: admission.categoryId, name: productName, variantName: 'Default', skuCode, size: size!, sizeUnit: row.sizeUnit! })).skuId;
      } catch (error) {
        const existing = await this.existingSku(error, skuCode);
        if (!existing) throw error;
        if (existing.code !== skuCode) {
          // The same brand, name and size already exist under another record: a person decides whether they are one product.
          const hold = rowHold('IDENTITY_UNCONFIRMED', { skuId: existing.skuId });
          await this.settle(row, CatalogDecision.HOLD_CRITICAL, hold.reasonCode, hold);
          return { decision: CatalogDecision.HOLD_CRITICAL, reasonCode: hold.reasonCode };
        }
        skuId = existing.skuId; // our own earlier attempt: resume
      }
      if ((await this.imports.bindRowToSku(row.id, skuId)) === 'LINKED') {
        // Another row of the same product (a concurrent import) owns this SKU and does its research and media: this row is a link.
        row = await this.imports.getRow(row.id);
        await this.settle(row, CatalogDecision.AUTO_LINK, 'AUTO_LINK_PIPELINE_PROVENANCE', undefined, { skuId });
        await this.imports.updateRowProgress(row.id, { stage: 'COMPLETE' });
        return { decision: CatalogDecision.AUTO_LINK, reasonCode: 'AUTO_LINK_PIPELINE_PROVENANCE' };
      }
      await this.intake.recordIdentityVerification(skuId, { status: 'EVIDENCE_VERIFIED', sourceUrls: [verdict.verifiedBy!.url], fingerprints: [row.fingerprint ?? key, key],
        rule: verdict.reasonCode, actorId });
      await this.log.record({ subjectType: 'SKU', subjectId: skuId, skuId, decision: 'IDENTITY_EVIDENCE_VERIFIED', reasonCode: verdict.reasonCode,
        evidence: { source: verdict.verifiedBy, barcode: row.barcode ? 'CLAIMED_NOT_VERIFIED' : 'NONE', importRowId: row.id }, actorType: 'SYSTEM' });
      row = await this.imports.updateRowProgress(row.id, { matchedSkuId: skuId, stage: 'INTAKE_DONE' });
    }

    if (!reached(row, 'RESEARCHED')) {
      const run = await this.research.startRun(skuId!, { sourceUrls: [row.sourceUrl!] }, actorId);
      await this.log.record({ subjectType: 'SKU', subjectId: skuId!, skuId, decision: `RESEARCH_${run.status}`, reasonCode: run.status, evidence: { runId: run.id, sources: run.sources }, actorType: 'SYSTEM' });
      if (run.status === 'PROVIDER_UNAVAILABLE' || run.status === 'FAILED') return { decision: await this.retryLater(row, `RESEARCH_${run.status}`), reasonCode: `RESEARCH_${run.status}` };
      row = await this.imports.updateRowProgress(row.id, { stage: 'RESEARCHED' });
    }

    if (!reached(row, 'FACTS_DONE')) {
      const verified = await this.research.autoVerify(skuId!, actorId);
      for (const hold of verified.holds) {
        await this.log.open({ subjectType: 'SKU', subjectId: skuId!, skuId, importRowId: row.id, hold, evidence: { factIds: hold.factIds } });
      }
      await this.log.record({ subjectType: 'SKU', subjectId: skuId!, skuId, decision: verified.holds.length ? 'FACTS_HELD' : 'FACTS_VERIFIED', reasonCode: verified.holds.map(h => h.reasonCode).join(',') || 'NO_CRITICAL_CONFLICT',
        evidence: { applied: verified.applied, unverified: verified.unverified, rejected: verified.rejected, coverage: verified.coverage }, actorType: 'SYSTEM' });
      row = await this.imports.updateRowProgress(row.id, { stage: 'FACTS_DONE' });
    }

    if (!reached(row, 'COMPLETE')) {
      await this.prepareMedia(skuId!, actorId);
      row = await this.imports.updateRowProgress(row.id, { stage: 'COMPLETE' });
    }

    const open = await this.log.openForSku(skuId!);
    if (open.length) {
      await this.settle(row, CatalogDecision.HOLD_CRITICAL, open[0].reasonCode, undefined, { openExceptions: open.map(item => item.id) });
      return { decision: CatalogDecision.HOLD_CRITICAL, reasonCode: open[0].reasonCode };
    }
    await this.settle(row, CatalogDecision.AUTO_ACCEPT, 'IDENTITY_VERIFIED_BY_SOURCE');
    return { decision: CatalogDecision.AUTO_ACCEPT, reasonCode: 'IDENTITY_VERIFIED_BY_SOURCE' };
  }

  private async existingSku(error: unknown, skuCode: string): Promise<{ skuId: string; code: string } | null> {
    if (!(error instanceof ConflictException)) return null;
    const response = error.getResponse() as { code?: string; existingSkuId?: string };
    if (response.code !== 'DUPLICATE_SKU') return null;
    const found = await this.intake.search(response.existingSkuId ? undefined : skuCode, 40);
    const match = response.existingSkuId ? (await this.intake.getSkuDetail(response.existingSkuId)) : null;
    if (match) return { skuId: match.id, code: match.code };
    const byCode = found.find(item => item.code === skuCode);
    return byCode ? { skuId: byCode.skuId, code: byCode.code } : null;
  }

  private async retryLater(row: Row, reason: string): Promise<CatalogDecision> {
    const attempts = row.attempts + 1;
    if (attempts >= MAX_AUTOMATIC_ATTEMPTS) {
      const hold = rowHold('RETRY_EXHAUSTED', { lastError: reason });
      await this.settle({ ...row, attempts }, CatalogDecision.HOLD_CRITICAL, hold.reasonCode, hold, { attempts, lastError: reason });
      return CatalogDecision.HOLD_CRITICAL;
    }
    await this.imports.updateRowProgress(row.id, { decision: CatalogDecision.RETRY_AUTOMATIC, attempts, nextAttemptAt: new Date(Date.now() + nextAttemptDelayMs(attempts)), lastError: reason });
    await this.log.record({ subjectType: 'IMPORT_ROW', subjectId: row.id, skuId: row.matchedSkuId, decision: CatalogDecision.RETRY_AUTOMATIC, reasonCode: reason.slice(0, 80),
      evidence: { attempts, stage: row.stage }, actorType: 'SYSTEM' });
    return CatalogDecision.RETRY_AUTOMATIC;
  }

  private async settle(row: Row, decision: CatalogDecision, reasonCode: string, hold?: HoldReason, evidence: Record<string, unknown> = {}) {
    await this.imports.updateRowProgress(row.id, { decision, nextAttemptAt: null, reasonCode, ...(hold && { reason: hold.summary.slice(0, 500) }),
      ...(decision !== CatalogDecision.HOLD_CRITICAL && { lastError: null }) });
    await this.log.record({ subjectType: 'IMPORT_ROW', subjectId: row.id, skuId: row.matchedSkuId, decision, reasonCode,
      evidence: { rowNumber: row.rowNumber, jobId: row.jobId, ...evidence }, actorType: 'SYSTEM' });
    if (hold) {
      await this.log.open({ subjectType: 'IMPORT_ROW', subjectId: row.id, skuId: row.matchedSkuId, importRowId: row.id, hold, evidence: {
        row: { rowNumber: row.rowNumber, name: row.name, brand: row.brand, size: row.size?.toNumber() ?? null, sizeUnit: row.sizeUnit, category: row.categoryHint,
          sourceUrl: row.sourceUrl, barcode: row.barcode, invalidBarcode: row.invalidBarcode }, identity: row.identity, ...evidence } });
    } else if (decision !== CatalogDecision.HOLD_CRITICAL) {
      await this.log.closeSettled('IMPORT_ROW', row.id, `Settled automatically: ${decision}`);
    }
  }

  /**
   * Authentic imagery with no clicks: the best manufacturer or trusted-distributor image of at least 400 px becomes the identity packshot, then the default clean
   * template derivative. Each is approved automatically only when every check passes; otherwise it is rejected with its reason. A missing or too-small image is a
   * publication prerequisite, not an exception: nothing here holds a product.
   */
  async prepareMedia(skuId: string, actorId: string): Promise<MediaOutcome> {
    const outcome: MediaOutcome = { primary: 'MISSING', editorial: 'MISSING', rejectedSources: [] };
    let assets = await this.media.listForSku(skuId);
    let original: MediaAsset | undefined = assets.find(asset => asset.role === MediaRole.PRIMARY_PACKSHOT && !asset.parentAssetId && asset.reviewStatus === MediaReviewStatus.APPROVED);
    if (!original) {
      const sources = await this.research.sourceImages(skuId);
      const seen = new Set<string>();
      const candidates: Array<ImageCandidate & { factId: string; buffer: Buffer; contentType: string; pageUrl: string }> = [];
      for (const source of sources) {
        if (seen.has(source.imageUrl) || candidates.length >= MAX_IMAGE_CANDIDATES) continue;
        seen.add(source.imageUrl);
        try {
          const image = await this.research.fetchSourceImage(source.factId, source.imageUrl);
          const meta = await sharp(image.buffer).metadata();
          candidates.push({ url: source.imageUrl, width: meta.width ?? 0, height: meta.height ?? 0, tier: image.sourceTier, reusedBySku: null, factId: source.factId,
            buffer: image.buffer, contentType: image.contentType, pageUrl: image.sourceUrl });
        } catch (error) {
          outcome.rejectedSources.push({ url: source.imageUrl, reason: error instanceof Error ? error.message.slice(0, 120) : 'FETCH_FAILED' });
        }
      }
      const { rejected } = chooseIdentityImage(candidates);
      outcome.rejectedSources.push(...rejected);
      const usable = candidates.filter(candidate => !rejected.some(item => item.url === candidate.url))
        .sort((a, b) => (a.tier === b.tier ? 0 : a.tier === 'OFFICIAL_MANUFACTURER' ? -1 : 1) || Math.min(b.width, b.height) - Math.min(a.width, a.height));
      for (const candidate of usable) {
        const extension = candidate.contentType.includes('png') ? 'png' : candidate.contentType.includes('webp') ? 'webp' : 'jpg';
        try {
          const asset = await this.media.registerOriginal({ skuId, role: MediaRole.PRIMARY_PACKSHOT, originType: MediaOriginType.verified, sourceUrl: candidate.pageUrl,
            sourcePublisher: new URL(candidate.pageUrl).hostname, sourceType: candidate.tier as 'OFFICIAL_MANUFACTURER' | 'TRUSTED_DISTRIBUTOR',
            rightsStatus: candidate.tier === 'OFFICIAL_MANUFACTURER' ? MediaRightsStatus.MANUFACTURER_PUBLISHED : MediaRightsStatus.AUTHORIZED_DISTRIBUTOR, capturedAt: new Date().toISOString() },
          { buffer: candidate.buffer, mimetype: candidate.contentType.split(';')[0], originalname: `source.${extension}`, size: candidate.buffer.length, fieldname: 'file', encoding: '7bit' } as Express.Multer.File, actorId);
          original = await this.media.autoReview(asset.id, { approve: true, reason: 'AUTHENTIC_SOURCE_CHECKS_PASSED' }, actorId);
          await this.log.record({ subjectType: 'MEDIA', subjectId: asset.id, skuId, decision: original.reviewStatus, reasonCode: original.reviewNote ?? '', evidence: { url: candidate.url, width: candidate.width, height: candidate.height, tier: candidate.tier }, actorType: 'SYSTEM' });
          if (original.reviewStatus === MediaReviewStatus.APPROVED) break;
          outcome.rejectedSources.push({ url: candidate.url, reason: original.reviewNote ?? 'NOT_APPROVED' });
          original = undefined;
        } catch (error) {
          // The same pixels already prove another SKU, or the file failed the identity size check: try the next authentic source.
          outcome.rejectedSources.push({ url: candidate.url, reason: error instanceof Error ? error.message.slice(0, 160) : 'REGISTER_FAILED' });
        }
      }
    }
    if (!original) {
      await this.log.record({ subjectType: 'SKU', subjectId: skuId, skuId, decision: 'MEDIA_MISSING', reasonCode: outcome.rejectedSources.length ? 'NO_USABLE_AUTHENTIC_IMAGE' : 'NO_SOURCE_IMAGE',
        evidence: { rejectedSources: outcome.rejectedSources }, actorType: 'SYSTEM' });
      return outcome;
    }
    outcome.primary = original.reviewStatus;

    await this.templates.ensureDefaultTemplate(actorId);
    assets = await this.media.listForSku(skuId);
    let editorial = assets.find(asset => asset.parentAssetId === original!.id && asset.role === MediaRole.CATEGORY_EDITORIAL && asset.reviewStatus !== MediaReviewStatus.REJECTED
      && asset.processingStatus === MediaProcessingStatus.SUCCEEDED);
    if (!editorial) {
      editorial = await this.media.derive(original.id, { transform: 'SAHEL_EDITORIAL' }, actorId);
      // One automatic retry for a transient processing failure; a source the cutout cannot handle honestly fails the same way twice and stays rejected.
      if (editorial.processingStatus === MediaProcessingStatus.FAILED) editorial = await this.media.derive(original.id, { transform: 'SAHEL_EDITORIAL' }, actorId);
    }
    if (editorial.reviewStatus === MediaReviewStatus.PENDING_REVIEW || (editorial.processingStatus === MediaProcessingStatus.FAILED && editorial.reviewStatus !== MediaReviewStatus.REJECTED)) {
      const verdict = decideEditorial(editorial.qualityReport as { warnings: string[] } | null, editorial.processingStatus);
      if (editorial.processingStatus === MediaProcessingStatus.SUCCEEDED) editorial = await this.media.autoReview(editorial.id, verdict, actorId);
      await this.log.record({ subjectType: 'MEDIA', subjectId: editorial.id, skuId, decision: verdict.approve ? 'APPROVED' : 'REJECTED', reasonCode: verdict.reason,
        evidence: { qualityReport: editorial.qualityReport, processingError: editorial.processingError, templateId: editorial.templateId }, actorType: 'SYSTEM' });
    }
    outcome.editorial = editorial.processingStatus === MediaProcessingStatus.FAILED ? 'FAILED' : editorial.reviewStatus;
    return outcome;
  }

  /**
   * A person's one decision on a critical exception. Resolve applies the precomputed (or chosen) resolution, Correct fixes the input and re-runs the pipeline, Reject
   * drops the row or the disputed field, Retry runs the pipeline again. Identity and safety checks still apply: linking goes through the identity guard, and a chosen
   * fact goes through the same Catalog write as any reviewed fact.
   */
  async resolveException(exceptionId: string, input: ExceptionResolution, actorId: string) {
    const item = await this.log.get(exceptionId);
    if (item.status !== CatalogExceptionStatus.OPEN && item.status !== CatalogExceptionStatus.RETRYING) throw new ConflictException({ code: 'EXCEPTION_CHANGED', message: 'This exception was already settled; reload' });
    const recommended = (item.recommended ?? {}) as { payload?: { skuId?: string; factId?: string } };
    const note = input.note.trim();
    if (note.length < 3) throw new BadRequestException('Say briefly why');

    if (item.subjectType === 'IMPORT_ROW') {
      const rowId = item.subjectId;
      if (input.action === 'RESOLVE') {
        const skuId = input.skuId ?? recommended.payload?.skuId;
        if (!skuId) throw new BadRequestException('Choose the catalog SKU this row is, or correct the row');
        await this.imports.resolveRow(rowId, { action: 'LINK_SKU', skuId, note }, actorId);
        const fingerprint = (await this.imports.getRow(rowId)).fingerprint;
        await this.intake.recordIdentityVerification(skuId, { status: 'ADMIN_VERIFIED', fingerprints: fingerprint ? [fingerprint] : [], rule: 'ADMIN_LINKED', actorId });
      } else if (input.action === 'REJECT') {
        await this.imports.resolveRow(rowId, { action: 'REJECT', note }, actorId);
      } else if (input.action === 'CORRECT') {
        await this.imports.correctRow(rowId, input.correction, actorId, note);
      } else {
        await this.imports.retryRow(rowId);
      }
      const settled = await this.log.settle(exceptionId, { status: input.action === 'REJECT' ? CatalogExceptionStatus.REJECTED : CatalogExceptionStatus.RESOLVED, resolution: input.action, note, actorId });
      // A corrected or retried row goes straight back through the automatic pipeline; it may come back with a new, more precise exception.
      const result = input.action === 'CORRECT' || input.action === 'RETRY' ? await this.processRow(rowId, actorId) : null;
      await this.log.record({ subjectType: 'IMPORT_ROW', subjectId: rowId, skuId: item.skuId, decision: `ADMIN_${input.action}`, reasonCode: item.reasonCode, evidence: { exceptionId, note }, actorType: 'ADMIN', actorId });
      return { exception: settled, row: await this.imports.getRow(rowId), result };
    }

    // SKU-level (facts): keep one reading, reject the field, or read the sources again.
    const skuId = item.skuId ?? item.subjectId;
    if (input.action === 'RESOLVE') {
      const factId = input.factId ?? recommended.payload?.factId;
      if (!factId) throw new BadRequestException('Choose the reading to keep');
      await this.research.review(factId, { decision: 'APPROVED', note, overwrite: false }, actorId);
    } else if (input.action === 'REJECT') {
      if (item.field) await this.research.rejectField(skuId, item.field, note, actorId);
    } else if (input.action === 'CORRECT') {
      throw new BadRequestException('A fact is corrected by keeping one of its readings (Resolve) or by retrying with a better source');
    } else {
      await this.refreshSku(skuId, actorId, []);
    }
    const settled = await this.log.settle(exceptionId, { status: input.action === 'REJECT' ? CatalogExceptionStatus.REJECTED : CatalogExceptionStatus.RESOLVED, resolution: input.action, note, actorId });
    // When nothing critical is left on the SKU, the row it held is accepted.
    if (!(await this.log.openForSku(skuId)).length && item.importRowId) {
      const row = await this.imports.getRow(item.importRowId);
      if (row.decision === CatalogDecision.HOLD_CRITICAL && row.stage === 'COMPLETE') await this.settle(row, CatalogDecision.AUTO_ACCEPT, 'CRITICAL_EXCEPTIONS_RESOLVED');
    }
    return { exception: settled, row: item.importRowId ? await this.imports.getRow(item.importRowId) : null, result: null };
  }

  /** Re-runs research, fact verification and media for an existing SKU, e.g. after a person resolved an exception or supplied a better page. */
  async refreshSku(skuId: string, actorId: string, sourceUrls: string[]) {
    if (sourceUrls.length) await this.research.startRun(skuId, { sourceUrls }, actorId);
    const verified = await this.research.autoVerify(skuId, actorId);
    for (const hold of verified.holds) await this.log.open({ subjectType: 'SKU', subjectId: skuId, skuId, hold, evidence: { factIds: hold.factIds } });
    const media = await this.prepareMedia(skuId, actorId);
    return { verified, media, openExceptions: await this.log.openForSku(skuId) };
  }
}

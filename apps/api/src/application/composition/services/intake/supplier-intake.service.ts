import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { IntakeJobStatus, IntakeRowOutcome, IntakeSource } from '@prisma/client';
import { CatalogSnapshotService } from '../../../../modules/catalog/public';
import {
  CandidateIndex, ColumnMap, IntakeStoreService, MATCH_RULE_VERSION, MatchVerdict, parseSpreadsheet, readSupplierRows, RowIdentity, RowSettlement, ScopeGate, sha256,
  supplierColumnProblems,
} from '../../../../modules/intake/public';
import { OfferIntakeService } from '../../../../modules/sourcing/public';

export interface UploadedFile { buffer: Buffer; originalname: string; mimetype: string; size: number }

const MAX_ROWS = 20_000;
const SETTLE_BATCH = 100;

type IntakeRowRecord = Awaited<ReturnType<IntakeStoreService['pendingRows']>>[number];

/**
 * Supplier price file → offers on existing canonical SKUs. Never creates or edits a catalog product. Per batch: one catalog snapshot, one scope gate, one candidate
 * index; per row: cheap read, safe skip, identity check, idempotent offer write. Every row ends SKIPPED, MATCHED, UPDATED, UNMATCHED, INVALID or CRITICAL.
 */
@Injectable()
export class SupplierIntakeService {
  private readonly logger = new Logger(SupplierIntakeService.name);
  private readonly running = new Set<string>();

  constructor(
    private readonly store: IntakeStoreService,
    private readonly snapshots: CatalogSnapshotService,
    private readonly offers: OfferIntakeService,
  ) {}

  /** Receives a file, records every row, and starts processing in the background. A replayed file returns the job it already created. */
  async submit(input: { supplierId: string; actorId: string; file: UploadedFile; mapping?: ColumnMap; wait?: boolean }) {
    await this.offers.assertActiveSupplier(input.supplierId);
    if (!input.file?.buffer?.length) throw new BadRequestException('The file is empty');
    const sheet = (() => {
      try { return parseSpreadsheet(input.file.buffer, input.file.originalname, input.file.mimetype, input.mapping); } catch (error) {
        throw new BadRequestException({ code: 'FILE_UNREADABLE', message: `The file could not be read as a spreadsheet: ${error instanceof Error ? error.message : error}`.slice(0, 300) });
      }
    })();
    const problems = supplierColumnProblems(sheet.columnMap);
    if (problems.length) throw new BadRequestException({ code: problems[0].code, message: problems[0].message, problems, headers: sheet.headers, detected: sheet.columnMap });
    if (!sheet.rows.length) throw new BadRequestException({ code: 'NO_ROWS', message: 'The file has a header but no product rows' });
    if (sheet.rows.length > MAX_ROWS) throw new BadRequestException({ code: 'TOO_MANY_ROWS', message: `At most ${MAX_ROWS} rows per file` });

    const checksum = sha256(Buffer.concat([input.file.buffer, Buffer.from(JSON.stringify(input.mapping ?? {}))]));
    const { job, replay } = await this.store.createJob({ source: IntakeSource.SUPPLIER, supplierId: input.supplierId, submittedBy: input.actorId, inputKind: 'FILE', checksum,
      fileName: input.file.originalname, mimeType: input.file.mimetype, sizeBytes: input.file.size,
      columnMap: { map: sheet.columnMap, headers: sheet.headers, headerRow: sheet.headerRow, ignored: sheet.ignored, ambiguous: sheet.ambiguous, sheet: sheet.sheetName } });
    if (!replay) await this.store.addRows(job.id, readSupplierRows(sheet));
    // A replay of a finished file changes nothing; an interrupted one only finishes its pending rows.
    if (!replay || job.status !== 'COMPLETED') {
      if (input.wait) await this.process(job.id);
      else this.start(job.id);
    }
    return { jobId: job.id, replay, ...(await this.summary(job.id)) };
  }

  start(jobId: string) {
    setImmediate(() => this.process(jobId).catch(error => this.logger.error(`Supplier intake ${jobId} failed: ${error instanceof Error ? error.stack : error}`)));
  }

  async summary(jobId: string, supplierId?: string) {
    const job = await this.store.getJob(jobId, supplierId ? { supplierId } : undefined);
    return { job, totals: await this.store.totals(jobId) };
  }

  /** Processes every pending row of one job. Safe to call again: settled rows are never revisited, and offer writes are idempotent per row. */
  async process(jobId: string) {
    if (this.running.has(jobId)) return;
    this.running.add(jobId);
    const started = Date.now();
    try {
      const job = await this.store.getJob(jobId);
      if (job.source !== IntakeSource.SUPPLIER || !job.supplierId) throw new ConflictException('Not a supplier intake job');
      await this.store.updateJob(jobId, { status: IntakeJobStatus.PROCESSING, startedAt: new Date() });

      // Batch snapshot, once: catalog identity, the supplier's codes, learned wording.
      const snapshotStarted = Date.now();
      const [snapshot, codes, learned] = await Promise.all([
        this.snapshots.identitySnapshot(), this.offers.codeAliases(job.supplierId), this.store.aliasesFor([job.supplierId, 'GLOBAL']),
      ]);
      const index = new CandidateIndex(snapshot, codes, learned.map);
      const gate = new ScopeGate(snapshot);
      const snapshotMs = Date.now() - snapshotStarted;
      await this.store.updateJob(jobId, { snapshot: { takenAt: snapshot.takenAt, policyVersion: snapshot.policyVersion, catalogSkus: index.size, brands: snapshot.brands.length,
        supplierCodes: codes.size, learnedAliases: learned.count, ruleVersion: MATCH_RULE_VERSION } });

      const rows = await this.store.pendingRows(jobId);
      const counters = { matchMs: 0, writeMs: 0, gateSkips: 0, offerWrites: 0 };
      let batch: RowSettlement[] = [];
      for (const row of rows) {
        const t0 = Date.now();
        const settlement = await this.decide(row, job.supplierId, index, gate, counters);
        settlement.processingMs = Date.now() - t0;
        batch.push(settlement);
        if (batch.length >= SETTLE_BATCH) { await this.store.settle(batch); batch = []; }
      }
      if (batch.length) await this.store.settle(batch);

      const totals = await this.store.totals(jobId);
      const durationMs = Date.now() - started;
      await this.store.updateJob(jobId, { status: IntakeJobStatus.COMPLETED, completedAt: new Date(), totals,
        metrics: { durationMs, snapshotMs, matchMs: counters.matchMs, offerWriteMs: counters.writeMs, rowsProcessed: rows.length,
          rowsPerSecond: rows.length ? Math.round((rows.length / Math.max(durationMs, 1)) * 1000 * 10) / 10 : 0, gateSkips: counters.gateSkips, offerWrites: counters.offerWrites,
          paidCalls: 0 } });
    } catch (error) {
      await this.store.updateJob(jobId, { status: IntakeJobStatus.FAILED, lastError: error instanceof Error ? error.message.slice(0, 500) : String(error) }).catch(() => undefined);
      throw error;
    } finally {
      this.running.delete(jobId);
    }
  }

  private identity(row: IntakeRowRecord): RowIdentity {
    const parsed = (row.parsed ?? {}) as { measures?: Array<{ size: number; unit: string }>; packCount?: number | null; brandCell?: string | null };
    const measures = parsed.measures ?? [];
    return { name: `${parsed.brandCell ?? ''} ${row.rawName}`.trim(), barcode: row.barcode, code: row.supplierCode, measure: measures.length === 1 ? measures[0] : null,
      measureConflict: measures.length > 1, packCount: parsed.packCount ?? null, fingerprint: row.fingerprint ?? '' };
  }

  private async decide(row: IntakeRowRecord, supplierId: string, index: CandidateIndex, gate: ScopeGate, counters: { matchMs: number; writeMs: number; gateSkips: number; offerWrites: number }): Promise<RowSettlement> {
    const identity = this.identity(row);
    const t0 = Date.now();
    const scope = gate.decide({ name: identity.name, catalogBrands: index.brands.detect(identity.name), hardIdentifier: index.hardHits(identity).length > 0 });
    if (scope.decision === 'SKIP') {
      counters.gateSkips++;
      counters.matchMs += Date.now() - t0;
      return { id: row.id, outcome: IntakeRowOutcome.SKIPPED, reasonCode: scope.reasonCode, reason: scope.detail, evidence: { gate: scope } };
    }
    const verdict = index.match(identity);
    counters.matchMs += Date.now() - t0;
    const candidates = verdict.candidates.slice(0, 5);
    if (verdict.kind !== 'MATCH') {
      const outcome = verdict.kind === 'NONE' ? IntakeRowOutcome.UNMATCHED : IntakeRowOutcome.CRITICAL;
      return { id: row.id, outcome, reasonCode: verdict.reasonCode, reason: verdict.detail, candidates, evidence: { gate: scope.reasonCode, brands: verdict.brandHits } };
    }
    return this.applyOffer(row, supplierId, verdict, candidates, counters);
  }

  private async applyOffer(row: IntakeRowRecord, supplierId: string, verdict: Extract<MatchVerdict, { kind: 'MATCH' }>, candidates: unknown,
    counters: { writeMs: number; offerWrites: number }, actor?: { basis: string }): Promise<RowSettlement> {
    const t1 = Date.now();
    const applied = await this.offers.applyFromIntake({ supplierId, skuId: verdict.skuId, purchasePrice: Number(row.purchasePrice), consumerPrice: row.consumerPrice !== null ? Number(row.consumerPrice) : null,
      currency: row.currency ?? 'EGP', quantity: row.quantity, supplierCode: row.supplierCode, sourceRef: row.id });
    counters.writeMs += Date.now() - t1;
    counters.offerWrites++;
    const basis = actor?.basis ?? verdict.basis;
    // Verified wording becomes knowledge for the next file; wording already learned is only confirmed.
    const learned = row.fingerprint ? await this.store.learnAlias({ fingerprint: row.fingerprint, scopeKey: supplierId, skuId: verdict.skuId, basis: basis.slice(0, 20), sampleText: row.rawName }) : 'NONE';
    const updated = applied.result === 'CREATED' || applied.result === 'CHANGED';
    return { id: row.id, outcome: updated ? IntakeRowOutcome.UPDATED : IntakeRowOutcome.MATCHED, reasonCode: `${applied.result}:${basis}`.slice(0, 80), matchedSkuId: verdict.skuId,
      candidates, evidence: { basis, score: verdict.score, brands: verdict.brandHits, offer: { id: applied.offerId, result: applied.result, before: applied.before, after: applied.after, codeAlias: applied.codeAlias }, learned } };
  }

  /**
   * An Admin settles a CRITICAL row: link it to the SKU they chose (the offer is written and the wording learned), or mark it unmatched. Nothing else changes.
   */
  async resolveCritical(rowId: string, decision: { action: 'LINK'; skuId: string } | { action: 'DISMISS'; note: string }, actorId: string) {
    const row = await this.store.getRow(rowId);
    if (row.job.source !== IntakeSource.SUPPLIER || !row.job.supplierId) throw new BadRequestException('Not a supplier row');
    if (row.outcome !== IntakeRowOutcome.CRITICAL) throw new ConflictException({ code: 'ROW_NOT_CRITICAL', message: 'Only a critical row is settled here', outcome: row.outcome });
    if (decision.action === 'DISMISS') {
      await this.store.settle([{ id: row.id, outcome: IntakeRowOutcome.UNMATCHED, reasonCode: 'ADMIN_DISMISSED', reason: decision.note, candidates: row.candidates,
        evidence: { ...(row.evidence as object ?? {}), resolvedBy: actorId } }]);
    } else {
      const snapshot = await this.snapshots.identitySnapshot();
      if (!snapshot.skus.some(sku => sku.skuId === decision.skuId)) throw new BadRequestException('That SKU is not an active canonical SKU');
      const settlement = await this.applyOffer(row, row.job.supplierId, { kind: 'MATCH', skuId: decision.skuId, basis: 'ADMIN_RESOLVED', score: 1, brandHits: [], candidates: [] },
        row.candidates, { writeMs: 0, offerWrites: 0 }, { basis: 'ADMIN_RESOLVED' });
      await this.store.settle([{ ...settlement, evidence: { ...(settlement.evidence as object), resolvedBy: actorId } }]);
    }
    await this.store.updateJob(row.jobId, { totals: await this.store.totals(row.jobId) });
    return this.store.getRow(rowId);
  }
}

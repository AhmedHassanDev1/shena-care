import { Injectable, NotFoundException } from '@nestjs/common';
import { IntakeJobStatus, IntakeRowOutcome, IntakeSource, Prisma } from '@prisma/client';
import { PrismaService } from '../../../platform/database/prisma.service';

export interface NewIntakeRow {
  rowNumber: number;
  rawName: string;
  sourceCells: Record<string, string>;
  normalizedName?: string | null;
  fingerprint?: string | null;
  supplierCode?: string | null;
  barcode?: string | null;
  purchasePrice?: number | null;
  consumerPrice?: number | null;
  currency?: string | null;
  quantity?: number | null;
  parsed?: Record<string, unknown> | null;
  /** Rows the reader already settles (INVALID, duplicates) are stored settled. */
  outcome?: IntakeRowOutcome;
  reasonCode?: string | null;
  reason?: string | null;
}

export interface RowSettlement {
  id: string;
  outcome: IntakeRowOutcome;
  reasonCode: string | null;
  reason?: string | null;
  matchedSkuId?: string | null;
  candidates?: unknown;
  evidence?: unknown;
  readiness?: unknown;
  processingMs?: number | null;
  cost?: unknown;
  stage?: string | null;
  attempts?: number;
}

const json = (value: unknown) => (value === undefined ? undefined : value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue));
const CHUNK = 200;
export const ADMIN_ROW_LEASE_MS = 10 * 60_000;

/** Owner of ingestion.intake_*: jobs, rows, learned identity aliases. Writes only its own tables. */
@Injectable()
export class IntakeStoreService {
  constructor(private readonly prisma: PrismaService) {}

  /** The same submission (same bytes or names, same submitter) resolves to the job it already created. */
  async createJob(input: { source: IntakeSource; supplierId: string | null; submittedBy: string; inputKind: 'SINGLE' | 'BULK' | 'FILE'; checksum: string;
    fileName?: string | null; mimeType?: string | null; sizeBytes?: number | null; columnMap?: unknown }): Promise<{ job: { id: string; status: IntakeJobStatus }; replay: boolean }> {
    const existing = await this.prisma.intakeJob.findUnique({ where: { source_sourceChecksum_submittedBy: { source: input.source, sourceChecksum: input.checksum, submittedBy: input.submittedBy } },
      select: { id: true, status: true } });
    if (existing && existing.status !== IntakeJobStatus.FAILED) return { job: existing, replay: true };
    if (existing) await this.prisma.intakeJob.delete({ where: { id: existing.id } });
    const job = await this.prisma.intakeJob.create({ data: { source: input.source, supplierId: input.supplierId, submittedBy: input.submittedBy, inputKind: input.inputKind,
      sourceChecksum: input.checksum, sourceFileName: input.fileName ?? null, sourceMimeType: input.mimeType ?? null, sourceSizeBytes: input.sizeBytes ?? null,
      columnMap: json(input.columnMap ?? null) }, select: { id: true, status: true } });
    return { job, replay: false };
  }

  async addRows(jobId: string, rows: NewIntakeRow[]) {
    for (let i = 0; i < rows.length; i += CHUNK) {
      await this.prisma.intakeRow.createMany({ data: rows.slice(i, i + CHUNK).map(row => ({
        jobId, rowNumber: row.rowNumber, rawName: row.rawName.slice(0, 1000), sourceCells: row.sourceCells as Prisma.InputJsonValue, normalizedName: row.normalizedName ?? null,
        fingerprint: row.fingerprint ?? null, supplierCode: row.supplierCode ?? null, barcode: row.barcode ?? null,
        purchasePrice: row.purchasePrice ?? null, consumerPrice: row.consumerPrice ?? null, currency: row.currency ?? null, quantity: row.quantity ?? null,
        parsed: json(row.parsed ?? null), outcome: row.outcome ?? IntakeRowOutcome.PENDING, reasonCode: row.reasonCode ?? null, reason: row.reason ?? null,
      })), skipDuplicates: true });
    }
  }

  async updateJob(jobId: string, data: { status?: IntakeJobStatus; snapshot?: unknown; metrics?: unknown; totals?: unknown; lastError?: string | null; startedAt?: Date; completedAt?: Date | null }) {
    return this.prisma.intakeJob.update({ where: { id: jobId }, data: { ...(data.status && { status: data.status }), snapshot: json(data.snapshot), metrics: json(data.metrics),
      totals: json(data.totals), ...(data.lastError !== undefined && { lastError: data.lastError }), ...(data.startedAt && { startedAt: data.startedAt }),
      ...(data.completedAt !== undefined && { completedAt: data.completedAt }) } });
  }

  async pendingRows(jobId: string) {
    return this.prisma.intakeRow.findMany({ where: { jobId, outcome: IntakeRowOutcome.PENDING }, orderBy: { rowNumber: 'asc' } });
  }

  async settle(rows: RowSettlement[]) {
    for (let i = 0; i < rows.length; i += 50) {
      await this.prisma.$transaction(rows.slice(i, i + 50).map(row => this.prisma.intakeRow.update({ where: { id: row.id }, data: {
        outcome: row.outcome, reasonCode: row.reasonCode, reason: row.reason ?? null, matchedSkuId: row.matchedSkuId ?? null,
        candidates: json(row.candidates), evidence: json(row.evidence), readiness: json(row.readiness), processingMs: row.processingMs ?? null, cost: json(row.cost),
        stage: row.stage ?? null, leaseUntil: null, nextAttemptAt: null, lastError: null,
        ...(row.attempts !== undefined && { attempts: row.attempts }),
      } })));
    }
  }

  /** Progress for a long-running row: its stage, evidence so far and cost, without settling it. */
  async progress(rowId: string, data: { stage?: string; evidence?: unknown; cost?: unknown; matchedSkuId?: string | null; lastError?: string | null; attempts?: number; nextAttemptAt?: Date | null }) {
    return this.prisma.intakeRow.update({ where: { id: rowId }, data: { ...(data.stage && { stage: data.stage }), evidence: json(data.evidence), cost: json(data.cost),
      ...(data.matchedSkuId !== undefined && { matchedSkuId: data.matchedSkuId }), ...(data.lastError !== undefined && { lastError: data.lastError?.slice(0, 1000) ?? null }),
      ...(data.attempts !== undefined && { attempts: data.attempts }), ...(data.nextAttemptAt !== undefined && { nextAttemptAt: data.nextAttemptAt, leaseUntil: null }) } });
  }

  /** Claims Admin rows that are due: pending, not leased by another worker, retry time reached. */
  async leaseAdminRows(limit: number, jobId?: string) {
    const now = new Date();
    const due = await this.prisma.intakeRow.findMany({
      where: { outcome: IntakeRowOutcome.PENDING, job: { source: IntakeSource.ADMIN, ...(jobId && { id: jobId }) },
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }], AND: [{ OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] }] },
      orderBy: [{ createdAt: 'asc' }, { rowNumber: 'asc' }], take: limit, select: { id: true },
    });
    const leased: string[] = [];
    for (const row of due) {
      const claimed = await this.prisma.intakeRow.updateMany({ where: { id: row.id, outcome: IntakeRowOutcome.PENDING, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
        data: { leaseUntil: new Date(now.getTime() + ADMIN_ROW_LEASE_MS) } });
      if (claimed.count) leased.push(row.id);
    }
    return this.prisma.intakeRow.findMany({ where: { id: { in: leased } }, include: { job: { select: { id: true, submittedBy: true } } }, orderBy: { rowNumber: 'asc' } });
  }

  async jobsWithPendingRows(source: IntakeSource) {
    return this.prisma.intakeJob.findMany({ where: { source, status: { in: [IntakeJobStatus.RECEIVED, IntakeJobStatus.PROCESSING] } }, select: { id: true } });
  }

  async totals(jobId: string) {
    const groups = await this.prisma.intakeRow.groupBy({ by: ['outcome'], where: { jobId }, _count: { _all: true } });
    const totals: Record<string, number> = { total: 0 };
    for (const group of groups) { totals[group.outcome] = group._count._all; totals.total += group._count._all; }
    return totals;
  }

  async getJob(jobId: string, scope?: { supplierId?: string }) {
    const job = await this.prisma.intakeJob.findUnique({ where: { id: jobId } });
    if (!job || (scope?.supplierId && job.supplierId !== scope.supplierId)) throw new NotFoundException('Intake job not found');
    return job;
  }

  async listJobs(filter: { source?: IntakeSource; supplierId?: string; take?: number }) {
    return this.prisma.intakeJob.findMany({ where: { ...(filter.source && { source: filter.source }), ...(filter.supplierId && { supplierId: filter.supplierId }) },
      orderBy: { createdAt: 'desc' }, take: Math.min(filter.take ?? 30, 100) });
  }

  async listRows(jobId: string, filter: { outcome?: IntakeRowOutcome; skip?: number; take?: number }) {
    const where = { jobId, ...(filter.outcome && { outcome: filter.outcome }) };
    const [items, total] = await Promise.all([
      this.prisma.intakeRow.findMany({ where, orderBy: { rowNumber: 'asc' }, skip: filter.skip ?? 0, take: Math.min(filter.take ?? 100, 500) }),
      this.prisma.intakeRow.count({ where }),
    ]);
    return { items, total };
  }

  async getRow(rowId: string) {
    const row = await this.prisma.intakeRow.findUnique({ where: { id: rowId }, include: { job: true } });
    if (!row) throw new NotFoundException('Intake row not found');
    return row;
  }

  /** Rows sent back to work (Admin retry, critical resolution): pending again, attempts reset. */
  async reopen(rowIds: string[]) {
    return this.prisma.intakeRow.updateMany({ where: { id: { in: rowIds } }, data: { outcome: IntakeRowOutcome.PENDING, reasonCode: null, reason: null, attempts: 0, nextAttemptAt: null, leaseUntil: null, lastError: null } });
  }

  /** Rows a person must settle: supplier CRITICAL identity conflicts and Admin names left UNRESOLVED, newest first. */
  async reviewQueue(take: number) {
    return this.prisma.intakeRow.findMany({ where: { outcome: { in: [IntakeRowOutcome.CRITICAL, IntakeRowOutcome.UNRESOLVED] } }, orderBy: { updatedAt: 'desc' }, take,
      include: { job: { select: { id: true, source: true, supplierId: true, sourceFileName: true, createdAt: true } } } });
  }

  /** One row back to work with corrected input (a page URL, a corrected name). */
  async reopenWith(rowId: string, input: { parsed: Record<string, unknown>; rawName?: string }) {
    return this.prisma.intakeRow.update({ where: { id: rowId }, data: { parsed: input.parsed as Prisma.InputJsonValue, ...(input.rawName && { rawName: input.rawName, normalizedName: input.rawName }),
      outcome: IntakeRowOutcome.PENDING, reasonCode: null, reason: null, attempts: 0, nextAttemptAt: null, leaseUntil: null, lastError: null, matchedSkuId: null, stage: null } });
  }

  // ─── Learned identity aliases ──────────────────────────────────────────────

  async aliasesFor(scopeKeys: string[]) {
    const aliases = await this.prisma.intakeIdentityAlias.findMany({ where: { scopeKey: { in: scopeKeys }, retiredAt: null }, select: { fingerprint: true, scopeKey: true, skuId: true } });
    // A supplier's own wording wins over global wording for the same fingerprint.
    const map = new Map<string, string>();
    for (const alias of aliases.sort((a, b) => Number(a.scopeKey !== 'GLOBAL') - Number(b.scopeKey !== 'GLOBAL'))) map.set(alias.fingerprint, alias.skuId);
    return { map, count: aliases.length };
  }

  /** Records verified wording. A fingerprint already tied to another SKU is retired, never silently re-pointed. */
  async learnAlias(input: { fingerprint: string; scopeKey: string; skuId: string; basis: string; sampleText: string }) {
    const existing = await this.prisma.intakeIdentityAlias.findUnique({ where: { fingerprint_scopeKey: { fingerprint: input.fingerprint, scopeKey: input.scopeKey } } });
    if (!existing) {
      await this.prisma.intakeIdentityAlias.create({ data: { ...input, sampleText: input.sampleText.slice(0, 300) } }).catch(() => undefined);
      return 'CREATED';
    }
    if (existing.retiredAt) return 'RETIRED';
    if (existing.skuId === input.skuId) {
      await this.prisma.intakeIdentityAlias.update({ where: { id: existing.id }, data: { confirmations: { increment: 1 }, lastSeenAt: new Date() } });
      return 'CONFIRMED';
    }
    await this.prisma.intakeIdentityAlias.update({ where: { id: existing.id }, data: { retiredAt: new Date() } });
    return 'CONTRADICTED';
  }
}

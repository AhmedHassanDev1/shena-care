import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CatalogException, CatalogExceptionStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import { DECISION_RULE_VERSION, HoldReason } from './catalog-decision-engine';

export type DecisionSubject = 'IMPORT_ROW' | 'SKU' | 'FACT' | 'MEDIA' | 'EXCEPTION' | 'BRAND';

export interface DecisionEntry {
  subjectType: DecisionSubject;
  subjectId: string;
  skuId?: string | null;
  decision: string;
  reasonCode: string;
  evidence?: Record<string, unknown>;
  actorType: 'SYSTEM' | 'ADMIN';
  actorId?: string | null;
  ruleVersion?: string;
}

export interface OpenExceptionInput {
  subjectType: DecisionSubject;
  subjectId: string;
  skuId?: string | null;
  importRowId?: string | null;
  hold: HoldReason;
  evidence?: Record<string, unknown>;
}

/**
 * The audit trail of every pipeline decision and the one queue of genuinely critical exceptions. Append-only decisions; one exception per subject, field and reason,
 * refreshed (never duplicated) when the pipeline meets the same problem again.
 */
@Injectable()
export class CatalogDecisionLogService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: DecisionEntry, db: Prisma.TransactionClient = this.prisma): Promise<void> {
    await db.catalogDecisionRecord.create({ data: {
      subjectType: entry.subjectType, subjectId: entry.subjectId, skuId: entry.skuId ?? null, decision: entry.decision, reasonCode: entry.reasonCode.slice(0, 80),
      ruleVersion: entry.ruleVersion ?? DECISION_RULE_VERSION, evidence: (entry.evidence ?? {}) as Prisma.InputJsonValue, actorType: entry.actorType, actorId: entry.actorId ?? null,
    } });
  }

  private key(input: OpenExceptionInput) {
    return `${input.subjectType}:${input.subjectId}:${input.hold.field ?? '*'}:${input.hold.reasonCode}`.slice(0, 240);
  }

  /** Opens (or re-opens and refreshes) the exception for this subject and reason. A resolved one comes back only if the problem comes back. */
  async open(input: OpenExceptionInput): Promise<CatalogException> {
    const data = {
      skuId: input.skuId ?? null, importRowId: input.importRowId ?? null, subjectType: input.subjectType, subjectId: input.subjectId, field: input.hold.field ?? null,
      reasonCode: input.hold.reasonCode, severity: input.hold.severity, summary: input.hold.summary, evidence: (input.evidence ?? {}) as Prisma.InputJsonValue,
      recommended: input.hold.recommended ? (input.hold.recommended as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
    };
    return this.prisma.catalogException.upsert({
      where: { dedupeKey: this.key(input) },
      create: { dedupeKey: this.key(input), ...data },
      update: { ...data, status: CatalogExceptionStatus.OPEN, resolution: null, resolutionNote: null, resolvedBy: null, resolvedAt: null },
    });
  }

  /** Closes every open exception of a subject that the pipeline itself has now settled (e.g. a retry succeeded). */
  async closeSettled(subjectType: DecisionSubject, subjectId: string, note: string): Promise<number> {
    const closed = await this.prisma.catalogException.updateMany({ where: { subjectType, subjectId, status: { in: [CatalogExceptionStatus.OPEN, CatalogExceptionStatus.RETRYING] } },
      data: { status: CatalogExceptionStatus.RESOLVED, resolution: 'AUTOMATIC', resolutionNote: note, resolvedAt: new Date() } });
    return closed.count;
  }

  async list(filter: { status?: CatalogExceptionStatus; skuId?: string; limit?: number } = {}) {
    const where = { ...(filter.status && { status: filter.status }), ...(filter.skuId && { skuId: filter.skuId }) };
    const [items, total] = await Promise.all([
      this.prisma.catalogException.findMany({ where, orderBy: [{ severity: 'asc' }, { createdAt: 'asc' }], take: Math.min(Math.max(filter.limit ?? 100, 1), 500) }),
      this.prisma.catalogException.count({ where }),
    ]);
    return { total, items };
  }

  async get(id: string): Promise<CatalogException> {
    const item = await this.prisma.catalogException.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Exception not found');
    return item;
  }

  async openForSku(skuId: string): Promise<CatalogException[]> {
    return this.prisma.catalogException.findMany({ where: { skuId, status: CatalogExceptionStatus.OPEN } });
  }

  async openForRow(importRowId: string): Promise<CatalogException[]> {
    return this.prisma.catalogException.findMany({ where: { importRowId, status: CatalogExceptionStatus.OPEN } });
  }

  /** Marks a person's decision on an exception. Concurrent decisions on the same exception: the first wins, the second is told it changed. */
  async settle(id: string, input: { status: CatalogExceptionStatus; resolution: string; note: string; actorId: string }): Promise<CatalogException> {
    const written = await this.prisma.catalogException.updateMany({
      where: { id, status: { in: [CatalogExceptionStatus.OPEN, CatalogExceptionStatus.RETRYING] } },
      data: { status: input.status, resolution: input.resolution, resolutionNote: input.note, resolvedBy: input.actorId, resolvedAt: new Date() },
    });
    if (!written.count) throw new ConflictException({ code: 'EXCEPTION_CHANGED', message: 'This exception was already settled; reload' });
    const item = await this.get(id);
    await this.record({ subjectType: 'EXCEPTION', subjectId: id, skuId: item.skuId, decision: input.status, reasonCode: `${input.resolution}:${item.reasonCode}`,
      evidence: { note: input.note }, actorType: 'ADMIN', actorId: input.actorId });
    return item;
  }

  async decisionsFor(subjectId: string) {
    return this.prisma.catalogDecisionRecord.findMany({ where: { OR: [{ subjectId }, { skuId: subjectId }] }, orderBy: { createdAt: 'asc' }, take: 200 });
  }

  /** Counts for the report and the Admin summary: what was decided automatically and what needs a person. */
  async summary(since?: Date) {
    const rows = await this.prisma.catalogDecisionRecord.groupBy({ by: ['subjectType', 'decision', 'actorType'], where: since ? { createdAt: { gte: since } } : {}, _count: { _all: true } });
    const open = await this.prisma.catalogException.groupBy({ by: ['severity'], where: { status: CatalogExceptionStatus.OPEN }, _count: { _all: true } });
    return { decisions: rows.map(row => ({ subjectType: row.subjectType, decision: row.decision, actorType: row.actorType, count: row._count._all })),
      openExceptions: Object.fromEntries(open.map(row => [row.severity, row._count._all])) };
  }
}

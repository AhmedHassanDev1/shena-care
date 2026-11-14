import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import type { EngineKnowledge } from '../recommendation/recommendation-engine';

/** A knowledge statement as a customer may see it: the words, how strong the evidence is, and where it comes from. */
export interface KnowledgeView {
  id: string
  topic: string
  subject: { type: string; key: string }
  concernSlug: string | null
  statement: string
  /** VERIFIED_FACT | EVIDENCE_SUPPORTED | INFERENCE */
  evidenceClass: string
  /** False until a qualified professional has reviewed the statement: it is then shown as general published guidance. */
  professionallyReviewed: boolean
  source: { title: string; url: string | null; type: string; retrievedAt: string }
}

const ROW = {
  id: true, key: true, subjectType: true, subjectKey: true, topic: true, concernSlug: true, careArea: true, strength: true, statementEn: true,
  statementAr: true, evidenceClass: true, reviewStatus: true, sourceTitle: true, sourceUrl: true, sourceType: true, retrievedAt: true, confidence: true,
} as const;

type Row = {
  id: string; key: string; subjectType: string; subjectKey: string; topic: string; concernSlug: string | null; careArea: string | null; strength: string | null
  statementEn: string; statementAr: string; evidenceClass: string; reviewStatus: string; sourceTitle: string; sourceUrl: string | null; sourceType: string
  retrievedAt: Date; confidence: number
};

/**
 * Read side of the care knowledge base. Only active statements that were not rejected and are not in conflict are ever
 * returned: a statement whose sources disagree is kept for the reviewers, not used to advise a customer.
 */
@Injectable()
export class KnowledgeService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly usable = { isActive: true, reviewStatus: { not: 'REJECTED' }, evidenceClass: { not: 'CONFLICT' } } as const;

  /** Everything the recommendation engine reasons with: concern relevance and precautions. Small, so it is read whole. */
  async forEngine(): Promise<EngineKnowledge[]> {
    return this.prisma.knowledgeEntry.findMany({
      where: { ...this.usable, topic: { in: ['CONCERN_RELEVANCE', 'PRECAUTION'] } }, select: ROW, orderBy: { key: 'asc' },
    });
  }

  async byIds(ids: string[]): Promise<Row[]> {
    if (!ids.length) return [];
    return this.prisma.knowledgeEntry.findMany({ where: { ...this.usable, id: { in: [...new Set(ids)] } }, select: ROW });
  }

  /** Statements about a concern: its overview, when to see a professional, what limits to expect. */
  async forConcerns(concernSlugs: string[], topics: string[] = ['OVERVIEW', 'ESCALATION', 'LIMITATION']): Promise<Row[]> {
    if (!concernSlugs.length) return [];
    return this.prisma.knowledgeEntry.findMany({
      where: { ...this.usable, concernSlug: { in: concernSlugs }, topic: { in: topics } }, select: ROW, orderBy: [{ topic: 'asc' }, { key: 'asc' }],
    });
  }

  /** What is known about ingredients (by slug or family) and product types: function, usage, precautions, limits. */
  async forSubjects(subjects: { ingredientSlugs?: string[]; familySlugs?: string[]; productTypes?: string[] }, topics = ['FUNCTION', 'USAGE', 'PRECAUTION', 'LIMITATION', 'COMPATIBILITY']): Promise<Row[]> {
    const or = [
      ...(subjects.ingredientSlugs?.length ? [{ subjectType: 'INGREDIENT', subjectKey: { in: subjects.ingredientSlugs } }] : []),
      ...(subjects.familySlugs?.length ? [{ subjectType: 'INGREDIENT_FAMILY', subjectKey: { in: subjects.familySlugs } }] : []),
      ...(subjects.productTypes?.length ? [{ subjectType: 'PRODUCT_TYPE', subjectKey: { in: subjects.productTypes } }] : []),
    ];
    if (!or.length) return [];
    return this.prisma.knowledgeEntry.findMany({ where: { ...this.usable, topic: { in: topics }, OR: or }, select: ROW, orderBy: [{ topic: 'asc' }, { key: 'asc' }] });
  }

  /** Concerns that have at least one sourced statement, with their overview: the public face of the knowledge base. */
  async concernGuide(concernSlug: string, locale: 'ar' | 'en') {
    const rows = await this.prisma.knowledgeEntry.findMany({
      where: { ...this.usable, concernSlug }, select: ROW, orderBy: [{ topic: 'asc' }, { strength: 'asc' }, { key: 'asc' }],
    });
    const view = (row: Row) => toView(row, locale);
    return {
      concernSlug,
      overview: rows.filter(r => r.topic === 'OVERVIEW').map(view)[0] ?? null,
      whenToSeeAProfessional: rows.filter(r => r.topic === 'ESCALATION').map(view),
      goodToKnow: rows.filter(r => r.topic === 'LIMITATION').map(view),
      ingredients: rows.filter(r => r.topic === 'CONCERN_RELEVANCE' && r.subjectType !== 'PRODUCT_TYPE').map(r => ({ ...view(r), strength: r.strength })),
      productTypes: rows.filter(r => r.topic === 'CONCERN_RELEVANCE' && r.subjectType === 'PRODUCT_TYPE').map(r => ({ ...view(r), strength: r.strength })),
    };
  }

  async ingredientGuide(slugOrFamily: string, locale: 'ar' | 'en') {
    const rows = await this.prisma.knowledgeEntry.findMany({
      where: { ...this.usable, subjectType: { in: ['INGREDIENT', 'INGREDIENT_FAMILY'] }, subjectKey: slugOrFamily }, select: ROW, orderBy: [{ topic: 'asc' }, { key: 'asc' }],
    });
    return { subject: slugOrFamily, statements: rows.map(row => ({ ...toView(row, locale), strength: row.strength })) };
  }

  /** Operational summary for staff: how much of the knowledge base is reviewed, by evidence class and source type. */
  async coverage() {
    const [byReview, byEvidence, bySource, total] = await Promise.all([
      this.prisma.knowledgeEntry.groupBy({ by: ['reviewStatus'], _count: true, where: { isActive: true } }),
      this.prisma.knowledgeEntry.groupBy({ by: ['evidenceClass'], _count: true, where: { isActive: true } }),
      this.prisma.knowledgeEntry.groupBy({ by: ['sourceType'], _count: true, where: { isActive: true } }),
      this.prisma.knowledgeEntry.count({ where: { isActive: true } }),
    ]);
    const fold = (rows: Array<Record<string, unknown> & { _count: number }>, key: string) => Object.fromEntries(rows.map(row => [String(row[key]), row._count]));
    return { total, byReviewStatus: fold(byReview, 'reviewStatus'), byEvidenceClass: fold(byEvidence, 'evidenceClass'), bySourceType: fold(bySource, 'sourceType') };
  }
}

export function toView(row: Row, locale: 'ar' | 'en'): KnowledgeView {
  return {
    id: row.id, topic: row.topic, subject: { type: row.subjectType, key: row.subjectKey }, concernSlug: row.concernSlug,
    statement: locale === 'ar' ? row.statementAr : row.statementEn, evidenceClass: row.evidenceClass,
    professionallyReviewed: row.reviewStatus === 'PROFESSIONALLY_REVIEWED',
    source: { title: row.sourceTitle, url: row.sourceUrl, type: row.sourceType, retrievedAt: row.retrievedAt.toISOString() },
  };
}

export type KnowledgeRow = Row;

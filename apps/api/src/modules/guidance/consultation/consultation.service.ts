import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { GuidanceMessageRole, GuidanceSessionStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import {
  AiClient, AiClientError, AiErrorKind, ConsultCandidate, ConsultContext, ConsultIntent, ConsultKnowledgeItem, ConsultPageContext,
  ConsultProviderMetadata, ConsultRespondResult, ConsultTurn, ConsultUnderstandResult,
} from '../../../platform/ai';
import { CatalogService, IngredientService, PRODUCT_TYPES } from '../../catalog/public';
import { CareProfileService, CareService, CompatibilityIssue, RoutineCompatibilityService } from '../../care/public';
import { KnowledgeRow, KnowledgeService, KnowledgeView, toView } from '../knowledge/knowledge.service';
import { RecommendationInput, RecommendationRun, RecommendationService, RecommendedItem } from '../recommendation/recommendation.service';
import {
  EMPTY_CONTEXT, Escalation, FALLBACK_TEXT, Slot, decideEscalation, fallbackQuestion, fallbackUnderstanding, mergeContext, readContext,
  routineBlockedReason, slotsFor,
} from './consultation-rules';

export const CONSULT_PAYLOAD_VERSION = 1;

/** The customer went away mid-turn; nothing more is computed or stored for it. */
export class TurnAbortedError extends Error {
  constructor() { super('The consultation turn was cancelled'); this.name = 'TurnAbortedError'; }
}

/**
 * What a streaming caller gets told while a turn runs. `begin` is called once the request has been accepted (after
 * validation, before any model work), so errors raised earlier are still ordinary HTTP errors.
 */
export interface TurnStream {
  signal: AbortSignal
  begin(): void
  status(stage: 'understanding' | 'searching' | 'writing'): void
  delta(text: string): void
  reset(): void
}
const HISTORY_TURNS = 14;
const MAX_MESSAGE_LENGTH = 1500;

/** One routine step; `alternatives` are the engine's next picks of the same product type, offered as swaps. */
export interface ConsultRoutineStep { slot: Slot; why: string; howToUse: string | null; item: RecommendedItem; alternatives: RecommendedItem[] }
export interface ConsultPayload {
  version: number
  /** AI = worded by the model from grounded data. FALLBACK = the model was unavailable; deterministic engine output only. */
  source: 'AI' | 'FALLBACK'
  intent: ConsultIntent
  language: 'ar' | 'en'
  recommendations: Array<RecommendedItem & { why: string }>
  routine: { title: string; careArea: 'skin' | 'hair'; steps: ConsultRoutineStep[]; issues: CompatibilityIssue[]; canSave: boolean } | null
  /** Why no routine was built although one was asked for (e.g. pregnancy: a professional reviews it first). */
  routineNote: string | null
  citations: KnowledgeView[]
  followUpQuestion: string | null
  quickReplies: string[]
  escalation: Escalation | null
  excluded: Array<{ name: string; text: string }>
  /** What the consultation currently understands, so the customer can see and correct it. */
  understood: ConsultContext
}

interface PageContextInput { kind?: string; concernSlug?: string | null; categorySlug?: string | null; productSlug?: string | null }

const PAGE_KINDS = new Set(['home', 'corner', 'category', 'product', 'routine', 'cart', 'other']);
const dailyMessageLimit = () => Math.max(1, Number(process.env.AI_CONSULT_DAILY_MESSAGES ?? 40));
const dailyCostLimit = () => Math.max(0, Number(process.env.AI_CONSULT_DAILY_COST_USD ?? 0.6));
const money = (price: { amount: number; currency: string }) => `${price.amount} ${price.currency}`;

/**
 * The care consultation (GLO-301 / GLO-313). Each turn:
 *   1. the model reads the conversation into structured needs (or a keyword reader does, if the model is down);
 *   2. this service decides: escalate, ask, or retrieve — eligible products from the recommendation engine, sourced
 *      knowledge, a routine layout checked by the shared compatibility rules;
 *   3. the model words the answer from that grounding only, referring to products by opaque refs;
 *   4. refs are mapped back to real catalog products here, so a product the engine did not supply cannot appear.
 * Nothing is written to a cart or a routine: saving a routine is a separate, explicit customer action.
 */
@Injectable()
export class ConsultationService {
  private readonly logger = new Logger(ConsultationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiClient,
    private readonly catalog: CatalogService,
    private readonly ingredients: IngredientService,
    private readonly care: CareService,
    private readonly careProfiles: CareProfileService,
    private readonly compatibility: RoutineCompatibilityService,
    private readonly knowledge: KnowledgeService,
    private readonly recommendations: RecommendationService,
  ) {}

  // ── Sessions ────────────────────────────────────────────────────────────────────────────────────────────

  async createSession(customerId: string, page?: PageContextInput | null) {
    const pageContext = this.cleanPageContext(page);
    // Start from what the customer already told us in their care profile; nothing else about them is used.
    const snapshot = await this.careProfiles.consultationSnapshot(customerId);
    const context: ConsultContext = {
      ...EMPTY_CONTEXT, safety: { ...snapshot.safety }, skinType: snapshot.skinType, fragranceFree: snapshot.fragranceFree,
      concerns: [...snapshot.concernSlugs, ...(pageContext?.concernSlug ? [pageContext.concernSlug] : [])].filter((v, i, all) => all.indexOf(v) === i).slice(0, 6),
    };
    const session = await this.prisma.guidanceSession.create({
      data: { customerId, status: GuidanceSessionStatus.active, context: context as unknown as Prisma.InputJsonValue, pageContext: pageContext ? (pageContext as unknown as Prisma.InputJsonValue) : Prisma.JsonNull },
    });
    return { id: session.id, status: session.status, understood: context, pageContext, messages: [], createdAt: session.createdAt };
  }

  async getSession(customerId: string, sessionId: string) {
    const session = await this.owned(customerId, sessionId);
    const messages = await this.prisma.guidanceMessage.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' }, take: 200 });
    return {
      id: session.id, status: session.status, understood: readContext(session.context), pageContext: session.pageContext ?? null, createdAt: session.createdAt,
      messages: messages.filter(m => m.role !== GuidanceMessageRole.system).map(m => ({ id: m.id, role: m.role, content: m.content, payload: m.payload ?? null, createdAt: m.createdAt })),
    };
  }

  private async owned(customerId: string, sessionId: string) {
    const session = /^[0-9a-f-]{36}$/i.test(sessionId) ? await this.prisma.guidanceSession.findUnique({ where: { id: sessionId } }) : null;
    if (!session) throw new NotFoundException('Consultation not found');
    if (session.customerId !== customerId) throw new ForbiddenException('Cannot access another customer consultation');
    return session;
  }

  private cleanPageContext(page?: PageContextInput | null): (ConsultPageContext & { productSlug?: string | null }) | null {
    if (!page || typeof page !== 'object') return null;
    const slug = (value: unknown) => (typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/.test(value) ? value : null);
    const kind = typeof page.kind === 'string' && PAGE_KINDS.has(page.kind) ? (page.kind as ConsultPageContext['kind']) : 'other';
    return { kind, concernSlug: slug(page.concernSlug), categorySlug: slug(page.categorySlug), productSlug: slug(page.productSlug) };
  }

  // ── One turn ────────────────────────────────────────────────────────────────────────────────────────────

  async sendMessage(customerId: string, sessionId: string, content: string, requestedLocale?: 'ar' | 'en', stream?: TurnStream) {
    const text = (content ?? '').trim();
    if (!text) throw new BadRequestException('Message is empty');
    if (text.length > MAX_MESSAGE_LENGTH) throw new BadRequestException(`Message is longer than ${MAX_MESSAGE_LENGTH} characters`);
    const session = await this.owned(customerId, sessionId);
    await this.assertWithinLimits(customerId);

    await this.prisma.guidanceMessage.create({ data: { sessionId, role: GuidanceMessageRole.user, content: text } });
    return this.runTurn(customerId, session, text, requestedLocale, stream);
  }

  /** Answers the last customer message again when no answer was stored for it (e.g. the request was interrupted). */
  async retryLast(customerId: string, sessionId: string, stream?: TurnStream) {
    const session = await this.owned(customerId, sessionId);
    const last = await this.prisma.guidanceMessage.findFirst({ where: { sessionId, role: { not: GuidanceMessageRole.system } }, orderBy: { createdAt: 'desc' } });
    if (!last || last.role !== GuidanceMessageRole.user) throw new BadRequestException('There is no unanswered message to retry');
    await this.assertWithinLimits(customerId);
    return this.runTurn(customerId, session, last.content, undefined, stream);
  }

  private async runTurn(customerId: string, session: { id: string; context: Prisma.JsonValue; pageContext: Prisma.JsonValue }, text: string, requestedLocale?: 'ar' | 'en', stream?: TurnStream) {
    stream?.begin();
    const sessionId = session.id;
    const history = await this.prisma.guidanceMessage.findMany({ where: { sessionId, role: { not: GuidanceMessageRole.system } }, orderBy: { createdAt: 'desc' }, take: HISTORY_TURNS });
    const turns: ConsultTurn[] = history.reverse().map(m => ({ role: m.role === GuidanceMessageRole.user ? 'user' : 'assistant', content: m.content.slice(0, 2000) }));
    const recentClarifications = history.filter(m => m.role === GuidanceMessageRole.assistant).slice(-2)
      .filter(m => !!(m.payload as { followUpQuestion?: string | null; recommendations?: unknown[] } | null)?.followUpQuestion
        && !((m.payload as { recommendations?: unknown[] } | null)?.recommendations?.length)).length;

    const known = readContext(session.context);
    const storedPage = (session.pageContext ?? null) as (ConsultPageContext & { productSlug?: string | null }) | null;
    const concerns = (await this.care.getPublicConcerns()).map(c => ({ slug: c.slug, name: c.name, careArea: c.careArea as 'skin' | 'hair' }));
    const productTypes = PRODUCT_TYPES.map(rule => rule.key);
    const vocabulary = { concerns: new Set(concerns.map(c => c.slug)), productTypes: new Set(productTypes) };
    const focusProduct = storedPage?.productSlug ? await this.catalog.getCareProductFacts({ limit: 500 }).then(all => all.find(p => p.slug === storedPage.productSlug) ?? null) : null;
    const pageContext: ConsultPageContext | null = storedPage
      ? { kind: storedPage.kind, concernSlug: storedPage.concernSlug ?? null, categorySlug: storedPage.categorySlug ?? null, productName: focusProduct ? `${focusProduct.brandName} ${focusProduct.name}` : null }
      : null;

    // 1. Understand
    stream?.status('understanding');
    let aiDown = false;
    let understanding: Pick<ConsultUnderstandResult, 'intent' | 'language' | 'context' | 'mentionedProducts' | 'mentionedIngredients' | 'redFlags' | 'missing' | 'needsClarification'>;
    const fallbackLanguage: 'ar' | 'en' = /[؀-ۿ]/.test(text) ? 'ar' : requestedLocale ?? 'en';
    try {
      const result = await this.ai.consultUnderstand(
        { customerId, locale: requestedLocale ?? fallbackLanguage, messages: turns, knownContext: known, pageContext, concernVocabulary: concerns, productTypeVocabulary: productTypes }, sessionId);
      await this.recordUsage(customerId, sessionId, 'consult.understand', 'OK', result.providerMetadata);
      understanding = result;
    } catch (error) {
      aiDown = true;
      await this.recordUsage(customerId, sessionId, 'consult.understand', this.outcomeOf(error));
      const fallback = fallbackUnderstanding(text, known, concerns, productTypes);
      understanding = { ...fallback, language: fallbackLanguage, mentionedProducts: [], mentionedIngredients: [], redFlags: [] };
    }
    if (stream?.signal.aborted) throw new TurnAbortedError();
    const locale: 'ar' | 'en' = understanding.language === 'en' ? 'en' : 'ar';
    const context = mergeContext(known, understanding.context, vocabulary);
    const intent = understanding.intent;
    await this.prisma.guidanceSession.update({ where: { id: sessionId }, data: { context: context as unknown as Prisma.InputJsonValue } });

    // 2. Decide and retrieve
    stream?.status('searching');
    const escalation = decideEscalation(understanding.redFlags ?? [], locale);
    const conversational = intent === 'smalltalk' || intent === 'out_of_scope';
    const wantsRoutine = intent === 'build_routine';
    const routineNote = wantsRoutine ? routineBlockedReason(context, locale) : null;

    let run: RecommendationRun | null = null;
    if (!escalation.required && !conversational) {
      const input: RecommendationInput = {
        careArea: context.careArea, concerns: context.concerns, productTypes: wantsRoutine ? [] : context.productTypes, skinType: context.skinType,
        hairType: context.hairType, fragranceFree: context.fragranceFree, budgetMax: context.budgetMax, safety: context.safety, sensitivities: context.sensitivities,
        // A routine takes the best product per type and keeps the next ones as swap alternatives for the customer.
        limit: wantsRoutine ? 16 : 6, perTypeLimit: wantsRoutine ? 3 : undefined,
      };
      const askedAboutProduct = intent === 'product_question' ? await this.matchProducts([...(understanding.mentionedProducts ?? []), ...(focusProduct ? [focusProduct.name] : [])]) : [];
      if (askedAboutProduct.length) {
        // A question about a specific product is answered about that product, not turned into a different suggestion.
        run = await this.recommendations.run({ ...input, concerns: [], productTypes: [], onlyProductIds: askedAboutProduct, limit: 3, perTypeLimit: null }, locale);
      } else if (context.careArea || context.concerns.length || context.productTypes.length) {
        run = await this.recommendations.run(input, locale);
      }
    }
    let items = run?.result.items ?? [];
    const alternativesByType = new Map<string, RecommendedItem[]>();
    if (wantsRoutine) {
      // One product per type goes into the routine; the engine's next picks of the same type become its alternatives.
      const chosen: RecommendedItem[] = [];
      const seen = new Set<string>();
      for (const item of items) {
        const key = item.productType ?? item.productId;
        if (!seen.has(key)) { seen.add(key); chosen.push(item); continue; }
        alternativesByType.set(key, [...(alternativesByType.get(key) ?? []), item].slice(0, 2));
      }
      items = chosen.slice(0, 8);
    }
    const alternativesFor = (item: RecommendedItem) => alternativesByType.get(item.productType ?? item.productId) ?? [];

    const safetyHeld = (run?.result.needsSafetyAnswer.length ?? 0) > 0;
    const missing = [...new Set([...(understanding.missing ?? []), ...(safetyHeld ? ['pregnancy'] : [])])].slice(0, 5);
    // Ask before recommending only when recommending would be guesswork, and never three times in a row.
    const mustClarify = !escalation.required && !conversational && recentClarifications < 2
      && (understanding.needsClarification || (!run && intent !== 'ingredient_question' && intent !== 'general_care') || (safetyHeld && items.length === 0));

    // Routine layout from the engine's picks, checked by the shared compatibility rules.
    let routineDraft: Array<{ item: RecommendedItem; slot: Slot; alternatives: RecommendedItem[] }> = [];
    let routineIssues: CompatibilityIssue[] = [];
    if (wantsRoutine && !routineNote && !mustClarify && run && items.length >= 2) {
      for (const item of items) {
        const facts = run.facts.get(item.productId)!;
        const variant = facts.variants.find(v => v.skuId === item.skuId);
        const slots = slotsFor({ role: item.role, productType: item.productType, careArea: item.careArea, families: facts.ingredientFamilies,
          statedPeriod: variant?.routine && variant.routine.routinePeriod !== 'UNKNOWN' ? variant.routine.routinePeriod : null, periodEligibility: variant?.routine?.periodEligibility ?? null });
        for (const slot of slots) routineDraft.push({ item, slot, alternatives: alternativesFor(item) });
      }
      const check = await this.compatibility.check(routineDraft.map(step => ({ skuId: step.item.skuId, slot: step.slot })), context.safety);
      routineIssues = check.issues;
      const blocked = new Set(check.issues.filter(issue => issue.severity === 'BLOCK').flatMap(issue => issue.skuIds.slice(1).length ? issue.skuIds.slice(1) : issue.skuIds));
      // A blocking issue removes the product from the proposal (for "one of a family", the later ones); it stays named in the issues.
      routineDraft = routineDraft.filter(step => !blocked.has(step.item.skuId));
      const position = (slot: Slot, skuId: string) => check.order[slot].indexOf(skuId);
      const slotRank: Record<Slot, number> = { AM: 0, PM: 1, AS_NEEDED: 2 };
      routineDraft.sort((a, b) => slotRank[a.slot] - slotRank[b.slot] || position(a.slot, a.item.skuId) - position(b.slot, b.item.skuId));
    }

    // Knowledge the answer may cite: about the concerns, and about the candidates' types and actives.
    const knowledgeRows = await this.collectKnowledge(context, items, run, understanding.mentionedIngredients ?? [], escalation.required);
    const knowledgeRefs = knowledgeRows.map((row, index) => ({ ref: `K${index + 1}`, row }));
    const candidateRefs = items.map((item, index) => ({ ref: `P${index + 1}`, item }));
    const refOf = new Map(candidateRefs.map(c => [c.item.productId, c.ref]));

    const candidates: ConsultCandidate[] = escalation.required ? [] : candidateRefs.map(({ ref, item }) => ({
      ref, name: item.name, brand: item.brand, productType: item.productType, role: item.role, size: item.sizeLabel, price: money(item.price), period: item.usage.period,
      reasons: item.reasons.slice(0, 4).map(r => ({ code: r.code, text: r.text, basis: r.basis })),
      keyActives: item.keyActives.map(a => `${a.name}${a.concentration ? ` ${a.concentration}` : ''}${a.level === 'NAMED' ? ' (named on the product; ingredient list not verified)' : ''}`),
      usage: item.usage.text ? item.usage.text.slice(0, 400) : null,
      cautions: item.cautions.map(c => c.text).slice(0, 3), unknowns: item.unknowns.map(u => u.text).slice(0, 3),
    }));
    const knowledgeItems: ConsultKnowledgeItem[] = knowledgeRefs.map(({ ref, row }) => ({
      ref, subject: row.subjectKey, topic: row.topic, statement: locale === 'ar' ? row.statementAr : row.statementEn, evidenceClass: row.evidenceClass,
      source: row.sourceTitle, professionallyReviewed: row.reviewStatus === 'PROFESSIONALLY_REVIEWED',
    }));
    const excluded = (run?.result.excluded ?? []).filter(e => e.code !== 'UNAVAILABLE').slice(0, 6);

    // 3. Word the answer
    if (stream?.signal.aborted) throw new TurnAbortedError();
    stream?.status('writing');
    let reply: ConsultRespondResult | null = null;
    if (!aiDown) {
      try {
        const respondRequest = {
          customerId, locale, intent, messages: turns, context, pageContext, candidates,
          excluded: excluded.map(e => `${e.name}: ${e.text}`), knowledge: knowledgeItems,
          routineDraft: routineDraft.map(step => ({ ref: refOf.get(step.item.productId)!, slot: step.slot.toLowerCase() as 'am' | 'pm' | 'as_needed', role: step.item.role })),
          routineIssues: [...routineIssues.filter(i => i.severity !== 'INFO' || i.code === 'INGREDIENTS_UNVERIFIED').map(i => (locale === 'ar' ? i.textAr : i.textEn)), ...(routineNote ? [routineNote] : [])].slice(0, 8),
          escalation: escalation.reasons.map(r => r.code), mustClarify, missing,
        };
        // Streaming only changes how the text reaches the customer: the result is checked and stored exactly the same.
        reply = stream
          ? await this.ai.consultRespondStream(respondRequest, { onDelta: text => stream.delta(text), onReset: () => stream.reset(), signal: stream.signal }, sessionId)
          : await this.ai.consultRespond(respondRequest, sessionId);
        await this.recordUsage(customerId, sessionId, 'consult.respond', 'OK', reply.providerMetadata);
      } catch (error) {
        if (stream?.signal.aborted) throw new TurnAbortedError();
        await this.recordUsage(customerId, sessionId, 'consult.respond', this.outcomeOf(error));
        this.logger.warn(`consultation ${sessionId}: AI respond failed (${error instanceof AiClientError ? error.kind : 'unknown'}); using the deterministic answer`);
      }
    }

    // 4. Map refs back to real products; anything else is discarded
    const byRef = new Map(candidateRefs.map(c => [c.ref, c.item]));
    const knowledgeByRef = new Map(knowledgeRefs.map(k => [k.ref, k.row]));
    let payload: ConsultPayload;
    let message: string;
    if (reply) {
      const recommendations = escalation.required || mustClarify ? [] : reply.recommendations
        .map(rec => ({ item: byRef.get(rec.ref), why: rec.why })).filter((r): r is { item: RecommendedItem; why: string } => !!r.item)
        .map(r => ({ ...r.item, why: r.why.slice(0, 400) }));
      const steps: ConsultRoutineStep[] = reply.routine && routineDraft.length
        ? routineDraft.map(step => {
            const worded = reply!.routine!.steps.find(s => byRef.get(s.ref)?.productId === step.item.productId && s.slot.toUpperCase() === step.slot);
            // "How to use" is the manufacturer's own direction or nothing; the model's wording is shown only as the reason.
            return { slot: step.slot, why: (worded?.why ?? step.item.reasons[0]?.text ?? '').slice(0, 300), howToUse: step.item.usage.text, item: step.item, alternatives: step.alternatives };
          })
        : [];
      message = reply.message.trim();
      payload = {
        version: CONSULT_PAYLOAD_VERSION, source: 'AI', intent, language: locale, recommendations,
        routine: steps.length >= 2 ? { title: (reply.routine?.title ?? '').slice(0, 120) || (locale === 'ar' ? 'روتين مقترح' : 'Suggested routine'),
          careArea: context.careArea ?? 'skin', steps, issues: routineIssues, canSave: true } : null,
        routineNote,
        citations: reply.citations.map(ref => knowledgeByRef.get(ref)).filter((row): row is KnowledgeRow => !!row).map(row => toView(row, locale)),
        followUpQuestion: escalation.required ? null : reply.followUpQuestion?.trim() || null,
        quickReplies: escalation.required ? [] : (reply.quickReplies ?? []).map(q => q.trim()).filter(q => q && !/^[PK]\d{1,2}$/.test(q)).slice(0, 4),
        escalation: escalation.required ? escalation : null,
        excluded: excluded.map(e => ({ name: e.name, text: e.text })), understood: context,
      };
    } else {
      ({ payload, message } = this.deterministicAnswer({ intent, locale, context, items, escalation, mustClarify, missing, routineDraft, routineIssues, routineNote, excluded, knowledgeRows }));
    }

    const saved = await this.prisma.guidanceMessage.create({
      data: { sessionId, role: GuidanceMessageRole.assistant, content: message, payload: payload as unknown as Prisma.InputJsonValue },
    });
    return { id: saved.id, sessionId, role: saved.role, content: saved.content, payload, createdAt: saved.createdAt };
  }

  /** The answer when the model is unavailable: the engine's result in fixed words. Honest about being a fallback. */
  private deterministicAnswer(input: {
    intent: ConsultIntent; locale: 'ar' | 'en'; context: ConsultContext; items: RecommendedItem[]; escalation: Escalation; mustClarify: boolean; missing: string[]
    routineDraft: Array<{ item: RecommendedItem; slot: Slot; alternatives: RecommendedItem[] }>; routineIssues: CompatibilityIssue[]; routineNote: string | null
    excluded: Array<{ name: string; text: string }>; knowledgeRows: KnowledgeRow[]
  }): { payload: ConsultPayload; message: string } {
    const { locale, escalation, mustClarify, items } = input;
    const base: ConsultPayload = {
      version: CONSULT_PAYLOAD_VERSION, source: 'FALLBACK', intent: input.intent, language: locale, recommendations: [], routine: null, routineNote: input.routineNote,
      citations: [], followUpQuestion: null, quickReplies: [], escalation: escalation.required ? escalation : null,
      excluded: input.excluded.map(e => ({ name: e.name, text: e.text })), understood: input.context,
    };
    if (escalation.required) {
      const escalationKnowledge = input.knowledgeRows.filter(row => row.topic === 'ESCALATION').slice(0, 2);
      return { payload: { ...base, citations: escalationKnowledge.map(row => toView(row, locale)) },
        message: `${FALLBACK_TEXT.escalate[locale]} ${escalation.reasons.map(r => r.text).join(' ')}` };
    }
    if (mustClarify) {
      const { question, quickReplies } = fallbackQuestion(input.missing, locale);
      return { payload: { ...base, followUpQuestion: question, quickReplies }, message: FALLBACK_TEXT.clarify[locale] };
    }
    if (!items.length) return { payload: base, message: FALLBACK_TEXT.nothing[locale] };
    const steps = input.routineDraft.map(step => ({ slot: step.slot, why: step.item.reasons[0]?.text ?? '', howToUse: step.item.usage.text, item: step.item, alternatives: step.alternatives }));
    return {
      message: FALLBACK_TEXT.unavailable[locale],
      payload: {
        ...base,
        recommendations: items.slice(0, 4).map(item => ({ ...item, why: item.reasons[0]?.text ?? '' })),
        routine: steps.length >= 2 ? { title: locale === 'ar' ? 'روتين مقترح' : 'Suggested routine', careArea: input.context.careArea ?? 'skin', steps, issues: input.routineIssues, canSave: true } : null,
      },
    };
  }

  private async collectKnowledge(context: ConsultContext, items: RecommendedItem[], run: RecommendationRun | null, mentionedIngredients: string[], escalated: boolean): Promise<KnowledgeRow[]> {
    const picked = new Map<string, KnowledgeRow>();
    const add = (rows: KnowledgeRow[], max: number) => { for (const row of rows.slice(0, max)) if (picked.size < 12) picked.set(row.id, row); };
    add(await this.knowledge.forConcerns(context.concerns, escalated ? ['ESCALATION'] : ['ESCALATION', 'LIMITATION', 'OVERVIEW']), escalated ? 3 : 4);
    if (escalated) return [...picked.values()];

    const families = new Set<string>();
    const slugs = new Set<string>();
    for (const item of items) {
      const facts = run?.facts.get(item.productId);
      if (!facts) continue;
      for (const active of item.keyActives) {
        const row = facts.productIngredients?.find(pi => pi.ingredientName === active.name);
        if (row) { slugs.add(row.ingredientSlug); if (row.familySlug) families.add(row.familySlug); } else families.add(active.name.replace(/\s+/g, '-').toLowerCase());
      }
    }
    for (const term of mentionedIngredients.slice(0, 4)) {
      const match = await this.ingredients.findByInciOrAlias(term);
      if (match) { slugs.add(match.slug); if (match.familySlug) families.add(match.familySlug); } else families.add(term.trim().toLowerCase().replace(/\s+/g, '-'));
    }
    // Reasons and cautions the engine attached already carry knowledge ids: cite those first.
    const cited = (run?.engine.ranked ?? []).flatMap(r => [...r.reasons.map(x => x.knowledgeId), ...r.cautions.map(x => x.knowledgeId)]).filter((id): id is string => !!id);
    add(cited.map(id => run!.knowledge.get(id)).filter((row): row is KnowledgeRow => !!row), 5);
    add(await this.knowledge.forSubjects({ ingredientSlugs: [...slugs], familySlugs: [...families] }), 5);
    add(await this.knowledge.forSubjects({ productTypes: [...new Set(items.map(i => i.productType).filter((t): t is string => !!t))] }, ['USAGE']), 4);
    return [...picked.values()];
  }

  /** Products the customer named, matched against published catalog names. No match means no product: never a guess. */
  private async matchProducts(names: string[]): Promise<string[]> {
    const wanted = names.map(name => name.toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, ' ').trim()).filter(name => name.length >= 4);
    if (!wanted.length) return [];
    const products = await this.catalog.getCareProductFacts({ limit: 500 });
    const ids: string[] = [];
    for (const product of products) {
      const name = product.name.toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, ' ').trim();
      const full = `${product.brandName.toLowerCase()} ${name}`;
      if (wanted.some(w => w === name || w === full || (name.length >= 8 && w.includes(name)) || (w.length >= 8 && full.includes(w)))) ids.push(product.productId);
    }
    return ids.slice(0, 3);
  }

  // ── Limits and usage ────────────────────────────────────────────────────────────────────────────────────

  /** Per-customer daily ceilings on messages and model spend; the gateway keeps its own process-wide ones. */
  private async assertWithinLimits(customerId: string): Promise<void> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [messages, spend] = await Promise.all([
      this.prisma.guidanceMessage.count({ where: { role: GuidanceMessageRole.user, createdAt: { gte: since }, session: { customerId } } }),
      this.prisma.aiUsageEvent.aggregate({ where: { customerId, createdAt: { gte: since } }, _sum: { costUsd: true } }),
    ]);
    const cost = Number(spend._sum.costUsd ?? 0);
    if (messages >= dailyMessageLimit() || (dailyCostLimit() > 0 && cost >= dailyCostLimit())) {
      await this.recordUsage(customerId, null, 'consult.respond', 'LIMITED');
      throw new HttpException({ code: 'CONSULT_DAILY_LIMIT', message: 'Daily consultation limit reached. Browsing and shopping are not affected.', retryable: false }, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private outcomeOf(error: unknown): string {
    if (!(error instanceof AiClientError)) return 'INVALID';
    if (error.kind === AiErrorKind.TIMEOUT) return 'TIMEOUT';
    if (error.kind === AiErrorKind.LIMITED) return 'LIMITED';
    if (error.kind === AiErrorKind.UNAVAILABLE) return 'UNAVAILABLE';
    return 'INVALID';
  }

  private async recordUsage(customerId: string, sessionId: string | null, task: string, outcome: string, meta?: ConsultProviderMetadata): Promise<void> {
    try {
      await this.prisma.aiUsageEvent.create({ data: {
        customerId, sessionId, task, outcome, model: meta?.model?.slice(0, 80) ?? null, promptTokens: Math.max(0, Math.round(meta?.promptTokens ?? 0)),
        completionTokens: Math.max(0, Math.round(meta?.completionTokens ?? 0)), costUsd: Math.max(0, Number(meta?.costUsd ?? 0)),
        latencyMs: Math.max(0, Math.round(meta?.latencyMs ?? 0)), usedFallback: meta?.usedFallback === true,
      } });
    } catch (error) {
      // Accounting must never break a customer's answer.
      this.logger.warn(`could not record AI usage: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Staff view: calls, tokens, cost, failures and fallbacks over a window. */
  async usageSummary(days = 7) {
    const since = new Date(Date.now() - Math.min(Math.max(days, 1), 90) * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.aiUsageEvent.groupBy({
      by: ['task', 'outcome', 'model'], where: { createdAt: { gte: since } }, _count: true,
      _sum: { promptTokens: true, completionTokens: true, costUsd: true, latencyMs: true },
    });
    const customers = await this.prisma.aiUsageEvent.findMany({ where: { createdAt: { gte: since } }, distinct: ['customerId'], select: { customerId: true } });
    return {
      since: since.toISOString(), customers: customers.length,
      totalCostUsd: Number(rows.reduce((sum, row) => sum + Number(row._sum.costUsd ?? 0), 0).toFixed(6)),
      limits: { dailyMessagesPerCustomer: dailyMessageLimit(), dailyCostUsdPerCustomer: dailyCostLimit() },
      rows: rows.map(row => ({ task: row.task, outcome: row.outcome, model: row.model, calls: row._count, promptTokens: row._sum.promptTokens ?? 0,
        completionTokens: row._sum.completionTokens ?? 0, costUsd: Number(row._sum.costUsd ?? 0), avgLatencyMs: row._count ? Math.round((row._sum.latencyMs ?? 0) / row._count) : 0 })),
    };
  }
}

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'crypto';
const request = require('supertest');
import { MediaOriginType, MediaType } from '@prisma/client';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { AiClient, ConsultUnderstandRequest, ConsultUnderstandResult } from '../../src/platform/ai';
import { DeterministicAiClient } from '../fixtures/deterministic-ai';
import { ensureFixtureReviewer, FIXTURE_SOURCE_URL } from '../fixtures/sellable-sku';

function ean13(): string {
  const body = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10));
  const sum = body.reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 1 : 3), 0);
  return body.join('') + String((10 - (sum % 10)) % 10);
}

/**
 * Care intelligence end to end against a real database: knowledge base -> recommendation engine -> consultation ->
 * routine proposal -> explicit save. The model is scripted (DeterministicAiClient), so every assertion is about what
 * the API decides and what it lets through, not about a model's mood.
 */
describe('Care consultation, recommendations and knowledge (GLO-301 / GLO-302 / GLO-313)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const ai = new DeterministicAiClient();
  const tag = randomUUID().slice(0, 8);
  const concern = `acne-${tag}`;
  const products: Record<string, { productId: string; skuId: string; name: string }> = {};
  let token: string;
  let otherToken: string;
  let customerId: string;

  async function register(label: string) {
    const res = await request(app.getHttpServer()).post('/accounts/register')
      .send({ email: `consult-${label}-${tag}@example.com`, password: 'password123', name: `Consult ${label}` }).expect(201);
    const me = await request(app.getHttpServer()).get('/accounts/me').set('Authorization', `Bearer ${res.body.token}`).expect(200);
    return { token: res.body.token as string, id: me.body.id as string };
  }

  async function product(key: string, input: { name: string; type: string; department: 'skin-care' | 'hair-care'; role: string; rank: number; listed?: boolean; price?: number; skinTypes?: string[]; usage?: string | null; periodEligibility?: string }) {
    const reviewer = await ensureFixtureReviewer(prisma);
    const suffix = `${tag}-${key}`;
    const category = await prisma.category.upsert({ where: { slug: input.department }, update: {}, create: { slug: input.department, name: input.department } });
    const brand = await prisma.brand.create({ data: { name: `Brand ${suffix}`, slug: `brand-${suffix}` } });
    const row = await prisma.product.create({ data: {
      brandId: brand.id, categoryId: category.id, name: input.name, slug: `cc-${suffix}`, isPublished: true, productType: input.type,
      usage: input.usage === undefined ? 'Apply as the pack directs.' : input.usage, suitableSkinTypes: input.skinTypes ?? [],
    } });
    const barcode = ean13();
    const sku = await prisma.sku.create({ data: { productId: row.id, code: `C-${suffix}`, variantName: '50 ml', size: 50, sizeUnit: 'ml', barcode } });
    // The storefront sells a SKU only with identity-reviewed verified media: the same gate applies to a recommendation.
    await prisma.productMedia.create({ data: {
      productId: row.id, type: MediaType.image, url: `https://cdn.fixtures.test/${suffix}.png`, isPrimary: true, originType: MediaOriginType.verified,
      generationMetadata: { isTest: false, reviewedBy: reviewer.id, reviewedAt: new Date().toISOString(), skuId: sku.id, barcode, size: 50, sizeUnit: 'ml',
        variantName: '50 ml', sourceType: 'OFFICIAL_MANUFACTURER', sourceUrl: FIXTURE_SOURCE_URL, identityVerification: 'BARCODE_VERIFIED' },
    } });
    await prisma.skuRoutineProfile.create({ data: {
      skuId: sku.id, productId: row.id, ruleVersion: 'test', productType: input.type, primaryRole: input.role, primaryRoleStatus: 'RULE_DERIVED',
      routineDomain: input.department === 'skin-care' ? 'SKIN' : 'HAIR', stepOrder: input.rank, periodEligibility: input.periodEligibility ?? null,
    } });
    await prisma.listing.create({ data: { skuId: sku.id, isListed: input.listed !== false } });
    await prisma.sellingPrice.create({ data: { skuId: sku.id, amount: input.price ?? 150, currency: 'EGP', validFrom: new Date(Date.now() - 60000) } });
    products[key] = { productId: row.id, skuId: sku.id, name: input.name };
    return products[key];
  }

  const knowledge = (key: string, data: Record<string, unknown>) => prisma.knowledgeEntry.create({ data: {
    key: `${key}-${tag}`, statementEn: `${key} statement`, statementAr: `جملة ${key}`, evidenceClass: 'EVIDENCE_SUPPORTED', sourceTitle: 'Test Dermatology Body',
    sourceUrl: 'https://example.test/source', sourceType: 'PROFESSIONAL_BODY', retrievedAt: new Date(), ...(data as object),
  } as never });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(AiClient).useValue(ai).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    ({ token, id: customerId } = await register('a'));
    ({ token: otherToken } = await register('b'));

    // Earlier runs of this suite leave their products in the test database; take them off the shelf so each run sees only its own.
    await prisma.product.updateMany({ where: { slug: { startsWith: 'cc-' } }, data: { isPublished: false } });
    await prisma.concern.create({ data: { slug: concern, name: `حب الشباب ${tag}`, careArea: 'skin' } });
    await product('cleanser', { name: `Purifying Cleanser ${tag}`, type: 'cleanser', department: 'skin-care', role: 'CLEANSER', rank: 2, skinTypes: ['oily'] });
    await product('sunscreen', { name: `Daily Fluid SPF ${tag}`, type: 'sunscreen', department: 'skin-care', role: 'SUNSCREEN', rank: 9, periodEligibility: 'AM' });
    await product('retinol', { name: `Night Serum ${tag}`, type: 'serum', department: 'skin-care', role: 'SERUM', rank: 6, price: 400 });
    await product('unlisted', { name: `Hidden Moisturizer ${tag}`, type: 'moisturizer', department: 'skin-care', role: 'MOISTURIZER', rank: 8, listed: false });
    await product('shampoo', { name: `Daily Shampoo ${tag}`, type: 'shampoo', department: 'hair-care', role: 'HAIR_WASH', rank: 1 });

    // Verified INCI for the serum: a stated retinol concentration.
    const retinolIngredient = await prisma.ingredient.upsert({
      where: { slug: 'retinol' }, update: { isActiveIngredient: true, familySlug: 'retinoids', status: 'APPROVED' },
      create: { name: 'Retinol', slug: 'retinol', inciName: 'RETINOL', primaryFunction: 'Skin Restoring', family: 'Retinoids', familySlug: 'retinoids', isActiveIngredient: true },
    });
    await prisma.productIngredient.create({ data: {
      productId: products.retinol.productId, ingredientId: retinolIngredient.id, isKeyActive: true, concentrationValue: 0.3, concentrationUnit: '%', concentrationStatus: 'STATED',
      concentrationEvidence: { sourceUrl: 'https://example.test/label', sourceType: 'MANUFACTURER', evidenceText: 'Retinol 0.3%', reviewedBy: 'test', reviewedAt: new Date().toISOString() },
    } });

    await knowledge('type-cleanser', { subjectType: 'PRODUCT_TYPE', subjectKey: 'cleanser', topic: 'CONCERN_RELEVANCE', concernSlug: concern, careArea: 'skin', strength: 'SUPPORTIVE' });
    await knowledge('type-sunscreen', { subjectType: 'PRODUCT_TYPE', subjectKey: 'sunscreen', topic: 'CONCERN_RELEVANCE', concernSlug: concern, careArea: 'skin', strength: 'SUPPORTIVE' });
    await knowledge('type-moisturizer', { subjectType: 'PRODUCT_TYPE', subjectKey: 'moisturizer', topic: 'CONCERN_RELEVANCE', concernSlug: concern, careArea: 'skin', strength: 'SUPPORTIVE' });
    await knowledge('active-retinoids', { subjectType: 'INGREDIENT_FAMILY', subjectKey: 'retinoids', topic: 'CONCERN_RELEVANCE', concernSlug: concern, careArea: 'skin', strength: 'PRIMARY' });
    await knowledge('escalation', { subjectType: 'CONCERN', subjectKey: concern, topic: 'ESCALATION', concernSlug: concern, careArea: 'skin' });
    await knowledge('overview', { subjectType: 'CONCERN', subjectKey: concern, topic: 'OVERVIEW', concernSlug: concern, careArea: 'skin', reviewStatus: 'PROFESSIONALLY_REVIEWED' });
    await knowledge('rejected', { subjectType: 'PRODUCT_TYPE', subjectKey: 'shampoo', topic: 'CONCERN_RELEVANCE', concernSlug: concern, careArea: 'hair', strength: 'PRIMARY', reviewStatus: 'REJECTED' });
    await knowledge('conflict', { subjectType: 'CONCERN', subjectKey: concern, topic: 'LIMITATION', concernSlug: concern, careArea: 'skin', evidenceClass: 'CONFLICT' });
    await prisma.ingredientRule.upsert({
      where: { key: 'retinoids-pregnancy' }, update: {},
      create: { key: 'retinoids-pregnancy', kind: 'EXCLUDE_CONDITION', subjectType: 'FAMILY', subject: 'retinoids', condition: 'PREGNANT', noteAr: 'الريتينويدات مش بتتقترح أثناء الحمل.', sourceTitle: 'Test Dermatology Body', sourceUrl: 'https://example.test/pregnancy', sourceType: 'PUBLISHED_GUIDANCE' },
    });
  });

  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    ai.down = false; ai.understand = null; ai.respond = null; ai.understandCalls = []; ai.respondCalls = [];
  });

  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });
  const newSession = async (page?: Record<string, unknown>, t = token) =>
    (await request(app.getHttpServer()).post('/guidance/sessions').set(auth(t)).send(page ? { page } : {}).expect(201)).body;
  const say = (sessionId: string, content: string, t = token) =>
    request(app.getHttpServer()).post(`/guidance/sessions/${sessionId}/messages`).set(auth(t)).send({ content });
  const understood = (patch: Record<string, unknown>) => (input: ConsultUnderstandRequest): Partial<ConsultUnderstandResult> =>
    ({ context: { ...input.knownContext, ...patch } as ConsultUnderstandResult['context'] });
  const NOT_PREGNANT = { pregnant: 'NO', breastfeeding: 'NO', prescriptionTopical: 'UNKNOWN', oralRetinoid: 'NO' };

  // ── Recommendation engine over HTTP (no AI involved) ───────────────────────────────────────────────────

  describe('POST /guidance/recommendations', () => {
    const recommend = (body: Record<string, unknown>) => request(app.getHttpServer()).post('/guidance/recommendations').send({ locale: 'en', ...body });

    it('recommends eligible, orderable catalog products for a concern, each with traceable reasons', async () => {
      const res = await recommend({ careArea: 'skin', concerns: [concern], safety: NOT_PREGNANT, limit: 10 }).expect(201);
      const ids = res.body.items.map((i: { productId: string }) => i.productId);
      expect(ids).toEqual(expect.arrayContaining([products.cleanser.productId, products.sunscreen.productId, products.retinol.productId]));
      expect(ids).not.toContain(products.shampoo.productId);   // a rejected knowledge statement must not link it
      expect(ids).not.toContain(products.unlisted.productId);  // not orderable
      expect(res.body.excluded.find((e: { productId: string }) => e.productId === products.unlisted.productId)).toMatchObject({ code: 'UNAVAILABLE' });

      const retinol = res.body.items.find((i: { productId: string }) => i.productId === products.retinol.productId);
      expect(retinol).toMatchObject({ skuId: products.retinol.skuId, canOrder: true, matchLevel: 'STRONG', price: { amount: 400, currency: 'EGP' } });
      expect(retinol.reasons[0]).toMatchObject({ code: 'ACTIVE_FOR_CONCERN', basis: 'EVIDENCE', source: { title: 'Test Dermatology Body', url: 'https://example.test/source', professionallyReviewed: false } });
      expect(retinol.keyActives).toEqual([expect.objectContaining({ level: 'STATED', concentration: '0.3%' })]);
      expect(res.body.engineVersion).toBe('recommendation-engine/1');
    });

    it('holds a retinoid until pregnancy is known and excludes it for a pregnant customer', async () => {
      const unknown = await recommend({ careArea: 'skin', concerns: [concern] }).expect(201);
      expect(unknown.body.items.map((i: { productId: string }) => i.productId)).not.toContain(products.retinol.productId);
      expect(unknown.body.needsSafetyAnswer).toEqual(['PREGNANT']);

      const pregnant = await recommend({ careArea: 'skin', concerns: [concern], safety: { pregnant: 'YES' } }).expect(201);
      expect(pregnant.body.items.map((i: { productId: string }) => i.productId)).not.toContain(products.retinol.productId);
      expect(pregnant.body.excluded.find((e: { productId: string }) => e.productId === products.retinol.productId)).toMatchObject({ code: 'SAFETY_CONDITION' });
    });

    it('lists each concern with how many orderable products it has, so an empty shelf can be hidden', async () => {
      const res = await request(app.getHttpServer()).get('/guidance/concerns').expect(200);
      const ours = res.body.find((c: { slug: string }) => c.slug === concern);
      // retinol is held until pregnancy is answered, the unlisted moisturizer is not orderable
      expect(ours).toMatchObject({ careArea: 'skin', productCount: 2, heldForSafety: true });
      expect(ours.productTypes.sort()).toEqual(['cleanser', 'sunscreen']);
      expect(ours.leadImageUrl).toMatch(/^https:\/\/cdn\.fixtures\.test\//);
      const item = (await request(app.getHttpServer()).post('/guidance/recommendations').send({ concerns: [concern], productTypes: ['cleanser'] }).expect(201)).body.items[0];
      expect(item).toMatchObject({ size: 50, sizeUnit: 'ml', category: { slug: 'skin-care' } });
    });

    it('answers a no-match with an empty list and validates its input', async () => {
      const none = await recommend({ careArea: 'hair', concerns: [concern] }).expect(201);
      expect(none.body.items).toEqual([]);
      await recommend({ careArea: 'teeth' }).expect(400);
      await recommend({ concerns: ['Not A Slug'] }).expect(400);
    });
  });

  describe('knowledge base', () => {
    it('serves a concern guide with source, retrieval date and review status; rejected and conflicting statements never appear', async () => {
      const res = await request(app.getHttpServer()).get(`/guidance/knowledge/concerns/${concern}?locale=en`).expect(200);
      expect(res.body.overview).toMatchObject({ evidenceClass: 'EVIDENCE_SUPPORTED', professionallyReviewed: true,
        source: { title: 'Test Dermatology Body', url: 'https://example.test/source', type: 'PROFESSIONAL_BODY' } });
      expect(Date.parse(res.body.overview.source.retrievedAt)).not.toBeNaN();
      expect(res.body.whenToSeeAProfessional).toHaveLength(1);
      expect(res.body.whenToSeeAProfessional[0].professionallyReviewed).toBe(false);
      expect(res.body.goodToKnow).toEqual([]);                               // the CONFLICT statement
      expect(res.body.productTypes.map((p: { subject: { key: string } }) => p.subject.key).sort()).toEqual(['cleanser', 'moisturizer', 'sunscreen']); // not the REJECTED shampoo
    });

    it('refuses a statement with no source at the database level', async () => {
      await expect(prisma.$executeRawUnsafe(
        `insert into care.knowledge_entries (id, key, subject_type, subject_key, topic, statement_en, statement_ar, evidence_class, source_title, source_type, retrieved_at, updated_at)
         values (gen_random_uuid(), 'nosource-${tag}', 'GENERAL', 'x', 'OVERVIEW', 'a', 'b', 'EVIDENCE_SUPPORTED', 'none', 'PROFESSIONAL_BODY', now(), now())`)).rejects.toThrow();
    });

    it('keeps staff views behind the admin role', async () => {
      await request(app.getHttpServer()).get('/guidance/admin/usage').expect(401);
      await request(app.getHttpServer()).get('/guidance/admin/usage').set(auth()).expect(403);
      await request(app.getHttpServer()).get('/guidance/admin/knowledge/coverage').set(auth()).expect(403);
    });
  });

  // ── Consultation ───────────────────────────────────────────────────────────────────────────────────────

  describe('consultation', () => {
    it('requires sign-in and keeps a session private to its owner', async () => {
      await request(app.getHttpServer()).post('/guidance/sessions').send({}).expect(401);
      const session = await newSession();
      await request(app.getHttpServer()).get(`/guidance/sessions/${session.id}`).set(auth(otherToken)).expect(403);
      await say(session.id, 'hello', otherToken).expect(403);
      await request(app.getHttpServer()).get(`/guidance/sessions/${randomUUID()}`).set(auth()).expect(404);
    });

    it('sends the model a pseudonym and care context only, never the customer id', async () => {
      const session = await newSession({ kind: 'corner', concernSlug: concern });
      expect(session.understood.concerns).toEqual([concern]); // the page the customer came from
      ai.understand = understood({ careArea: 'skin', concerns: [concern], safety: NOT_PREGNANT });
      await say(session.id, 'عايزة منتجات للحبوب').expect(201);
      const sent = JSON.stringify([ai.understandCalls[0], ai.respondCalls[0]]);
      // The fixture receives the contract object; the id is replaced by the HTTP client. What matters here: no profile data rides along.
      expect(ai.understandCalls[0]).toMatchObject({ locale: 'ar', pageContext: { kind: 'corner', concernSlug: concern } });
      expect(sent).not.toContain(`consult-a-${tag}@example.com`);
      expect(sent).not.toContain('Consult a');
      expect(Object.keys(ai.respondCalls[0]).sort()).toEqual(
        ['candidates', 'context', 'customerId', 'escalation', 'excluded', 'intent', 'knowledge', 'locale', 'messages', 'missing', 'mustClarify', 'pageContext', 'routineDraft', 'routineIssues']);
    });

    it('grounds the answer: the model sees opaque refs with verified facts and only those products come back', async () => {
      const session = await newSession();
      ai.understand = understood({ careArea: 'skin', concerns: [concern], skinType: 'oily', safety: NOT_PREGNANT });
      ai.respond = input => ({
        message: 'دي اختياراتي ليكي.',
        recommendations: [{ ref: input.candidates[0].ref, why: 'سبب موثّق' }, { ref: 'P99', why: 'منتج مخترع' }, { ref: 'not-a-ref', why: 'x' }],
        citations: [input.knowledge[0].ref, 'K99'],
      });
      const res = await say(session.id, 'بشرتي دهنية وعندي حبوب').expect(201);
      const { payload } = res.body;

      const candidate = ai.respondCalls[0].candidates[0];
      expect(candidate.ref).toMatch(/^P\d+$/);
      expect(JSON.stringify(ai.respondCalls[0].candidates)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/); // no catalog ids reach the model
      expect(candidate.price).toMatch(/EGP$/);
      expect(ai.respondCalls[0].candidates.map(c => c.name)).not.toContain(products.unlisted.name);
      expect(ai.respondCalls[0].knowledge.every(k => /^K\d+$/.test(k.ref))).toBe(true);

      expect(payload.source).toBe('AI');
      expect(payload.recommendations).toHaveLength(1); // the invented refs are gone
      expect(payload.recommendations[0]).toMatchObject({ why: 'سبب موثّق', canOrder: true });
      expect(Object.values(products).map(p => p.productId)).toContain(payload.recommendations[0].productId);
      expect(payload.citations).toHaveLength(1);
      expect(payload.citations[0].source).toMatchObject({ title: 'Test Dermatology Body' });
      expect(payload.understood).toMatchObject({ careArea: 'skin', skinType: 'oily', concerns: [concern] });

      // The turn is persisted with its payload and the context survives to the next turn.
      const stored = await request(app.getHttpServer()).get(`/guidance/sessions/${session.id}`).set(auth()).expect(200);
      expect(stored.body.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant']);
      expect(stored.body.messages[1].payload.recommendations).toHaveLength(1);
      await say(session.id, 'وإيه كمان؟').expect(201);
      expect(ai.understandCalls[1].knownContext).toMatchObject({ careArea: 'skin', skinType: 'oily', concerns: [concern] });
      expect(ai.understandCalls[1].messages.map(m => m.role)).toEqual(['user', 'assistant', 'user']);
    });

    it('asks instead of guessing, and does not let the model recommend on a clarification turn', async () => {
      const session = await newSession();
      ai.understand = () => ({ needsClarification: true, missing: ['careArea'] });
      ai.respond = input => ({ message: 'محتاجة أعرف حاجة.', followUpQuestion: 'للبشرة ولا للشعر؟', quickReplies: ['البشرة', 'الشعر'],
        recommendations: input.candidates.map(c => ({ ref: c.ref, why: 'x' })) });
      const res = await say(session.id, 'محتاجة مساعدة').expect(201);
      expect(ai.respondCalls[0]).toMatchObject({ mustClarify: true, missing: ['careArea'] });
      expect(res.body.payload).toMatchObject({ recommendations: [], followUpQuestion: 'للبشرة ولا للشعر؟', quickReplies: ['البشرة', 'الشعر'] });
    });

    it('asks about pregnancy when the only relevant product depends on it, then excludes it on a yes', async () => {
      const session = await newSession();
      ai.understand = understood({ careArea: 'skin', productTypes: ['serum'] });
      const first = await say(session.id, 'عايزة سيروم').expect(201);
      expect(ai.respondCalls[0]).toMatchObject({ mustClarify: true, candidates: [] });
      expect(ai.respondCalls[0].missing).toContain('pregnancy');
      expect(first.body.payload.recommendations).toEqual([]);

      ai.understand = understood({ careArea: 'skin', productTypes: ['serum'], safety: { ...NOT_PREGNANT, pregnant: 'YES' } });
      const second = await say(session.id, 'أيوه أنا حامل').expect(201);
      expect(second.body.payload.recommendations).toEqual([]);
      // (other runs may have left serums in this database: assert on ours)
      expect(second.body.payload.excluded).toEqual(expect.arrayContaining([expect.objectContaining({ name: products.retinol.name })]));
      expect(ai.respondCalls[1].excluded.join(' | ')).toContain(products.retinol.name);
    });

    it('escalates red flags: no products, no questions, the reason and the sourced guidance', async () => {
      const session = await newSession();
      ai.understand = input => ({ ...understood({ careArea: 'skin', concerns: [concern] })(input), redFlags: [{ code: 'INFECTION_SIGNS', evidence: 'فيها صديد' }, { code: 'SEVERE_OR_PAINFUL', evidence: 'مؤلمة' }] });
      ai.respond = () => ({ message: 'لازم دكتور يشوفها.', followUpQuestion: 'سؤال؟', quickReplies: ['أ'], recommendations: [{ ref: 'P1', why: 'x' }] });
      const res = await say(session.id, 'حبوب مؤلمة وفيها صديد').expect(201);
      expect(ai.respondCalls[0]).toMatchObject({ candidates: [], escalation: ['INFECTION_SIGNS', 'SEVERE_OR_PAINFUL'], mustClarify: false });
      expect(ai.respondCalls[0].knowledge.map(k => k.topic)).toEqual(['ESCALATION']);
      expect(res.body.payload).toMatchObject({ recommendations: [], routine: null, followUpQuestion: null, quickReplies: [] });
      expect(res.body.payload.escalation).toMatchObject({ required: true });
      expect(res.body.payload.escalation.reasons.map((r: { code: string }) => r.code)).toEqual(['INFECTION_SIGNS', 'SEVERE_OR_PAINFUL']);
    });

    it('keeps answering from the engine when the AI is down, and says so', async () => {
      ai.down = true;
      const session = await newSession();
      const res = await say(session.id, `عايزة غسول عشان حب الشباب ${tag}`).expect(201);
      expect(res.body.payload.source).toBe('FALLBACK');
      expect(res.body.content).toContain('مش متاح');
      expect(res.body.payload.recommendations.map((r: { productId: string }) => r.productId)).toEqual([products.cleanser.productId]);
      expect(res.body.payload.recommendations[0].why).toBeTruthy();

      const vague = await say((await newSession()).id, 'ممكن مساعدة؟').expect(201);
      expect(vague.body.payload).toMatchObject({ source: 'FALLBACK', recommendations: [], quickReplies: ['البشرة', 'الشعر'] });
      // Shopping is untouched by the outage.
      await request(app.getHttpServer()).post('/guidance/recommendations').send({ careArea: 'skin', productTypes: ['cleanser'] }).expect(201);
    });

    it('falls back when only the wording call fails', async () => {
      const session = await newSession();
      ai.understand = understood({ careArea: 'skin', productTypes: ['cleanser'] });
      ai.respond = () => { throw new Error('model returned nonsense'); };
      const res = await say(session.id, 'عايزة غسول').expect(201);
      expect(res.body.payload.source).toBe('FALLBACK');
      expect(res.body.payload.recommendations).toHaveLength(1);
    });

    it('records usage per call and enforces the per-customer daily limit', async () => {
      const before = await prisma.aiUsageEvent.count({ where: { customerId } });
      const session = await newSession();
      ai.understand = understood({ careArea: 'skin', productTypes: ['cleanser'] });
      await say(session.id, 'عايزة غسول').expect(201);
      const events = await prisma.aiUsageEvent.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' }, take: 2 });
      expect(await prisma.aiUsageEvent.count({ where: { customerId } })).toBe(before + 2);
      expect(events.map(e => e.task).sort()).toEqual(['consult.respond', 'consult.understand']);
      expect(events.every(e => e.outcome === 'OK' && Number(e.costUsd) > 0 && e.promptTokens > 0)).toBe(true);

      const fresh = await register('limit');
      const limited = await newSession(undefined, fresh.token);
      process.env.AI_CONSULT_DAILY_MESSAGES = '1';
      try {
        await say(limited.id, 'عايزة غسول', fresh.token).expect(201);
        const refused = await say(limited.id, 'وكمان واقي', fresh.token).expect(429);
        expect(refused.body).toMatchObject({ code: 'CONSULT_DAILY_LIMIT' });
        expect(ai.understandCalls).toHaveLength(2); // the refused message never reached the model
      } finally {
        delete process.env.AI_CONSULT_DAILY_MESSAGES;
      }
    });

    it('retries an unanswered message without saving it twice, and only for its owner', async () => {
      const session = await newSession();
      await prisma.guidanceMessage.create({ data: { sessionId: session.id, role: 'user', content: 'عايزة غسول' } });
      ai.understand = understood({ careArea: 'skin', productTypes: ['cleanser'] });
      await request(app.getHttpServer()).post(`/guidance/sessions/${session.id}/retry`).set(auth(otherToken)).expect(403);
      const res = await request(app.getHttpServer()).post(`/guidance/sessions/${session.id}/retry`).set(auth()).expect(201);
      expect(res.body.payload.recommendations).toHaveLength(1);
      const roles = (await prisma.guidanceMessage.findMany({ where: { sessionId: session.id }, orderBy: { createdAt: 'asc' } })).map(m => m.role);
      expect(roles).toEqual(['user', 'assistant']);
      await request(app.getHttpServer()).post(`/guidance/sessions/${session.id}/retry`).set(auth()).expect(400); // already answered
    });

    it('rejects empty and oversized messages', async () => {
      const session = await newSession();
      await say(session.id, '   ').expect(400);
      await say(session.id, 'x'.repeat(1501)).expect(400);
    });
  });

  // ── AI routine: propose -> edit -> revalidate -> explicit save ─────────────────────────────────────────

  describe('AI routine (GLO-313)', () => {
    it('proposes a routine laid out by role, lets the customer edit it, revalidates and saves only on confirmation', async () => {
      const session = await newSession();
      ai.understand = input => ({ ...understood({ careArea: 'skin', concerns: [concern], safety: NOT_PREGNANT })(input), intent: 'build_routine' });
      const res = await say(session.id, 'عايزة روتين للحبوب').expect(201);
      const routine = res.body.payload.routine;
      expect(routine).toBeTruthy();
      const layout = routine.steps.map((s: { slot: string; item: { productId: string } }) => `${s.slot}:${Object.keys(products).find(k => products[k].productId === s.item.productId)}`);
      expect(layout).toEqual(['AM:cleanser', 'AM:sunscreen', 'PM:cleanser', 'PM:retinol']);
      expect(routine.canSave).toBe(true);
      expect(routine.steps[0].howToUse).toBe('Apply as the pack directs.'); // the manufacturer's text, not the model's
      expect(ai.respondCalls[0].routineDraft.map(s => s.slot)).toEqual(['am', 'am', 'pm', 'pm']);
      // Nothing was saved by proposing.
      expect(await prisma.routine.count({ where: { ownerCustomerId: customerId } })).toBe(0);

      // The customer removes the serum; the shared rules run on the edited routine.
      const edited = routine.steps.filter((s: { item: { productId: string } }) => s.item.productId !== products.retinol.productId);
      const check = await request(app.getHttpServer()).post('/care/routines/check').set(auth())
        .send({ steps: edited.map((s: { slot: string; item: { skuId: string } }) => ({ skuId: s.item.skuId, timing: s.slot })) }).expect(201);
      expect(check.body.ok).toBe(true);

      const body = { idempotencyKey: randomUUID(), title: 'روتيني للحبوب', careArea: 'skin',
        steps: edited.map((s: { slot: string; why: string; item: { skuId: string; name: string } }) => ({ title: s.item.name.slice(0, 80), timing: s.slot, skuId: s.item.skuId, reason: 'خطوة أساسية' })) };
      await request(app.getHttpServer()).post('/care/personal-routines/from-proposal').set(auth()).send(body).expect(400); // no explicit confirmation
      const saved = await request(app.getHttpServer()).post('/care/personal-routines/from-proposal').set(auth()).send({ ...body, confirmed: true }).expect(201);
      expect(saved.body).toMatchObject({ origin: 'AI', replayed: false });
      expect(saved.body.steps).toHaveLength(3);

      const mine = await request(app.getHttpServer()).get(`/care/personal-routines/${saved.body.id}`).set(auth()).expect(200);
      expect(mine.body.steps.map((s: { timing: string }) => s.timing)).toEqual(['AM', 'AM', 'PM']);
      await request(app.getHttpServer()).get(`/care/personal-routines/${saved.body.id}`).set(auth(otherToken)).expect(404);
    });

    it('does not build a personal routine for a pregnant customer, but still suggests safe products', async () => {
      const session = await newSession();
      ai.understand = input => ({ ...understood({ careArea: 'skin', concerns: [concern], safety: { ...NOT_PREGNANT, pregnant: 'YES' } })(input), intent: 'build_routine' });
      const res = await say(session.id, 'أنا حامل وعايزة روتين للحبوب').expect(201);
      expect(res.body.payload.routine).toBeNull();
      expect(res.body.payload.routineNote).toContain('الحمل');
      expect(ai.respondCalls[0].routineDraft).toEqual([]);
      expect(res.body.payload.recommendations.map((r: { productId: string }) => r.productId)).not.toContain(products.retinol.productId);
    });

    it('refuses to save an edited proposal the compatibility rules block', async () => {
      const second = await product('retinol2', { name: `Second Retinoid ${tag}`, type: 'serum', department: 'skin-care', role: 'SERUM', rank: 6 });
      const retinal = await prisma.ingredient.upsert({ where: { slug: 'retinal' }, update: { familySlug: 'retinoids', isActiveIngredient: true },
        create: { name: 'Retinal', slug: 'retinal', inciName: 'RETINAL', primaryFunction: 'Skin Restoring', familySlug: 'retinoids', isActiveIngredient: true } });
      await prisma.productIngredient.create({ data: { productId: second.productId, ingredientId: retinal.id, isKeyActive: true } });
      await prisma.ingredientRule.upsert({ where: { key: 'max-one-retinoid-per-area' }, update: {},
        create: { key: 'max-one-retinoid-per-area', kind: 'MAX_ONE_PER_AREA', subjectType: 'FAMILY', subject: 'retinoids', noteAr: 'ريتينويد واحد بس.', sourceTitle: 'ShinaCare conservative policy', sourceType: 'SHINACARE_POLICY' } });

      const steps = [{ skuId: products.retinol.skuId, timing: 'PM' }, { skuId: second.skuId, timing: 'PM' }, { skuId: products.sunscreen.skuId, timing: 'AM' }];
      const check = await request(app.getHttpServer()).post('/care/routines/check').send({ steps, safety: NOT_PREGNANT }).expect(201); // guests can check too
      expect(check.body.ok).toBe(false);
      expect(check.body.issues.find((i: { code: string }) => i.code === 'MAX_ONE_PER_AREA')).toMatchObject({ severity: 'BLOCK' });

      const res = await request(app.getHttpServer()).post('/care/personal-routines/from-proposal').set(auth())
        .send({ idempotencyKey: randomUUID(), confirmed: true, title: 'روتين', steps: steps.map(s => ({ ...s, title: 'خطوة' })) }).expect(422);
      expect(res.body).toMatchObject({ code: 'ROUTINE_INCOMPATIBLE' });
    });
  });
});

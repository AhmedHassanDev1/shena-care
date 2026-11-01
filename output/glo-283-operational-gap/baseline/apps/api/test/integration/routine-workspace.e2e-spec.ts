import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { Role, RoutineTier } from '@prisma/client';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { AiClient } from '../../src/platform/ai/ai-client.contract';
import { DeterministicAiClient } from '../fixtures/deterministic-ai';
import { createSellableSku } from '../fixtures/sellable-sku';
import { Actor, createActor } from '../fixtures/actors';

/**
 * Routine system phase 1, individual (docs/project/ROUTINE_SYSTEM.md): builder → engine proposal → actions → save →
 * my routines → activation limits → cart. Every product is a real, sellable catalog SKU with reviewed facts; each run
 * owns its blueprint, ingredients and rules (suffixed), so nothing shared is changed.
 */
describe('Routine system phase 1 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let customer: Actor;
  let other: Actor;
  let admin: Actor;

  const s = randomUUID().slice(0, 8);
  const concern = `acne-${s}`;
  const RET = `retinoids-${s}`;
  const AZE = `azelaic-${s}`;
  const products: Record<string, { productId: string; skuId: string }> = {};
  const http = () => request(app.getHttpServer());

  async function ingredient(slug: string, family: string) {
    return prisma.ingredient.create({ data: { name: slug, slug, inciName: slug.toUpperCase(), family, familySlug: family,
      primaryFunction: 'Active', isActiveIngredient: true } });
  }

  async function routineProduct(key: string, roleKey: string, price: number, opts: {
    tier?: RoutineTier; active?: { id: string; value: number | null }; usage?: boolean;
  } = {}) {
    const sku = await createSellableSku(prisma);
    await prisma.sellingPrice.updateMany({ where: { skuId: sku.id }, data: { amount: price } });
    await prisma.product.update({ where: { id: sku.productId }, data: { name: `${key} ${s}` } });
    if (opts.active) {
      await prisma.productIngredient.create({ data: {
        productId: sku.productId, ingredientId: opts.active.id, isKeyActive: true,
        ...(opts.active.value !== null && {
          concentrationValue: opts.active.value, concentrationUnit: '%', concentration: `${opts.active.value}%`,
          concentrationEvidence: { sourceUrl: 'https://example.test/label', sourceType: 'OFFICIAL_MANUFACTURER', evidenceText: 'label',
            reviewedBy: 'fixture', reviewedAt: new Date().toISOString() },
        }),
      } });
    }
    if (opts.usage !== false) {
      await prisma.productUsageRule.create({ data: {
        productId: sku.productId, skuId: sku.id, targetArea: 'FACE', routinePeriod: 'PM', rinseMode: 'LEAVE_ON', frequencyUnit: 'DAY',
        usesMin: 1, usesMax: 1, evidenceText: 'Apply once daily', sourceUrl: 'https://example.test/usage', sourceType: 'OFFICIAL_MANUFACTURER',
        reviewedBy: 'fixture', reviewedAt: new Date(),
      } });
    }
    await prisma.productRoleEligibility.create({ data: {
      productId: sku.productId, roleKey, tier: opts.tier ?? RoutineTier.SMART, concernSlugs: [concern], reviewStatus: 'APPROVED',
      reviewedBy: 'fixture', reviewedAt: new Date(),
    } });
    products[key] = { productId: sku.productId, skuId: sku.id };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AiClient).useValue(new DeterministicAiClient())
      .compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    customer = await createActor(prisma, Role.CUSTOMER);
    other = await createActor(prisma, Role.CUSTOMER);
    admin = await createActor(prisma, Role.ADMIN);

    const adapalene = await ingredient(`adapalene-${s}`, RET);
    const azelaic = await ingredient(`azelaic-acid-${s}`, AZE);

    const bp = await prisma.routineBlueprint.create({ data: {
      key: `acne-${s}`, concernSlug: concern, careArea: 'skin', kind: 'TREATMENT', severityMin: 1, severityMax: 2,
      titleAr: 'روتين الحبوب', titleEn: 'Acne', safetyNotesAr: [], sources: [{ title: 'AAD', url: 'https://www.aad.org/public/diseases/acne/DIY/wont-clear' }],
      status: 'PUBLISHED', publishedAt: new Date(), publishedBy: 'fixture',
      roles: { create: [
        { roleKey: `cleanser-${s}`, sortOrder: 1, titleAr: 'غسول', isEssential: true, startWeek: 1, requiredActives: [] },
        { roleKey: `treatment-${s}`, sortOrder: 2, titleAr: 'علاج', isEssential: true, startWeek: 2, requiredActives: [RET, AZE],
          concentrationRanges: [{ subject: AZE, min: 10, max: 20, unit: '%' }] },
        { roleKey: `moisturizer-${s}`, sortOrder: 3, titleAr: 'مرطب', isEssential: true, startWeek: 1, requiredActives: [] },
        { roleKey: 'sunscreen', sortOrder: 4, titleAr: 'واقي شمس', isEssential: true, startWeek: 1, requiredActives: [] },
      ] },
    } });
    expect(bp.id).toBeDefined();
    await prisma.ingredientRule.create({ data: {
      key: `retinoids-pregnancy-${s}`, kind: 'EXCLUDE_CONDITION', subjectType: 'FAMILY', subject: RET, condition: 'PREGNANT',
      sourceTitle: 'AAD', sourceType: 'PUBLISHED_GUIDANCE',
    } });

    await routineProduct('cleanser', `cleanser-${s}`, 120);
    await routineProduct('cleanser-b', `cleanser-${s}`, 150);
    await routineProduct('retinoid', `treatment-${s}`, 150, { active: { id: adapalene.id, value: 0.1 } });
    await routineProduct('azelaic', `treatment-${s}`, 220, { active: { id: azelaic.id, value: 15 } });
    await routineProduct('azelaic-unverified', `treatment-${s}`, 90, { active: { id: azelaic.id, value: null } });
    await routineProduct('moisturizer', `moisturizer-${s}`, 170);
    await routineProduct('moisturizer-b', `moisturizer-${s}`, 180);
    await routineProduct('sunscreen', 'sunscreen', 220);
    await routineProduct('sunscreen-b', 'sunscreen', 260);
  });

  afterAll(async () => {
    await app.close();
  });

  const answers = { severity: 2, skinType: 'oily', ageBand: 'ADULT', experienceLevel: 'BEGINNER' };
  const noRisk = { pregnant: 'NO', breastfeeding: 'NO', prescriptionTopical: 'NO', oralRetinoid: 'NO', fragranceSensitive: 'NO' };
  const item = (proposal: any, roleKey: string) => proposal.snapshot.items.find((i: any) => i.roleKey === roleKey);

  async function guestDraft(extra: Record<string, unknown> = {}) {
    const start = await http().post('/care/workspace/drafts').send({ primaryConcern: concern, ...answers, ...extra }).expect(201);
    return { draftId: start.body.draft.id as string, guestToken: start.body.guestToken as string, version: start.body.draft.version as number };
  }

  let guest: { draftId: string; guestToken: string; version: number };
  let proposalId: string;
  let routineId: string;

  it('needs consent before storing health answers', async () => {
    guest = await guestDraft();
    await http().patch(`/care/workspace/drafts/${guest.draftId}`).set('x-guest-token', guest.guestToken)
      .send({ version: guest.version, safety: noRisk }).expect(400)
      .expect(res => expect(res.body.code ?? res.body.message?.code).toBe('CONSENT_REQUIRED'));
    const ok = await http().patch(`/care/workspace/drafts/${guest.draftId}`).set('x-guest-token', guest.guestToken)
      .send({ version: guest.version, safety: noRisk, consentVersion: 'privacy-2026-10' }).expect(200);
    expect(ok.body.safety.pregnant).toBe('NO');
    expect(ok.body).not.toHaveProperty('guestTokenHash');
    guest.version = ok.body.version;
  });

  it('builds a proposal from real sellable products, deterministically', async () => {
    const res = await http().post(`/care/workspace/drafts/${guest.draftId}/proposals`).set('x-guest-token', guest.guestToken).expect(201);
    proposalId = res.body.id;
    const p = res.body;
    expect(p.status).toBe('proposed');
    expect(p.snapshot.tier).toBe('SMART');
    expect(item(p, `cleanser-${s}`).product.productId).toBe(products.cleanser.productId);
    // The cheaper azelaic product has no stated concentration: it never qualifies for the treatment role.
    expect(item(p, `treatment-${s}`).product.productId).toBe(products.retinoid.productId);
    expect(item(p, `treatment-${s}`)).toMatchObject({ startWeek: 2, purchasePhase: 'DEFERRED' });
    expect(item(p, 'sunscreen')).toMatchObject({ startWeek: 1, purchasePhase: 'IMMEDIATE' });
    expect(Number(p.totalPrice)).toBe(120 + 150 + 170 + 220);

    const again = await http().post(`/care/workspace/drafts/${guest.draftId}/proposals`).set('x-guest-token', guest.guestToken).expect(201);
    expect(again.body.snapshot).toEqual(p.snapshot);
    proposalId = again.body.id;
  });

  it('refuses another guest token and a stale draft version', async () => {
    await http().get(`/care/workspace/drafts/${guest.draftId}`).set('x-guest-token', randomUUID()).expect(403);
    await http().post(`/care/workspace/drafts/${guest.draftId}/actions`).set('x-guest-token', guest.guestToken)
      .send({ version: guest.version - 1, action: 'SET_OWNED', roleKey: `cleanser-${s}`, owned: true }).expect(409);
  });

  it('recomputes on the server for each action', async () => {
    const owned = await http().post(`/care/workspace/drafts/${guest.draftId}/actions`).set('x-guest-token', guest.guestToken)
      .send({ version: guest.version, action: 'SET_OWNED', roleKey: `cleanser-${s}`, owned: true }).expect(201);
    expect(item(owned.body, `cleanser-${s}`).status).toBe('OWNED');
    expect(Number(owned.body.totalPrice)).toBe(150 + 170 + 220);
    guest.version += 1;

    const swapped = await http().post(`/care/workspace/drafts/${guest.draftId}/actions`).set('x-guest-token', guest.guestToken)
      .send({ version: guest.version, action: 'SWAP_ITEM', roleKey: `moisturizer-${s}`, productId: products['moisturizer-b'].productId }).expect(201);
    expect(item(swapped.body, `moisturizer-${s}`).product.productId).toBe(products['moisturizer-b'].productId);
    expect(item(swapped.body, `moisturizer-${s}`).reasonCodes[0]).toBe('CUSTOMER_CHOICE');
    guest.version += 1;
    proposalId = swapped.body.id;
  });

  it('excludes retinoids for a pregnant customer and picks the allowed treatment', async () => {
    const d = await guestDraft();
    await http().patch(`/care/workspace/drafts/${d.draftId}`).set('x-guest-token', d.guestToken)
      .send({ version: d.version, safety: { ...noRisk, pregnant: 'YES' }, consentVersion: 'privacy-2026-10' }).expect(200);
    const p = await http().post(`/care/workspace/drafts/${d.draftId}/proposals`).set('x-guest-token', d.guestToken).expect(201);
    expect(item(p.body, `treatment-${s}`).product.productId).toBe(products.azelaic.productId);
  });

  it('routes severe acne to gentle basics with a doctor recommendation', async () => {
    const d = await guestDraft({ severity: 3 });
    const p = await http().post(`/care/workspace/drafts/${d.draftId}/proposals`).set('x-guest-token', d.guestToken).expect(201);
    expect(p.body.snapshot.mode).toBe('GENTLE_BASICS');
    expect(p.body.snapshot.warnings).toContain('SEVERE_SEE_DOCTOR');
    expect(item(p.body, `treatment-${s}`)).toBeUndefined();
  });

  it('saves only for the signed-in owner, once, and activates the routine', async () => {
    await http().post(`/care/workspace/proposals/${proposalId}/save`).send({}).expect(401);
    await http().post(`/care/workspace/drafts/${guest.draftId}/link`).set(customer.auth).set('x-guest-token', guest.guestToken).expect(201);
    await http().post(`/care/workspace/proposals/${proposalId}/save`).set(other.auth).send({}).expect(403);

    const [a, b] = await Promise.all([
      http().post(`/care/workspace/proposals/${proposalId}/save`).set(customer.auth).send({}),
      http().post(`/care/workspace/proposals/${proposalId}/save`).set(customer.auth).send({}),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.id).toBe(b.body.id);
    routineId = a.body.id;
    expect(await prisma.customerRoutine.count({ where: { createdFromProposalId: proposalId } })).toBe(1);

    const saved = await http().get(`/care/me/routines/${routineId}`).set(customer.auth).expect(200);
    expect(saved.body).toMatchObject({ activation: 'ACTIVE', lifecycle: 'NOT_STARTED', version: 1, kind: 'TREATMENT' });
    expect(saved.body.items.find((i: any) => i.roleKey === `cleanser-${s}`)).toMatchObject({ isOwned: true, productId: null });

    const v1 = await prisma.customerRoutineVersion.findUniqueOrThrow({ where: { routineId_version: { routineId, version: 1 } } });
    const snap = v1.snapshot as any;
    expect(snap.safetyAnswers.pregnant).toBe('NO');
    expect(snap.facts[products.retinoid.productId].actives[0]).toMatchObject({ concentrationValue: 0.1, concentrationVerified: true });
    expect(snap.facts[products.retinoid.productId].usageRules).toHaveLength(1);
    const flags = await prisma.careSafetyFlags.findFirstOrThrow({ where: { careProfile: { customerId: customer.id } } });
    expect(flags).toMatchObject({ pregnant: 'NO', consentVersion: 'privacy-2026-10' });
  });

  it('keeps routines private to their owner', async () => {
    await http().get(`/care/me/routines/${routineId}`).set(other.auth).expect(403);
    await http().get(`/care/me/routines/${routineId}`).expect(401);
  });

  it('refuses to save a proposal the draft has moved past', async () => {
    const start = await http().post('/care/workspace/drafts').set(customer.auth).send({ primaryConcern: concern, ...answers }).expect(201);
    const draftId = start.body.draft.id;
    const old = await http().post(`/care/workspace/drafts/${draftId}/proposals`).set(customer.auth).expect(201);
    await http().patch(`/care/workspace/drafts/${draftId}`).set(customer.auth).send({ version: start.body.draft.version, budget: 900 }).expect(200);
    await http().post(`/care/workspace/proposals/${old.body.id}/save`).set(customer.auth).send({}).expect(409)
      .expect(res => expect(res.body.code ?? res.body.message?.code).toBe('PROPOSAL_OUTDATED'));
  });

  it('allows one active face-treatment routine at a time', async () => {
    const start = await http().post('/care/workspace/drafts').set(customer.auth).send({ primaryConcern: concern, ...answers }).expect(201);
    const p = await http().post(`/care/workspace/drafts/${start.body.draft.id}/proposals`).set(customer.auth).expect(201);
    const second = await http().post(`/care/workspace/proposals/${p.body.id}/save`).set(customer.auth).send({}).expect(201);
    expect(second.body.activation).toBe('INACTIVE');
    expect(second.body.activationResult.blockedBy).toMatchObject({ code: 'AREA_LIMIT', otherRoutineId: routineId });
    await http().post(`/care/me/routines/${second.body.id}/activate`).set(customer.auth).send({}).expect(409);

    const list = await http().get('/care/me/routines').set(customer.auth).expect(200);
    expect(list.body.map((r: any) => r.activation)).toEqual(['ACTIVE', 'INACTIVE']);
  });

  it('adds the steps still to buy, this week first, without doubling cart lines', async () => {
    const first = await http().post(`/care/me/routines/${routineId}/cart`).set(customer.auth).send({ phase: 'IMMEDIATE' }).expect(201);
    expect(first.body.added.sort()).toEqual([`moisturizer-${s}`, 'sunscreen'].sort());
    const skus = first.body.cart.items.map((l: any) => l.skuId);
    expect(skus).toEqual(expect.arrayContaining([products['moisturizer-b'].skuId, products.sunscreen.skuId]));
    expect(skus).not.toContain(products.retinoid.skuId); // the treatment starts in week 2
    const lines = await prisma.cartItem.findMany({ where: { skuId: { in: [products.sunscreen.skuId] } } });
    expect(lines.every(l => l.sourceType === 'ROUTINE' && l.quantity === 1)).toBe(true);

    const again = await http().post(`/care/me/routines/${routineId}/cart`).set(customer.auth).send({ phase: 'ALL' }).expect(201);
    expect(again.body.added).toEqual([`treatment-${s}`]);
    expect(again.body.skipped.map((x: any) => x.reason)).toEqual(['ALREADY_IN_CART', 'ALREADY_IN_CART']);
  });

  it('lets a guest put the current proposal in a guest cart', async () => {
    const d = await guestDraft();
    await http().patch(`/care/workspace/drafts/${d.draftId}`).set('x-guest-token', d.guestToken)
      .send({ version: d.version, safety: noRisk, consentVersion: 'privacy-2026-10' }).expect(200);
    const p = await http().post(`/care/workspace/drafts/${d.draftId}/proposals`).set('x-guest-token', d.guestToken).expect(201);
    const res = await http().post(`/care/workspace/proposals/${p.body.id}/cart`).set('x-guest-token', d.guestToken).send({ phase: 'IMMEDIATE' }).expect(201);
    expect(res.headers['x-cart-token']).toBeDefined();
    expect(res.body.added).toHaveLength(3);
  });

  it('swaps a saved step as a new version and keeps the old one in history', async () => {
    const res = await http().post(`/care/me/routines/${routineId}/items/sunscreen/swap`).set(customer.auth)
      .send({ version: 1, productId: products['sunscreen-b'].productId }).expect(201);
    expect(res.body.version).toBe(2);
    expect(res.body.items.find((i: any) => i.roleKey === 'sunscreen').productId).toBe(products['sunscreen-b'].productId);
    const history = await prisma.customerRoutineItem.findMany({ where: { routineId, roleKey: 'sunscreen' }, orderBy: { addedAtVersion: 'asc' } });
    expect(history.map(h => [h.productId, h.addedAtVersion, h.removedAtVersion])).toEqual([
      [products.sunscreen.productId, 1, 2], [products['sunscreen-b'].productId, 2, null],
    ]);
    await http().post(`/care/me/routines/${routineId}/items/sunscreen/swap`).set(customer.auth)
      .send({ version: 1, productId: products.sunscreen.productId }).expect(409);
    await http().post(`/care/me/routines/${routineId}/items/${`treatment-${s}`}/swap`).set(customer.auth)
      .send({ version: 2, productId: products['azelaic-unverified'].productId }).expect(422);
  });

  it('moves through start, complete, and refuses to reactivate a completed routine', async () => {
    const started = await http().post(`/care/me/routines/${routineId}/start`).set(customer.auth).expect(201);
    expect(started.body.lifecycle).toBe('IN_PROGRESS');
    const done = await http().patch(`/care/me/routines/${routineId}/status`).set(customer.auth).send({ action: 'COMPLETE' }).expect(200);
    expect(done.body).toMatchObject({ lifecycle: 'COMPLETED', activation: 'INACTIVE', nextStep: 'MAINTENANCE_SUGGESTED' });
    const blocked = await http().post(`/care/me/routines/${routineId}/activate`).set(customer.auth).send({}).expect(409);
    expect(blocked.body.blockedBy ?? blocked.body.message?.blockedBy).toMatchObject({ code: 'LIFECYCLE' });
  });

  it('shows the ready-made routine for discovery with unknown safety answers', async () => {
    const res = await http().get(`/care/routines/featured?concern=${concern}`).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ preview: true });
    expect(res.body[0].warnings).toContain('NEEDS_SAFETY_ANSWERS');
    // With pregnancy unknown, the retinoid is ruled out; the verified azelaic product fills the treatment.
    const smart = res.body[0].tiers.find((t: any) => t.tier === 'SMART');
    expect(smart.items.find((i: any) => i.roleKey === `treatment-${s}`).product.productId).toBe(products.azelaic.productId);
  });

  it('gates publishing on sources and catalog readiness (admin only)', async () => {
    await http().get('/care/admin/routines/readiness').set(customer.auth).expect(403);
    const readiness = await http().get('/care/admin/routines/readiness').set(admin.auth).expect(200);
    const mine = readiness.body.find((b: any) => b.key === `acne-${s}`);
    expect(mine.tiers.SMART.ready).toBe(true);
    expect(mine.tiers.LUXE.ready).toBe(false);

    const draft = await prisma.routineBlueprint.create({ data: {
      key: `empty-${s}`, concernSlug: `empty-${s}`, careArea: 'skin', kind: 'SUPPORT', titleAr: 'فارغ', titleEn: 'Empty', safetyNotesAr: [], sources: [],
      roles: { create: [{ roleKey: `moisturizer-${s}`, sortOrder: 1, titleAr: 'مرطب', requiredActives: [] }] },
    } });
    await http().post(`/care/admin/routines/blueprints/${draft.id}/publish`).set(admin.auth).expect(422)
      .expect(res => expect(res.body.code ?? res.body.message?.code).toBe('SOURCES_REQUIRED'));
  });
});

// A flat fee keeps the expected COD arithmetic readable.
process.env.DELIVERY_FEE_POLICY = JSON.stringify({ bands: [{ maxKm: null, fee: 50 }], discountTiers: [], freeFrom: 100000 });
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { MediaOriginType, MediaType, Role } from '@prisma/client';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { DomainEventsService } from '../../src/platform/events/domain-events.service';
import { AiClient, ConsultUnderstandRequest, ConsultUnderstandResult } from '../../src/platform/ai';
import { createActor, Actor } from '../fixtures/actors';
import { recordPackaging } from '../fixtures/pack-ready';
import { signInCustomer } from '../fixtures/checkout';
import { DeterministicAiClient } from '../fixtures/deterministic-ai';
import { ensureFixtureReviewer, FIXTURE_SOURCE_URL } from '../fixtures/sellable-sku';

type Sku = { id: string; productId: string; barcode: string; name: string };
type Placed = { id: string; orderNumber: string; codAmount: number; totalAmount: number; items: Array<{ id: string; skuId: string; quantity: number }> };

function ean13() {
  const body = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10));
  const sum = body.reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 1 : 3), 0);
  return body.join('') + String((10 - (sum % 10)) % 10);
}

/**
 * GLO-304 journeys 2, 3 and 4: a routine of every origin (Ready Routine copy, manual, AI proposal) ends in a real order that the
 * one-person Hub receives, packs and delivers, with cash settled. Routines are bought through the shared Routine domain's cart path;
 * nothing is mocked except the model (scripted for journey 4, as in the consultation suite).
 */
describe('Golden journeys 2-4: routines to delivery (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let events: DomainEventsService;
  let admin: Actor; let hub: Actor; let driver: Actor;
  let locationId: string;
  const ai = new DeterministicAiClient();
  const tag = randomUUID().slice(0, 8);
  const concern = `oily-${tag}`;
  const previousMode = process.env.SOURCING_MODE;
  const http = () => request(app.getHttpServer());
  const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const EXPIRY = '2031-12-31';
  const address = { governorate: 'Cairo', area: 'Maadi' };
  const studio = '/care/admin/studio';

  async function product(key: string, input: { name: string; type: string; role: string; rank: number; periodEligibility?: string; price?: number }): Promise<Sku> {
    const reviewer = await ensureFixtureReviewer(prisma);
    const suffix = `${tag}-${key}`;
    const category = await prisma.category.upsert({ where: { slug: 'skin-care' }, update: {}, create: { slug: 'skin-care', name: 'skin-care' } });
    const brand = await prisma.brand.create({ data: { name: `Brand ${suffix}`, slug: `brand-${suffix}` } });
    const row = await prisma.product.create({ data: {
      brandId: brand.id, categoryId: category.id, name: input.name, slug: `gj-${suffix}`, isPublished: true, productType: input.type,
      usage: 'Apply as the pack directs.', suitableSkinTypes: ['oily'],
    } });
    const barcode = ean13();
    const sku = await prisma.sku.create({ data: { productId: row.id, code: `GJ-${suffix}`, variantName: '50 ml', size: 50, sizeUnit: 'ml', barcode } });
    await prisma.productMedia.create({ data: {
      productId: row.id, type: MediaType.image, url: `https://cdn.fixtures.test/${suffix}.png`, isPrimary: true, originType: MediaOriginType.verified,
      generationMetadata: { isTest: false, reviewedBy: reviewer.id, reviewedAt: new Date().toISOString(), skuId: sku.id, barcode, size: 50, sizeUnit: 'ml',
        variantName: '50 ml', sourceType: 'OFFICIAL_MANUFACTURER', sourceUrl: FIXTURE_SOURCE_URL, identityVerification: 'BARCODE_VERIFIED' },
    } });
    await prisma.skuRoutineProfile.create({ data: {
      skuId: sku.id, productId: row.id, ruleVersion: 'test', productType: input.type, primaryRole: input.role, primaryRoleStatus: 'RULE_DERIVED',
      routineDomain: 'SKIN', stepOrder: input.rank, periodEligibility: input.periodEligibility ?? null,
    } });
    await prisma.listing.create({ data: { skuId: sku.id, isListed: true } });
    await prisma.sellingPrice.create({ data: { skuId: sku.id, amount: input.price ?? 100, currency: 'EGP', validFrom: new Date(Date.now() - 60000) } });
    return { id: sku.id, productId: row.id, barcode, name: input.name };
  }

  const checkoutBody = (q: { quoteVersion: string; revision: number }, key = randomUUID()) => ({
    ...address, customerName: 'Routine Customer', customerPhone: '01012345678', shippingAddress: '12 Road 9, Maadi',
    latitude: 29.9602, longitude: 31.2569, locationSource: 'map_pin', locationConfirmed: true, quoteVersion: q.quoteVersion, cartRevision: q.revision, idempotencyKey: key,
  });
  /** Checks out the customer's CURRENT cart (filled from a routine) as COD. */
  const placeFromCart = async (customer: Actor) => {
    const q = (await http().post('/ordering/checkout/quote').set(customer.auth).send(address).expect(201)).body;
    const order = (await http().post('/ordering/checkout').set(customer.auth).send(checkoutBody(q)).expect(201)).body as Placed;
    await events.dispatchPending({ aggregateId: order.id });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await prisma.supplyRequirement.count({ where: { orderItemId: { in: order.items.map(i => i.id) } } }) === order.items.length) break;
      await pause(100);
      await events.dispatchPending({ aggregateId: order.id });
    }
    return order;
  };
  const cartLines = async (customer: Actor) => ((await http().get('/ordering/cart').set(customer.auth).expect(200)).body.items as Array<{ skuId: string; quantity: number }>);
  const event = (shipmentId: string, actor: Actor, body: Record<string, unknown>) => http().post(`/fulfillment/shipments/${shipmentId}/events`).set(actor.auth).send(body);

  /** Purchase → Hub desk (scan once, cost at receipt) → print/pack → run → delivery with cash → hub cash count. Returns the settlement. */
  const fulfil = async (order: Placed, skus: Sku[]) => {
    const byId = new Map(skus.map(s => [s.id, s]));
    for (const item of order.items) await http().post('/buy-list/acquire').set(hub.auth).send({ skuId: item.skuId, quantity: item.quantity, idempotencyKey: randomUUID() }).expect(200);
    let last: { body: { order: { stage: string; shipment: { id: string; status: string } } } } | undefined;
    for (const item of order.items) {
      for (let unit = 0; unit < item.quantity; unit++) {
        last = await http().post(`/fulfillment/locations/${locationId}/desk/orders/${order.id}/scan`).set(hub.auth).send({
          clientScanId: randomUUID(), barcodeScanned: byId.get(item.skuId)!.barcode, expiryDate: EXPIRY,
          ...(unit === 0 ? { cost: { listUnitPrice: 60, discountPerUnit: 10 } } : {}),
        }).expect(201);
      }
    }
    expect(last!.body.order).toMatchObject({ stage: 'packing', shipment: { status: 'prepared' } });
    const shipmentId = last!.body.order.shipment.id;
    const barcode = (await http().post(`/fulfillment/shipments/${shipmentId}/label`).set(hub.auth).expect(201)).body.barcode as string;
    await event(shipmentId, hub, { type: 'LABEL_PRINTED' }).expect(201);
    await event(shipmentId, hub, { type: 'RECEIPT_PRINTED' }).expect(201);
    await recordPackaging(app, hub.auth, shipmentId);
    await event(shipmentId, hub, { type: 'PACKED' }).expect(201);
    const batch = (await http().post('/fulfillment/delivery-batches').set(hub.auth).send({ hubId: locationId, name: 'Routine run', driverId: driver.id }).expect(201)).body as { id: string };
    await http().post(`/fulfillment/delivery-batches/${batch.id}/stops`).set(hub.auth).send({ stops: [{ shipmentId, sequence: 1 }] }).expect(201);
    await event(shipmentId, driver, { type: 'HANDOFF_SCANNED', barcode }).expect(201);
    await http().post(`/fulfillment/delivery-batches/${batch.id}/dispatch`).set(hub.auth).expect(201);
    await event(shipmentId, driver, { type: 'DELIVERED', collectedAmount: order.codAmount }).expect(201);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('delivered');
    const settled = await http().post('/ordering/settlements/batch').set(hub.auth).send({
      courierId: driver.id, locationId, reference: 'RJ-' + randomUUID(), currency: 'EGP', totalCollected: Number(order.codAmount),
      collections: [{ orderId: order.id, collectedAmount: Number(order.codAmount) }],
    }).expect(201);
    expect(await prisma.paymentCollection.findUniqueOrThrow({ where: { orderId: order.id } })).toMatchObject({ status: 'settled' });
    return settled.body;
  };

  let cleanser: Sku; let moisturizer: Sku; let sunscreen: Sku; let serum: Sku;

  beforeAll(async () => {
    process.env.TEST_BYPASS_AUTH = 'false';
    process.env.SOURCING_MODE = 'INTERNAL_BUY_LIST';
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(AiClient).useValue(ai).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    events = app.get(DomainEventsService);
    admin = await createActor(prisma, Role.ADMIN);
    hub = await createActor(prisma, Role.HUB_OPERATOR);
    driver = await createActor(prisma, Role.DRIVER);
    locationId = (await prisma.fulfillmentLocation.create({ data: { name: 'Routine Hub ' + randomUUID(), address: '1 Hub Street' } })).id;
    await prisma.fulfillmentLocationOperator.create({ data: { locationId, operatorId: hub.id } });
    // Leftovers of earlier runs must not appear as candidates for this run's concern.
    await prisma.product.updateMany({ where: { OR: [{ slug: { startsWith: 'gj-' } }, { slug: { startsWith: 'cc-' } }] }, data: { isPublished: false } });
    await prisma.concern.create({ data: { slug: concern, name: `بشرة دهنية ${tag}`, careArea: 'skin' } });
    cleanser = await product('cleanser', { name: `Purifying Cleanser ${tag}`, type: 'cleanser', role: 'CLEANSER', rank: 2 });
    moisturizer = await product('moisturizer', { name: `Light Moisturizer ${tag}`, type: 'moisturizer', role: 'MOISTURIZER', rank: 8 });
    sunscreen = await product('sunscreen', { name: `Daily Fluid SPF ${tag}`, type: 'sunscreen', role: 'SUNSCREEN', rank: 9, periodEligibility: 'AM' });
    serum = await product('serum', { name: `Balancing Serum ${tag}`, type: 'serum', role: 'SERUM', rank: 6, price: 120 });
    const knowledge = (key: string, data: Record<string, unknown>) => prisma.knowledgeEntry.create({ data: {
      key: `${key}-${tag}`, statementEn: `${key} statement`, statementAr: `جملة ${key}`, evidenceClass: 'EVIDENCE_SUPPORTED', sourceTitle: 'Test Dermatology Body',
      sourceUrl: 'https://example.test/source', sourceType: 'PROFESSIONAL_BODY', retrievedAt: new Date(), ...(data as object),
    } as never });
    for (const type of ['cleanser', 'moisturizer', 'sunscreen']) {
      await knowledge(`type-${type}`, { subjectType: 'PRODUCT_TYPE', subjectKey: type, topic: 'CONCERN_RELEVANCE', concernSlug: concern, careArea: 'skin', strength: 'SUPPORTIVE' });
    }
    await knowledge('escalation', { subjectType: 'CONCERN', subjectKey: concern, topic: 'ESCALATION', concernSlug: concern, careArea: 'skin' });
  });

  afterAll(async () => {
    // This suite's catalog must not stay on the shelf for suites that count orderable products (e.g. consultation).
    await prisma.product.updateMany({ where: { slug: { startsWith: 'gj-' } }, data: { isPublished: false } });
    if (previousMode === undefined) delete process.env.SOURCING_MODE; else process.env.SOURCING_MODE = previousMode;
    await app.close();
  });

  const step = (title: string, timing: string, sku: { id: string }, extra: Record<string, unknown> = {}) => ({ title, timing, product: { skuId: sku.id }, ...extra });

  it('Journey 2: Ready Routine → personal copy → cart → COD order → Hub → delivery, with purchase intent', async () => {
    // Admin authors and publishes a Ready Routine on real products; customers never see the draft.
    const draft = (await http().post(`${studio}/routines`).set(admin.auth).send({
      title: 'روتين البشرة الدهنية ' + tag, description: 'روتين بسيط صباحًا ومساءً.', careArea: 'skin', concernSlug: concern,
      references: [{ title: 'AAD basics', url: 'https://www.aad.org/public/everyday-care' }],
      steps: [step('غسول', 'AM', cleanser), step('مرطّب', 'PM', moisturizer)],
    }).expect(201)).body;
    await http().get(`/care/ready-routines/${draft.id}`).expect(404);
    await http().post(`${studio}/routines/${draft.id}/publish`).set(admin.auth).expect(200);

    const customer = await signInCustomer(app);
    const stranger = await signInCustomer(app);
    const listed = (await http().get(`/care/ready-routines?concern=${concern}`).expect(200)).body as Array<{ id: string }>;
    expect(listed.map(r => r.id)).toContain(draft.id);
    const copy = (await http().post(`/care/personal-routines/from-template/${draft.id}`).set(customer.auth).expect(201)).body;
    expect(copy).toMatchObject({ origin: 'COPY', sourceRoutineId: draft.id });

    // Purchase path: owner only; sellable products only; no doubling; unsellable steps are reported, never replaced.
    await http().post(`/care/personal-routines/${copy.id}/cart`).send({}).expect(401);
    await http().post(`/care/personal-routines/${copy.id}/cart`).set(stranger.auth).send({}).expect(404);
    await prisma.listing.update({ where: { skuId: moisturizer.id }, data: { isListed: false } });
    try {
      const partial = (await http().post(`/care/personal-routines/${copy.id}/cart`).set(customer.auth).send({}).expect(201)).body;
      expect(partial.added).toHaveLength(1);
      expect(partial.unavailable).toEqual([expect.objectContaining({ skuId: moisturizer.id, state: 'UNAVAILABLE' })]);
      expect((await cartLines(customer)).map(l => l.skuId)).toEqual([cleanser.id]);
    } finally {
      await prisma.listing.update({ where: { skuId: moisturizer.id }, data: { isListed: true } });
    }
    // The template can be retired without touching the customer's copy; adding again never doubles the cleanser.
    await http().post(`${studio}/routines/${draft.id}/unpublish`).set(admin.auth).expect(200);
    const rest = (await http().post(`/care/personal-routines/${copy.id}/cart`).set(customer.auth).send({}).expect(201)).body;
    expect(rest.added).toHaveLength(1);
    expect(rest.skipped).toEqual([expect.objectContaining({ skuId: cleanser.id, reason: 'ALREADY_IN_CART' })]);
    expect((await cartLines(customer)).map(l => `${l.skuId}:${l.quantity}`).sort()).toEqual([`${cleanser.id}:1`, `${moisturizer.id}:1`].sort());

    // COD order; purchase intent per line (optional, edit, skip), private, and the commercial order is untouched.
    const order = await placeFromCart(customer);
    expect(Number(order.totalAmount)).toBe(250); // 100 + 100 + 50 delivery
    const before = JSON.stringify(await prisma.orderItem.findMany({ where: { orderId: order.id }, orderBy: { createdAt: 'asc' } }));
    const [first, second] = order.items;
    await http().put(`/ordering/orders/${order.id}/items/${first.id}/purchase-reason`).set(customer.auth).send({ reasons: ['OILY_SKIN', 'DAILY_ROUTINE'], source: 'ROUTINE' }).expect(200);
    await http().put(`/ordering/orders/${order.id}/items/${first.id}/purchase-reason`).set(customer.auth).send({ reasons: ['OILY_SKIN'], note: 'بشرتي بتلمع', source: 'ROUTINE' }).expect(200);
    await http().put(`/ordering/orders/${order.id}/items/${first.id}/purchase-reason`).set(stranger.auth).send({ reasons: ['GIFT'] }).expect(404);
    expect((await http().get(`/ordering/orders/${order.id}/purchase-reasons`).set(customer.auth).expect(200)).body.items.map((i: { status: string }) => i.status).sort()).toEqual(['SPECIFIED', 'UNSPECIFIED']);
    void second;
    expect(JSON.stringify(await prisma.orderItem.findMany({ where: { orderId: order.id }, orderBy: { createdAt: 'asc' } }))).toBe(before);

    const settled = await fulfil(order, [cleanser, moisturizer]);
    expect(settled.lines).toEqual([expect.objectContaining({ orderId: order.id, countedAmount: '250.00', variance: '0.00', status: 'settled' })]);
    // Intent is still readable after delivery, and the copy survived the template being unpublished.
    expect((await http().get(`/ordering/orders/${order.id}/purchase-reasons`).set(customer.auth).expect(200)).body.items.find((i: { orderItemId: string }) => i.orderItemId === first.id).reason.reasons).toEqual(['OILY_SKIN']);
    await http().get(`/care/personal-routines/${copy.id}`).set(customer.auth).expect(200);
  });

  it('Journey 3: Manual Routine → save → reopen → edit → cart (by time of day) → COD order → Hub → delivery', async () => {
    const customer = await signInCustomer(app);
    const stranger = await signInCustomer(app);
    // Create, reopen (resume), then reorder and replace a product; a stale editor cannot overwrite it.
    const created = (await http().post('/care/personal-routines').set(customer.auth).send({
      title: 'روتيني', steps: [step('غسول', 'AM', cleanser), step('مرطّب', 'PM', moisturizer), step('سيروم', 'AS_NEEDED', serum, { isOptional: true })],
    }).expect(201)).body;
    expect(created).toMatchObject({ origin: 'USER', status: 'DRAFT' });
    const resumed = (await http().get(`/care/personal-routines/${created.id}`).set(customer.auth).expect(200)).body;
    expect(resumed.steps.map((s: { timing: string }) => s.timing)).toEqual(['AM', 'PM', 'AS_NEEDED']);
    const edited = (await http().put(`/care/personal-routines/${created.id}`).set(customer.auth).send({
      title: 'روتيني المعدّل', expectedVersion: resumed.version,
      steps: [step('واقي شمس', 'AM', sunscreen), step('غسول', 'AM', cleanser), step('مرطّب', 'PM', moisturizer)],
    }).expect(200)).body;
    expect(edited.steps.map((s: { title: string }) => s.title)).toEqual(['واقي شمس', 'غسول', 'مرطّب']);
    await http().put(`/care/personal-routines/${created.id}`).set(customer.auth).send({ title: 'stale', expectedVersion: resumed.version, steps: [step('x', 'AM', cleanser)] }).expect(409);
    await http().put(`/care/personal-routines/${created.id}`).set(stranger.auth).send({ title: 'mine', steps: [step('x', 'AM', cleanser)] }).expect(404);

    // Morning part first, then the rest: nothing is bought twice and the cart mirrors the routine.
    const am = (await http().post(`/care/personal-routines/${created.id}/cart`).set(customer.auth).send({ timing: 'AM' }).expect(201)).body;
    expect(am.added).toHaveLength(2);
    expect((await cartLines(customer)).map(l => l.skuId).sort()).toEqual([sunscreen.id, cleanser.id].sort());
    const all = (await http().post(`/care/personal-routines/${created.id}/cart`).set(customer.auth).send({}).expect(201)).body;
    expect(all.added).toHaveLength(1);
    expect(all.skipped.map((s: { reason: string }) => s.reason)).toEqual(['ALREADY_IN_CART', 'ALREADY_IN_CART']);
    await http().post(`/care/personal-routines/${created.id}/cart`).set(customer.auth).send({ timing: 'MIDNIGHT' }).expect(400);

    const order = await placeFromCart(customer);
    expect(order.items).toHaveLength(3);
    expect(Number(order.totalAmount)).toBe(350);
    await http().put(`/ordering/orders/${order.id}/items/${order.items[0].id}/purchase-reason`).set(customer.auth).send({ reasons: ['SUN_PROTECTION'], source: 'ROUTINE' }).expect(200);
    await fulfil(order, [sunscreen, cleanser, moisturizer]);
    // Editing the routine later never changes what was ordered.
    await http().put(`/care/personal-routines/${created.id}`).set(customer.auth).send({ title: 'بعد الطلب', expectedVersion: edited.version, steps: [step('غسول', 'AM', cleanser)] }).expect(200);
    expect(await prisma.orderItem.count({ where: { orderId: order.id } })).toBe(3);
  });

  it('Journey 4: Chatbot → AI routine proposal → review/edit → explicit save → cart → COD order → Hub → delivery, with outage safety', async () => {
    const customer = await signInCustomer(app);
    const stranger = await signInCustomer(app);
    const understood = (patch: Record<string, unknown>) => (input: ConsultUnderstandRequest): Partial<ConsultUnderstandResult> =>
      ({ context: { ...input.knownContext, ...patch } as ConsultUnderstandResult['context'] });
    const NOT_PREGNANT = { pregnant: 'NO', breastfeeding: 'NO', prescriptionTopical: 'UNKNOWN', oralRetinoid: 'NO' };
    ai.down = false; ai.respond = null;
    ai.understand = input => ({ ...understood({ careArea: 'skin', concerns: [concern], skinType: 'oily', safety: NOT_PREGNANT })(input), intent: 'build_routine' });
    const session = (await http().post('/guidance/sessions').set(customer.auth).send({}).expect(201)).body;
    const routineCount = () => prisma.routine.count({ where: { ownerCustomerId: customer.id } });

    // Customer need → grounded structured proposal. Proposing changes nothing: no routine, no cart, no order.
    const reply = await http().post(`/guidance/sessions/${session.id}/messages`).set(customer.auth).send({ content: 'عايزة روتين لبشرتي الدهنية' }).expect(201);
    const proposal = reply.body.payload.routine as { canSave: boolean; steps: Array<{ slot: string; item: { skuId: string; productId: string; name: string } }> };
    expect(proposal.steps.length).toBeGreaterThanOrEqual(2);
    const mine = new Set([cleanser.id, moisturizer.id, sunscreen.id]);
    expect(proposal.steps.every(s => mine.has(s.item.skuId))).toBe(true); // only real, orderable products of this catalog
    expect(JSON.stringify(ai.respondCalls[0].candidates)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/); // the model never sees catalog ids
    expect(await routineCount()).toBe(0);
    expect(await cartLines(customer)).toEqual([]);
    expect(await prisma.order.count({ where: { customerId: customer.id } })).toBe(0);

    // The customer reviews and edits (drops the last step); the shared rules re-check the edited routine.
    const edited = proposal.steps.slice(0, -1);
    const checked = (await http().post('/care/routines/check').set(customer.auth).send({ steps: edited.map(s => ({ skuId: s.item.skuId, timing: s.slot })) }).expect(201)).body;
    expect(checked.ok).toBe(true);
    const body = { idempotencyKey: randomUUID(), title: 'روتيني من الشات', careArea: 'skin',
      steps: edited.map(s => ({ title: s.item.name.slice(0, 80), timing: s.slot, skuId: s.item.skuId, reason: 'خطوة أساسية' })) };

    // Nothing is saved without explicit confirmation; a forged product, an unsupported claim or an injected cart action are refused.
    await http().post('/care/personal-routines/from-proposal').set(customer.auth).send(body).expect(400);
    await http().post('/care/personal-routines/from-proposal').set(customer.auth).send({ ...body, confirmed: true, steps: [{ title: 'x', timing: 'AM', skuId: randomUUID() }] }).expect(422);
    await http().post('/care/personal-routines/from-proposal').set(customer.auth).send({ ...body, confirmed: true, steps: [{ title: 'x', timing: 'AM', skuId: cleanser.id, reason: 'يعالج الحبوب نهائيًا ومضمون' }] }).expect(422);
    await http().post('/care/personal-routines/from-proposal').set(customer.auth).send({ ...body, confirmed: true, addToCart: true }).expect(400);
    await http().post('/care/personal-routines/from-proposal').send({ ...body, confirmed: true }).expect(401);
    expect(await routineCount()).toBe(0);

    // Explicit confirmation saves once (replay-safe), privately, and still without touching the cart.
    const saved = (await http().post('/care/personal-routines/from-proposal').set(customer.auth).send({ ...body, confirmed: true }).expect(201)).body;
    expect(saved).toMatchObject({ origin: 'AI', replayed: false });
    expect((await http().post('/care/personal-routines/from-proposal').set(customer.auth).send({ ...body, confirmed: true }).expect(201)).body).toMatchObject({ id: saved.id, replayed: true });
    expect(await routineCount()).toBe(1);
    await http().get(`/care/personal-routines/${saved.id}`).set(stranger.auth).expect(404);
    expect(await cartLines(customer)).toEqual([]);

    // AI outage: the engine keeps answering, says so, and nothing is saved, carted or ordered by the failure.
    ai.down = true;
    const outage = (await http().post('/guidance/sessions').set(customer.auth).send({}).expect(201)).body;
    const fallback = await http().post(`/guidance/sessions/${outage.id}/messages`).set(customer.auth).send({ content: `عايزة غسول ${concern}` }).expect(201);
    expect(fallback.body.payload.source).toBe('FALLBACK');
    ai.down = false;
    expect(await routineCount()).toBe(1);
    expect(await cartLines(customer)).toEqual([]);

    // Purchase the saved routine, intent attributed to the chatbot, then the Hub takes it to delivery.
    const bought = (await http().post(`/care/personal-routines/${saved.id}/cart`).set(customer.auth).send({}).expect(201)).body;
    const distinct = [...new Set(edited.map(s => s.item.skuId))].sort(); // one product used at two times of day is bought once
    expect(bought.added).toHaveLength(distinct.length);
    const order = await placeFromCart(customer);
    expect(order.items.map(i => i.skuId).sort()).toEqual(distinct);
    await http().put(`/ordering/orders/${order.id}/items/${order.items[0].id}/purchase-reason`).set(customer.auth).send({ reasons: ['OILY_SKIN'], source: 'CHATBOT' }).expect(200);
    await fulfil(order, [cleanser, moisturizer, sunscreen]);
    expect(await prisma.order.count({ where: { customerId: customer.id } })).toBe(1);
  });
});

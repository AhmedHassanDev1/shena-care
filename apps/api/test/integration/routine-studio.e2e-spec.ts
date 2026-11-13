import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { Role } from '@prisma/client';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { createActor, Actor } from '../fixtures/actors';
import { createSellableSku } from '../fixtures/sellable-sku';

/**
 * GLO-311 / GLO-312 / GLO-313: Routine Studio (draft → preview → publish), JSON import, My Routine persistence and
 * validated AI-proposal saving on the shared routine domain.
 */
describe('Routine Studio, My Routine and AI proposal saving (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Actor; let hub: Actor; let driver: Actor; let customer: Actor; let other: Actor;
  let a: Awaited<ReturnType<typeof createSellableSku>>; let b: Awaited<ReturnType<typeof createSellableSku>>;
  let unpublished: { id: string; code: string };
  let concernSlug: string;
  const http = () => request(app.getHttpServer());
  const studio = '/care/admin/studio';

  const step = (title: string, timing: string, sku: { id: string }, extra: Record<string, unknown> = {}) =>
    ({ title, timing, product: { skuId: sku.id }, ...extra });
  const template = (overrides: Record<string, unknown> = {}) => ({
    title: 'روتين البشرة الدهنية ' + randomUUID().slice(0, 6), description: 'روتين بسيط صباحًا ومساءً.', careArea: 'skin', concernSlug,
    references: [{ title: 'AAD basics', url: 'https://www.aad.org/public/everyday-care' }],
    steps: [step('غسول', 'AM', a), step('مرطّب', 'PM', b, { alternatives: [{ skuId: a.id }] })], ...overrides,
  });
  const createDraft = async (overrides: Record<string, unknown> = {}) =>
    (await http().post(`${studio}/routines`).set(admin.auth).send(template(overrides)).expect(201)).body;

  beforeAll(async () => {
    process.env.TEST_BYPASS_AUTH = 'false';
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    admin = await createActor(prisma, Role.ADMIN);
    hub = await createActor(prisma, Role.HUB_OPERATOR);
    driver = await createActor(prisma, Role.DRIVER);
    customer = await createActor(prisma, Role.CUSTOMER);
    other = await createActor(prisma, Role.CUSTOMER);
    a = await createSellableSku(prisma);
    b = await createSellableSku(prisma);
    const brand = await prisma.brand.create({ data: { name: 'Hidden ' + randomUUID(), slug: 'hidden-' + randomUUID() } });
    const product = await prisma.product.create({ data: { brandId: brand.id, name: 'Unpublished', slug: 'unpublished-' + randomUUID(), isPublished: false } });
    const sku = await prisma.sku.create({ data: { productId: product.id, code: 'UNPUB-' + randomUUID(), variantName: '30 ml', barcode: 'UNPUB-BAR-' + randomUUID() } });
    unpublished = { id: sku.id, code: sku.code };
    concernSlug = 'oily-' + randomUUID().slice(0, 8);
    await prisma.concern.create({ data: { name: 'Oily ' + concernSlug, slug: concernSlug, careArea: 'skin' } });
  });
  afterAll(async () => { await app.close(); });

  describe('Studio', () => {
    it('is Admin only', async () => {
      await http().get(`${studio}/routines`).expect(401);
      for (const actor of [customer, hub, driver]) await http().get(`${studio}/routines`).set(actor.auth).expect(403);
      await http().post(`${studio}/routines`).set(customer.auth).send(template()).expect(403);
      await http().post(`${studio}/import/preview`).set(driver.auth).send({ document: {} }).expect(403);
      await http().get(`${studio}/routines`).set(admin.auth).expect(200);
    });

    it('creates a draft that customers cannot see, then publishes it only when it is ready', async () => {
      const draft = await createDraft();
      expect(draft).toMatchObject({ status: 'DRAFT', origin: 'TEMPLATE', version: 1, isTemplate: true });
      expect(draft.steps.map((s: { timing: string }) => s.timing)).toEqual(['AM', 'PM']);
      expect(draft.steps[1].alternatives).toHaveLength(1);
      expect(draft.steps[0].product).toMatchObject({ state: 'AVAILABLE', skuId: a.id });

      // Drafts are invisible: public list, public detail and the legacy by-id read all say "not found".
      await http().get(`/care/ready-routines/${draft.id}`).expect(404);
      expect(((await http().get(`/care/ready-routines?concern=${concernSlug}`).expect(200)).body as Array<{ id: string }>).some(r => r.id === draft.id)).toBe(false);
      await http().get(`/care/routines/${draft.id}`).set(customer.auth).expect(404);

      // Publish gate: no reference → refused with the exact problem.
      const noRefs = await createDraft({ references: [] });
      const refused = await http().post(`${studio}/routines/${noRefs.id}/publish`).set(admin.auth).expect(422);
      expect(refused.body.issues.map((i: { code: string }) => i.code)).toContain('REQUIRED');

      const published = (await http().post(`${studio}/routines/${draft.id}/publish`).set(admin.auth).expect(200)).body;
      expect(published).toMatchObject({ status: 'PUBLISHED', version: 2 });
      const publicView = (await http().get(`/care/ready-routines/${draft.id}`).expect(200)).body;
      expect(publicView.steps[0].product).toMatchObject({ state: 'AVAILABLE', skuCode: a.code });
      expect(((await http().get(`/care/ready-routines?concern=${concernSlug}`).expect(200)).body as Array<{ id: string }>).some(r => r.id === draft.id)).toBe(true);

      // A published routine is not edited in place; unpublishing hides it and keeps the history.
      await http().put(`${studio}/routines/${draft.id}`).set(admin.auth).send(template({ expectedVersion: 2 })).expect(409);
      await http().post(`${studio}/routines/${draft.id}/unpublish`).set(admin.auth).expect(200);
      await http().get(`/care/ready-routines/${draft.id}`).expect(404);
      const revisions = (await http().get(`${studio}/routines/${draft.id}/revisions`).set(admin.auth).expect(200)).body as Array<{ action: string }>;
      expect(revisions.map(r => r.action).sort()).toEqual(['created', 'published', 'unpublished']);
    });

    it('never publishes a recommendation that is not sellable and shows the state instead of swapping it', async () => {
      const draft = await createDraft({ steps: [step('غسول', 'AM', unpublished)] });
      expect(draft.steps[0].product.state).toBe('UNPUBLISHED');
      const refused = await http().post(`${studio}/routines/${draft.id}/publish`).set(admin.auth).expect(422);
      expect(refused.body.issues[0]).toMatchObject({ code: 'PRODUCT_UNPUBLISHED' });
    });

    it('rejects unknown products, unsupported claims, unknown concerns and stale edits', async () => {
      const unknownProduct = await http().post(`${studio}/routines`).set(admin.auth)
        .send(template({ steps: [{ title: 'x', timing: 'AM', product: { sku: 'NO-SUCH-' + randomUUID() } }] })).expect(422);
      expect(unknownProduct.body.issues[0].code).toBe('PRODUCT_NOT_FOUND');
      await http().post(`${studio}/routines`).set(admin.auth).send(template({ description: 'يعالج حب الشباب نهائيًا' })).expect(422);
      await http().post(`${studio}/routines`).set(admin.auth).send(template({ concernSlug: 'no-such-concern' })).expect(422);
      await http().post(`${studio}/routines`).set(admin.auth).send(template({ steps: [step('x', 'MIDNIGHT', a)] })).expect(400);

      const draft = await createDraft();
      await http().put(`${studio}/routines/${draft.id}`).set(admin.auth).send(template({ expectedVersion: 1, title: 'Edited ' + randomUUID().slice(0, 4) })).expect(200);
      const stale = await http().put(`${studio}/routines/${draft.id}`).set(admin.auth).send(template({ expectedVersion: 1 })).expect(409);
      expect(stale.body.code).toBe('STALE_VERSION');
    });
  });

  describe('JSON import', () => {
    const doc = (overrides: Record<string, unknown> = {}) => ({
      schema: 'shinacare.routine/v1', title: { ar: 'روتين مستورد ' + randomUUID().slice(0, 6), en: 'Imported' }, concern: concernSlug, careArea: 'skin',
      description: 'روتين بسيط.', references: [{ title: 'AAD', url: 'https://www.aad.org/public' }],
      steps: [{ timing: 'AM', title: 'غسول', usage: 'اشطفي جيدًا', product: { sku: a.code } }, { timing: 'PM', title: 'مرطّب', product: { barcode: b.barcode }, alternatives: [{ sku: a.code }] }],
      ...overrides,
    });

    it('serves the documented schema and example', async () => {
      const schema = (await http().get(`${studio}/import/schema`).set(admin.auth).expect(200)).body;
      expect(schema).toMatchObject({ schema: 'shinacare.routine/v1', timings: ['AM', 'PM', 'AS_NEEDED'] });
      expect(schema.example.steps.length).toBeGreaterThan(0);
    });

    it('previews without saving, creates a draft only after confirmation, and refuses a duplicate upload', async () => {
      const document = doc();
      const before = await prisma.routine.count({ where: { concernSlug } });
      const preview = (await http().post(`${studio}/import/preview`).set(admin.auth).send({ document }).expect(200)).body;
      expect(preview.valid).toBe(true);
      expect(preview.preview.steps[0].product).toMatchObject({ skuCode: a.code, state: 'AVAILABLE' });
      expect(preview.preview.steps[1].product).toMatchObject({ skuCode: b.code });
      expect(await prisma.routine.count({ where: { concernSlug } })).toBe(before);

      // Without confirm: still nothing saved.
      const unconfirmed = (await http().post(`${studio}/import`).set(admin.auth).send({ document }).expect(201)).body;
      expect(unconfirmed.created).toBe(false);
      expect(await prisma.routine.count({ where: { concernSlug } })).toBe(before);

      const created = (await http().post(`${studio}/import`).set(admin.auth).send({ document, confirm: true }).expect(201)).body;
      expect(created).toMatchObject({ status: 'DRAFT', origin: 'TEMPLATE' });
      await http().get(`/care/ready-routines/${created.id}`).expect(404); // never auto-published

      const duplicate = await http().post(`${studio}/import`).set(admin.auth).send({ document, confirm: true }).expect(409);
      expect(duplicate.body).toMatchObject({ code: 'DUPLICATE_IMPORT', routineId: created.id });
      const reordered = JSON.parse(JSON.stringify(document));
      await http().post(`${studio}/import/preview`).set(admin.auth).send({ document: { ...reordered, title: reordered.title } }).expect(200)
        .then(res => expect(res.body.duplicateOf).toBe(created.id));
    });

    it('explains every invalid case and saves nothing', async () => {
      const codes = async (document: unknown) => ((await http().post(`${studio}/import/preview`).set(admin.auth).send({ document }).expect(200)).body.issues as Array<{ code: string }>).map(i => i.code);
      const before = await prisma.routine.count({ where: { concernSlug } });
      expect(await codes(doc({ schema: 'shinacare.routine/v9' }))).toContain('UNSUPPORTED_VERSION');
      expect(await codes(doc({ steps: [{ timing: 'MIDNIGHT', title: 'x', product: { sku: a.code } }] }))).toContain('UNSUPPORTED_TIMING');
      expect(await codes(doc({ steps: [{ timing: 'AM', title: 'x', product: { sku: 'NOPE-' + randomUUID() } }] }))).toContain('PRODUCT_NOT_FOUND');
      expect(await codes(doc({ steps: [{ timing: 'AM', title: 'x', product: { sku: a.code, expect: { variant: '999 ml' } } }] }))).toContain('WRONG_VARIANT');
      expect(await codes(doc({ steps: [{ timing: 'AM', title: 'x', product: { sku: unpublished.code } }] }))).toContain('PRODUCT_UNPUBLISHED');
      expect(await codes(doc({ steps: [{ timing: 'AM', title: '<script>x</script>', product: { sku: a.code } }] }))).toContain('MARKUP_NOT_ALLOWED');
      expect(await codes(doc({ steps: [{ timing: 'AM', title: 'x', product: { sku: a.code, skuId: a.id } }] }))).toContain('PRODUCT_REFERENCE');
      expect(await codes(doc({ surprise: true }))).toContain('UNKNOWN_FIELD');
      expect(await codes(doc({ references: [{ title: 'x', url: 'javascript:alert(1)' }] }))).toContain('INVALID_URL');
      expect(await codes(doc({ steps: Array.from({ length: 31 }, () => ({ timing: 'AM', title: 'x', product: { sku: a.code } })) }))).toContain('TOO_MANY');
      expect(await codes(doc({ concern: 'no-such-concern' }))).toContain('UNKNOWN_CONCERN');
      expect(await codes(doc({ description: 'x'.repeat(70_000) }))).toContain('TOO_LARGE');
      // A missing alternative is skipped and reported, never dropped silently; a missing main product blocks the import.
      const withBadAlt = (await http().post(`${studio}/import/preview`).set(admin.auth).send({ document: doc({
        steps: [{ timing: 'AM', title: 'x', product: { sku: a.code }, alternatives: [{ sku: 'NOPE-' + randomUUID() }] }] }) }).expect(200)).body;
      expect(withBadAlt.valid).toBe(true);
      expect(withBadAlt.skipped).toHaveLength(1);
      await http().post(`${studio}/import`).set(admin.auth).send({ document: doc({ schema: 'bad' }), confirm: true }).expect(422);
      expect(await prisma.routine.count({ where: { concernSlug } })).toBe(before);
    });
  });

  describe('My Routine', () => {
    it('persists create → reopen → edit/reorder/remove, owner only', async () => {
      const created = (await http().post('/care/personal-routines').set(customer.auth).send({
        title: 'روتيني', steps: [step('غسول', 'AM', a), step('مرطّب', 'PM', b), step('قناع', 'AS_NEEDED', a, { instructions: 'مرة في الأسبوع', isOptional: true })],
      }).expect(201)).body;
      expect(created).toMatchObject({ origin: 'USER', isTemplate: false, status: 'DRAFT' });

      const reopened = (await http().get(`/care/personal-routines/${created.id}`).set(customer.auth).expect(200)).body;
      expect(reopened.steps.map((s: { timing: string; title: string }) => `${s.timing}:${s.title}`)).toEqual(['AM:غسول', 'PM:مرطّب', 'AS_NEEDED:قناع']);
      expect(((await http().get('/care/personal-routines').set(customer.auth).expect(200)).body as Array<{ id: string }>).some(r => r.id === created.id)).toBe(true);

      // Reorder + remove a step + change the product of another.
      const edited = (await http().put(`/care/personal-routines/${created.id}`).set(customer.auth).send({
        title: 'روتيني المعدّل', expectedVersion: reopened.version, steps: [step('مرطّب', 'PM', a), step('غسول', 'AM', b)],
      }).expect(200)).body;
      expect(edited.steps.map((s: { title: string }) => s.title)).toEqual(['مرطّب', 'غسول']);
      expect(edited.steps[0].product.skuId).toBe(a.id);
      expect(edited.version).toBe(reopened.version + 1);
      await http().put(`/care/personal-routines/${created.id}`).set(customer.auth).send({ title: 'x', expectedVersion: reopened.version, steps: [step('x', 'AM', a)] }).expect(409);

      // Someone else's routine does not exist for the caller.
      await http().get(`/care/personal-routines/${created.id}`).set(other.auth).expect(404);
      await http().put(`/care/personal-routines/${created.id}`).set(other.auth).send({ title: 'mine now', steps: [step('x', 'AM', a)] }).expect(404);
      await http().delete(`/care/personal-routines/${created.id}`).set(other.auth).expect(404);
      await http().get(`/care/routines/${created.id}`).set(other.auth).expect(404);
      await http().get('/care/personal-routines').expect(401);

      await http().delete(`/care/personal-routines/${created.id}`).set(customer.auth).expect(200);
      await http().get(`/care/personal-routines/${created.id}`).set(customer.auth).expect(404);
    });

    it('rejects unknown products and shows a product that stopped being sellable without replacing it', async () => {
      await http().post('/care/personal-routines').set(customer.auth).send({ title: 'x', steps: [{ title: 'x', timing: 'AM', product: { sku: 'NOPE-' + randomUUID() } }] }).expect(422);
      const routine = (await http().post('/care/personal-routines').set(customer.auth).send({ title: 'روتيني', steps: [step('غسول', 'AM', b)] }).expect(201)).body;
      await prisma.listing.update({ where: { skuId: b.id }, data: { isListed: false } });
      try {
        const view = (await http().get(`/care/personal-routines/${routine.id}`).set(customer.auth).expect(200)).body;
        expect(view.steps[0].product).toMatchObject({ skuId: b.id, state: 'UNAVAILABLE' });
      } finally {
        await prisma.listing.update({ where: { skuId: b.id }, data: { isListed: true } });
      }
      // A product removed from the catalog leaves the step with no product instead of a silent substitute.
      const brand = await prisma.brand.create({ data: { name: 'Gone ' + randomUUID(), slug: 'gone-' + randomUUID() } });
      const product = await prisma.product.create({ data: { brandId: brand.id, name: 'Gone', slug: 'gone-' + randomUUID(), isPublished: true } });
      const sku = await prisma.sku.create({ data: { productId: product.id, code: 'GONE-' + randomUUID(), variantName: 'x', barcode: 'GONE-' + randomUUID() } });
      const gone = (await http().post('/care/personal-routines').set(customer.auth).send({ title: 'g', steps: [step('s', 'AM', sku)] }).expect(201)).body;
      await prisma.routineStepRecommendation.deleteMany({ where: { productId: product.id } });
      expect((await http().get(`/care/personal-routines/${gone.id}`).set(customer.auth).expect(200)).body.steps[0].product).toBeNull();
    });

    it('copies a published Ready Routine without ever altering the template', async () => {
      const draft = await createDraft();
      await http().post(`/care/personal-routines/from-template/${draft.id}`).set(customer.auth).expect(404); // unpublished
      await http().post(`${studio}/routines/${draft.id}/publish`).set(admin.auth).expect(200);
      const copy = (await http().post(`/care/personal-routines/from-template/${draft.id}`).set(customer.auth).expect(201)).body;
      expect(copy).toMatchObject({ origin: 'COPY', sourceRoutineId: draft.id, isTemplate: false });
      expect(copy.steps).toHaveLength(2);
      await http().put(`/care/personal-routines/${copy.id}`).set(customer.auth).send({ title: 'نسختي', expectedVersion: copy.version, steps: [step('فقط', 'AM', b)] }).expect(200);
      const templateAfter = (await http().get(`/care/ready-routines/${draft.id}`).expect(200)).body;
      expect(templateAfter.steps).toHaveLength(2);
      expect(templateAfter.title).toBe(draft.title);
    });
  });

  describe('AI proposal → review → save', () => {
    const proposal = (overrides: Record<string, unknown> = {}) => ({
      idempotencyKey: randomUUID(), confirmed: true, title: 'روتين مقترح',
      steps: [{ title: 'غسول', timing: 'AM', skuId: a.id, reason: 'مناسب للبشرة الدهنية' }, { title: 'مرطّب', timing: 'PM', skuId: b.id }], ...overrides,
    });

    it('saves only after explicit confirmation, validated against the real catalog, and replays safely', async () => {
      await http().post('/care/personal-routines/from-proposal').set(customer.auth).send(proposal({ confirmed: false })).expect(400);
      await http().post('/care/personal-routines/from-proposal').send(proposal()).expect(401);

      const body = proposal();
      const saved = (await http().post('/care/personal-routines/from-proposal').set(customer.auth).send(body).expect(201)).body;
      expect(saved).toMatchObject({ origin: 'AI', replayed: false, isTemplate: false });
      expect(saved.steps[0]).toMatchObject({ reason: 'مناسب للبشرة الدهنية', instructions: null });
      const replay = (await http().post('/care/personal-routines/from-proposal').set(customer.auth).send(body).expect(201)).body;
      expect(replay).toMatchObject({ id: saved.id, replayed: true });
      expect((await http().get(`/care/personal-routines/${saved.id}`).set(customer.auth).expect(200)).body.steps).toHaveLength(2);
      // Another account cannot read it, and replaying its key as someone else creates their own routine.
      await http().get(`/care/personal-routines/${saved.id}`).set(other.auth).expect(404);
      const theirs = (await http().post('/care/personal-routines/from-proposal').set(other.auth).send(body).expect(201)).body;
      expect(theirs.id).not.toBe(saved.id);
    });

    it('refuses wrong variants, unavailable products, unsupported claims and injected fields — all or nothing', async () => {
      const count = () => prisma.routine.count({ where: { ownerCustomerId: customer.id, origin: 'AI' } });
      const before = await count();
      const missing = await http().post('/care/personal-routines/from-proposal').set(customer.auth).send(proposal({ steps: [{ title: 'x', timing: 'AM', skuId: randomUUID() }] })).expect(422);
      expect(missing.body.issues[0].code).toBe('PRODUCT_NOT_FOUND');
      const unavailable = await http().post('/care/personal-routines/from-proposal').set(customer.auth)
        .send(proposal({ steps: [{ title: 'ok', timing: 'AM', skuId: a.id }, { title: 'x', timing: 'PM', skuId: unpublished.id }] })).expect(422);
      expect(unavailable.body.issues[0].code).toBe('PRODUCT_UNPUBLISHED');
      await http().post('/care/personal-routines/from-proposal').set(customer.auth)
        .send(proposal({ steps: [{ title: 'x', timing: 'AM', skuId: a.id, reason: 'يعالج الحبوب نهائيًا ومضمون' }] })).expect(422);
      // A prompt-injected extra field (e.g. an order or cart action) is not part of the contract.
      await http().post('/care/personal-routines/from-proposal').set(customer.auth).send(proposal({ addToCart: true })).expect(400);
      await http().post('/care/personal-routines/from-proposal').set(customer.auth)
        .send(proposal({ steps: [{ title: 'x', timing: 'AM', skuId: a.id, usage: 'خذ 10 جرام' }] })).expect(400);
      expect(await count()).toBe(before);
    });

    it('sends medical-sensitive customers to a professional instead of saving an assistant routine', async () => {
      const sensitive = await createActor(prisma, Role.CUSTOMER);
      const profile = await prisma.customerCareProfile.create({ data: { customerId: sensitive.id } });
      await prisma.careSafetyFlags.create({ data: { careProfileId: profile.id, pregnant: 'YES', consentVersion: 'v1', consentAt: new Date() } });
      const refused = await http().post('/care/personal-routines/from-proposal').set(sensitive.auth).send(proposal()).expect(403);
      expect(refused.body.code).toBe('SAFETY_REVIEW_REQUIRED');
    });
  });
});

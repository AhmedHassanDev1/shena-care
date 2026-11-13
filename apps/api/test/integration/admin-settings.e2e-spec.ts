/* eslint-disable @typescript-eslint/no-explicit-any -- HTTP response bodies are asserted structurally */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { runtimeSetting, replaceRuntimeSettings } from '../../src/platform/settings/runtime-settings';
import { SettingsService } from '../../src/modules/operations/settings/settings.service';
import { SETTING_DEFINITIONS } from '../../src/modules/operations/settings/setting-definitions';
import { computeDeliveryFee, loadDeliveryFeePolicy } from '../../src/modules/ordering/services/delivery-fee';
import { decisionWindowHours } from '../../src/modules/ordering/services/decision-window';
import { getSourcingMode } from '../../src/modules/sourcing/config/procurement-batch.config';
import { serviceGovernorate } from '../../src/modules/ordering/services/service-area';
import { createActor, Actor } from '../fixtures/actors';

/** Admin Settings (الإعدادات): validated, server-persisted, Admin-only, audited, and applied by the code that enforces them. */
describe('Admin settings (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let settings: SettingsService;
  let admin: Actor;
  let hub: Actor;
  let customer: Actor;
  const api = () => request(app.getHttpServer());
  const patch = (changes: Record<string, unknown>, actor: Actor = admin) => api().patch('/operations/settings').set(actor.auth).send({ changes });
  const valueOf = (list: any[], key: string) => list.find(item => item.key === key);

  const resetAll = async () => {
    await prisma.appSetting.deleteMany({});
    await settings.refresh();
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    settings = app.get(SettingsService);
    admin = await createActor(prisma, 'ADMIN');
    hub = await createActor(prisma, 'HUB_OPERATOR');
    customer = await createActor(prisma, 'CUSTOMER');
    await resetAll();
  }, 120000);

  afterAll(async () => {
    await resetAll();
    await prisma.appSettingChange.deleteMany({ where: { actorId: admin.id } });
    await app.close();
  });

  it('only Admins can read or change settings', async () => {
    await api().get('/operations/settings').expect(401);
    await api().get('/operations/settings').set(hub.auth).expect(403);
    await api().get('/operations/settings').set(customer.auth).expect(403);
    await patch({ 'commerce.cod.enabled': false }, hub).expect(403);
    await api().post('/operations/settings/commerce.cod.enabled/reset').set(customer.auth).expect(403);
    await api().get('/operations/settings/history').set(hub.auth).expect(403);
    await api().get('/operations/settings/security').set(hub.auth).expect(403);
    expect(runtimeSetting('commerce.cod.enabled')).toBeUndefined();
  });

  it('lists every setting with its group, kind, current value and default, and exposes no secrets', async () => {
    const list = (await api().get('/operations/settings').set(admin.auth).expect(200)).body as any[];
    expect(list.map(item => item.key).sort()).toEqual(SETTING_DEFINITIONS.map(item => item.key).sort());
    expect(list.length).toBeLessThanOrEqual(17) // 15 + packaging bag and box cost + profit-share percentage;
    expect(new Set(list.map(item => item.group))).toEqual(new Set(['commerce', 'operations', 'business']));
    expect(valueOf(list, 'commerce.cod.enabled')).toMatchObject({ value: true, source: 'DEFAULT', kind: 'boolean' });
    expect(valueOf(list, 'commerce.delivery.policy').value).toMatchObject({ freeFrom: expect.any(Number), bands: expect.any(Array) });
    expect(valueOf(list, 'commerce.delivery.areas')).toMatchObject({ options: ['Cairo', 'Giza'] });
    expect(JSON.stringify(list)).not.toMatch(/secret|token|password|api[_-]?key|DATABASE_URL/i);
  });

  it('rejects invalid values and unknown keys without storing anything from the batch', async () => {
    const reject = async (changes: Record<string, unknown>) => {
      await patch(changes).expect(400);
    };
    await reject({ 'not.a.setting': true });
    await reject({ 'commerce.cod.enabled': 'yes' });
    await reject({ 'commerce.packaging.carton_cost': -1 });
    await reject({ 'commerce.packaging.carton_cost': 1.234 });
    await reject({ 'commerce.delivery.internal_cost': 'free' });
    await reject({ 'operations.sourcing.mode': 'AUCTION' });
    await reject({ 'operations.decision_window_hours': 0 });
    await reject({ 'operations.decision_window_hours': 5.5 });
    await reject({ 'commerce.delivery.areas': [] });
    await reject({ 'commerce.delivery.areas': ['Alexandria'] });
    await reject({ 'business.phone': 'call me' });
    await reject({ 'business.facebook.url': 'http://facebook.com/shena' });
    await reject({ 'business.facebook.url': 'https://example.com/shena' });
    await reject({ 'commerce.cod.enabled': null });
    await reject({ 'commerce.delivery.policy': { bands: [], discountTiers: [], freeFrom: 500 } });
    await reject({ 'commerce.delivery.policy': { bands: [{ maxKm: 10, fee: 30 }, { maxKm: null, fee: 40 }], discountTiers: [], freeFrom: 0 } });
    await reject({ 'commerce.delivery.policy': { bands: [{ maxKm: 30, fee: 40 }, { maxKm: 10, fee: 30 }, { maxKm: null, fee: 50 }], discountTiers: [], freeFrom: 500 } });
    await api().patch('/operations/settings').set(admin.auth).send({}).expect(400);
    // One bad value rejects the whole batch.
    await reject({ 'commerce.cod.enabled': false, 'operations.sourcing.mode': 'AUCTION' });
    expect(await prisma.appSetting.count()).toBe(0);
    expect(runtimeSetting('commerce.cod.enabled')).toBeUndefined();
  });

  it('refuses to switch a contact channel on before its number or link exists', async () => {
    await patch({ 'business.whatsapp.enabled': true }).expect(400);
    await patch({ 'business.facebook.enabled': true }).expect(400);
    const ok = await patch({ 'business.whatsapp.number': '+20 100 123 4567', 'business.whatsapp.enabled': true, 'business.phone': '01001234567', 'business.facebook.url': 'https://www.facebook.com/shenacare', 'business.facebook.enabled': true });
    expect(ok.status).toBe(200);
    const contact = (await api().get('/storefront/contact').expect(200)).body;
    expect(contact).toEqual({ phone: '01001234567', whatsapp: { number: '+20 100 123 4567' }, facebook: { url: 'https://www.facebook.com/shenacare' }, ordersOpen: true });
    // Clearing the number while WhatsApp is on is refused; switching it off first works and hides the channel publicly.
    await patch({ 'business.whatsapp.number': null }).expect(400);
    await patch({ 'business.whatsapp.enabled': false }).expect(200);
    expect((await api().get('/storefront/contact').expect(200)).body.whatsapp).toBeNull();
    await resetAll();
  });

  it('persists a change, applies it to the code that enforces it, audits it, and survives a reload from the database', async () => {
    const policy = { bands: [{ maxKm: 10, fee: 25 }, { maxKm: null, fee: 35 }], discountTiers: [{ minSubtotal: 150, discount: 5 }], freeFrom: 600 };
    const res = await patch({
      'commerce.delivery.policy': policy, 'operations.sourcing.mode': 'BROADCAST_ON_DEMAND', 'operations.decision_window_hours': 6,
      'commerce.delivery.areas': ['Cairo'], 'commerce.cod.enabled': false, 'commerce.packaging.carton_cost': 3.5,
    }).expect(200);
    expect(valueOf(res.body, 'commerce.cod.enabled')).toMatchObject({ value: false, source: 'ADMIN', updatedBy: admin.id });

    // The checkout code reads these synchronously from the runtime store.
    expect(loadDeliveryFeePolicy()).toEqual(policy);
    expect(computeDeliveryFee({ invoice: 100 }).fee).toBe(25);
    expect(computeDeliveryFee({ invoice: 600 }).fee).toBe(0);
    expect(getSourcingMode()).toBe('BROADCAST_ON_DEMAND');
    expect(decisionWindowHours()).toBe(6);
    expect(serviceGovernorate('Cairo')).toBe('Cairo');
    expect(() => serviceGovernorate('Giza')).toThrow(/paused/);
    expect((await api().get('/rfq/mode').set(admin.auth).expect(200)).body.mode).toBe('BROADCAST_ON_DEMAND');

    // A restart forgets the in-memory values; the database brings them back.
    replaceRuntimeSettings([]);
    expect(loadDeliveryFeePolicy()).not.toEqual(policy);
    await settings.refresh();
    expect(loadDeliveryFeePolicy()).toEqual(policy);
    expect(runtimeSetting('commerce.cod.enabled')).toBe(false);

    const history = (await api().get('/operations/settings/history').set(admin.auth).expect(200)).body as any[];
    expect(history.filter(row => row.actorId === admin.id).map(row => row.key)).toEqual(expect.arrayContaining(['commerce.cod.enabled', 'operations.sourcing.mode', 'commerce.delivery.policy']));
    expect(history.find(row => row.key === 'commerce.cod.enabled')).toMatchObject({ previous: true, current: false, actorName: expect.any(String) });
  });

  it('records no change when the value already in force is sent again, and reset restores the deployment default', async () => {
    const before = await prisma.appSettingChange.count({ where: { key: 'commerce.cod.enabled' } });
    await patch({ 'commerce.cod.enabled': false }).expect(200);
    expect(await prisma.appSettingChange.count({ where: { key: 'commerce.cod.enabled' } })).toBe(before);

    const reset = await api().post('/operations/settings/commerce.cod.enabled/reset').set(admin.auth).expect(201);
    expect(valueOf(reset.body, 'commerce.cod.enabled')).toMatchObject({ value: true, source: 'DEFAULT' });
    expect(runtimeSetting('commerce.cod.enabled')).toBeUndefined();
    expect(await prisma.appSetting.findUnique({ where: { key: 'commerce.cod.enabled' } })).toBeNull();
    await api().post('/operations/settings/no.such.key/reset').set(admin.auth).expect(404);
    await resetAll();
    expect(getSourcingMode({ ...process.env, SOURCING_MODE: 'OFFER_BASED' })).toBe('OFFER_BASED');
  });

  it('reports the security picture without credentials', async () => {
    const security = (await api().get('/operations/settings/security').set(admin.auth).expect(200)).body;
    expect(security.activeAdmins).toBeGreaterThanOrEqual(1);
    expect(security.admins.find((row: any) => row.id === admin.id)).toMatchObject({ isActive: true, activeSessions: 1 });
    expect(JSON.stringify(security)).not.toMatch(/password|token/i);
  });
});

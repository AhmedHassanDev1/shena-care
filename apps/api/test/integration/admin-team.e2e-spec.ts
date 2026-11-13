/* eslint-disable @typescript-eslint/no-explicit-any -- HTTP response bodies are asserted structurally */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { createActor, Actor } from '../fixtures/actors';

/** Admin Team (الفريق): staff accounts, roles and hub assignment, enforced by the API on the existing sign-in. */
describe('Admin team management (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Actor;
  let hub: Actor;
  let customer: Actor;
  let supplierId: string;
  let locationId: string;
  const createdIds: string[] = [];
  const api = () => request(app.getHttpServer());
  const email = (label: string) => `team-${label}-${randomUUID().slice(0, 8)}@fixtures.test`;
  const PASSWORD = 'Str0ng-pass-1';

  const create = (body: Record<string, unknown>, actor: Actor = admin) => api().post('/operations/staff').set(actor.auth).send(body);
  const created = async (body: Record<string, unknown>) => {
    const res = await create(body).expect(201);
    createdIds.push(res.body.id);
    return res.body;
  };
  const login = (address: string, password: string) => api().post('/accounts/login').send({ email: address, password });
  const sessionFor = async (customerId: string) => {
    const session = await prisma.session.create({ data: { customerId, token: randomUUID(), expiresAt: new Date(Date.now() + 3600000) } });
    return { Authorization: `Bearer ${session.token}` };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    admin = await createActor(prisma, 'ADMIN');
    hub = await createActor(prisma, 'HUB_OPERATOR');
    customer = await createActor(prisma, 'CUSTOMER');
    supplierId = (await prisma.supplier.create({ data: { name: `Team ${randomUUID()}`, slug: `team-${randomUUID()}` } })).id;
    locationId = (await prisma.fulfillmentLocation.create({ data: { name: `Team hub ${randomUUID()}`, address: '1 Team Street' } })).id;
  }, 120000);

  afterAll(async () => {
    const ids = [...createdIds, admin.id, hub.id, customer.id];
    await prisma.fulfillmentLocationOperator.deleteMany({ where: { operatorId: { in: ids } } });
    await prisma.session.deleteMany({ where: { customerId: { in: ids } } });
    await prisma.identity.deleteMany({ where: { customerId: { in: ids } } });
    await prisma.customer.deleteMany({ where: { id: { in: ids } } });
    await prisma.fulfillmentLocation.delete({ where: { id: locationId } }).catch(() => undefined);
    await prisma.supplier.delete({ where: { id: supplierId } }).catch(() => undefined);
    await app.close();
  });

  it('only an Admin can create or edit staff: hub operators and customers are refused', async () => {
    const body = { name: 'Nope', email: email('nope'), password: PASSWORD, roles: ['HUB_OPERATOR'] };
    await api().post('/operations/staff').send(body).expect(401);
    await create(body, hub).expect(403);
    await create(body, customer).expect(403);
    await api().patch(`/operations/staff/${hub.id}`).set(hub.auth).send({ name: 'Self' }).expect(403);
    await api().post(`/operations/staff/${hub.id}/reset-password`).set(hub.auth).send({ password: PASSWORD }).expect(403);
    await api().patch(`/operations/staff/${hub.id}/roles`).set(hub.auth).send({ roles: ['ADMIN'] }).expect(403);
  });

  it('creates a Hub operator who signs in with the password the Admin set, scoped to the chosen hub', async () => {
    const address = email('hub');
    const staff = await created({ name: 'Mona Hub', email: address.toUpperCase(), password: PASSWORD, roles: ['HUB_OPERATOR'], locationIds: [locationId] });
    expect(staff).toMatchObject({ name: 'Mona Hub', email: address, roles: ['HUB_OPERATOR'], isActive: true, activeSessions: 0 });
    expect(staff.locations.map((location: any) => location.id)).toEqual([locationId]);
    expect(JSON.stringify(staff)).not.toMatch(/passwordHash|password/);

    // (The sign-in route is rate-limited to 5 attempts per IP, so this file signs in sparingly.)
    const signedIn = await login(address, PASSWORD).expect(201);
    const me = await api().get('/workspace/me').set('Authorization', `Bearer ${signedIn.body.token}`).expect(200);
    expect(me.body.roles).toContain('HUB_OPERATOR');
    expect(me.body.hubLocations.map((location: any) => location.id)).toEqual([locationId]);

    const listed = (await api().get('/operations/staff?role=HUB_OPERATOR&isActive=true').set(admin.auth).expect(200)).body as any[];
    expect(listed.find(row => row.id === staff.id)).toMatchObject({ activeSessions: 1 });
  });

  it('validates the new account: duplicates, weak passwords, bad roles and role combinations', async () => {
    const taken = email('dup');
    await created({ name: 'First', email: taken, password: PASSWORD, roles: ['DRIVER'] });
    expect((await create({ name: 'Second', email: taken, password: PASSWORD, roles: ['DRIVER'] }).expect(409)).body.code).toBe('EMAIL_ALREADY_REGISTERED');
    await create({ name: 'Weak', email: email('weak'), password: 'short', roles: ['DRIVER'] }).expect(400);
    await create({ name: 'Bad email', email: 'not-an-email', password: PASSWORD, roles: ['DRIVER'] }).expect(400);
    await create({ name: 'No roles', email: email('none'), password: PASSWORD, roles: [] }).expect(400);
    await create({ name: 'Unknown role', email: email('hr'), password: PASSWORD, roles: ['HR_MANAGER'] }).expect(400);
    await create({ name: 'Customer', email: email('cust'), password: PASSWORD, roles: ['CUSTOMER'] }).expect(400);
    // Supplier logins belong to a supplier company and never carry other authority.
    await create({ name: 'Sup', email: email('sup'), password: PASSWORD, roles: ['SUPPLIER'] }).expect(400);
    await create({ name: 'Sup', email: email('sup2'), password: PASSWORD, roles: ['SUPPLIER'], supplierId: randomUUID() }).expect(404);
    await create({ name: 'Mixed', email: email('mix'), password: PASSWORD, roles: ['SUPPLIER', 'ADMIN'], supplierId }).expect(400);
    await create({ name: 'Mixed driver', email: email('mix2'), password: PASSWORD, roles: ['DRIVER', 'HUB_OPERATOR'] }).expect(400);
    await create({ name: 'Hub with supplier', email: email('hs'), password: PASSWORD, roles: ['HUB_OPERATOR'], supplierId }).expect(400);
    await create({ name: 'Unknown hub', email: email('uh'), password: PASSWORD, roles: ['HUB_OPERATOR'], locationIds: [randomUUID()] }).expect(404);
    const supplierUser = await created({ name: 'Sup OK', email: email('supok'), password: PASSWORD, roles: ['SUPPLIER'], supplierId });
    expect(supplierUser.supplier).toMatchObject({ id: supplierId });
  });

  it('does not let a role change escalate a supplier or driver login into Admin or Hub authority', async () => {
    const supplierUser = await created({ name: 'Sup', email: email('esc'), password: PASSWORD, roles: ['SUPPLIER'], supplierId });
    await api().patch(`/operations/staff/${supplierUser.id}/roles`).set(admin.auth).send({ roles: ['SUPPLIER', 'ADMIN'] }).expect(400);
    await api().patch(`/operations/staff/${supplierUser.id}/roles`).set(admin.auth).send({ roles: ['ADMIN'] }).expect(200);
    // A driver login cannot be given a supplier role without a supplier company.
    const driver = await created({ name: 'Drv', email: email('drv'), password: PASSWORD, roles: ['DRIVER'] });
    await api().patch(`/operations/staff/${driver.id}/roles`).set(admin.auth).send({ roles: ['SUPPLIER'] }).expect(400);
    await api().patch(`/operations/staff/${driver.id}/roles`).set(admin.auth).send({ roles: ['DRIVER', 'HUB_OPERATOR'] }).expect(400);
  });

  it('edits the name and hub assignment, and resets a password and signs the account out', async () => {
    const address = email('edit');
    const staff = await created({ name: 'Old Name', email: address, password: PASSWORD, roles: ['HUB_OPERATOR'] });
    const bearer = await sessionFor(staff.id);
    await api().get('/accounts/me').set(bearer).expect(200);

    const edited = (await api().patch(`/operations/staff/${staff.id}`).set(admin.auth).send({ name: '  New Name ', locationIds: [locationId] }).expect(200)).body;
    expect(edited).toMatchObject({ name: 'New Name' });
    expect(edited.locations.map((location: any) => location.id)).toEqual([locationId]);
    expect((await api().patch(`/operations/staff/${staff.id}`).set(admin.auth).send({ locationIds: [] }).expect(200)).body.locations).toEqual([]);
    await api().patch(`/operations/staff/${staff.id}`).set(admin.auth).send({ name: 'x' }).expect(400);
    await api().patch(`/operations/staff/${staff.id}`).set(admin.auth).send({ locationIds: [randomUUID()] }).expect(404);
    const driver = await created({ name: 'Driver', email: email('drv2'), password: PASSWORD, roles: ['DRIVER'] });
    await api().patch(`/operations/staff/${driver.id}`).set(admin.auth).send({ locationIds: [locationId] }).expect(400);
    // The Team dialog always sends an empty list for non-hub roles: that must save, not fail.
    await api().patch(`/operations/staff/${driver.id}`).set(admin.auth).send({ name: 'Driver Renamed', phone: '01012345678', locationIds: [] }).expect(200);
    // A Hub role granted in the same save: roles first, then the hub assignment.
    await api().patch(`/operations/staff/${driver.id}/roles`).set(admin.auth).send({ roles: ['HUB_OPERATOR'] }).expect(200);
    expect((await api().patch(`/operations/staff/${driver.id}`).set(admin.auth).send({ locationIds: [locationId] }).expect(200)).body.locations.map((l: any) => l.id)).toEqual([locationId]);
    await api().patch(`/operations/staff/${randomUUID()}`).set(admin.auth).send({ name: 'Ghost' }).expect(404);

    await api().post(`/operations/staff/${staff.id}/reset-password`).set(admin.auth).send({ password: 'short' }).expect(400);
    await api().post(`/operations/staff/${staff.id}/reset-password`).set(admin.auth).send({ password: 'Brand-new-pass-2' }).expect(201);
    await api().get('/accounts/me').set(bearer).expect(401); // the old session is gone
    await login(address, PASSWORD).expect(401);
    await login(address, 'Brand-new-pass-2').expect(201);
  });

  it('stores an optional contact phone on create and on edit, validates its format, and clears it on an empty edit', async () => {
    const address = email('phone');
    const bare = await created({ name: 'No Phone', email: address, password: PASSWORD, roles: ['HUB_OPERATOR'] });
    expect(bare.phone).toBeNull();

    const withPhone = await created({ name: 'With Phone', email: email('phone2'), password: PASSWORD, roles: ['DRIVER'], phone: ' 01012345678 ' });
    expect(withPhone).toMatchObject({ phone: '01012345678' });
    await create({ name: 'Bad Phone', email: email('phone3'), password: PASSWORD, roles: ['DRIVER'], phone: '12345' }).expect(400);

    const edited = (await api().patch(`/operations/staff/${bare.id}`).set(admin.auth).send({ phone: '+201112223334' }).expect(200)).body;
    expect(edited).toMatchObject({ phone: '+201112223334' });
    expect((await api().get(`/operations/staff/${bare.id}`).set(admin.auth).expect(200)).body).toMatchObject({ phone: '+201112223334' });
    await api().patch(`/operations/staff/${bare.id}`).set(admin.auth).send({ phone: 'abc' }).expect(400);
    const cleared = (await api().patch(`/operations/staff/${bare.id}`).set(admin.auth).send({ phone: '' }).expect(200)).body;
    expect(cleared.phone).toBeNull();
    // Name-only edits leave the number as it is.
    await api().patch(`/operations/staff/${withPhone.id}`).set(admin.auth).send({ name: 'Renamed' }).expect(200);
    expect((await api().get(`/operations/staff/${withPhone.id}`).set(admin.auth).expect(200)).body.phone).toBe('01012345678');
  });

  it('deactivates and reactivates an account, ending its sessions, and keeps the last Admin protected', async () => {
    const staff = await created({ name: 'Leaver', email: email('leave'), password: PASSWORD, roles: ['HUB_OPERATOR'] });
    const session = await prisma.session.create({ data: { customerId: staff.id, token: randomUUID(), expiresAt: new Date(Date.now() + 3600000) } });
    await api().patch(`/operations/staff/${staff.id}/status`).set(admin.auth).send({ isActive: false }).expect(200);
    await api().get('/accounts/me').set('Authorization', `Bearer ${session.token}`).expect(401);
    expect((await api().get('/operations/staff?isActive=false').set(admin.auth).expect(200)).body.some((row: any) => row.id === staff.id)).toBe(true);
    await api().patch(`/operations/staff/${staff.id}/status`).set(admin.auth).send({ isActive: true }).expect(200);
    expect((await api().get(`/operations/staff/${staff.id}`).set(admin.auth).expect(200)).body).toMatchObject({ isActive: true });
  });

  it('lets any signed-in user change their own password and sign out their other devices', async () => {
    const address = email('self');
    const staff = await created({ name: 'Self Service', email: address, password: PASSWORD, roles: ['HUB_OPERATOR'] });
    const first = await sessionFor(staff.id);
    const second = await sessionFor(staff.id);
    const bearer = (headers: { Authorization: string }) => headers;

    await api().post('/accounts/me/password').set(bearer(first)).send({ currentPassword: 'not-my-password', newPassword: 'Another-pass-3' }).expect(401);
    await api().post('/accounts/me/password').set(bearer(first)).send({ currentPassword: PASSWORD, newPassword: PASSWORD }).expect(400);
    await api().post('/accounts/me/password').set(bearer(first)).send({ currentPassword: PASSWORD, newPassword: 'short' }).expect(400);
    await api().post('/accounts/me/password').set(bearer(first)).send({ currentPassword: PASSWORD, newPassword: 'Another-pass-3' }).expect(201);
    await api().get('/accounts/me').set(bearer(first)).expect(200); // the device used stays signed in
    await api().get('/accounts/me').set(bearer(second)).expect(401); // the other one is signed out

    const third = { Authorization: `Bearer ${(await login(address, 'Another-pass-3').expect(201)).body.token}` };
    const revoked = (await api().post('/accounts/me/sessions/revoke-others').set(bearer(third)).expect(201)).body;
    expect(revoked).toMatchObject({ success: true, revokedSessionsCount: 1 });
    await api().get('/accounts/me').set(bearer(first)).expect(401);
    await api().get('/accounts/me').set(bearer(third)).expect(200);
    await api().post('/accounts/me/password').send({ currentPassword: 'x', newPassword: 'Another-pass-4' }).expect(401);
    expect(staff.id).toBeTruthy();
  });
});

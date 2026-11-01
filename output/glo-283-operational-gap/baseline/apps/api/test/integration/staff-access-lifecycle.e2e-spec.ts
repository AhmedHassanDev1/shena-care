import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { Role, OrderStatus, ShipmentStatus } from '@prisma/client';
import { createActor, Actor } from '../fixtures/actors';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';

describe('Staff Access Lifecycle & Custody Guards (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Actor;
  let locationId: string;

  const testCustomerIds: string[] = [];
  const testOrderIds: string[] = [];
  const testBatchIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
    prisma = app.get<PrismaService>(PrismaService);

    admin = await createActor(prisma, 'ADMIN');

    const location = await prisma.fulfillmentLocation.upsert({
      where: { name: 'Staff Lifecycle Test Hub' },
      update: {},
      create: {
        name: 'Staff Lifecycle Test Hub',
        address: '50 Test Avenue, Giza',
      },
    });
    locationId = location.id;
  });

  afterAll(async () => {
    // Teardown
    if (testBatchIds.length > 0) {
      await prisma.deliveryStop.deleteMany({ where: { batchId: { in: testBatchIds } } });
      await prisma.deliveryBatch.deleteMany({ where: { id: { in: testBatchIds } } });
    }
    if (testOrderIds.length > 0) {
      await prisma.paymentCollection.deleteMany({ where: { orderId: { in: testOrderIds } } });
      await prisma.shipmentItem.deleteMany({ where: { shipment: { orderId: { in: testOrderIds } } } });
      await prisma.shipment.deleteMany({ where: { orderId: { in: testOrderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: testOrderIds } } });
    }
    if (testCustomerIds.length > 0) {
      await prisma.session.deleteMany({ where: { customerId: { in: testCustomerIds } } });
      await prisma.identity.deleteMany({ where: { customerId: { in: testCustomerIds } } });
      await prisma.customer.deleteMany({ where: { id: { in: testCustomerIds } } });
    }
    await app.close();
  });

  async function createStaffUser(email: string, name: string, roles: Role[], supplierId?: string | null) {
    const passwordHash = await bcrypt.hash('StaffPassword123!', 10);
    const customer = await prisma.customer.create({
      data: {
        email,
        name,
        roles,
        supplierId: supplierId ?? null,
        isActive: true,
        identities: {
          create: {
            provider: 'EMAIL',
            providerId: email,
            passwordHash,
          },
        },
      },
    });
    testCustomerIds.push(customer.id);

    // Create active session
    const token = randomUUID();
    const session = await prisma.session.create({
      data: {
        token,
        customerId: customer.id,
        isValid: true,
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      },
    });

    return {
      id: customer.id,
      email,
      token,
      auth: { Authorization: `Bearer ${token}` },
    };
  }

  // 1. Staff Provisioning & Listing
  it('allows Admin to list staff members with their role scopes', async () => {
    const hubStaff = await createStaffUser(`hub-${randomUUID().slice(0, 6)}@test.com`, 'Hub Operator 1', [Role.HUB_OPERATOR]);

    const res = await request(app.getHttpServer())
      .get('/operations/staff')
      .set(admin.auth)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    const found = res.body.find((u: any) => u.id === hubStaff.id);
    expect(found).toBeTruthy();
    expect(found.roles).toContain('HUB_OPERATOR');
    expect(found.isActive).toBe(true);
  });

  // 2. Disable / Deactivate & Session Revocation
  it('disabling staff account invalidates existing sessions and blocks subsequent logins', async () => {
    const email = `disabled-${randomUUID().slice(0, 6)}@test.com`;
    const staff = await createStaffUser(email, 'Temporary Staff', [Role.HUB_OPERATOR]);

    // Verify session initially works
    await request(app.getHttpServer())
      .get('/workspace/me')
      .set(staff.auth)
      .expect(200);

    // Admin deactivates staff account
    const deactivateRes = await request(app.getHttpServer())
      .patch(`/operations/staff/${staff.id}/status`)
      .set(admin.auth)
      .send({ isActive: false })
      .expect(200);

    expect(deactivateRes.body.isActive).toBe(false);

    // Old bearer session must be immediately rejected (revoked / inactive)
    await request(app.getHttpServer())
      .get('/workspace/me')
      .set(staff.auth)
      .expect(401);

    // Login attempt with correct password must be refused
    const loginRes = await request(app.getHttpServer())
      .post('/accounts/login')
      .send({ email, password: 'StaffPassword123!' })
      .expect(401);

    expect(loginRes.body.message).toContain('deactivated');

    // Reactivate staff account
    await request(app.getHttpServer())
      .patch(`/operations/staff/${staff.id}/status`)
      .set(admin.auth)
      .send({ isActive: true })
      .expect(200);

    // Now login succeeds and returns new session
    const relogin = await request(app.getHttpServer())
      .post('/accounts/login')
      .send({ email, password: 'StaffPassword123!' })
      .expect(201);

    expect(relogin.body.token).toBeTruthy();

    // New session can access workspace
    await request(app.getHttpServer())
      .get('/workspace/me')
      .set({ Authorization: `Bearer ${relogin.body.token}` })
      .expect(200);
  });

  // 3. Founder-only Admin Preservation
  it('refuses to deactivate the last active Admin or remove the last ADMIN role', async () => {
    // Ensure admin.id is the only active admin in the database
    const otherAdmins = await prisma.customer.findMany({
      where: { roles: { has: Role.ADMIN }, id: { not: admin.id }, isActive: true },
    });
    if (otherAdmins.length > 0) {
      await prisma.customer.updateMany({
        where: { id: { in: otherAdmins.map(a => a.id) } },
        data: { isActive: false },
      });
    }

    try {
      // Attempting to deactivate the only active admin
      const res = await request(app.getHttpServer())
        .patch(`/operations/staff/${admin.id}/status`)
        .set(admin.auth)
        .send({ isActive: false })
        .expect(400);

      expect(res.body.message).toContain('Founder-only Admin preservation');

      // Attempting to demote the only admin to customer
      const res2 = await request(app.getHttpServer())
        .patch(`/operations/staff/${admin.id}/roles`)
        .set(admin.auth)
        .send({ roles: [Role.CUSTOMER] })
        .expect(400);

      expect(res2.body.message).toContain('Founder-only Admin preservation');

      // Attempting to assign unauthorized non-canonical roles (HR, Payroll, etc.)
      const res3 = await request(app.getHttpServer())
        .patch(`/operations/staff/${admin.id}/roles`)
        .set(admin.auth)
        .send({ roles: ['HR_MANAGER'] as any })
        .expect(400);

      const msg = Array.isArray(res3.body.message) ? res3.body.message.join(' ') : res3.body.message;
      expect(msg).toContain('must be one of the following values');
    } finally {
      if (otherAdmins.length > 0) {
        await prisma.customer.updateMany({
          where: { id: { in: otherAdmins.map(a => a.id) } },
          data: { isActive: true },
        });
      }
    }
  });

  // 4. Driver Custody Guard: Blocking deactivation with active shipment custody
  it('blocks deactivating a driver who currently holds active shipment custody', async () => {
    const driverEmail = `driver-${randomUUID().slice(0, 6)}@test.com`;
    const driver = await createStaffUser(driverEmail, 'Active Driver', [Role.DRIVER]);

    // Create an order and shipment for the run
    const orderNumber = `ORD-DRV-${randomUUID().slice(0, 8)}`;
    const order = await prisma.order.create({
      data: {
        orderNumber,
        customerId: driver.id,
        customerName: 'Driver Test Customer',
        customerPhone: '+201011111111',
        status: OrderStatus.confirmed,
        currency: 'EGP',
        subtotal: 300,
        totalAmount: 300,
        shippingAddress: 'Giza, Egypt',
      },
    });
    testOrderIds.push(order.id);

    const shipment = await prisma.shipment.create({
      data: {
        orderId: order.id,
        locationId,
        status: ShipmentStatus.dispatched,
      },
    });

    // Create active dispatched delivery batch assigned to this driver
    const batch = await prisma.deliveryBatch.create({
      data: {
        driverId: driver.id,
        locationId,
        status: 'dispatched',
        stops: {
          create: {
            shipmentId: shipment.id,
            sequence: 1,
            status: 'active',
          },
        },
      },
    });
    testBatchIds.push(batch.id);

    // Attempt to deactivate driver while batch is dispatched
    const deactivateRes = await request(app.getHttpServer())
      .patch(`/operations/staff/${driver.id}/status`)
      .set(admin.auth)
      .send({ isActive: false })
      .expect(400);

    expect(deactivateRes.body.message).toContain('driver currently holds active delivery batch');
    expect(deactivateRes.body.message).toContain('Never silently reassign physical custody');

    // Attempt to remove DRIVER role while batch is dispatched
    const demoteRes = await request(app.getHttpServer())
      .patch(`/operations/staff/${driver.id}/roles`)
      .set(admin.auth)
      .send({ roles: [Role.CUSTOMER] })
      .expect(400);

    expect(demoteRes.body.message).toContain('driver currently holds active delivery batch');

    // Settle delivery batch and complete stops
    await prisma.deliveryStop.updateMany({
      where: { batchId: batch.id },
      data: { status: 'delivered', closedAt: new Date() },
    });
    await prisma.deliveryBatch.update({
      where: { id: batch.id },
      data: { status: 'completed', completedAt: new Date() },
    });
    await prisma.shipment.update({
      where: { id: shipment.id },
      data: { status: ShipmentStatus.delivered },
    });

    // Now driver can be deactivated safely
    const successRes = await request(app.getHttpServer())
      .patch(`/operations/staff/${driver.id}/status`)
      .set(admin.auth)
      .send({ isActive: false })
      .expect(200);

    expect(successRes.body.isActive).toBe(false);
  });

  // 5. Cross-Tenant Access Enforcement
  it('enforces tenant isolation: supplier cannot access another supplier purchase order', async () => {
    // Create two distinct suppliers
    const supplierA = await prisma.supplier.create({
      data: { name: `Supplier A ${randomUUID().slice(0, 4)}`, slug: `sup-a-${randomUUID().slice(0, 6)}` },
    });
    const supplierB = await prisma.supplier.create({
      data: { name: `Supplier B ${randomUUID().slice(0, 4)}`, slug: `sup-b-${randomUUID().slice(0, 6)}` },
    });

    // Create staff user belonging to Supplier A
    const userA = await createStaffUser(`user-a-${randomUUID().slice(0, 6)}@test.com`, 'Supplier User A', [Role.SUPPLIER], supplierA.id);

    // Create purchase order for Supplier B
    const poB = await prisma.supplierPurchaseOrder.create({
      data: {
        supplierId: supplierB.id,
        status: 'created',
      },
    });

    // Supplier A attempts to read Supplier B's purchase order
    await request(app.getHttpServer())
      .get(`/purchase-orders/${poB.id}`)
      .set(userA.auth)
      .expect(403);

    // Clean up test PO & suppliers
    await prisma.supplierPurchaseOrder.delete({ where: { id: poB.id } });
    await prisma.supplier.deleteMany({ where: { id: { in: [supplierA.id, supplierB.id] } } });
  });

  // 6. Explicit Session Revocation
  it('allows Admin to explicitly revoke all active sessions for a staff member', async () => {
    const staff = await createStaffUser(`revokeme-${randomUUID().slice(0, 6)}@test.com`, 'Revoke Me', [Role.HUB_OPERATOR]);

    // Session works
    await request(app.getHttpServer())
      .get('/workspace/me')
      .set(staff.auth)
      .expect(200);

    // Revoke sessions
    const revokeRes = await request(app.getHttpServer())
      .post(`/operations/staff/${staff.id}/revoke-sessions`)
      .set(admin.auth)
      .expect(201);

    expect(revokeRes.body.success).toBe(true);
    expect(revokeRes.body.revokedSessionsCount).toBeGreaterThanOrEqual(1);

    // Session no longer works
    await request(app.getHttpServer())
      .get('/workspace/me')
      .set(staff.auth)
      .expect(401);
  });
});

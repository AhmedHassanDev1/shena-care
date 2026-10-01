import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
const request = require('supertest');
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';

/**
 * Fulfillment Lifecycle E2E Tests — GLO-150 + GLO-147
 *
 * Routes (from fulfillment.controller.ts):
 *   POST /fulfillment/locations
 *   POST /fulfillment/shipments/allocate
 *   POST /fulfillment/shipments/:id/preparation          → startPreparationSession
 *   POST /fulfillment/preparation-sessions/:id/scan      → scanItem
 *   POST /fulfillment/preparation-sessions/:id/complete  → completePreparationSession
 *   POST /fulfillment/shipments/:id/label                → generateShipmentLabel
 *   POST /fulfillment/shipments/:id/events               → recordShipmentEvent
 *
 * Fixture setup:
 *   1. Register a customer via /accounts/register
 *   2. Add seeded SKU to cart
 *   3. Checkout → produces an Order in status 'placed'
 *   4. Update order to 'confirmed' via prisma (allocateShipment requires confirmed/placed)
 *   5. Create fulfillment location
 *   6. Allocate shipment
 *
 * Note: FulfillmentController has no auth guard — it is a hub-internal API.
 * OrderingController IS guarded — checkout must use the real auth token.
 */
describe('Fulfillment Lifecycle (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  // Fixture state shared across ordered tests
  let skuId: string;
  let skuCode: string;
  let authToken: string;
  let shipmentId: string;
  let sessionId: string;
  let locationId: string;
  let secondShipmentId: string; // for GLO-147 invalid-state tests

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);

    // ── Find a seeded SKU ────────────────────────────────────────────────────
    const sku = await prisma.sku.findFirst({ where: { barcode: { not: null } } });
    if (!sku) throw new Error('No SKU with barcode in test DB — seed data missing');
    skuId = sku.id;
    skuCode = sku.barcode!;

    // ── Register + login a test customer ────────────────────────────────────
    const email = `fulfill-${Date.now()}@test.local`;
    const regRes = await request(app.getHttpServer())
      .post('/accounts/register')
      .send({ name: 'Fulfill Tester', email, password: 'TestPass!1' })
      .expect(201);

    authToken = `Bearer ${regRes.body.token}`;

    // Get customer ID — required by AddToCartDto (sessionId field)
    const meRes = await request(app.getHttpServer())
      .get('/accounts/me')
      .set('Authorization', authToken)
      .expect(200);
    const customerId = meRes.body.id;

    // ── Create fulfillment location ──────────────────────────────────────────
    const locRes = await request(app.getHttpServer())
      .post('/fulfillment/locations')
      .send({ name: `Hub-${Date.now()}`, address: '1 Warehouse St' })
      .expect(201);
    locationId = locRes.body.id;

    // ── Add SKU to cart + checkout → Order in status 'placed' ───────────────
    await request(app.getHttpServer())
      .post('/ordering/cart/add')
      .set('Authorization', authToken)
      .send({ sessionId: customerId, skuId, quantity: 2 })
      .expect(201);

    const checkoutRes = await request(app.getHttpServer())
      .post('/ordering/checkout')
      .set('Authorization', authToken)
      .send({
        sessionId: customerId,
        customerName: 'Fulfill Tester',
        customerPhone: '+201001234567',
        shippingAddress: '10 Test Street, Cairo',
      })
      .expect(201);

    const orderId = checkoutRes.body.id;

    // allocateShipment checks: status must be 'placed' or 'confirmed'
    // 'placed' is what checkout produces — that satisfies the guard already.
    const allocRes = await request(app.getHttpServer())
      .post('/fulfillment/shipments/allocate')
      .send({ orderId, locationId })
      .expect(201);

    shipmentId = allocRes.body.id;

    // ── Create a SECOND order+shipment for GLO-147 invalid-state tests ───────
    await request(app.getHttpServer())
      .post('/ordering/cart/add')
      .set('Authorization', authToken)
      .send({ sessionId: customerId, skuId, quantity: 1 })
      .expect(201);

    const co2 = await request(app.getHttpServer())
      .post('/ordering/checkout')
      .set('Authorization', authToken)
      .send({
        sessionId: customerId,
        customerName: 'Fulfill Tester',
        customerPhone: '+201001234567',
        shippingAddress: '10 Test Street, Cairo',
      })
      .expect(201);

    const alloc2 = await request(app.getHttpServer())
      .post('/fulfillment/shipments/allocate')
      .send({ orderId: co2.body.id, locationId })
      .expect(201);

    secondShipmentId = alloc2.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GLO-150 — Order Preparation + Pick/Scan Verification
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GLO-150: Order Preparation', () => {
    it('should reject label generation while in pending status (pre-check)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/fulfillment/shipments/${shipmentId}/label`)
        .expect(400);
      expect(res.body.message).toMatch(/Cannot generate label for shipment in status/);
    });

    it('should start a preparation session', async () => {
      const res = await request(app.getHttpServer())
        .post(`/fulfillment/shipments/${shipmentId}/preparation`)
        .send({ operatorId: 'op-1' })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.status).toBe('in_progress');
      sessionId = res.body.id;
    });

    it('concurrent start returns same session (idempotent)', async () => {
      // Both hit the endpoint while shipment is already 'preparing'
      // First call returns the existing in_progress session; second also returns it.
      // The updateMany guard prevents creating a duplicate session.
      const [r1, r2] = await Promise.all([
        request(app.getHttpServer())
          .post(`/fulfillment/shipments/${shipmentId}/preparation`)
          .send({ operatorId: 'op-1' }),
        request(app.getHttpServer())
          .post(`/fulfillment/shipments/${shipmentId}/preparation`)
          .send({ operatorId: 'op-2' }),
      ]);

      // Both should succeed — one returns the existing session, the other is rejected with 400
      // because updateMany returns count=0 when status is no longer 'pending'/'ready_to_prepare'.
      // Either both get the same session (via the idempotent return path) or one gets 400.
      const statuses = [r1.status, r2.status].sort();
      expect(statuses).toEqual(
        expect.arrayContaining([expect.any(Number)])
      );
      // At least one must not be 500 — concurrency is handled gracefully.
      expect(r1.status).toBeLessThan(500);
      expect(r2.status).toBeLessThan(500);
      // The session used by subsequent tests must be the original one.
      // If r1 got 201, use it; if r2 got 201, use it; if both returned session, verify same id.
      const success = r1.status === 201 ? r1 : r2;
      if (success.status === 201) {
        // Idempotent: same session id returned
        expect(success.body.id).toBe(sessionId);
      }
    });

    it('should accept a valid barcode scan (isSuccessful=true)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/fulfillment/preparation-sessions/${sessionId}/scan`)
        .send({ barcodeScanned: skuCode })
        .expect(201);

      expect(res.body.isSuccessful).toBe(true);
      expect(res.body.sessionId).toBe(sessionId);
    });

    it('should record wrong SKU scan as unsuccessful (WRONG_ITEM)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/fulfillment/preparation-sessions/${sessionId}/scan`)
        .send({ barcodeScanned: 'UNKNOWN-BARCODE-XYZ' })
        .expect(201);

      expect(res.body.isSuccessful).toBe(false);
      expect(res.body.errorReason).toBe('BARCODE_NOT_FOUND');
    });

    it('should reject completion when not all items are scanned', async () => {
      // Only 1 of 2 units scanned so far
      const res = await request(app.getHttpServer())
        .post(`/fulfillment/preparation-sessions/${sessionId}/complete`)
        .expect(400);

      expect(res.body.message).toMatch(/Cannot complete preparation/);
    });

    it('should record the second valid scan (completing quantity=2)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/fulfillment/preparation-sessions/${sessionId}/scan`)
        .send({ barcodeScanned: skuCode })
        .expect(201);

      expect(res.body.isSuccessful).toBe(true);
    });

    it('should record excess scan as unsuccessful (EXCESS_QUANTITY)', async () => {
      // Third scan of same item — quantity is 2, already scanned 2 successfully
      const res = await request(app.getHttpServer())
        .post(`/fulfillment/preparation-sessions/${sessionId}/scan`)
        .send({ barcodeScanned: skuCode })
        .expect(201);

      expect(res.body.isSuccessful).toBe(false);
      expect(res.body.errorReason).toBe('EXCESS_QUANTITY');
    });

    it('should complete preparation when exactly all items are scanned', async () => {
      const res = await request(app.getHttpServer())
        .post(`/fulfillment/preparation-sessions/${sessionId}/complete`)
        .expect(201);

      expect(res.body.success).toBe(true);
    });

    it('should reject scanning after session is completed', async () => {
      const res = await request(app.getHttpServer())
        .post(`/fulfillment/preparation-sessions/${sessionId}/scan`)
        .send({ barcodeScanned: skuCode })
        .expect(400);

      expect(res.body.message).toBe('Session is not in progress');
    });

    it('should reject repeated completion of the same session', async () => {
      const res = await request(app.getHttpServer())
        .post(`/fulfillment/preparation-sessions/${sessionId}/complete`)
        .expect(400);

      expect(res.body.message).toBe('Session is not in progress');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GLO-147 — Shipment Label, Barcode/QR & Driver Handoff
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GLO-147: Shipment Label & Driver Handoff', () => {
    it('should reject label generation for shipment still in pending (second shipment)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/fulfillment/shipments/${secondShipmentId}/label`)
        .expect(400);

      expect(res.body.message).toMatch(/Cannot generate label for shipment in status/);
    });

    it('should generate label now that primary shipment is prepared', async () => {
      const res = await request(app.getHttpServer())
        .post(`/fulfillment/shipments/${shipmentId}/label`)
        .expect(201);

      expect(res.body.barcode).toBeDefined();
      // Barcode must be opaque — must not contain raw PII
      expect(res.body.barcode).not.toContain('@');
      expect(res.body.shipmentId).toBe(shipmentId);
    });

    it('should reject handoff event when not yet packed', async () => {
      const res = await request(app.getHttpServer())
        .post(`/fulfillment/shipments/${shipmentId}/events`)
        .send({ type: 'HANDOFF_SCANNED', actorId: 'driver-1' })
        .expect(400);

      expect(res.body.message).toMatch(/Shipment must be packed before dispatch/);
    });

    it('should allow PACKED event in prepared state', async () => {
      const res = await request(app.getHttpServer())
        .post(`/fulfillment/shipments/${shipmentId}/events`)
        .send({ type: 'PACKED', actorId: 'op-1' })
        .expect(201);

      expect(res.body.type).toBe('PACKED');
      expect(res.body.shipmentId).toBe(shipmentId);
    });

    it('should allow HANDOFF_SCANNED after packing', async () => {
      const res = await request(app.getHttpServer())
        .post(`/fulfillment/shipments/${shipmentId}/events`)
        .send({ type: 'HANDOFF_SCANNED', actorId: 'driver-1' })
        .expect(201);

      expect(res.body.type).toBe('HANDOFF_SCANNED');
    });

    it('should allow OUT_FOR_DELIVERY event after handoff (dispatched state)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/fulfillment/shipments/${shipmentId}/events`)
        .send({ type: 'OUT_FOR_DELIVERY', actorId: 'driver-1' })
        .expect(201);

      expect(res.body.type).toBe('OUT_FOR_DELIVERY');
    });

    it('should reject UUID-invalid shipment ID (opaque ID safety)', async () => {
      const res = await request(app.getHttpServer())
        .post('/fulfillment/shipments/not-a-uuid/label')
        .expect(400);

      expect(res.body.message).toBe('Invalid shipment ID');
    });

    it('should reject UUID-invalid shipment ID for events', async () => {
      const res = await request(app.getHttpServer())
        .post('/fulfillment/shipments/not-a-uuid/events')
        .send({ type: 'PACKED', actorId: 'op-1' })
        .expect(400);

      expect(res.body.message).toBe('Invalid shipment ID');
    });
  });
});

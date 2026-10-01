import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
const request = require('supertest');
import { AppModule } from '../../src/app.module';

describe('Fulfillment Lifecycle (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  let customerId: string;
  let skuId: string;
  let skuBarcode: string;
  let orderId: string;
  let locationId: string;
  let shipmentId: string;
  let sessionId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    
    // Register customer
    const testEmail = `fulfill-${Date.now()}@example.com`;
    const regRes = await request(app.getHttpServer())
      .post('/accounts/register')
      .send({ name: 'Fulfill Tester', email: testEmail, password: 'pass' });
    
    authToken = `Bearer ${regRes.body.token}`;
    const meRes = await request(app.getHttpServer())
      .get('/accounts/me')
      .set('Authorization', authToken);
    customerId = meRes.body.id;

    // Find SKU
    const productRes = await request(app.getHttpServer())
      .get('/products/cerave-moisturizing-cream');
    skuId = productRes.body.skus[0].id;
    skuBarcode = productRes.body.skus[0].barcode;

    // Create a fulfillment location
    const locRes = await request(app.getHttpServer())
      .post('/fulfillment/locations')
      .send({ name: `Hub-${Date.now()}`, address: 'Test Hub Address' });
    locationId = locRes.body.id;

    // Place an order
    await request(app.getHttpServer())
      .post('/ordering/cart/add')
      .set('Authorization', authToken)
      .send({ sessionId: customerId, skuId, quantity: 2 });
      
    const checkoutRes = await request(app.getHttpServer())
      .post('/ordering/checkout')
      .set('Authorization', authToken)
      .send({
        sessionId: customerId,
        paymentMethod: 'cash_on_delivery',
        shippingAddress: '123 Test St'
      });
    orderId = checkoutRes.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should allocate shipment', async () => {
    const res = await request(app.getHttpServer())
      .post('/fulfillment/shipments/allocate')
      .send({ orderId, locationId })
      .expect(201);
    
    shipmentId = res.body.id;
    expect(res.body.status).toBe('pending');
    expect(res.body.items[0].quantity).toBe(2);
  });

  it('should prevent label generation while in pending status', async () => {
    const res = await request(app.getHttpServer())
      .post(`/fulfillment/shipments/${shipmentId}/label`)
      .expect(400);
      
    expect(res.body.message).toContain('Cannot generate label for shipment in status pending');
  });

  it('should handle concurrent startPreparationSession requests safely', async () => {
    // Fire two requests concurrently
    const [res1, res2] = await Promise.all([
      request(app.getHttpServer())
        .post(`/fulfillment/shipments/${shipmentId}/prepare/start`)
        .send({ operatorId: 'op1' }),
      request(app.getHttpServer())
        .post(`/fulfillment/shipments/${shipmentId}/prepare/start`)
        .send({ operatorId: 'op2' })
    ]);

    // One should succeed (201 or 200 depending on idempotency if they hit the same session), 
    // but Prisma updateMany will return count=1 for the first and count=0 for the second.
    // If the second one hits count=0, it throws 400.
    const statuses = [res1.status, res2.status];
    expect(statuses).toContain(201);
    expect(statuses).toContain(400);

    const successRes = res1.status === 201 ? res1 : res2;
    sessionId = successRes.body.id;
    expect(successRes.body.status).toBe('in_progress');
  });

  it('should allow valid scanning', async () => {
    const res = await request(app.getHttpServer())
      .post(`/fulfillment/sessions/${sessionId}/scan`)
      .send({ barcodeScanned: skuBarcode })
      .expect(201);

    expect(res.body.isSuccessful).toBe(true);
  });

  it('should prevent completion when items are missing', async () => {
    const res = await request(app.getHttpServer())
      .post(`/fulfillment/sessions/${sessionId}/complete`)
      .expect(400);

    expect(res.body.message).toBe('Cannot complete preparation, items do not match exactly');
  });

  it('should allow completing preparation after scanning exactly all items', async () => {
    // Scan 2nd item
    await request(app.getHttpServer())
      .post(`/fulfillment/sessions/${sessionId}/scan`)
      .send({ barcodeScanned: skuBarcode })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post(`/fulfillment/sessions/${sessionId}/complete`)
      .expect(201);

    expect(res.body.success).toBe(true);
  });

  it('should reject overscanning', async () => {
    const res = await request(app.getHttpServer())
      .post(`/fulfillment/sessions/${sessionId}/scan`)
      .send({ barcodeScanned: skuBarcode })
      .expect(400);
      
    // Because the session is now completed, it should throw 'Session is not in progress'
    expect(res.body.message).toBe('Session is not in progress');
  });

  it('should successfully generate label now that it is prepared', async () => {
    const res = await request(app.getHttpServer())
      .post(`/fulfillment/shipments/${shipmentId}/label`)
      .expect(201);
      
    expect(res.body.barcode).toBeDefined();
    expect(res.body.shipmentId).toBe(shipmentId);
  });

  it('should prevent handoff if not packed', async () => {
    const res = await request(app.getHttpServer())
      .post(`/fulfillment/shipments/${shipmentId}/events`)
      .send({ type: 'HANDOFF_SCANNED', actorId: 'driver1' })
      .expect(400);
      
    expect(res.body.message).toContain('Shipment must be packed before dispatch');
  });

  it('should allow packing and then handoff', async () => {
    // Pack
    await request(app.getHttpServer())
      .post(`/fulfillment/shipments/${shipmentId}/events`)
      .send({ type: 'PACKED', actorId: 'op1' })
      .expect(201);
      
    // Handoff
    const handoffRes = await request(app.getHttpServer())
      .post(`/fulfillment/shipments/${shipmentId}/events`)
      .send({ type: 'HANDOFF_SCANNED', actorId: 'driver1' })
      .expect(201);
      
    expect(handoffRes.body.type).toBe('HANDOFF_SCANNED');
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
const request = require('supertest');
import { AppModule } from '../../src/app.module';

describe('Release Candidate Smoke Test (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  let customerId: string;

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
    
    // Register to get a token
    const testEmail = `smoke-${Date.now()}@example.com`;
    const res = await request(app.getHttpServer())
      .post('/accounts/register')
      .send({
        name: 'Smoke Tester',
        email: testEmail,
        password: 'password123',
      });
    
    authToken = `Bearer ${res.body.token}`;

    // Get the user's ID
    const meRes = await request(app.getHttpServer())
      .get('/accounts/me')
      .set('Authorization', authToken);
    
    customerId = meRes.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('1. Browse Product (Composition View)', async () => {
    const res = await request(app.getHttpServer())
      .get('/products/cerave-moisturizing-cream')
      .expect(200);
      
    expect(res.body.name).toBe('Moisturizing Cream');
    expect(res.body.skus.length).toBeGreaterThan(0);
  });

  it('2. Care Profile & AI Recommendation', async () => {
    // Care Profile
    let res = await request(app.getHttpServer())
      .post('/care/profiles')
      .set('Authorization', authToken)
      .send({ customerId, skinType: 'dry' })
      .expect(201);
      
    expect(res.body.customerId).toBe(customerId);

    // Create Guidance Session
    res = await request(app.getHttpServer())
      .post('/guidance/sessions')
      .set('Authorization', authToken)
      .send({ customerId })
      .expect(201);
      
    const sessionId = res.body.id;

    // Ask AI for Recommendation (Mocked)
    res = await request(app.getHttpServer())
      .post(`/guidance/sessions/${sessionId}/messages`)
      .set('Authorization', authToken)
      .send({ content: 'I need a moisturizer for dry skin' })
      .expect(201);
      
    expect(res.body.content).toBeDefined();
  });

  it('3. Add to Cart', async () => {
    // Get product to find SKU
    const productRes = await request(app.getHttpServer())
      .get('/products/cerave-moisturizing-cream')
      .expect(200);
    const skuId = productRes.body.skus[0].id;

    // Add to Cart
    const res = await request(app.getHttpServer())
      .post('/ordering/cart/add')
      .set('Authorization', authToken)
      .send({
        sessionId: customerId,
        skuId: skuId,
        quantity: 2
      })
      .expect(201);
      
    expect(res.body.items.length).toBeGreaterThan(0);
  });

  it('4. Checkout -> COD Order', async () => {
    const res = await request(app.getHttpServer())
      .post('/ordering/checkout')
      .set('Authorization', authToken)
      .send({
        sessionId: customerId,
        customerName: 'Smoke Tester',
        customerPhone: '+201000000000',
        shippingAddress: 'Test Address',
        idempotencyKey: 'smoke-test-idem-1'
      })
      .expect(201);
      
    expect(res.body.orderNumber).toBeDefined();
    expect(res.body.status).toBe('placed');
  });
});

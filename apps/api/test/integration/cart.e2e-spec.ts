import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
const request = require('supertest');
import { AppModule } from '../../src/app.module';

describe('Cart APIs (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  let customerId: string;
  let skuId: string;

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
    
    // 1. Get a token
    const testEmail = `cart-test-${Date.now()}@example.com`;
    const regRes = await request(app.getHttpServer())
      .post('/accounts/register')
      .send({
        name: 'Cart Tester',
        email: testEmail,
        password: 'password123',
      });
    
    authToken = `Bearer ${regRes.body.token}`;

    const meRes = await request(app.getHttpServer())
      .get('/accounts/me')
      .set('Authorization', authToken);
    
    customerId = meRes.body.id;

    // 2. Find a valid SKU
    const productRes = await request(app.getHttpServer())
      .get('/products/cerave-moisturizing-cream');
    skuId = productRes.body.skus[0].id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should return an empty cart initially', async () => {
    const res = await request(app.getHttpServer())
      .get('/ordering/cart')
      .set('Authorization', authToken)
      .expect(200);

    expect(res.body.sessionId).toBe(customerId);
    expect(res.body.items.length).toBe(0);
    expect(res.body.totalAmount).toBe(0);
  });

  it('should add an item to the cart', async () => {
    const res = await request(app.getHttpServer())
      .post('/ordering/cart/add')
      .set('Authorization', authToken)
      .send({
        sessionId: customerId,
        skuId,
        quantity: 2
      })
      .expect(201); // NestJS defaults POST to 201

    expect(res.body.items.length).toBe(1);
    expect(res.body.items[0].skuId).toBe(skuId);
    expect(res.body.items[0].quantity).toBe(2);
    expect(res.body.totalAmount).toBeGreaterThan(0);
  });

  it('should update the quantity of the item', async () => {
    const res = await request(app.getHttpServer())
      .patch('/ordering/cart/quantity')
      .set('Authorization', authToken)
      .send({
        sessionId: customerId,
        skuId,
        quantity: 5
      })
      .expect(200);

    expect(res.body.items.length).toBe(1);
    expect(res.body.items[0].quantity).toBe(5);
  });

  it('should remove the item from the cart', async () => {
    const res = await request(app.getHttpServer())
      .post('/ordering/cart/remove')
      .set('Authorization', authToken)
      .send({
        sessionId: customerId,
        skuId
      })
      .expect(201);

    expect(res.body.items.length).toBe(0);
  });
});

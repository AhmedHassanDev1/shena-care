import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { DatabaseModule } from '../../src/platform/database/database.module';
import { CareModule } from '../../src/modules/care/care.module';
import { OrderingModule } from '../../src/modules/ordering/ordering.module';
import { GuidanceModule } from '../../src/modules/guidance/guidance.module';

describe('Auth & Security (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [DatabaseModule, CareModule, OrderingModule, GuidanceModule],
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
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Care Profile Endpoint Security', () => {
    it('should reject access to profile if missing x-customer-id', async () => {
      return request(app.getHttpServer())
        .get('/care/profiles')
        .expect(401);
    });

    it('should allow access to profile if x-customer-id is provided', async () => {
      return request(app.getHttpServer())
        .get('/care/profiles')
        .set('x-customer-id', 'test-customer-123')
        .expect(200);
    });
    
    it('should prevent creating a profile for a different customer ID', async () => {
      return request(app.getHttpServer())
        .post('/care/profiles')
        .set('x-customer-id', 'test-customer-123')
        .send({ customerId: 'hacked-customer-id' })
        .expect(403);
    });
  });

  describe('Ordering & Cart Endpoint Security', () => {
    it('should reject access to cart if missing x-customer-id', async () => {
      return request(app.getHttpServer())
        .get('/ordering/cart')
        .expect(401);
    });

    it('should allow cart access with x-customer-id', async () => {
      return request(app.getHttpServer())
        .get('/ordering/cart')
        .set('x-customer-id', 'test-customer-123')
        .expect(200);
    });
    
    it('should prevent checking out a cart with a different session ID', async () => {
      return request(app.getHttpServer())
        .post('/ordering/checkout')
        .set('x-customer-id', 'test-customer-123')
        .send({ 
          sessionId: 'other-customer-456',
          customerName: 'Test',
          customerPhone: '+1234567890',
          shippingAddress: 'Address'
        })
        .expect(403);
    });
  });

  describe('Guidance Endpoint Security', () => {
    let createdSessionId: string;

    it('should reject access to create session if missing x-customer-id', async () => {
      return request(app.getHttpServer())
        .post('/guidance/sessions')
        .send({ customerId: 'test-customer-123' })
        .expect(401);
    });

    it('should prevent creating a session for a different customer ID', async () => {
      return request(app.getHttpServer())
        .post('/guidance/sessions')
        .set('x-customer-id', 'test-customer-123')
        .send({ customerId: 'other-customer-456' })
        .expect(403);
    });
    
    it('should create a session for the authenticated customer', async () => {
      const response = await request(app.getHttpServer())
        .post('/guidance/sessions')
        .set('x-customer-id', 'test-customer-123')
        .send({})
        .expect(201);
        
      expect(response.body.id).toBeDefined();
      expect(response.body.customerId).toBe('test-customer-123');
      createdSessionId = response.body.id;
    });

    it('should prevent another customer from accessing the session', async () => {
      return request(app.getHttpServer())
        .get(`/guidance/sessions/${createdSessionId}`)
        .set('x-customer-id', 'hacked-customer-999')
        .expect(403);
    });
    
    it('should prevent another customer from sending a message to the session', async () => {
      return request(app.getHttpServer())
        .post(`/guidance/sessions/${createdSessionId}/messages`)
        .set('x-customer-id', 'hacked-customer-999')
        .send({ content: 'Hello' })
        .expect(403);
    });
  });
});

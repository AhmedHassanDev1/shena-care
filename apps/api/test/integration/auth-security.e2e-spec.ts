import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
const request = require('supertest');
import { AppModule } from '../../src/app.module';

describe('Auth & Security (e2e)', () => {
  let app: INestApplication;
  let authToken: string;

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
    const testEmail = `authsec-${Date.now()}@example.com`;
    const res = await request(app.getHttpServer())
      .post('/accounts/register')
      .send({
        name: 'Auth Security Test',
        email: testEmail,
        password: 'password123',
      });
    
    authToken = `Bearer ${res.body.token}`;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Care Profile Endpoint Security', () => {
    it('should reject access to profile if missing auth token', async () => {
      return request(app.getHttpServer())
        .get('/care/profiles')
        .expect(401);
    });

    it('should allow access to profile if token is provided', async () => {
      return request(app.getHttpServer())
        .get('/care/profiles')
        .set('Authorization', authToken)
        .expect(404); // 404 means Auth passed but profile not found
    });
  });

  describe('Ordering & Cart Endpoint Security', () => {
    it('should reject access to cart if missing token', async () => {
      return request(app.getHttpServer())
        .get('/ordering/cart')
        .expect(401);
    });

    it('should allow cart access with token', async () => {
      return request(app.getHttpServer())
        .get('/ordering/cart')
        .set('Authorization', authToken)
        .expect(200);
    });
  });

  describe('Guidance Endpoint Security', () => {
    let createdSessionId: string;

    it('should reject access to create session if missing token', async () => {
      return request(app.getHttpServer())
        .post('/guidance/sessions')
        .send({})
        .expect(401);
    });

    it('should create a session for the authenticated customer', async () => {
      const response = await request(app.getHttpServer())
        .post('/guidance/sessions')
        .set('Authorization', authToken)
        .send({})
        .expect(201);
        
      expect(response.body.id).toBeDefined();
      createdSessionId = response.body.id;
    });

    it('should prevent another customer from accessing the session', async () => {
      // Create another customer
      const testEmail2 = `authsec2-${Date.now()}@example.com`;
      const res = await request(app.getHttpServer())
        .post('/accounts/register')
        .send({
          name: 'Hacker',
          email: testEmail2,
          password: 'password123',
        });
      const hackerToken = `Bearer ${res.body.token}`;

      return request(app.getHttpServer())
        .get(`/guidance/sessions/${createdSessionId}`)
        .set('Authorization', hackerToken)
        .expect(403);
    });
    
    it('should prevent another customer from sending a message to the session', async () => {
      // Create another customer
      const testEmail3 = `authsec3-${Date.now()}@example.com`;
      const res = await request(app.getHttpServer())
        .post('/accounts/register')
        .send({
          name: 'Hacker',
          email: testEmail3,
          password: 'password123',
        });
      const hackerToken = `Bearer ${res.body.token}`;

      return request(app.getHttpServer())
        .post(`/guidance/sessions/${createdSessionId}/messages`)
        .set('Authorization', hackerToken)
        .send({ content: 'Hello' })
        .expect(403);
    });
  });
});

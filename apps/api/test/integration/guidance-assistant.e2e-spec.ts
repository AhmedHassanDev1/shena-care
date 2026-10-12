import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
const request = require('supertest');
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';

describe('GLO-88 Guidance Assistant (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let customerToken: string;
  let customerId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
    prisma = app.get<PrismaService>(PrismaService);

    // Create a customer
    const res = await request(app.getHttpServer())
      .post('/accounts/register')
      .send({
        email: `test-guidance-${Date.now()}@example.com`,
        password: 'password123',
        name: 'Guidance Customer'
      })
      .expect(201);
    
    customerToken = res.body.token;

    // Get customer ID
    const meRes = await request(app.getHttpServer())
      .get('/accounts/me')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    customerId = meRes.body.id;

    // Create a care profile
    await request(app.getHttpServer())
      .post('/care/profiles')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ customerId, skinType: 'dry' })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it('should create a guidance session, chat, and handle mock recommendations', async () => {
    // Create session
    const sessionRes = await request(app.getHttpServer())
      .post('/guidance/sessions')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ customerId })
      .expect(201);
    
    const sessionId = sessionRes.body.id;
    expect(sessionId).toBeDefined();

    // Send a message
    const chatRes = await request(app.getHttpServer())
      .post(`/guidance/sessions/${sessionId}/messages`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ content: 'I need a routine for oily skin' })
      .expect(201);

    expect(chatRes.body.role).toBe('assistant');
    // Ensure the message object also returns the type
    expect(chatRes.body.type).toBeDefined();

    // Get session
    const getRes = await request(app.getHttpServer())
      .get(`/guidance/sessions/${sessionId}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);

    expect(getRes.body.messages.length).toBe(2);
    expect(getRes.body.messages[0].role).toBe('user');
    expect(getRes.body.messages[1].role).toBe('assistant');
  });
});

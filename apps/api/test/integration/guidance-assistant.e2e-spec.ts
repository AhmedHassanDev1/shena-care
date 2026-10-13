import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
const request = require('supertest');
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { AiClient } from '../../src/platform/ai';
import { DeterministicAiClient } from '../fixtures/deterministic-ai';
import { createSellableSku } from '../fixtures/sellable-sku';

describe('GLO-88 Guidance Assistant (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let customerToken: string;
  let customerId: string;
  const ai = new DeterministicAiClient();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).overrideProvider(AiClient).useValue(ai).compile();

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

  it('isolates an AI outage: retryable 503, user message kept, retry recovers, commerce unaffected', async () => {
    const auth = { Authorization: `Bearer ${customerToken}` };
    const sku = await createSellableSku(prisma);
    const session = (await request(app.getHttpServer()).post('/guidance/sessions').set(auth).send({}).expect(201)).body;

    ai.down = true;
    try {
      const failed = await request(app.getHttpServer()).post(`/guidance/sessions/${session.id}/messages`).set(auth)
        .send({ content: 'I need a routine' }).expect(503);
      expect(failed.body.retryable).toBe(true);

      // Commerce keeps working while the AI provider is down.
      await request(app.getHttpServer()).get('/products/' + sku.productSlug).expect(200);
      await request(app.getHttpServer()).post('/ordering/cart/add').set(auth).send({ skuId: sku.id, quantity: 1 }).expect(201);
    } finally {
      ai.down = false;
    }

    const retried = await request(app.getHttpServer()).post(`/guidance/sessions/${session.id}/retry`).set(auth).expect(201);
    expect(retried.body.role).toBe('assistant');
    const messages = (await request(app.getHttpServer()).get(`/guidance/sessions/${session.id}`).set(auth).expect(200)).body.messages;
    expect(messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant']);
  });

  it('refuses access to a guidance session owned by another customer', async () => {
    const session = (await request(app.getHttpServer()).post('/guidance/sessions')
      .set('Authorization', `Bearer ${customerToken}`).send({}).expect(201)).body;
    const other = await request(app.getHttpServer()).post('/accounts/register')
      .send({ email: `guidance-other-${Date.now()}@example.com`, password: 'password123', name: 'Other' }).expect(201);
    const otherAuth = { Authorization: `Bearer ${other.body.token}` };
    await request(app.getHttpServer()).get(`/guidance/sessions/${session.id}`).set(otherAuth).expect(403);
    await request(app.getHttpServer()).post(`/guidance/sessions/${session.id}/messages`).set(otherAuth).send({ content: 'hi' }).expect(403);
    await request(app.getHttpServer()).post('/guidance/sessions').set(otherAuth).send({ customerId }).expect(403);
  });
});

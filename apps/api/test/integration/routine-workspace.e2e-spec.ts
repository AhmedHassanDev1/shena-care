import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { AiClient } from '../../src/platform/ai/ai-client.contract';

describe('Routine Workspace & AI Proposal Lifecycle (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let customer1Token: string;
  let customer1Id: string;
  let customer2Token: string;
  let customer2Id: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AiClient)
      .useValue({
        enrichProduct: jest.fn(),
        recommendRoutine: jest.fn().mockResolvedValue({
          schemaVersion: '1',
          message: 'Personalized routine proposal',
          proposal: {
            title: 'Hydrating Morning Routine',
            description: 'Focuses on hydration and skin barrier',
            careArea: 'skin',
            steps: [
              {
                title: 'Gentle Cleanser',
                instructions: 'Apply to damp face',
                timing: 'am',
                isOptional: false,
                productQuery: null,
              },
            ],
          },
        }),
        generateContent: jest.fn(),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);

    // Register Customer 1
    const email1 = `routine-user1-${Date.now()}@example.com`;
    const res1 = await request(app.getHttpServer())
      .post('/accounts/register')
      .send({ name: 'User One', email: email1, password: 'password123' });
    customer1Token = `Bearer ${res1.body.token}`;

    const meRes1 = await request(app.getHttpServer())
      .get('/accounts/me')
      .set('Authorization', customer1Token);
    customer1Id = meRes1.body.id;

    // Register Customer 2
    const email2 = `routine-user2-${Date.now()}@example.com`;
    const res2 = await request(app.getHttpServer())
      .post('/accounts/register')
      .send({ name: 'User Two', email: email2, password: 'password123' });
    customer2Token = `Bearer ${res2.body.token}`;

    const meRes2 = await request(app.getHttpServer())
      .get('/accounts/me')
      .set('Authorization', customer2Token);
    customer2Id = meRes2.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('1. Creates an anonymous draft and retrieves guest token', async () => {
    const res = await request(app.getHttpServer())
      .post('/care/workspace/drafts')
      .send({
        careArea: 'skin',
        primaryConcern: 'dryness',
        budget: 150,
        isBudgetStrict: true,
      })
      .expect(201);

    expect(res.body.draft).toBeDefined();
    expect(res.body.guestToken).toBeDefined();
    expect(res.body.draft.customerId).toBeNull();
  });

  it('2. Links guest draft to Customer 1 and invalidates re-linking guest token', async () => {
    // Create anonymous draft
    const startRes = await request(app.getHttpServer())
      .post('/care/workspace/drafts')
      .send({ careArea: 'skin', primaryConcern: 'acne' });

    const draftId = startRes.body.draft.id;
    const guestToken = startRes.body.guestToken;

    // Link to Customer 1
    const linkRes = await request(app.getHttpServer())
      .post(`/care/workspace/drafts/${draftId}/link`)
      .set('Authorization', customer1Token)
      .set('x-guest-token', guestToken)
      .expect(201);

    expect(linkRes.body.customerId).toBe(customer1Id);
    expect(linkRes.body.guestTokenHash).toBeNull();

    // Attempting to re-link with same guest token must fail (Security: Guest token reuse prevention)
    await request(app.getHttpServer())
      .post(`/care/workspace/drafts/${draftId}/link`)
      .set('Authorization', customer2Token)
      .set('x-guest-token', guestToken)
      .expect(403);
  });

  it('3. Enforces cross-user authorization (Customer 2 cannot access Customer 1 draft)', async () => {
    const startRes = await request(app.getHttpServer())
      .post('/care/workspace/drafts')
      .send({ careArea: 'skin', primaryConcern: 'sensitivity' });

    const draftId = startRes.body.draft.id;
    const guestToken = startRes.body.guestToken;

    await request(app.getHttpServer())
      .post(`/care/workspace/drafts/${draftId}/link`)
      .set('Authorization', customer1Token)
      .set('x-guest-token', guestToken)
      .expect(201);

    // Customer 2 tries to get Customer 1's draft
    await request(app.getHttpServer())
      .get(`/care/workspace/drafts/${draftId}`)
      .set('Authorization', customer2Token)
      .expect(403);
  });

  it('4. Handles optimistic concurrency conflict on draft updates (Stale Version 409)', async () => {
    const startRes = await request(app.getHttpServer())
      .post('/care/workspace/drafts')
      .set('Authorization', customer1Token)
      .send({ careArea: 'skin', primaryConcern: 'aging' });

    const draftId = startRes.body.draft.id;

    // Update with correct version (1)
    const updateRes = await request(app.getHttpServer())
      .patch(`/care/workspace/drafts/${draftId}`)
      .set('Authorization', customer1Token)
      .send({ primaryConcern: 'wrinkles', version: 1 })
      .expect(200);

    expect(updateRes.body.version).toBe(2);

    // Update with stale version (1 instead of 2) -> Expect 409 Conflict
    await request(app.getHttpServer())
      .patch(`/care/workspace/drafts/${draftId}`)
      .set('Authorization', customer1Token)
      .send({ primaryConcern: 'fine lines', version: 1 })
      .expect(409);
  });

  it('5. Full Lifecycle: Draft → Proposal → Accept → Saved Routine in PostgreSQL', async () => {
    // Create & link draft
    const startRes = await request(app.getHttpServer())
      .post('/care/workspace/drafts')
      .send({ careArea: 'skin', primaryConcern: 'hyperpigmentation' });

    const draftId = startRes.body.draft.id;
    const guestToken = startRes.body.guestToken;

    await request(app.getHttpServer())
      .post(`/care/workspace/drafts/${draftId}/link`)
      .set('Authorization', customer1Token)
      .set('x-guest-token', guestToken);

    // Generate Proposal
    const proposalRes = await request(app.getHttpServer())
      .post(`/care/workspace/drafts/${draftId}/proposals`)
      .set('Authorization', customer1Token)
      .expect(201);

    expect(proposalRes.body.status).toBe('proposed');
    expect(proposalRes.body.snapshot).toBeDefined();
    const proposalId = proposalRes.body.id;

    // Accept Proposal
    const acceptRes = await request(app.getHttpServer())
      .post(`/care/workspace/proposals/${proposalId}/accept`)
      .set('Authorization', customer1Token)
      .expect(201);

    expect(acceptRes.body.id).toBeDefined();

    // Verify DB Assertions
    const savedRoutine = await prisma.routine.findUnique({
      where: { id: acceptRes.body.id },
      include: { steps: true },
    });

    expect(savedRoutine).not.toBeNull();
    expect(savedRoutine?.title).toBe('Hydrating Morning Routine');
    expect(savedRoutine?.steps.length).toBe(1);

    const updatedProposal = await prisma.routineProposal.findUnique({
      where: { id: proposalId },
    });
    expect(updatedProposal?.status).toBe('accepted');
  });

  it('6. Idempotent acceptance: duplicate accept throws error', async () => {
    const startRes = await request(app.getHttpServer())
      .post('/care/workspace/drafts')
      .send({ careArea: 'skin', primaryConcern: 'redness' });

    const draftId = startRes.body.draft.id;
    const guestToken = startRes.body.guestToken;

    await request(app.getHttpServer())
      .post(`/care/workspace/drafts/${draftId}/link`)
      .set('Authorization', customer1Token)
      .set('x-guest-token', guestToken);

    const proposalRes = await request(app.getHttpServer())
      .post(`/care/workspace/drafts/${draftId}/proposals`)
      .set('Authorization', customer1Token);

    const proposalId = proposalRes.body.id;

    // First accept
    await request(app.getHttpServer())
      .post(`/care/workspace/proposals/${proposalId}/accept`)
      .set('Authorization', customer1Token)
      .expect(201);

    // Duplicate accept attempt -> Expect 400 Bad Request
    await request(app.getHttpServer())
      .post(`/care/workspace/proposals/${proposalId}/accept`)
      .set('Authorization', customer1Token)
      .expect(400);
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
const request = require('supertest');
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';

describe('Care Domain Lifecycle (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let productId: string;
  let invalidProductId = '00000000-0000-0000-0000-000000000000';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Clean tables
    await prisma.routineStepRecommendation.deleteMany();
    await prisma.routineStep.deleteMany();
    await prisma.routine.deleteMany();
    await prisma.concern.deleteMany();
    await prisma.productMedia.deleteMany();
    await prisma.sku.deleteMany();
    await prisma.product.deleteMany();
    await prisma.brand.deleteMany();

    // Setup basic catalog product for recommendation
    const brand = await prisma.brand.create({
      data: { name: 'CareBrand', slug: 'care-brand' },
    });

    const product = await prisma.product.create({
      data: {
        name: 'Care Cleanser',
        slug: 'care-cleanser',
        brandId: brand.id,
        isPublished: true,
      },
    });
    productId = product.id;
  });

  it('verifies the care domain lifecycle: concerns, routines, steps, and catalog references', async () => {
    // 1. Create a Concern
    const createConcernRes = await request(app.getHttpServer())
      .post('/care/concerns')
      .send({
        name: 'Acne',
        careArea: 'skin',
        description: 'Frequent breakouts',
      })
      .expect(201);

    const concernId = createConcernRes.body.id;
    expect(concernId).toBeDefined();

    // 2. Different care areas can coexist (Create Hair concern)
    const createHairConcernRes = await request(app.getHttpServer())
      .post('/care/concerns')
      .send({
        name: 'Frizz',
        careArea: 'hair',
      })
      .expect(201);

    expect(createHairConcernRes.body.careArea).toBe('hair');

    // 3. Routine creation
    const createRoutineRes = await request(app.getHttpServer())
      .post('/care/routines')
      .send({
        title: 'Basic Acne Routine',
        careArea: 'skin',
      })
      .expect(201);

    const routineId = createRoutineRes.body.id;
    expect(routineId).toBeDefined();

    // 5. Invalid catalog reference is rejected
    await request(app.getHttpServer())
      .post(`/care/routines/${routineId}/steps`)
      .send({
        title: 'Cleansing',
        stepOrder: 1,
        timing: 'am',
        recommendations: [
          { productId: invalidProductId }
        ]
      })
      .expect(404);

    // 4 & 6. Ordered routine steps with timing
    await request(app.getHttpServer())
      .post(`/care/routines/${routineId}/steps`)
      .send({
        title: 'Cleansing',
        stepOrder: 1,
        timing: 'both',
        instructions: 'Massage for 60s',
        recommendations: [
          { productId } // valid product reference
        ]
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/care/routines/${routineId}/steps`)
      .send({
        title: 'Treatment',
        stepOrder: 2,
        timing: 'pm',
        isOptional: true,
      })
      .expect(201);

    // 7. Duplicate step ordering behavior fails
    await request(app.getHttpServer())
      .post(`/care/routines/${routineId}/steps`)
      .send({
        title: 'Another Treatment',
        stepOrder: 2,
        timing: 'pm',
      })
      .expect(409); // Conflict

    // Verify retrieval of Routine
    const getRoutineRes = await request(app.getHttpServer())
      .get(`/care/routines/${routineId}`)
      .expect(200);

    expect(getRoutineRes.body.steps.length).toBe(2);
    expect(getRoutineRes.body.steps[0].stepOrder).toBe(1);
    expect(getRoutineRes.body.steps[0].recommendations.length).toBe(1);
    expect(getRoutineRes.body.steps[0].recommendations[0].productId).toBe(productId);
    expect(getRoutineRes.body.steps[1].stepOrder).toBe(2);
  });

  it('verifies that deleting a referenced Catalog product cascades correctly', async () => {
    // Setup Routine and Step with product recommendation
    const routine = await prisma.routine.create({
      data: { title: 'Delete Test Routine', careArea: 'skin' }
    });

    const step = await prisma.routineStep.create({
      data: {
        routineId: routine.id,
        title: 'Step 1',
        stepOrder: 1,
        timing: 'both',
        recommendations: {
          create: [{ productId }]
        }
      },
      include: { recommendations: true }
    });

    expect(step.recommendations.length).toBe(1);

    // Act: Delete the Product from Catalog
    await prisma.product.delete({ where: { id: productId } });

    // Assert: The recommendation should be cascading deleted
    const recs = await prisma.routineStepRecommendation.findMany({
      where: { stepId: step.id }
    });
    expect(recs.length).toBe(0);

    // Assert: The step itself still exists
    const stepAfter = await prisma.routineStep.findUnique({
      where: { id: step.id }
    });
    expect(stepAfter).toBeDefined();
  });
});

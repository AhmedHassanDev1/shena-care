import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { createActor, Actor } from '../fixtures/actors';

describe('supplier ingestion job readback (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let supplierA: Actor;
  let supplierB: Actor;
  let admin: Actor;
  let customer: Actor;
  let unlinkedSupplier: Actor;
  let supplierAId: string;
  let supplierBId: string;
  let ownJobId: string;
  let foreignJobId: string;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useLogger(false);
    await app.init();
    prisma = app.get(PrismaService);
    const marker = randomUUID();
    supplierAId = (await prisma.supplier.create({ data: { name: `Readback A ${marker}`, slug: `readback-a-${marker}` } })).id;
    supplierBId = (await prisma.supplier.create({ data: { name: `Readback B ${marker}`, slug: `readback-b-${marker}` } })).id;
    supplierA = await createActor(prisma, 'SUPPLIER', supplierAId);
    supplierB = await createActor(prisma, 'SUPPLIER', supplierBId);
    admin = await createActor(prisma, 'ADMIN');
    customer = await createActor(prisma, 'CUSTOMER');
    unlinkedSupplier = await createActor(prisma, 'SUPPLIER');
    ownJobId = (await prisma.ingestionJob.create({ data: { supplierId: supplierAId, items: { create: {
      supplierSkuCode: 'OWN-1', name: 'Own item', brand: 'Fixture', price: 12, currency: 'EGP',
    } } } })).id;
    foreignJobId = (await prisma.ingestionJob.create({ data: { supplierId: supplierBId, items: { create: {
      supplierSkuCode: 'OTHER-1', name: 'Other item', brand: 'Fixture', price: 34, currency: 'EGP',
    } } } })).id;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.ingestionJob.deleteMany({ where: { id: { in: [ownJobId, foreignJobId] } } });
      const actorIds = [supplierA?.id, supplierB?.id, admin?.id, customer?.id, unlinkedSupplier?.id].filter(Boolean);
      await prisma.session.deleteMany({ where: { customerId: { in: actorIds } } });
      await prisma.customer.deleteMany({ where: { id: { in: actorIds } } });
      await prisma.supplier.deleteMany({ where: { id: { in: [supplierAId, supplierBId] } } });
    }
    if (app) await app.close();
  });

  it('lets a supplier resume only its own import job and keeps other tenants hidden', async () => {
    const list = await http().get('/ingestion/jobs').set(supplierA.auth).expect(200);
    expect(list.body.map((job: { id: string }) => job.id)).toContain(ownJobId);
    expect(list.body.map((job: { id: string }) => job.id)).not.toContain(foreignJobId);
    const own = await http().get(`/ingestion/jobs/${ownJobId}`).set(supplierA.auth).expect(200);
    expect(own.body).toMatchObject({ id: ownJobId, supplierId: supplierAId, items: [{ supplierSkuCode: 'OWN-1' }] });
    await http().get(`/ingestion/jobs/${foreignJobId}`).set(supplierA.auth).expect(404);
    await http().get(`/ingestion/jobs/${ownJobId}`).set(supplierB.auth).expect(404);
    await http().get(`/ingestion/jobs/${foreignJobId}`).set(admin.auth).expect(200);
  });

  it('rejects anonymous and customer job reads', async () => {
    await http().get('/ingestion/jobs').expect(401);
    await http().get(`/ingestion/jobs/${ownJobId}`).expect(401);
    await http().get('/ingestion/jobs').set(customer.auth).expect(403);
    await http().get(`/ingestion/jobs/${ownJobId}`).set(customer.auth).expect(403);
    await http().get('/ingestion/jobs').set(unlinkedSupplier.auth).expect(403);
    await http().get(`/ingestion/jobs/${ownJobId}`).set(unlinkedSupplier.auth).expect(403);
    await http().get('/ingestion/jobs/not-a-uuid').set(supplierA.auth).expect(400);
  });
});

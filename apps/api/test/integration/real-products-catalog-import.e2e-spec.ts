process.env.SOURCING_MODE = 'BROADCAST_ON_DEMAND';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { AiClient } from '../../src/platform/ai';
import { DeterministicAiClient } from '../fixtures/deterministic-ai';
import { createActor, Actor } from '../fixtures/actors';

const file = fs.readFileSync(path.join(__dirname, '../fixtures/real-nivea-10.csv'));
const checksum = createHash('sha256').update(file).digest('hex');

describe('Ten genuine NIVEA catalog-list products on isolated PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Actor;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AiClient).useClass(DeterministicAiClient).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    admin = await createActor(prisma, 'ADMIN');
  }, 120000);

  afterAll(async () => { await app.close(); });

  it('uploads ten real product names, records outcomes, and reuses the same job on retry without offers or publication', async () => {
    const before = {
      offers: await prisma.supplierOffer.count(),
      products: await prisma.product.count(),
      prices: await prisma.sellingPrice.count(),
    };
    const upload = () => request(app.getHttpServer()).post('/admin/catalog-imports').set(admin.auth)
      .attach('file', file, { filename: 'real-nivea-10.csv', contentType: 'text/csv' });
    const first = await upload().expect(201);
    expect(first.body).toMatchObject({ totalRows: 10 });
    const second = await upload().expect(201);
    expect(second.body).toMatchObject({ jobId: first.body.jobId, reused: true });

    const job = await prisma.adminCatalogImportJob.findUniqueOrThrow({ where: { sourceChecksum: checksum } });
    const rows = await prisma.adminCatalogImportRow.findMany({ where: { jobId: job.id }, orderBy: { rowNumber: 'asc' } });
    expect(rows).toHaveLength(10);
    expect(rows.map(row => row.rowNumber)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(rows.every(row => row.brand === 'NIVEA' && row.sourceUrl?.startsWith('https://www.nivea-me.com/'))).toBe(true);
    expect(rows.every(row => row.outcome !== 'PENDING')).toBe(true);
    expect(await prisma.adminCatalogImportJob.count({ where: { sourceChecksum: checksum } })).toBe(1);
    expect(await prisma.supplierOffer.count()).toBe(before.offers);
    expect(await prisma.product.count()).toBe(before.products);
    expect(await prisma.sellingPrice.count()).toBe(before.prices);
  }, 120000);
});

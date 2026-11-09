/* eslint-disable @typescript-eslint/no-explicit-any -- one-off, results printed */
import { readFileSync } from 'fs';
import { parse } from 'dotenv';
process.env.EXA_API_KEY = parse(readFileSync(`${__dirname}/../../.env`)).EXA_API_KEY ?? '';
process.env.MEDIA_STORAGE_PROVIDER = 'local';
process.env.SOURCING_MODE = 'BROADCAST_ON_DEMAND';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { AiClient } from '../../src/platform/ai';
import { DeterministicAiClient } from '../fixtures/deterministic-ai';
import { createActor } from '../fixtures/actors';

/** One-off (2026-11-08): the single size derm-active.com states on the ACTI-REPAIR CICA Cream page (50 ML, the only size on the page) is applied as an Admin correction. */
describe('CICA cream size from its official page', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(AiClient).useClass(DeterministicAiClient).compile();
    app = moduleRef.createNestApplication(); app.useLogger(['error']);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true })); await app.init();
  }, 120000);
  afterAll(async () => { await app.close(); });
  it('corrects and re-runs the one row', async () => {
    const prisma = app.get(PrismaService); const admin = await createActor(prisma, 'ADMIN');
    const row = await prisma.adminCatalogImportRow.findFirstOrThrow({ where: { name: 'ACTI-REPAIR CICA Cream' } });
    const exception = await prisma.catalogException.findFirstOrThrow({ where: { importRowId: row.id, status: 'OPEN' } });
    const res = await request(app.getHttpServer()).post(`/catalog/workbench/exceptions/${exception.id}/resolve`).set(admin.auth)
      .send({ action: 'CORRECT', note: 'Size from the official page https://derm-active.com/product/acti-repair-cica-cream/ : it states one size only, 50 ML', correction: { size: 50, sizeUnit: 'ml' } });
    const after = await prisma.adminCatalogImportRow.findUniqueOrThrow({ where: { id: row.id } });
    console.log('RESULT', res.status, JSON.stringify({ decision: after.decision, reason: after.reasonCode, size: after.size?.toString(), unit: after.sizeUnit, sku: after.matchedSkuId, result: res.body?.result }));
  }, 600000);
});

import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { IntakeStoreService } from '../../src/modules/intake/public';
import { AdminIntakeService } from '../../src/application/composition/services/intake/admin-intake.service';
import { IntakeRunnerService } from '../../src/application/composition/services/intake/intake-runner.service';
import { createActor } from '../fixtures/actors';

describe('expired intake lease and exhausted retries in PostgreSQL', () => {
  it('recovers the expired lease, persists failure five, closes the job and drains idempotently', async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile(), app = mod.createNestApplication(); await app.init();
    try {
      const db = app.get(PrismaService), admin = await createActor(db, 'ADMIN'), store = app.get(IntakeStoreService), service = app.get(AdminIntakeService);
      const { job } = await store.createJob({ source: 'ADMIN', supplierId: null, submittedBy: admin.id, inputKind: 'SINGLE', checksum: randomUUID(), columnMap: { options: { researchPrices: false } } });
      await store.addRows(job.id, [{ rowNumber: 1, rawName: 'Exact verified page currently unavailable 40 ml', sourceCells: { URL: 'https://manufacturer.example/40ml' } }]);
      const [row] = await store.pendingRows(job.id);
      await db.intakeRow.update({ where: { id: row.id }, data: { attempts: 4, leaseUntil: new Date(Date.now() - 1000), nextAttemptAt: new Date(Date.now() - 1000), evidence: { checkedSource: 'https://manufacturer.example/40ml' } } });
      const work = jest.spyOn(service as unknown as { work(...args: unknown[]): Promise<never> }, 'work').mockRejectedValue(new Error('SOURCE_ACCESS_DENIED'));
      expect(await app.get(IntakeRunnerService).drain(job.id)).toBe(1);
      const saved = await db.intakeRow.findUniqueOrThrow({ where: { id: row.id } });
      expect(saved).toMatchObject({ attempts: 5, outcome: 'UNRESOLVED', reasonCode: 'RETRY_EXHAUSTED', leaseUntil: null, nextAttemptAt: null,
        evidence: { checkedSource: 'https://manufacturer.example/40ml', terminalFailure: { attempts: 5, lastError: 'SOURCE_ACCESS_DENIED' } } });
      expect((await store.getJob(job.id)).status).toBe('COMPLETED');
      expect(await app.get(IntakeRunnerService).drain(job.id)).toBe(0);
      expect(work).toHaveBeenCalledTimes(1);
      expect(await db.catalogException.count({ where: { importRowId: row.id, status: 'OPEN' } })).toBe(1);
    } finally { await app.close(); }
  }, 60000);
});

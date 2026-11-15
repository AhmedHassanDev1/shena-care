import { randomUUID } from 'crypto';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { IntakeStoreService } from '../../src/modules/intake/public';

describe('durable intake concurrency in PostgreSQL', () => {
  const db = new PrismaService();
  const store = new IntakeStoreService(db);
  beforeAll(() => db.$connect());
  afterAll(() => db.$disconnect());

  it('returns one job and one replay for simultaneous identical submissions', async () => {
    const input = { source: 'ADMIN' as const, supplierId: null, submittedBy: randomUUID(), inputKind: 'SINGLE' as const, checksum: randomUUID() };
    const find = db.intakeJob.findUnique.bind(db.intakeJob);
    let arrived = 0;
    let release!: () => void;
    const selected = new Promise<void>(resolve => { release = resolve; });
    // Both requests read the real initial state before either attempts its insert.
    const initialReads = jest.spyOn(db.intakeJob, 'findUnique').mockImplementation((async (args: Parameters<typeof find>[0]) => {
      const result = await find(args);
      if (++arrived <= 2) {
        if (arrived === 2) release();
        await selected;
      }
      return result;
    }) as typeof db.intakeJob.findUnique);
    try {
      const results = await Promise.all([store.createJob(input), store.createJob(input)]);
      expect(new Set(results.map(result => result.job.id)).size).toBe(1);
      expect(results.map(result => result.replay).sort()).toEqual([false, true]);
      expect(await db.intakeJob.count({ where: { sourceChecksum: input.checksum } })).toBe(1);
    } finally { initialReads.mockRestore(); }
  });

  it('does not reclaim a row rescheduled by another worker after the due-row read', async () => {
    const { job } = await store.createJob({ source: 'ADMIN', supplierId: null, submittedBy: randomUUID(), inputKind: 'SINGLE', checksum: randomUUID() });
    await store.addRows(job.id, [{ rowNumber: 1, rawName: 'Awaiting exact source evidence', sourceCells: {} }]);
    const [row] = await store.pendingRows(job.id);
    const retryAt = new Date(Date.now() + 60_000);
    const find = db.intakeRow.findMany.bind(db.intakeRow);
    const reschedule = jest.spyOn(db.intakeRow, 'findMany').mockImplementationOnce((async (args: Parameters<typeof find>[0]) => {
      const result = await find(args);
      // The first worker has released the lease and scheduled a bounded retry.
      await store.progress(row.id, { attempts: 1, nextAttemptAt: retryAt });
      return result;
    }) as typeof db.intakeRow.findMany);
    try {
      expect(await store.leaseAdminRows(1, job.id)).toEqual([]);
      const persisted = await db.intakeRow.findUniqueOrThrow({ where: { id: row.id } });
      expect(persisted).toMatchObject({ attempts: 1, nextAttemptAt: retryAt, leaseUntil: null });
    } finally { reschedule.mockRestore(); }
  });

  it('allows only one worker to lease a due row, then settles and replays without work', async () => {
    const { job } = await store.createJob({ source: 'ADMIN', supplierId: null, submittedBy: randomUUID(), inputKind: 'SINGLE', checksum: randomUUID() });
    await store.addRows(job.id, [{ rowNumber: 1, rawName: 'Exact row', sourceCells: {} }]);
    const leases = await Promise.all([store.leaseAdminRows(1, job.id), store.leaseAdminRows(1, job.id)]);
    expect(leases.flat()).toHaveLength(1);
    const [row] = leases.flat();
    await store.settle([{ id: row.id, outcome: 'SKIPPED', reasonCode: 'OUT_OF_SCOPE' }]);
    expect(await store.leaseAdminRows(1, job.id)).toEqual([]);
  });

  it('scopes supplier replays to the supplier, even when the same actor sends identical bytes', async () => {
    const input = { source: 'SUPPLIER' as const, submittedBy: randomUUID(), inputKind: 'FILE' as const, checksum: randomUUID() };
    const firstSupplier = randomUUID(), otherSupplier = randomUUID();
    const first = await store.createJob({ ...input, supplierId: firstSupplier });
    const other = await store.createJob({ ...input, supplierId: otherSupplier });
    expect(other.replay).toBe(false);
    expect(other.job.id).not.toBe(first.job.id);
    expect(await store.createJob({ ...input, supplierId: firstSupplier })).toMatchObject({ replay: true, job: { id: first.job.id } });
    expect(await store.createJob({ ...input, supplierId: otherSupplier })).toMatchObject({ replay: true, job: { id: other.job.id } });
    expect((await store.getJob(other.job.id)).supplierId).toBe(otherSupplier);
  });

  it('preserves replay of a preexisting supplier job only for its original supplier', async () => {
    const input = { source: 'SUPPLIER' as const, submittedBy: randomUUID(), inputKind: 'FILE' as const, checksum: randomUUID(), supplierId: randomUUID() };
    const legacy = await db.intakeJob.create({ data: { source: input.source, submittedBy: input.submittedBy, inputKind: input.inputKind,
      supplierId: input.supplierId, sourceChecksum: input.checksum } });
    expect(await store.createJob(input)).toMatchObject({ replay: true, job: { id: legacy.id } });
    const other = await store.createJob({ ...input, supplierId: randomUUID() });
    expect(other.replay).toBe(false);
    expect(other.job.id).not.toBe(legacy.id);
  });
});

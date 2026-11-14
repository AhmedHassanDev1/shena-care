import { AdminIntakeService } from '../../src/application/composition/services/intake/admin-intake.service';

describe('bounded intake failure closure', () => {
  function fixture(attempts: number) {
    const store = { getJob: jest.fn().mockResolvedValue({ columnMap: {} }), settle: jest.fn(), progress: jest.fn() };
    const decisions = { open: jest.fn() };
    const service = Object.create(AdminIntakeService.prototype) as AdminIntakeService;
    Object.assign(service, { store, decisions, logger: { warn: jest.fn() }, usage: () => ({ searches: 0, pageFetches: 0, imageFetches: 0 }),
      work: jest.fn().mockRejectedValue(new Error('SOURCE_ACCESS_DENIED')), finishJobIfDone: jest.fn() });
    const row = { id: 'row', jobId: 'job', rawName: 'Exact product 40 ml', attempts, matchedSkuId: null,
      evidence: { checkedSource: 'https://manufacturer.example/40ml' }, job: { submittedBy: 'actor' } } as Parameters<AdminIntakeService['processRow']>[0];
    return { store, decisions, service, row };
  }
  it('persists the fifth failure and its supporting evidence atomically, without scheduling a sixth attempt', async () => {
    const f = fixture(4); await f.service.processRow(f.row);
    expect(f.store.settle).toHaveBeenCalledWith([expect.objectContaining({ outcome: 'UNRESOLVED', attempts: 5,
      evidence: expect.objectContaining({ checkedSource: 'https://manufacturer.example/40ml', terminalFailure: { attempts: 5, lastError: 'SOURCE_ACCESS_DENIED' } }) })]);
    expect(f.store.progress).not.toHaveBeenCalled();
    expect(f.decisions.open).toHaveBeenCalledWith(expect.objectContaining({ evidence: expect.objectContaining({ attempts: 5, lastError: 'SOURCE_ACCESS_DENIED' }) }));
  });
  it('keeps a fourth failure pending only until its bounded automatic retry is due', async () => {
    const f = fixture(3); const before = Date.now(); await f.service.processRow(f.row);
    expect(f.store.settle).not.toHaveBeenCalled();
    expect(f.store.progress).toHaveBeenCalledWith('row', expect.objectContaining({ attempts: 4, nextAttemptAt: expect.any(Date) }));
    const next = f.store.progress.mock.calls[0][1].nextAttemptAt.getTime();
    expect(next - before).toBeGreaterThanOrEqual(480000); expect(next - before).toBeLessThan(481000);
  });
});

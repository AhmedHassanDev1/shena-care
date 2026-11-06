import { NodeResearchTransport, safeLookup } from '../../src/modules/ingestion/services/research-source-fetcher';

/** The connection itself refuses private addresses, so a hostname cannot pass a public pre-check and then connect inward. */
describe('Research transport connect-time guard', () => {
  const lookup = (host: string, all = false) => new Promise<{ error?: Error & { code?: string }; result?: unknown }>(resolve =>
    safeLookup(host, { all }, (error: Error | null, ...result: unknown[]) => resolve({ error: error ?? undefined, result })));

  it('refuses a name that resolves to a loopback or private address', async () => {
    for (const all of [false, true]) {
      const { error } = await lookup('localhost', all);
      expect(error?.code ?? error?.message).toMatch(/PRIVATE_ADDRESS|ENOTFOUND|NO_ADDRESS/);
    }
    expect((await lookup('127.0.0.1')).error?.code).toBe('PRIVATE_ADDRESS');
    expect((await lookup('10.0.0.5', true)).error?.code).toBe('PRIVATE_ADDRESS');
    expect((await lookup('169.254.169.254')).error?.code).toBe('PRIVATE_ADDRESS');
  });

  it('never opens a connection to a private address, even when asked for it directly', async () => {
    const transport = new NodeResearchTransport();
    await expect(transport.get('https://127.0.0.1:9/', { accept: 'text/html', timeoutMs: 3000 })).rejects.toMatchObject({ code: 'PRIVATE_ADDRESS' });
    await expect(transport.get('https://localhost:9/', { accept: 'text/html', timeoutMs: 3000 })).rejects.toBeDefined();
  });
});

import { isPrivateAddress, validateSafeUrl } from '../../src/platform/security/url-validator';
import { ResearchSourceFetcher, ResearchTransport } from '../../src/modules/ingestion/services/research-source-fetcher';
import { curatedBrandAlias } from '../../src/modules/ingestion/services/brand-enrichment.service';

/** SSRF audit of the direct research reader: what an address, a redirect or a DNS answer is allowed to reach. */
describe('Research reader SSRF protections', () => {
  it('classifies every private, local, embedded-IPv4 and malformed address as private', () => {
    const privateAddresses = [
      '0.0.0.0', '10.1.2.3', '127.0.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.168.0.1', '100.64.0.1', '198.18.0.1', '192.0.2.1', '224.0.0.1', '255.255.255.255',
      '::', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'fec0::1', 'ff02::1',
      '::ffff:7f00:1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:169.254.169.254', '::FFFF:192.168.1.1',
      '::127.0.0.1', '::10.0.0.1', '64:ff9b::7f00:1', '64:ff9b::10.0.0.1', '64:ff9b:1::1', '2002:7f00:1::1', '2002:0a00:0001::1', '2001::1', '2001:db8::1',
      'not-an-address', '1:2:3', '1::2::3', '::ffff:999.1.1.1', 'g::1', '',
    ];
    for (const address of privateAddresses) expect([address, isPrivateAddress(address)]).toEqual([address, true]);
    for (const address of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '100.63.0.1', '2606:2800:220:1::1', '2a00:1450:4001:80b::200e', '::ffff:93.184.216.34', '64:ff9b::5db8:d822', '2002:5db8:d822::1']) {
      expect([address, isPrivateAddress(address)]).toEqual([address, false]);
    }
  });

  it('refuses unsafe URL shapes before any lookup (plain http is refused by the reader itself, below)', () => {
    for (const url of ['ftp://example.com/x', 'https://user:pw@example.com/', 'https://localhost/', 'https://printer/', 'https://svc.internal/', 'https://10.0.0.1/', 'https://[::1]/', 'https://[fd00::1]/', 'https://[::ffff:127.0.0.1]/', 'https://2130706433/', 'https://0x7f.1/'])
      expect([url, (() => { try { validateSafeUrl(url); return 'allowed'; } catch { return 'refused'; } })()]).toEqual([url, 'refused']);
    expect(() => validateSafeUrl('https://www.example.com/page')).not.toThrow();
  });

  const transport = (hosts: Record<string, string[]>, pages: Record<string, { status: number; headers?: Record<string, string>; body?: string }>): ResearchTransport & { calls: string[] } => {
    const calls: string[] = [];
    return {
      calls,
      resolve: async host => hosts[host] ?? ['93.184.216.34'],
      get: async url => {
        calls.push(url);
        const page = pages[url] ?? { status: 404 };
        const headers = new Map(Object.entries({ 'content-type': 'text/html', ...(page.headers ?? {}) }));
        return { status: page.status, headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null }, arrayBuffer: async () => { const bytes = Buffer.from(page.body ?? ''); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) as ArrayBuffer; } };
      },
    };
  };
  const any = () => true;

  it('re-validates every redirect hop: an approved host that resolves privately is never contacted', async () => {
    const t = transport({ 'internal.acme.example': ['10.0.0.7'] }, {
      'https://acme.example/robots.txt': { status: 404 },
      'https://acme.example/x': { status: 302, headers: { location: 'https://internal.acme.example/secret' } },
    });
    const result = await new ResearchSourceFetcher(t).fetch('https://acme.example/x', { kind: 'page', isApprovedHost: any });
    expect(result.outcome).toBe('UNSAFE_URL');
    expect(t.calls.some(url => url.includes('internal.acme.example'))).toBe(false);
  });

  it('refuses a redirect to a metadata or loopback literal, a downgrade to http and a redirect loop', async () => {
    for (const location of ['https://169.254.169.254/latest/meta-data', 'https://[::1]/x', 'http://acme.example/plain', 'file:///etc/passwd', 'https://user:pw@acme.example/']) {
      const t = transport({}, { 'https://acme.example/robots.txt': { status: 404 }, 'https://acme.example/x': { status: 301, headers: { location } } });
      const outcome = (await new ResearchSourceFetcher(t).fetch('https://acme.example/x', { kind: 'page', isApprovedHost: any })).outcome;
      expect([location, outcome]).toEqual([location, 'UNSAFE_URL']);
    }
    const loop = transport({}, { 'https://acme.example/robots.txt': { status: 404 }, 'https://acme.example/x': { status: 302, headers: { location: '/x' } } });
    expect((await new ResearchSourceFetcher(loop).fetch('https://acme.example/x', { kind: 'page', isApprovedHost: any })).outcome).toBe('TOO_MANY_REDIRECTS');
  });

  it('refuses a name that answers with a hostile IPv6 spelling of a private address', async () => {
    for (const address of ['::ffff:127.0.0.1', '64:ff9b::7f00:1', '2002:7f00:1::1', 'fec0::5']) {
      const t = transport({ 'rebind.example': ['93.184.216.34', address] }, { 'https://rebind.example/robots.txt': { status: 404 }, 'https://rebind.example/x': { status: 200, body: 'x' } });
      expect([address, (await new ResearchSourceFetcher(t).fetch('https://rebind.example/x', { kind: 'page', isApprovedHost: any })).outcome]).toEqual([address, 'UNSAFE_URL']);
      expect(t.calls).toEqual([]);
    }
  });
});

describe('Curated Arabic brand dictionary', () => {
  it('resolves reviewed spellings and never guesses', () => {
    expect(curatedBrandAlias('سيرافي')).toMatchObject({ canonicalName: 'CeraVe' });
    expect(curatedBrandAlias('  كوسركس ')).toMatchObject({ canonicalName: 'COSRX' });
    expect(curatedBrandAlias('لاروش بوزيه')).toMatchObject({ canonicalName: 'La Roche-Posay' });
    expect(curatedBrandAlias('ISDIN')).toMatchObject({ canonicalName: 'ISDIN' });
    expect(curatedBrandAlias('سيروماكس')).toBeNull();
    expect(curatedBrandAlias('')).toBeNull();
  });
});

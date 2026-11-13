import sharp from 'sharp';
import { ResearchSourceFetcher, ResearchTransport } from '../../src/modules/catalog/research/research-source-fetcher';

describe('native WebP served by official sites as binary', () => {
  const read = async (body: Buffer, contentType = 'application/octet-stream', kind: 'page' | 'image' = 'image') => {
    const transport: ResearchTransport = {
      resolve: async () => ['93.184.216.34'],
      get: async url => ({ status: url.endsWith('/robots.txt') ? 404 : 200,
        headers: { get: name => name === 'content-type' ? contentType : null },
        arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length) as ArrayBuffer }),
    };
    return new ResearchSourceFetcher(transport).fetch('https://africa.cerave.com/original.webp', { kind, isApprovedHost: h => h === 'africa.cerave.com' });
  };
  it('accepts a fully decoded single-frame native WebP and retains its exact bytes', async () => {
    const body = await sharp({ create: { width: 400, height: 500, channels: 3, background: 'white' } }).webp().toBuffer();
    const source = await read(body, 'application/octet-stream; charset=binary');
    expect(source.outcome).toBe('OK');
    expect(source.contentType).toBe('image/webp');
    expect(source.body).toEqual(body);
  });
  it('does not trust a .webp extension, a signature alone, corrupt payload or appended foreign bytes', async () => {
    const real = await sharp({ create: { width: 400, height: 500, channels: 3, background: 'white' } }).webp().toBuffer();
    for (const body of [Buffer.from('<html>denied</html>'), Buffer.from('RIFF0000WEBPfake'), real.subarray(0, 30), Buffer.concat([real, Buffer.from('<script>x</script>')])]) {
      expect((await read(body)).outcome).toBe('WRONG_CONTENT_TYPE');
    }
  });
  it('does not widen page or other media-type acceptance', async () => {
    const real = await sharp({ create: { width: 400, height: 500, channels: 3, background: 'white' } }).webp().toBuffer();
    expect((await read(real, 'text/html')).outcome).toBe('WRONG_CONTENT_TYPE');
    expect((await read(real, 'application/octet-stream', 'page')).outcome).toBe('WRONG_CONTENT_TYPE');
  });
});

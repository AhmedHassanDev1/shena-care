import sharp from 'sharp';
import { assertSafeSvg, normalizeLogo } from '../../src/modules/catalog/research/brand-logo';

const svg = (inner: string, attrs = 'viewBox="0 0 200 80" width="200" height="80"') =>
  Buffer.from(`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ${attrs}>${inner}</svg>`);
const GOOD = '<rect width="200" height="80" fill="#14507a"/><circle cx="40" cy="40" r="24" fill="#fff"/><path d="M90 20h80v10H90z" fill="url(#g)"/><defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs>';

describe('Brand logo normalization', () => {
  it('rasterizes a legitimate SVG to a PNG and keeps nothing of the source', async () => {
    const out = await normalizeLogo('image/svg+xml', svg(GOOD));
    expect(out).not.toBeNull();
    const meta = await sharp(out!.png).metadata();
    expect(meta.format).toBe('png');
    expect(Math.max(meta.width!, meta.height!)).toBe(512);
    expect(out!.png.includes(Buffer.from('<svg'))).toBe(false);
  });

  it('refuses every SVG that can run, load or include something', async () => {
    const hostile: Array<[string, string]> = [
      ['script', '<script>alert(1)</script><rect width="9" height="9"/>'],
      ['event handler', '<rect width="9" height="9" onload="alert(1)"/>'],
      ['foreignObject', '<foreignObject width="9" height="9"><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject>'],
      ['external image', '<image href="https://evil.example/x.png" width="9" height="9"/>'],
      ['external xlink', '<image xlink:href="http://169.254.169.254/latest" width="9" height="9"/>'],
      ['file reference', '<image href="file:///etc/passwd" width="9" height="9"/>'],
      ['external use', '<use href="https://evil.example/a.svg#x"/>'],
      ['css url', '<rect width="9" height="9" style="fill:url(https://evil.example/p)"/>'],
      ['css import', '<style>@import url("https://evil.example/a.css");</style><rect width="9" height="9"/>'],
      ['javascript link', '<a href="javascript:alert(1)"><rect width="9" height="9"/></a>'],
      ['animation of href', '<rect width="9" height="9"><animate attributeName="href" to="https://evil.example"/></rect>'],
    ];
    for (const [name, inner] of hostile) expect([name, await normalizeLogo('image/svg+xml', svg(inner))]).toEqual([name, null]);
    const entity = Buffer.from('<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 9 9"><text>&x;</text></svg>');
    expect(await normalizeLogo('image/svg+xml', entity)).toBeNull();
    expect(() => assertSafeSvg(entity.toString())).toThrow();
  });

  it('allows references inside the file and small embedded raster images', async () => {
    const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#2a6' } }).png().toBuffer();
    const inner = `<defs><rect id="r" width="60" height="30" fill="#14507a"/></defs><use href="#r"/><image width="40" height="40" href="data:image/png;base64,${png.toString('base64')}"/>`;
    expect(await normalizeLogo('image/svg+xml', svg(inner))).not.toBeNull();
  });

  it('refuses oversized, blank and non-image input without throwing', async () => {
    expect(await normalizeLogo('image/svg+xml', Buffer.alloc(300_001, 32))).toBeNull();
    expect(await normalizeLogo('image/svg+xml', svg('<rect width="200" height="80" fill-opacity="0"/>'))).toBeNull(); // renders nothing
    expect(await normalizeLogo('image/svg+xml', Buffer.from('not xml at all'))).toBeNull();
    expect(await normalizeLogo('text/html', Buffer.from('<svg/>'))).toBeNull();
    expect(await normalizeLogo('image/png', Buffer.from('definitely not a png'))).toBeNull();
    expect(await normalizeLogo('image/png', await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000' } }).png().toBuffer())).toBeNull(); // a speck
  });

  it('re-encodes raster logos, dropping metadata, and never upscales them', async () => {
    const jpg = await sharp({ create: { width: 300, height: 120, channels: 3, background: '#14507a' } }).withMetadata({ exif: { IFD0: { Copyright: 'x' } } }).jpeg().toBuffer();
    const out = await normalizeLogo('image/jpeg', jpg);
    const meta = await sharp(out!.png).metadata();
    expect([meta.format, meta.width, meta.height, meta.exif]).toEqual(['png', 300, 120, undefined]);
  });
});

import sharp from 'sharp';

/**
 * A brand logo from the web is untrusted input. Nothing fetched is ever stored or served as-is: it is decoded, size-bounded and re-encoded as a
 * plain PNG, so no active content, metadata or external reference survives. SVG, which is code, must first pass a strict allow-list and is then
 * rasterized by the renderer; an SVG that fails any rule is not a logo we keep.
 */
export const LOGO_MAX_BYTES = 1_500_000;
export const SVG_MAX_BYTES = 300_000;
const MAX_INPUT_PIXELS = 25_000_000;
export const LOGO_EDGE = 512;
const MIN_EDGE = 24;

export const LOGO_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'] as const;
export type LogoMediaType = (typeof LOGO_MEDIA_TYPES)[number];

/** Anything that can run, load or include something else. A logo needs none of it. */
const FORBIDDEN_SVG = /<!doctype|<!entity|<\?xml-stylesheet|<script|<foreignobject|<iframe|<object|<embed|<audio|<video|<canvas|<animate|<set\b|<handler|<listener|<a\s|@import|javascript:|vbscript:|expression\s*\(|\son[a-z]+\s*=/i;
const DATA_IMAGE = /^data:image\/(png|jpe?g|webp);base64,[a-z0-9+/=\s]+$/i;

/** Throws when the SVG contains anything beyond static vector drawing. */
export function assertSafeSvg(source: string): void {
  const text = source.replace(/^﻿/, '');
  if (Buffer.byteLength(text) > SVG_MAX_BYTES) throw new Error('SVG_TOO_LARGE');
  const body = text.replace(/<\?xml[^>]*\?>/i, '').replace(/<!--[\s\S]*?-->/g, '').trimStart();
  if (!/^<svg[\s>]/i.test(body)) throw new Error('NOT_SVG');
  if (FORBIDDEN_SVG.test(body)) throw new Error('UNSAFE_SVG');
  // Every reference must point inside the file; only small embedded raster images may be loaded from a data URI.
  for (const m of body.matchAll(/(?:xlink:)?href\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const target = (m[1] ?? m[2] ?? '').trim();
    if (!target.startsWith('#') && !DATA_IMAGE.test(target)) throw new Error('EXTERNAL_REFERENCE');
  }
  for (const m of body.matchAll(/url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi)) {
    const target = m[2].trim();
    if (!target.startsWith('#') && !DATA_IMAGE.test(target)) throw new Error('EXTERNAL_REFERENCE');
  }
}

export interface NormalizedLogo { png: Buffer; width: number; height: number }

/** The PNG that is safe to store for a fetched logo, or null when the bytes are not a usable logo. Never throws on hostile input. */
export async function normalizeLogo(mediaType: string, bytes: Buffer): Promise<NormalizedLogo | null> {
  try {
    const type = mediaType.split(';')[0].trim().toLowerCase();
    if (!(LOGO_MEDIA_TYPES as readonly string[]).includes(type)) return null;
    let input: Buffer;
    if (type === 'image/svg+xml') {
      if (bytes.length > SVG_MAX_BYTES) return null;
      const source = bytes.toString('utf8');
      assertSafeSvg(source);
      input = Buffer.from(source, 'utf8');
    } else {
      if (bytes.length > LOGO_MAX_BYTES) return null;
      input = bytes;
    }
    const pipeline = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error', ...(type === 'image/svg+xml' && { density: 192 }) });
    const meta = await pipeline.metadata();
    if (!meta.width || !meta.height || Math.min(meta.width, meta.height) < 1) return null;
    const { data, info } = await pipeline.rotate().resize({ width: LOGO_EDGE, height: LOGO_EDGE, fit: 'inside', withoutEnlargement: type !== 'image/svg+xml' })
      .png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true });
    // A blank render (everything transparent) or a speck is not a logo.
    if (Math.min(info.width, info.height) < MIN_EDGE) return null;
    const stats = await sharp(data).stats();
    if (stats.isOpaque === false && stats.channels.length >= 4 && stats.channels[3].max === 0) return null;
    return { png: data, width: info.width, height: info.height };
  } catch {
    return null;
  }
}

import { createHash } from 'crypto';

/**
 * URL slug for a NEW catalog product created from a candidate (GLO-278). The readable part is ASCII-only, so an Arabic
 * title contributes nothing to it; a hash of the normalized identity keeps two different Arabic products from both
 * collapsing to "<brand>-product". The slug is never used to FIND an existing product — identity is (brand, base name).
 */
export function canonicalProductSlug(brandName: string, productName: string, identityKey: string): string {
  const ascii = (text: string) => text.normalize('NFKD').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const hash = createHash('sha256').update(identityKey).digest('hex').slice(0, 10);
  return [ascii(brandName) || 'brand', ascii(productName).slice(0, 60).replace(/-+$/, '') || 'product', hash].join('-');
}

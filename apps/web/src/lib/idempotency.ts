/**
 * Random RFC 4122 version-4 UUID for request idempotency keys.
 *
 * Replaces the `uuid` package, which apps/web never declared (it only resolved through apps/api's
 * hoisted copy). `crypto.randomUUID()` needs a secure context (HTTPS or localhost), so plain-HTTP
 * hosts fall back to `crypto.getRandomValues()`, which is available everywhere.
 */
export function createIdempotencyKey(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();

  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

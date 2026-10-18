/**
 * Hosts next/image may optimize (mirrors `images.remotePatterns` in next.config.js). Any other host
 * is still shown, but unoptimized, so one unexpected media URL never breaks the page.
 */
const OPTIMIZED_HOSTS = new Set(['cdn.shopify.com', 'res.cloudinary.com']);

export function canOptimizeImage(url: string): boolean {
  try {
    return OPTIMIZED_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

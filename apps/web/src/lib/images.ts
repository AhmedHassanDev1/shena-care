const CLOUDINARY_CLOUD = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME || 'dkcmjjkno';
const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/+$/, '');

/**
 * Resolves catalog/API media references into valid, browser-loadable URLs.
 * Handles:
 * - cloudinary://<public_id> -> https://res.cloudinary.com/<cloud>/image/upload/<public_id>
 * - relative API storage paths (/storage/..., /uploads/...) -> http://localhost:3001/...
 * - absolute http(s) URLs -> passed as-is
 * - empty / invalid -> null
 */
export function resolveImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('cloudinary://')) {
    const publicId = trimmed.slice('cloudinary://'.length).replace(/^\/+/, '');
    return `https://res.cloudinary.com/${CLOUDINARY_CLOUD}/image/upload/${publicId}`;
  }

  if (
    trimmed.startsWith('/storage/') ||
    trimmed.startsWith('/uploads/') ||
    trimmed.startsWith('storage/') ||
    trimmed.startsWith('uploads/')
  ) {
    const normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    return `${API_URL}${normalized}`;
  }

  return trimmed;
}

/**
 * Hosts next/image may optimize (mirrors `images.remotePatterns` in next.config.js). Any other host
 * is still shown, but unoptimized, so one unexpected media URL never breaks the page.
 * Localhost and 127.0.0.1 return false so that local development and test servers serve images directly
 * via <img src="..." /> rather than through the Next.js image proxy /_next/image (preventing port mismatch 400s).
 */
const OPTIMIZED_HOSTS = new Set([
  'cdn.shopify.com',
  'res.cloudinary.com',
  'lh3.googleusercontent.com',
]);

export function canOptimizeImage(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      return false;
    }
    if (parsed.hostname.endsWith('.supabase.co') || parsed.hostname.endsWith('.cloudinary.com')) {
      return true;
    }
    return OPTIMIZED_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}


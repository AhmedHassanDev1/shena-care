import type { Config } from './config.js';
import { AdapterError } from './errors.js';

export function allowedDownloadUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new AdapterError('Stitch returned an invalid download URL.'); }
  const host = url.hostname;
  const allowed = ['storage.googleapis.com', 'contribution.usercontent.google.com'].includes(host)
    || ['googleusercontent.com', 'gstatic.com'].some(domain => host === domain || host.endsWith(`.${domain}`));
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !allowed) {
    throw new AdapterError('Download blocked: the URL must use HTTPS on an approved Google asset host. Inspect get_screen metadata if Stitch has changed its export host.');
  }
  return url;
}

export async function download(value: string, config: Config, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<Buffer> {
  const abort = AbortSignal.any([AbortSignal.timeout(config.downloadTimeoutMs), ...(signal ? [signal] : [])]);
  let url = allowedDownloadUrl(value);
  for (let redirects = 0; redirects <= 3; redirects++) {
    // The Stitch API key, cookies and bearer token are never sent to asset hosts.
    const response = await fetcher(url, { redirect: 'manual', credentials: 'omit', signal: abort, headers: { Accept: '*/*' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location || redirects === 3) throw new AdapterError('The export has too many redirects or no redirect destination.');
      url = allowedDownloadUrl(new URL(location, url).href);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new AdapterError(`Asset download failed (HTTP ${response.status}). Call again to obtain a fresh export URL.`);
    }
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > config.maxDownloadBytes) {
      await response.body?.cancel();
      throw new AdapterError('Export exceeds STITCH_MAX_DOWNLOAD_BYTES.');
    }
    if (!response.body) throw new AdapterError('The export response was empty.');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        size += chunk.byteLength;
        if (size > config.maxDownloadBytes) throw new AdapterError('Export exceeds STITCH_MAX_DOWNLOAD_BYTES.');
        chunks.push(chunk);
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    return Buffer.concat(chunks);
  }
  throw new AdapterError('Export redirect limit reached.');
}

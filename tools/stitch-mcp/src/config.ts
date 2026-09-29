export const ENDPOINT = 'https://stitch.googleapis.com/mcp';

export interface Config {
  headers: Record<string, string>;
  enableWrites: boolean;
  timeoutMs: number;
  downloadTimeoutMs: number;
  maxDownloadBytes: number;
}

function integer(env: NodeJS.ProcessEnv, key: string, fallback: number, min: number, max: number): number {
  const raw = env[key];
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${key} must be an integer.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${key} must be between ${min} and ${max}.`);
  }
  return value;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const apiKey = env.STITCH_API_KEY?.trim();
  const token = env.STITCH_ACCESS_TOKEN?.trim();
  const project = env.GOOGLE_CLOUD_PROJECT?.trim();
  if (apiKey && token) throw new Error('Set either STITCH_API_KEY or STITCH_ACCESS_TOKEN, not both.');
  if (!apiKey && !(token && project)) {
    throw new Error('Set STITCH_API_KEY, or STITCH_ACCESS_TOKEN together with GOOGLE_CLOUD_PROJECT.');
  }
  if ([apiKey, token, project].some(value => value && /[\r\n]/.test(value))) {
    throw new Error('Authentication environment variables must be single-line values.');
  }
  const writes = env.STITCH_ENABLE_WRITES ?? 'false';
  if (writes !== 'true' && writes !== 'false') throw new Error('STITCH_ENABLE_WRITES must be true or false.');
  return {
    headers: apiKey ? { 'X-Goog-Api-Key': apiKey } : {
      Authorization: `Bearer ${token!}`, 'X-Goog-User-Project': project!
    },
    enableWrites: writes === 'true',
    timeoutMs: integer(env, 'STITCH_TIMEOUT_MS', 300000, 1000, 900000),
    downloadTimeoutMs: integer(env, 'STITCH_DOWNLOAD_TIMEOUT_MS', 30000, 1000, 120000),
    maxDownloadBytes: integer(env, 'STITCH_MAX_DOWNLOAD_BYTES', 5242880, 1024, 20971520)
  };
}

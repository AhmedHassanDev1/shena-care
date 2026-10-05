const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL;

// Local development default only. Production must supply NEXT_PUBLIC_API_URL.
export const API_URL = configuredApiUrl?.replace(/\/$/, '') ||
  (process.env.NODE_ENV === 'development' ? 'http://localhost:3001' : '');

export function requireApiUrl(): string {
  if (!API_URL) {
    throw new Error('NEXT_PUBLIC_API_URL must be configured for the web app');
  }
  return API_URL;
}

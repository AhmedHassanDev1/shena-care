/*
 * Admin Overview data source. The real authenticated API is the default and the only source in
 * production. Demo data is a local-development convenience, selected explicitly and never as a
 * fallback for a failed request.
 *
 *   NEXT_PUBLIC_ADMIN_OVERVIEW_SOURCE=mock npm run dev   → demo data (development only)
 *   anything else, or any production build              → real API
 */

export type OverviewSource = 'api' | 'mock';

/** Pure rule behind MOCK_OVERVIEW; exported so the production guard can be tested directly. */
export function resolveOverviewSource(env: { nodeEnv?: string; requested?: string }): OverviewSource {
  if (env.nodeEnv === 'production') return 'api';
  return env.requested === 'mock' ? 'mock' : 'api';
}

/**
 * Both inputs are inlined by Next at build time. In a production build this is the literal `false`,
 * so every `if (MOCK_OVERVIEW)` branch — and the fixtures it imports — is removed from the bundle.
 */
export const MOCK_OVERVIEW: boolean =
  process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_ADMIN_OVERVIEW_SOURCE === 'mock';

'use client'

import { useApi, type ApiFetcher } from '@/lib/use-api'
import type { MockOverviewState } from '@/lib/mock/overview-mock-api'

/**
 * Admin Overview read. Real mode is exactly `useApi` (authenticated API, same errors, same polling).
 * In development-only demo mode the transport alone is swapped; a failed real request is never
 * answered with demo data, and demo data is never reachable from a production build.
 *
 * The condition below is written out literally (the rule of `MOCK_OVERVIEW` in overview-source.ts,
 * checked by a test) because bundlers only drop an `import()` whose guard they can see inline: in a
 * production build the branch, the demo module and its fixtures never reach the bundle.
 */
export function useOverviewApi<T>(
  path: string,
  options: { pollMs?: number; mockState?: MockOverviewState } = {},
) {
  const { mockState = 'live', pollMs } = options
  const fetcher: ApiFetcher | undefined =
    process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_ADMIN_OVERVIEW_SOURCE === 'mock'
      ? (<R>(requestPath: string, signal: AbortSignal) =>
          import('@/lib/mock/overview-mock-api').then((demo) =>
            demo.mockOverviewRequest<R>(requestPath, signal, { state: mockState }),
          )) as ApiFetcher
      : undefined
  return useApi<T>(path, { pollMs, fetcher })
}

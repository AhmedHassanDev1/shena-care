'use client'

import * as React from 'react'
import { api, ApiError } from '@/lib/api'

export type ApiFetcher = <T>(path: string, signal: AbortSignal) => Promise<T>

/**
 * Server read with loading / error / reload; `path = null` waits (e.g. until a hub is chosen).
 * `fetcher` replaces the transport only (used by the development-only Admin Overview demo data).
 */
export function useApi<T>(path: string | null, options: { pollMs?: number; fetcher?: ApiFetcher } = {}) {
  const fetcherRef = React.useRef(options.fetcher)
  fetcherRef.current = options.fetcher
  const [data, setData] = React.useState<T | undefined>(undefined)
  const [error, setError] = React.useState<ApiError | null>(null)
  const [loading, setLoading] = React.useState(path !== null)
  const [tick, setTick] = React.useState(0)

  React.useEffect(() => {
    if (path === null) return
    const controller = new AbortController()
    setLoading(true)
    const read = fetcherRef.current
      ? fetcherRef.current<T>(path, controller.signal)
      : api<T>(path, { signal: controller.signal })
    read
      .then((result) => {
        setData(result)
        setError(null)
      })
      .catch((err: unknown) => {
        if ((err as Error).name === 'AbortError') return
        setError(err instanceof ApiError ? err : new ApiError(String(err), 0))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [path, tick])

  React.useEffect(() => {
    if (!options.pollMs || path === null) return
    const id = window.setInterval(() => setTick((t) => t + 1), options.pollMs)
    return () => window.clearInterval(id)
  }, [options.pollMs, path])

  const reload = React.useCallback(() => setTick((t) => t + 1), [])
  return { data, error, loading, reload }
}

/** A command: pending state, last error, and the server's answer. Never optimistic. */
export function useCommand<TArgs extends unknown[], TResult>(run: (...args: TArgs) => Promise<TResult>) {
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<ApiError | null>(null)
  const runRef = React.useRef(run)
  runRef.current = run

  const execute = React.useCallback(async (...args: TArgs): Promise<TResult | undefined> => {
    setPending(true)
    setError(null)
    try {
      return await runRef.current(...args)
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(String(err), 0))
      return undefined
    } finally {
      setPending(false)
    }
  }, [])

  return { execute, pending, error, clearError: () => setError(null) }
}

'use client'

/*
 * Business Workspace API client (C0). Every business rule lives in the NestJS API; this only carries
 * the staff session token, sends JSON and turns the API's error envelope into one typed error.
 */

const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '')
const TOKEN_KEY = 'bw.session.v1'

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export function getToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string | null) {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token)
    else window.localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* private mode: the session simply does not persist */
  }
}

type Envelope = { message?: unknown; code?: string; error?: string }

function describe(body: Envelope | undefined, status: number): { message: string; code?: string } {
  const inner = body?.message && typeof body.message === 'object' && !Array.isArray(body.message) ? (body.message as Envelope) : undefined
  const raw = inner?.message ?? body?.message
  const message = Array.isArray(raw) ? raw.join('، ') : typeof raw === 'string' && raw ? raw : `HTTP ${status}`
  return { message, code: body?.code ?? inner?.code }
}

/** Listeners told when the API rejects the session (401), so the shell can return to login. */
const unauthorizedListeners = new Set<() => void>()
export function onUnauthorized(listener: () => void): () => void {
  unauthorizedListeners.add(listener)
  return () => {
    unauthorizedListeners.delete(listener)
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const token = getToken()
  let response: Response
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: {
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: 'no-store',
      signal: init.signal,
    })
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error
    throw new ApiError('تعذر الاتصال بالخادم. تأكد من الإنترنت وحاول تاني.', 0, 'NETWORK')
  }
  const text = await response.text()
  const body = text ? (JSON.parse(text) as unknown) : undefined
  if (!response.ok) {
    const { message, code } = describe(body as Envelope | undefined, response.status)
    if (response.status === 401) unauthorizedListeners.forEach((listener) => listener())
    throw new ApiError(message, response.status, code)
  }
  return body as T
}

/** One idempotency key per user intent; reuse it on retry so the API replays instead of duplicating. */
export function newKey(): string {
  return crypto.randomUUID()
}

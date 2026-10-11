import { requireApiUrl } from './config';
import { SESSION_TOKEN_KEY } from './session-token';

export type ApiErrorType = 
  | 'VALIDATION' 
  | 'UNAUTHENTICATED' 
  | 'FORBIDDEN' 
  | 'NOT_FOUND' 
  | 'CONFLICT' 
  | 'STALE_REVISION' 
  | 'PRICE_CHANGED' 
  | 'UNAVAILABLE' 
  | 'RATE_LIMITED' 
  | 'NETWORK' 
  | 'SERVER'
  | 'UNKNOWN';

export class ApiError extends Error {
  constructor(
    message: string,
    public type: ApiErrorType,
    public status: number,
    public data?: any
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * The API wraps every HttpException as `{ statusCode, timestamp, path, message }` where `message` is the
 * exception response: a string, or `{ message: string | string[], error?, code? }` (apps/api
 * all-exceptions.filter.ts). Never assume `message` is a string; `message` is therefore typed loosely here.
 */
interface ErrorBody {
  code?: string;
  error?: string;
  message?: unknown;
}

interface NestResponse {
  message?: unknown;
  code?: string;
  error?: string;
}

function nested(data: ErrorBody | undefined): NestResponse | undefined {
  const outer = data?.message;
  return outer && typeof outer === 'object' && !Array.isArray(outer) ? (outer as NestResponse) : undefined;
}

function errorMessage(data: ErrorBody | undefined): string | undefined {
  const inner = nested(data)?.message ?? data?.message;
  if (Array.isArray(inner)) return inner.join(', ');
  return typeof inner === 'string' && inner ? inner : undefined;
}

function errorCode(data: ErrorBody | undefined): string | undefined {
  const inner = nested(data);
  return data?.code || inner?.code || data?.error || inner?.error;
}

function normalizeError(status: number, data: ErrorBody | undefined): ApiErrorType {
  const code = errorCode(data);
  if (status === 400) {
    if (code === 'STALE_REVISION') return 'STALE_REVISION';
    if (code === 'PRICE_CHANGED') return 'PRICE_CHANGED';
    if (code === 'UNAVAILABLE') return 'UNAVAILABLE';
    return 'VALIDATION';
  }
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'SERVER';
  return 'UNKNOWN';
}

export interface RequestOptions extends RequestInit {
  token?: string;
}

async function fetchApi<T>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<T> {
  const { token, ...fetchOptions } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${requireApiUrl()}${endpoint}`, {
    cache: 'no-store',
    ...fetchOptions,
    headers: {
      ...headers,
      ...(fetchOptions.headers as Record<string, string>),
    },
  });

  if (!response.ok) {
    let errorData: ErrorBody;
    try {
      errorData = await response.json();
    } catch {
      errorData = { message: response.statusText };
    }
    // A rejected session must not linger: drop it so the app falls back to signed-out instead of failing every request.
    if (response.status === 401 && token && typeof window !== 'undefined') {
      localStorage.removeItem(SESSION_TOKEN_KEY);
    }
    throw new ApiError(
      errorMessage(errorData) || 'Request failed',
      normalizeError(response.status, errorData),
      response.status,
      errorData
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

export const apiClient = {
  get: <T>(endpoint: string, options?: RequestOptions) =>
    fetchApi<T>(endpoint, { method: 'GET', ...options }),

  post: <T>(endpoint: string, body?: unknown, options?: RequestOptions) =>
    fetchApi<T>(endpoint, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
      ...options,
    }),

  patch: <T>(endpoint: string, body?: unknown, options?: RequestOptions) =>
    fetchApi<T>(endpoint, {
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
      ...options,
    }),

  delete: <T>(endpoint: string, options?: RequestOptions) =>
    fetchApi<T>(endpoint, { method: 'DELETE', ...options }),
};

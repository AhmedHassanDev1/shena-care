import { requireApiUrl } from './config';

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

function normalizeError(status: number, data: any): ApiErrorType {
  const code = data?.code || data?.error;
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
    let errorData;
    try {
      errorData = await response.json();
    } catch {
      errorData = { message: response.statusText };
    }
    throw new ApiError(
      errorData.message || 'Request failed',
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

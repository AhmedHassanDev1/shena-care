export class ApiError extends Error {
  public status: number;
  public code?: string;
  public details?: unknown;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function normalizeApiError(error: any): ApiError {
  if (error.response) {
    const status = error.response.status;
    const data = error.response.data || {};
    const message = data.message || error.message || 'An API error occurred';
    return new ApiError(message, status, data.code, data.details || data);
  } else if (error.request) {
    return new ApiError('Network error', 0);
  }
  return new ApiError(error.message || 'Unknown error', 500);
}

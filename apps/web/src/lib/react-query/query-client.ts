import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '../api-client';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
      refetchOnWindowFocus: false,
      // A 4xx answer (conflict, unauthorized, not found…) is final: retrying only delays the error state.
      // Network failures and 5xx get one retry.
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
        return failureCount < 1;
      },
    },
  },
});

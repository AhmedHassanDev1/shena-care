export const catalogKeys = {
  all: ['catalog'] as const,
  lists: () => [...catalogKeys.all, 'list'] as const,
  list: (filters?: Record<string, unknown>) => [...catalogKeys.lists(), { filters }] as const,
  details: () => [...catalogKeys.all, 'detail'] as const,
  detail: (slug: string) => [...catalogKeys.details(), slug] as const,
};

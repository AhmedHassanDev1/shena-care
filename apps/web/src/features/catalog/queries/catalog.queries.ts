import { useQuery } from '@tanstack/react-query';
import { catalogApi } from '../api/catalog.api';
import { catalogKeys } from './catalog.keys';

export function useProducts() {
  return useQuery({
    queryKey: catalogKeys.lists(),
    queryFn: () => catalogApi.getProducts(),
  });
}

export function useProduct(slug: string) {
  return useQuery({
    queryKey: catalogKeys.detail(slug),
    queryFn: () => catalogApi.getProduct(slug),
    enabled: !!slug,
  });
}

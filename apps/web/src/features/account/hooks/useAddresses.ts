import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  addressesApi,
  type CustomerAddress,
  type CreateCustomerAddressInput,
  type UpdateCustomerAddressInput,
} from '@/lib/addresses';
import { useAuth } from '@/features/auth/AuthContext';

export const ADDRESSES_QUERY_KEY = ['customer', 'addresses'];

export function useAddresses() {
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuth();

  const {
    data: addresses = [],
    isLoading,
    error,
    refetch,
  } = useQuery<CustomerAddress[]>({
    queryKey: ADDRESSES_QUERY_KEY,
    queryFn: () => addressesApi.list(),
    enabled: isAuthenticated,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ADDRESSES_QUERY_KEY });
  };

  const createMutation = useMutation({
    mutationFn: (data: CreateCustomerAddressInput) => addressesApi.create(data),
    onSuccess: () => invalidate(),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateCustomerAddressInput }) =>
      addressesApi.update(id, data),
    onSuccess: () => invalidate(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => addressesApi.delete(id),
    onSuccess: () => invalidate(),
  });

  const setDefaultMutation = useMutation({
    mutationFn: (id: string) => addressesApi.setDefault(id),
    onSuccess: () => invalidate(),
  });

  const defaultAddress = addresses.find((a) => a.isDefault) ?? addresses[0] ?? null;

  return {
    addresses,
    defaultAddress,
    isLoading,
    error,
    refetch,
    createAddress: createMutation.mutateAsync,
    isCreating: createMutation.isPending,
    updateAddress: updateMutation.mutateAsync,
    isUpdating: updateMutation.isPending,
    deleteAddress: deleteMutation.mutateAsync,
    isDeleting: deleteMutation.isPending,
    setDefaultAddress: setDefaultMutation.mutateAsync,
    isSettingDefault: setDefaultMutation.isPending,
    invalidate,
  };
}

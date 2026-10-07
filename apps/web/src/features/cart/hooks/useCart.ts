import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { cart as cartApi, Cart } from '@/lib/cart';

export const CART_QUERY_KEY = ['cart'];

export function useCart() {
  const queryClient = useQueryClient();

  const { data: cart, isLoading, error } = useQuery<Cart>({
    queryKey: CART_QUERY_KEY,
    queryFn: () => cartApi.getCart(),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: CART_QUERY_KEY });
  };

  const addMutation = useMutation({
    mutationFn: ({ skuId, quantity = 1 }: { skuId: string; quantity?: number }) =>
      cartApi.addToCart(skuId, quantity),
    onSuccess: (newCart) => {
      queryClient.setQueryData(CART_QUERY_KEY, newCart);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ skuId, quantity }: { skuId: string; quantity: number }) =>
      cartApi.updateQuantity(skuId, quantity),
    onSuccess: (newCart) => {
      queryClient.setQueryData(CART_QUERY_KEY, newCart);
    },
  });

  const removeMutation = useMutation({
    mutationFn: (skuId: string) => cartApi.removeFromCart(skuId),
    onSuccess: (newCart) => {
      queryClient.setQueryData(CART_QUERY_KEY, newCart);
    },
  });

  return {
    cart,
    isLoading,
    error,
    addItem: addMutation.mutateAsync,
    isAdding: addMutation.isPending,
    updateItem: updateMutation.mutateAsync,
    isUpdating: updateMutation.isPending,
    removeItem: removeMutation.mutateAsync,
    isRemoving: removeMutation.isPending,
    invalidate,
  };
}

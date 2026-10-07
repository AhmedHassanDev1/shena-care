import { useQuery } from '@tanstack/react-query';
import { orders } from '@/lib/orders';
import { useCart } from '@/features/cart/hooks/useCart';

interface QuoteRequest {
  governorate: string;
  area: string;
  couponCode?: string;
}

export function useCheckoutQuote(request: QuoteRequest) {
  const { cart } = useCart();
  
  const enabled = !!request.governorate && !!request.area && !!cart && cart.items.length > 0;

  return useQuery({
    queryKey: ['checkoutQuote', request.governorate, request.area, request.couponCode, cart?.itemCount],
    queryFn: () => orders.getQuote(request),
    enabled,
    staleTime: 0, // quotes should recalculate easily, especially if cart changes
  });
}

'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, ShoppingBag } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { useCart } from '@/features/cart/hooks/useCart';
import { ApiError } from '@/lib/api-client';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import type { ProductCardModel } from '../lib/products';

type Status = 'idle' | 'pending' | 'added' | 'unavailable' | 'failed';

/**
 * Compact overlay anchored inside the lower part of the product image. A single-variant product is
 * added directly (guest or signed-in cart, as the cart client decides); a product with variants sends
 * the shopper to its page instead of picking one for them.
 */
export function QuickAdd({ product }: { product: ProductCardModel }) {
  const m = useMessages();
  const { addItem } = useCart();
  const [status, setStatus] = useState<Status>('idle');
  const resetTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  const { action } = product;
  if (action.kind === 'unavailable') return null;

  const overlay = 'absolute inset-x-2 bottom-2 z-10 h-11 w-[calc(100%-1rem)] text-support shadow-raised';

  if (action.kind === 'choose') {
    return (
      <Link
        href={routes.product(product.slug)}
        aria-label={fillMessage(m.quickChooseLabel, { name: product.name })}
        className={cn(buttonVariants({ variant: 'outline' }), overlay)}
      >
        {m.quickChoose}
      </Link>
    );
  }

  const add = async () => {
    setStatus('pending');
    try {
      await addItem({ skuId: action.skuId });
      setStatus('added');
      clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setStatus('idle'), 2500);
    } catch (error) {
      const stale = error instanceof ApiError && (error.type === 'UNAVAILABLE' || error.type === 'PRICE_CHANGED');
      setStatus(stale ? 'unavailable' : 'failed');
    }
  };

  const failed = status === 'failed' || status === 'unavailable';
  const label =
    status === 'pending' ? m.quickAdding : status === 'added' ? m.quickAdded : failed ? m.quickFailed : m.quickAdd;

  return (
    <>
      <Button
        type="button"
        variant={status === 'added' ? 'secondary' : failed ? 'outline' : 'default'}
        loading={status === 'pending'}
        onClick={add}
        aria-label={status === 'idle' ? fillMessage(m.quickAddLabel, { name: product.name }) : undefined}
        className={cn(overlay, failed && 'border-destructive text-destructive')}
      >
        {status === 'idle' ? <ShoppingBag aria-hidden="true" /> : null}
        {status === 'added' ? <Check aria-hidden="true" /> : null}
        <span className="truncate">{status === 'unavailable' ? m.quickUnavailable : label}</span>
      </Button>
      <p role="status" className="sr-only">
        {status === 'added' ? `${m.quickAdded}: ${product.name}` : failed ? (status === 'unavailable' ? m.quickUnavailable : m.quickFailed) : ''}
      </p>
    </>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button, buttonVariants } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { useCart } from '@/features/cart/hooks/useCart';
import { ApiError } from '@/lib/api-client';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import type { ProductCardModel } from '../lib/products';

type Status = 'idle' | 'pending' | 'added' | 'unavailable' | 'failed';

/**
 * Add control for the buy row of a product card. A single-variant product is added directly (guest or
 * signed-in cart, as the cart client decides); a product with variants sends the shopper to its page
 * instead of picking one for them. Idle is the design system's filled "+", pending keeps its size while
 * the beads load, and the outcome (added / failed / unavailable) is always stated in words.
 */
export function QuickAdd({ product }: { product: ProductCardModel }) {
  const m = useMessages();
  const { addItem } = useCart();
  const [status, setStatus] = useState<Status>('idle');
  const resetTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  const { action } = product;
  if (action.kind === 'unavailable') return null;

  if (action.kind === 'choose') {
    return (
      <Link
        href={routes.product(product.slug)}
        aria-label={fillMessage(m.quickChooseLabel, { name: product.name })}
        className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'relative z-10')}
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
      {status === 'idle' || status === 'pending' ? (
        <Button
          type="button"
          size="icon"
          loading={status === 'pending'}
          onClick={add}
          aria-label={status === 'pending' ? label : fillMessage(m.quickAddLabel, { name: product.name })}
          className="relative z-10"
        >
          <Icon name="plus" />
        </Button>
      ) : (
        <Button
          type="button"
          size="sm"
          variant={status === 'added' ? 'tonal' : 'secondary'}
          onClick={status === 'added' ? undefined : add}
          className={cn('relative z-10', failed && 'border-destructive text-destructive')}
        >
          <Icon name={status === 'added' ? 'check' : 'alert'} size={18} />
          <span className="truncate">{status === 'unavailable' ? m.quickUnavailable : label}</span>
        </Button>
      )}
      <p role="status" className="sr-only">
        {status === 'added' ? `${m.quickAdded}: ${product.name}` : failed ? (status === 'unavailable' ? m.quickUnavailable : m.quickFailed) : ''}
      </p>
    </>
  );
}

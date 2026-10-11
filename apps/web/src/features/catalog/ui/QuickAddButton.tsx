'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Plus } from 'lucide-react';
import { useCart } from '@/features/cart/hooks/useCart';
import { ApiError } from '@/lib/api-client';
import { auth } from '@/lib/auth';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';

type Status = 'idle' | 'adding' | 'added' | 'failed';

/**
 * Adds one unit of the SKU from a product card. Same rules as the product page: adding requires a session,
 * and a 401 sends the customer to sign in and back.
 */
export function QuickAddButton({ skuId, productName }: { skuId: string; productName: string }) {
  const m = useMessages();
  const router = useRouter();
  const { addItem } = useCart();
  const [status, setStatus] = useState<Status>('idle');

  const signIn = () => {
    const returnTo = window.location.pathname + window.location.search;
    router.push(`${routes.login}?${new URLSearchParams({ returnTo }).toString()}`);
  };

  const add = async () => {
    if (status === 'adding') return;
    if (!auth.isAuthenticated()) return signIn();
    setStatus('adding');
    try {
      await addItem({ skuId, quantity: 1 });
      setStatus('added');
      window.setTimeout(() => setStatus('idle'), 2500);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return signIn();
      setStatus('failed');
    }
  };

  const label =
    status === 'added' ? m.quickAddedShort : status === 'failed' ? m.quickAddFailedShort : m.quickAdd;

  return (
    <button
      type="button"
      onClick={add}
      aria-busy={status === 'adding' || undefined}
      aria-label={status === 'idle' ? fillMessage(m.quickAddLabel, { name: productName }) : undefined}
      className={cn(
        'flex h-10 w-full items-center justify-center gap-1.5 rounded-sm text-support font-semibold shadow-raised',
        'transition-colors duration-fast ease-standard',
        status === 'failed'
          ? 'bg-destructive-subtle text-destructive'
          : 'bg-card/95 text-foreground hover:bg-primary hover:text-primary-foreground',
        status === 'adding' && 'cursor-progress'
      )}
    >
      {status === 'added' ? <Check aria-hidden="true" className="size-4" /> : <Plus aria-hidden="true" className="size-4" />}
      <span aria-live="polite">{label}</span>
    </button>
  );
}

'use client';

import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import type { ShinaActivityState } from '../lib/shina-types';
import { ShinaMascot } from './ShinaMascot';

export interface ShinaHeaderProps {
  state: ShinaActivityState;
  onResetSession: () => void;
  cartItemCount?: number;
  className?: string;
}

/**
 * Compact, focused header for Ask Shina conversational experience.
 * Replaces the heavy multi-tier storefront header with an editorial, AI-first header.
 */
export function ShinaHeader({
  state,
  onResetSession,
  cartItemCount = 0,
  className,
}: ShinaHeaderProps) {
  const m = useMessages();

  const isBusy =
    state === 'thinking' ||
    state === 'searching' ||
    state === 'comparing' ||
    state === 'routine' ||
    state === 'recommending' ||
    state === 'streaming';

  return (
    <header
      className={cn(
        'sticky top-0 z-30 flex h-14 w-full shrink-0 items-center justify-between border-b border-line/50 bg-chalk/90 px-3 backdrop-blur-md sm:px-6',
        className,
      )}
    >
      {/* Start: Back link + Assistant Identity */}
      <div className="flex items-center gap-2 sm:gap-3">
        <Link
          href={routes.home}
          aria-label={m.shellHome}
          className="inline-flex size-9 items-center justify-center rounded-full text-stone transition-colors hover:bg-sand/35 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt"
        >
          <Icon name="chevron-back" size={20} />
        </Link>

        <div className="flex items-center gap-2">
          <div className="relative">
            <ShinaMascot state={state} size="xs" decorative />
            <span
              className={cn(
                'absolute -bottom-0.5 -end-0.5 size-2.5 rounded-full border-2 border-chalk',
                isBusy ? 'bg-cobalt animate-pulse' : 'bg-ok',
              )}
              aria-hidden="true"
            />
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-display text-14 font-extrabold text-ink sm:text-15">
                {m.shinaAssistantTitle}
              </span>
              <span className="rounded-pill bg-citron px-1.5 py-0.5 font-display text-11 font-bold text-ink">
                AI
              </span>
            </div>
            <p className="hidden truncate font-text text-11 text-stone sm:block">
              {isBusy ? m.shinaStateThinking : m.shinaAiConnectedNote}
            </p>
          </div>
        </div>
      </div>

      {/* End: New session + Cart shortcut */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onResetSession}
          title={m.shinaNewSession}
          aria-label={m.shinaNewSession}
          className="inline-flex size-9 items-center justify-center rounded-full border border-line bg-linen/90 text-ink shadow-elevation-1 transition-all hover:border-cobalt hover:bg-chalk hover:text-cobalt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt active:scale-95"
        >
          <Icon name="plus" size={16} />
        </button>

        <Link
          href={routes.cart}
          aria-label={m.shellCart}
          className="relative inline-flex size-9 items-center justify-center rounded-full border border-line bg-linen/90 text-ink shadow-elevation-1 transition-all hover:border-cobalt hover:bg-chalk hover:text-cobalt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt active:scale-95"
        >
          <Icon name="bag" size={16} />
          {cartItemCount > 0 ? (
            <span className="absolute -top-1 -end-1 flex size-4 items-center justify-center rounded-full bg-cobalt font-display text-11 font-bold text-chalk">
              {cartItemCount > 9 ? '9+' : cartItemCount}
            </span>
          ) : null}
        </Link>
      </div>
    </header>
  );
}

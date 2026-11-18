'use client';

import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import { GlassBadge } from '@/components/ui/glass-badge';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { routes } from '@/lib/routes';

export function ShinaCareBanner() {
  const m = useMessages();

  return (
    <aside
      aria-label={m.profileShinaBannerTitle}
      className="relative isolate overflow-hidden rounded-card border border-line bg-linen/95 p-6 shadow-elevation-1 md:p-8"
    >
      {/* Subtle warm atmospheric glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-20 end-0 -z-10 size-72 rounded-full bg-sand/35 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-20 start-0 -z-10 size-72 rounded-full bg-tan/10 blur-3xl"
      />

      <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2">
            <GlassBadge tone="accent">
              <span className="flex items-center gap-1.5 font-display text-12 font-semibold text-citron">
                <Icon name="sparkles" size={13} />
                <span>شاينا · Shina AI</span>
              </span>
            </GlassBadge>
          </div>

          <h3 className="m-0 font-display text-20 md:text-24 font-extrabold text-ink leading-tight">
            {m.profileShinaBannerTitle}
          </h3>

          <p className="m-0 max-w-xl text-14 leading-relaxed text-stone">
            {m.profileShinaBannerSubtitle}
          </p>
        </div>

        <Link
          href={routes.shina}
          className="inline-flex h-control-m shrink-0 items-center justify-center gap-2 rounded-pill bg-cobalt px-6 font-display text-14 font-semibold text-chalk shadow-elevation-1 transition-all hover:bg-cobalt-deep active:scale-95"
        >
          <Icon name="message" size={16} />
          <span>{m.profileShinaBannerAction}</span>
        </Link>
      </div>
    </aside>
  );
}

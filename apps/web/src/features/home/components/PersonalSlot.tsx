'use client';

import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import { useAuth } from '@/features/auth/AuthContext';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { routes } from '@/lib/routes';

/**
 * Personal slot, new-visitor version (Main / Mobile «أول مرة في شينا كير؟»). The returning-customer version
 * (SlotDesktop / SlotMobile, saved routine progress) needs a routine read the API does not expose yet, so it is not
 * rendered; signed-in customers do not get the «ادخل حسابك» link.
 */
export function PersonalSlot() {
  const m = useMessages();
  const { user } = useAuth();
  return (
    <section aria-labelledby="slot-h" className="flex flex-wrap items-center gap-x-10 gap-y-4 rounded-card bg-linen p-5 shadow-outline-hairline lg:px-7 lg:py-5.5">
      <div aria-hidden="true" className="relative hidden h-7 w-[92px] flex-none items-center justify-between lg:flex">
        <span className="absolute inset-x-0 top-[13px] h-0.5 bg-line" />
        <span className="relative size-3 rounded-full bg-night" />
        <span className="relative size-2.5 rounded-full bg-linen shadow-outline-control" />
        <span className="relative size-2.5 rounded-full bg-linen shadow-outline-control" />
      </div>
      <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-0.5">
        <span className="text-12 font-semibold leading-17 text-ink-2">{m.slotEyebrow}</span>
        <h2 id="slot-h" className="m-0 text-display-3">
          {m.slotTitle}
        </h2>
        <p className="m-0 text-14 leading-22 text-ink-2">{m.slotBody}</p>
      </div>
      <div className="flex w-full flex-col items-stretch gap-x-6 gap-y-3 lg:w-auto lg:flex-row lg:flex-wrap lg:items-center">
        <Link
          href={routes.routineBuilder}
          className="inline-flex h-12.5 items-center justify-center gap-2.5 rounded-pill bg-night px-6 text-15 font-semibold text-linen no-underline hover:bg-night-2"
        >
          <span>{m.slotCta}</span>
          <Icon name="arrow-forward" size={18} />
        </Link>
        {user ? null : (
          <Link href={`${routes.login}?returnTo=${encodeURIComponent(routes.account)}`} className="text-link self-center">
            {m.slotSignIn}
          </Link>
        )}
      </div>
    </section>
  );
}

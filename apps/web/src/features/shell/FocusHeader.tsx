import type { ReactNode } from 'react';
import Link from 'next/link';
import { PageContainer } from '@/components/layout/page-container';
import { Icon } from '@/components/ui/icon';
import { iconButtonVariants } from '@/components/ui/icon-button';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import { routes } from '@/lib/routes';

export interface FocusHeaderProps {
  /** Phone title (Beiruti 22/28, 800): «السلة», «إتمام الطلب». Omit on pages whose own h1 carries the title. */
  title?: ReactNode;
  /** Phone back target and its accessible name («رجوع», «ارجع للسلة»). */
  back: { href: string; label: string };
  /** One action at the phone header's end (e.g. «دفع آمن»). */
  action?: ReactNode;
  /** Desktop: the underlined link at the reading end («ارجع للسلة»). Omit to show the full browsing header instead. */
  desktopBack?: { href: string; label: string };
  /** Desktop: show «دفع آمن» with the lock in ok green (CheckoutD). */
  secure?: boolean;
}

/**
 * Focus Mode chrome for transactional pages (handoff §Responsive: "Header 56 tall: back chevron, title, one action"):
 *  - phone: 56-tall bone bar with a 1px line hairline, back chevron (44×44), Beiruti title, one optional action;
 *  - desktop (CheckoutD / AuthEntryD): wordmark (30/32), optional «دفع آمن», and the back link at the reading end.
 * No floating nav on these pages.
 */
export function FocusHeader({ title, back, action, desktopBack, secure }: FocusHeaderProps) {
  const m = getMessages(getLocale());
  return (
    <header className="bg-bone shadow-hairline-bottom">
      <div className="flex h-header-m items-center gap-0.5 px-2 lg:hidden">
        <Link href={back.href} aria-label={back.label} className={iconButtonVariants()}>
          <Icon name="chevron-back" size={22} strokeWidth={1.9} />
        </Link>
        {title ? <h1 className="m-0 font-display text-22 font-extrabold leading-28">{title}</h1> : null}
        {action ? <span className="ms-auto flex items-center pe-1.5">{action}</span> : null}
      </div>
      {desktopBack ? (
        <PageContainer className="hidden items-center gap-6 py-3.5 lg:flex">
          <Link href={routes.home} aria-label={m.shellHome} className="inline-flex min-h-control-s items-center text-night no-underline">
            <span className="font-display text-30 font-black leading-32">شينا كير</span>
          </Link>
          {secure ? <SecureBadge label={m.focusSecure} /> : null}
          <Link href={desktopBack.href} className="text-link ms-auto">
            {desktopBack.label}
          </Link>
        </PageContainer>
      ) : null}
    </header>
  );
}

/** «دفع آمن» with the lock, ok green (CheckoutD header, CommerceMobile ٣ header action). */
export function SecureBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-14 font-semibold text-ok">
      <Icon name="lock" size={18} />
      {label}
    </span>
  );
}


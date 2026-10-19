import type { ReactNode } from 'react';
import Link from 'next/link';
import { PageContainer } from '@/components/layout/page-container';
import { Icon } from '@/components/ui/icon';
import { iconButtonVariants } from '@/components/ui/icon-button';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { Wordmark } from '@/components/ui/wordmark';

export interface FocusHeaderProps {
  /** Phone title (Beiruti 22/28, 800): «السلة», «إتمام الطلب». Omit on pages whose own h1 carries the title. */
  title?: ReactNode;
  /** The title is only a label (the page body carries its own h1, e.g. Order placed): not a heading. */
  titleIsLabel?: boolean;
  /** Phone back target and its accessible name («رجوع», «ارجع للسلة»). Omitted on a page with nowhere to go back to (Order placed). */
  back?: { href: string; label: string };
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
export function FocusHeader({ title, titleIsLabel, back, action, desktopBack, secure }: FocusHeaderProps) {
  const Title = titleIsLabel ? "p" : "h1";
  const m = getMessages(getLocale());
  return (
    <header className="bg-bone shadow-hairline-bottom">
      <div className={cn("flex h-header-m items-center gap-0.5 lg:hidden", back ? "px-2" : "px-4")}>
        {back ? (
          <Link href={back.href} aria-label={back.label} className={iconButtonVariants()}>
            <Icon name="chevron-back" size={22} strokeWidth={1.9} />
          </Link>
        ) : null}
        {title ? <Title className="m-0 font-display text-22 font-extrabold leading-28">{title}</Title> : null}
        {action ? <span className="ms-auto flex items-center pe-1.5">{action}</span> : null}
      </div>
      {desktopBack ? (
        <PageContainer className="hidden items-center gap-6 py-3.5 lg:flex">
          <Link href={routes.home} aria-label={m.shellHome} className="inline-flex min-h-control-s items-center text-night no-underline">
            <Wordmark />
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


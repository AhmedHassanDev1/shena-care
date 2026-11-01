'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/ui/icon';
import { iconButtonVariants } from '@/components/ui/icon-button';
import { Toast } from '@/components/ui/toast';
import { Wordmark } from '@/components/ui/wordmark';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { routes } from '@/lib/routes';

/**
 * PDP phone header (PDPMobile): back chevron, the wordmark, then search and share. Share uses the Web Share API and
 * falls back to copying the link («اتنسخ الرابط»).
 */
export function ProductPhoneHeader() {
  const m = useMessages();
  const router = useRouter();
  const [copied, setCopied] = useState(false);

  const back = () => (window.history.length > 1 ? router.back() : router.push(routes.products));
  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ url, title: document.title });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      }
    } catch {
      // Dismissed share sheet: nothing to do.
    }
  };

  return (
    <header className="relative flex h-header-m items-center gap-1 bg-chalk border-b border-ink/15 px-2 lg:hidden">
      <button type="button" aria-label={m.back} onClick={back} className={iconButtonVariants()}>
        <Icon name="chevron-back" size={22} strokeWidth={1.9} />
      </button>
      <Link href={routes.home} aria-label={m.shellHome} className="inline-flex min-h-control-s items-center text-ink no-underline">
        <Wordmark />
      </Link>
      <span className="ms-auto flex items-center">
        <Link href={routes.products} aria-label={m.pdpSearch} className={iconButtonVariants()}>
          <Icon name="search" size={22} />
        </Link>
        <button type="button" aria-label={m.pdpShare} onClick={share} className={iconButtonVariants()}>
          <Icon name="share" size={22} />
        </button>
      </span>
      {copied ? (
        <div className="absolute inset-x-3 top-full z-toast mt-2">
          <Toast>{m.pdpLinkCopied}</Toast>
        </div>
      ) : null}
    </header>
  );
}

'use client';

import type { ReactNode } from 'react';
import Image from 'next/image';
import { BrandLogo } from '@/components/BrandLogo';
import { LocaleSwitch } from '@/components/LocaleSwitch';
import { useMessages } from '@/lib/i18n/LocaleProvider';

/**
 * Sign-in frame. The form is the focus; one lockup, one language switch. On large screens a restrained
 * editorial panel carries a single sentence about what the account is for. It is not rendered on mobile.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  const m = useMessages();

  return (
    <div className="auth-shell min-h-screen bg-background text-foreground lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
      <div className="flex min-h-screen flex-col">
        <div className="flex items-center justify-between gap-4 px-5 py-4 md:px-10 md:py-6">
          <BrandLogo />
          <LocaleSwitch />
        </div>
        <div className="flex flex-1 justify-center px-5 pb-12 pt-6 md:items-center md:pb-24 md:pt-0">
          <div className="w-full max-w-[26rem]">{children}</div>
        </div>
      </div>

      <aside className="relative hidden overflow-hidden lg:sticky lg:top-0 lg:m-4 lg:block lg:h-[calc(100vh-2rem)] lg:rounded-lg lg:bg-secondary">
        <Image
          src="/assets/home/haircare-still-life.webp"
          alt=""
          fill
          priority
          sizes="45vw"
          className="object-cover object-[78%_50%]"
        />
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-overlay/80 via-overlay/25 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-10 xl:p-12">
          <p className="max-w-[28rem] text-balance text-h1 font-semibold text-primary-foreground">{m.authPanelTitle}</p>
          <p className="mt-3 max-w-[28rem] text-body-lg text-primary-foreground/90">{m.authPanelBody}</p>
        </div>
      </aside>
    </div>
  );
}

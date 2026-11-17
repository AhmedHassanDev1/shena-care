'use client';

import type { ReactNode } from 'react';
import { MotionProvider } from '@/components/motion/motion-provider';
import { QueryProvider } from '@/lib/react-query/query-provider';
import { LocaleProvider } from '@/lib/i18n/LocaleProvider';
import type { Locale } from '@/lib/i18n/messages';
import { AuthProvider } from '@/features/auth/AuthContext';
import { AuthReturnToast } from '@/features/auth/components/AuthReturnToast';

export function AppProviders({
  children,
  locale,
}: {
  children: ReactNode;
  locale: Locale;
}) {
  return (
    <QueryProvider>
      <LocaleProvider locale={locale}>
        <AuthProvider>
          <MotionProvider>
            {children}
            <AuthReturnToast />
          </MotionProvider>
        </AuthProvider>
      </LocaleProvider>
    </QueryProvider>
  );
}

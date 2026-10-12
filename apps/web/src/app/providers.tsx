'use client';

import type { ReactNode } from 'react';
import { QueryProvider } from '@/lib/react-query/query-provider';
import { LocaleProvider } from '@/lib/i18n/LocaleProvider';
import type { Locale } from '@/lib/i18n/messages';
import { AuthProvider } from '@/features/auth/AuthContext';

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
          {children}
        </AuthProvider>
      </LocaleProvider>
    </QueryProvider>
  );
}

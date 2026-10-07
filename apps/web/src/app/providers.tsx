'use client';

import { QueryProvider } from '@/lib/react-query/query-provider';
import { LocaleProvider } from '@/lib/i18n/LocaleProvider';
import { AuthProvider } from '@/features/auth/AuthContext';

export function AppProviders({
  children,
  locale,
}: {
  children: React.ReactNode;
  locale: string;
}) {
  return (
    <QueryProvider>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <LocaleProvider locale={locale as any}>
        <AuthProvider>
          {children}
        </AuthProvider>
      </LocaleProvider>
    </QueryProvider>
  );
}

'use client';

import { QueryProvider } from '@/lib/react-query/query-provider';
import { LocaleProvider } from '@/lib/i18n/LocaleProvider';

export function AppProviders({
  children,
  locale,
}: {
  children: React.ReactNode;
  locale: string;
}) {
  return (
    <QueryProvider>
      <LocaleProvider locale={locale as any}>
        {children}
      </LocaleProvider>
    </QueryProvider>
  );
}

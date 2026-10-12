import type { Metadata } from 'next';
import '@/styles/tokens.css';
import './globals.css';
import { AppProviders } from './providers';
import { getLocale } from '@/lib/i18n/server';

export function generateMetadata(): Metadata {
  return {
    title: 'ShinaCare',
    description: 'منصة شينا كير للعناية بالبشرة والشعر',
  };
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = getLocale();
  return (
    <html lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <body>
        <AppProviders locale={locale}>
          <a href="#main-content" className="sr-only focus:not-sr-only">
            {locale === 'ar' ? 'انتقل إلى المحتوى الرئيسي' : 'Skip to main content'}
          </a>
          <main id="main-content">{children}</main>
        </AppProviders>
      </body>
    </html>
  );
}

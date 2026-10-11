import type { Metadata } from 'next';
import '@/styles/tokens.css';
import './globals.css';
import { Header } from '@/components/Header';
import { AppProviders } from './providers';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import { fontSans } from '@/lib/fonts';

export function generateMetadata(): Metadata {
  const m = getMessages(getLocale());
  return { title: m.siteTitle, description: m.siteDescription };
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = getLocale();
  const m = getMessages(locale);
  return (
    <html lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'} className={fontSans.variable}>
      <body>
        <AppProviders locale={locale}>
          <Header />
          <main id="main-content">{children}</main>
          <footer className="site-footer">
            <div className="container"><p>&copy; {new Date().getFullYear()} {m.footerRights}</p></div>
          </footer>
        </AppProviders>
      </body>
    </html>
  );
}

import type { Metadata } from 'next';
import './globals.css';
import { Header } from '@/components/Header';
import { LocaleProvider } from '@/lib/i18n/LocaleProvider';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';

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
    <html lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <body>
        <LocaleProvider locale={locale}>
          <Header />
          <main id="main-content">{children}</main>
          <footer className="site-footer">
            <div className="container"><p>&copy; {new Date().getFullYear()} {m.footerRights}</p></div>
          </footer>
        </LocaleProvider>
      </body>
    </html>
  );
}

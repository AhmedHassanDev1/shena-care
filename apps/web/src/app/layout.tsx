import type { Metadata, Viewport } from 'next';
// SAHEL typefaces, self-hosted from @fontsource (OFL-1.1) under their own family names, so the tokens.json stacks
// resolve them directly and no build or page load depends on Google Fonts. Display: Beiruti (headings ≥21px);
// text: IBM Plex Sans Arabic; campaign: Instrument Serif italic (one Latin line per campaign, never UI).
import '@fontsource/beiruti/700.css';
import '@fontsource/beiruti/800.css';
import '@fontsource/beiruti/900.css';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import '@fontsource/instrument-serif/400-italic.css';
import '@/styles/tokens.generated.css';
import 'swiper/css';
import './globals.css';
import { AppProviders } from './providers';
import { getLocale } from '@/lib/i18n/server';
import tokens from '../../design-system/tokens.json';

const chalk = tokens.color.tokens.find((t) => t.name === 'chalk')!.value;

export function generateMetadata(): Metadata {
  return {
    title: 'شينا كير · ShinaCare',
    description: 'منصة شينا كير للعناية بالبشرة والشعر',
  };
}

/** viewport-fit=cover populates env(safe-area-inset-bottom) for the floating nav and sticky action areas. */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: chalk,
};

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
          <a href="#main-content" className="skip-link">
            {locale === 'ar' ? 'انتقل إلى المحتوى الرئيسي' : 'Skip to main content'}
          </a>
          <main id="main-content">{children}</main>
        </AppProviders>
      </body>
    </html>
  );
}

import { Alexandria } from 'next/font/google';

/**
 * Application typeface. next/font downloads Alexandria at build time and serves it from this app,
 * so customers never request Google Fonts. Components read it through `--font-sans` (tokens.css).
 */
export const fontSans = Alexandria({
  subsets: ['arabic', 'latin'],
  display: 'swap',
  variable: '--font-alexandria',
});

import { IBM_Plex_Sans_Arabic } from 'next/font/google';

/**
 * PROVISIONAL application typeface — not an approved brand font.
 *
 * IBM Plex Sans Arabic is the default while the shortlist (Alexandria, Readex Pro,
 * IBM Plex Sans Arabic) is compared in the design lab (/design-lab): it covers Arabic and
 * Latin in one family, which keeps both locales visually consistent without a third font.
 * Swapping the family only requires changing this file; components read `--font-sans`.
 */
export const fontSans = IBM_Plex_Sans_Arabic({
  subsets: ['arabic', 'latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-sans-provisional',
});

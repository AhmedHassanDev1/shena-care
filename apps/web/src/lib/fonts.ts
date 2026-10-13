import { Alexandria, IBM_Plex_Sans_Arabic } from 'next/font/google';

/**
 * Design-system typefaces (design-system/tokens.json → type.families). next/font downloads them at build
 * time and serves them from this app, so customers never request Google Fonts. The variable names must
 * match `fonts` in design-system/roles.json: the generated `--font-display` / `--font-text` stacks
 * resolve through them.
 *
 *   display → Alexandria: headlines, prices, routine names, the wordmark.
 *   text    → IBM Plex Sans Arabic: reading and UI text, with matched Latin for mixed product names.
 */
export const fontDisplay = Alexandria({
  subsets: ['arabic', 'latin'],
  display: 'swap',
  variable: '--font-alexandria',
});

export const fontText = IBM_Plex_Sans_Arabic({
  subsets: ['arabic', 'latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-plex-sans-arabic',
});

export const fontVariables = `${fontDisplay.variable} ${fontText.variable}`;

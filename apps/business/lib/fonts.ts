import { Alexandria, IBM_Plex_Sans_Arabic } from 'next/font/google'

/*
 * Same typefaces as the storefront (apps/web/src/lib/fonts.ts) so both apps read as one brand.
 * Variable names match --font-bw-display / --font-bw-text in design/tokens.css.
 */
const display = Alexandria({ subsets: ['arabic', 'latin'], display: 'swap', variable: '--font-alexandria' })
const text = IBM_Plex_Sans_Arabic({
  subsets: ['arabic', 'latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-plex-sans-arabic',
})

export const bwFontVariables = `${display.variable} ${text.variable}`

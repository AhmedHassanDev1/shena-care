import { Alexandria, Geist, IBM_Plex_Sans_Arabic } from 'next/font/google'

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

/* Geist carries Latin runs (brand, email, digits) on the sign-in screen; Arabic falls through to Plex. */
const geist = Geist({ subsets: ['latin'], display: 'swap', variable: '--font-geist' })

export const bwFontVariables = `${display.variable} ${text.variable} ${geist.variable}`

import { Alexandria, Readex_Pro } from 'next/font/google';
import { fontSans } from '@/lib/fonts';

// Candidates are loaded only on this route and never preloaded, so they cost the app nothing.
const alexandria = Alexandria({ subsets: ['arabic', 'latin'], display: 'swap', preload: false });
const readexPro = Readex_Pro({ subsets: ['arabic', 'latin'], display: 'swap', preload: false });

/** Facts from the Google Fonts metadata bundled with next/font — not quality judgements. */
export const FONT_CANDIDATES = [
  {
    id: 'ibm-plex-sans-arabic',
    name: 'IBM Plex Sans Arabic',
    className: fontSans.className,
    facts: 'Static weights 100–700 · Arabic + Latin · current provisional app default',
  },
  {
    id: 'readex-pro',
    name: 'Readex Pro',
    className: readexPro.className,
    facts: 'Variable wght 160–700 (+ HEXP axis) · Arabic + Latin',
  },
  {
    id: 'alexandria',
    name: 'Alexandria',
    className: alexandria.className,
    facts: 'Variable wght 100–900 · Arabic + Latin',
  },
] as const;

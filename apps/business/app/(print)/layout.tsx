import type { Metadata } from 'next'
import { bwFontVariables } from '@/lib/fonts'

export const metadata: Metadata = { title: 'طباعة', robots: { index: false, follow: false } }

/* Thermal print views: black on white, no workspace chrome. */
export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return <div lang="ar" dir="rtl" className={bwFontVariables}>{children}</div>
}

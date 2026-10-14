import type { Metadata } from 'next'
import { bwFontVariables } from '@/lib/fonts'

export const metadata: Metadata = {
  title: 'Business Workspace v0.1 — design reference',
  robots: { index: false, follow: false },
}

/* Design-lab scope (GLO-230): Arabic RTL first; every screen here renders synthetic data only. */
export default function DesignLayout({ children }: { children: React.ReactNode }) {
  return (
    <div lang="ar" dir="rtl" className={`bw ${bwFontVariables}`}>
      {children}
    </div>
  )
}

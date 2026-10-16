import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { bwFontVariables } from '@/lib/fonts'

export const metadata: Metadata = {
  title: 'Business Workspace v0.1 — design reference',
  robots: { index: false, follow: false },
}

/* Legacy reference screens are development-only; live role routes remain separate. */
export default function DesignLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV !== 'development') notFound()
  return (
    <div lang="ar" dir="rtl" className={`bw ${bwFontVariables}`}>
      {children}
    </div>
  )
}

import type { Metadata, Viewport } from 'next'
import { notFound } from 'next/navigation'
import { bwFontVariables } from '@/lib/fonts'
import { Playground } from './playground'

export const metadata: Metadata = {
  title: 'ShinaCare Admin Design System · Showcase',
  robots: { index: false, follow: false },
}

export const viewport: Viewport = { colorScheme: 'dark', themeColor: '#0b0b0e' }

/** The playground is an authoring tool, never a production route. */
export default function DesignSystemPage() {
  if (process.env.NODE_ENV !== 'development') notFound()

  return (
    <div lang="ar" dir="rtl" className={`bw bw-admin ${bwFontVariables}`}>
      <Playground />
    </div>
  )
}

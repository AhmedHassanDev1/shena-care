import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { bwFontVariables } from '@/lib/fonts'
import { Playground } from './playground'

export const metadata: Metadata = {
  title: 'Business Design System v1 · Playground',
  robots: { index: false, follow: false },
}

/** The playground is an authoring tool, never a production route. */
export default function DesignSystemPage() {
  if (process.env.NODE_ENV !== 'development') notFound()

  return (
    <div lang="ar" dir="rtl" className={`bw ${bwFontVariables}`}>
      <Playground />
    </div>
  )
}

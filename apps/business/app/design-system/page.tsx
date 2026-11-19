import type { Metadata, Viewport } from 'next'
import { notFound } from 'next/navigation'
import { ToastProvider } from '@/components/bw/toast'
import { bwFontVariables } from '@/lib/fonts'
import { Playground } from './playground'

export const metadata: Metadata = {
  title: 'ShinaCare Admin Design System · Showcase',
  robots: { index: false, follow: false },
}

export const viewport: Viewport = { colorScheme: 'dark', themeColor: '#0a0a0b' }

/** The playground is an authoring tool, never a production route. */
export default function DesignSystemPage() {
  if (process.env.NODE_ENV !== 'development') notFound()

  return (
    <div lang="ar" dir="rtl" className={`bw ${bwFontVariables}`}>
      <ToastProvider><Playground /></ToastProvider>
    </div>
  )
}

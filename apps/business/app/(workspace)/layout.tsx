import type { Metadata } from 'next'
import { bwFontVariables } from '@/lib/fonts'
import { SessionProvider } from '@/lib/session'

export const metadata: Metadata = {
  title: 'شينا كير أعمال',
  robots: { index: false, follow: false },
}

/* Live Business Workspace (C0): Arabic RTL first, staff session, real API data only. */
export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <div lang="ar" dir="rtl" className={`bw ${bwFontVariables}`}>
      <SessionProvider>{children}</SessionProvider>
    </div>
  )
}

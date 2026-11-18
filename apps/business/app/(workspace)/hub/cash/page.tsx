'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button, Notice, PageHeader } from '@/components/bw/primitives'
import { HubShell } from '@/components/workspace/hub'
import { Page } from '@/components/workspace/kit'

/**
 * Hub Cash Redirect (Merged into Hub Dispatch):
 * Cash collection & settlement has been integrated directly into Hub Dispatch (/hub/dispatch?tab=settlement).
 * This page gracefully handles legacy links and bookmarks with an automatic redirect.
 */
export default function HubCash() {
  const router = useRouter()

  React.useEffect(() => {
    const timer = setTimeout(() => {
      router.replace('/hub/dispatch?tab=settlement')
    }, 1200)
    return () => clearTimeout(timer)
  }, [router])

  return (
    <HubShell active="handoff">
      <Page>
        <PageHeader
          title="عدّ نقدية المندوبين"
          meta="تم دمج تسوية العهدة النقدية والمرتجعات داخل صفحة التسليم للمندوب"
        />
        <div className="space-y-4">
          <Notice tone="ok" title="تم توحيد تسوية العهدة مع التسليم للمندوب">
            تم دمج وظائف عدّ النقدية، تسوية عهدة المندوب، واستلام الطرود المرتجعة داخل صفحة واحدة متكاملة{' '}
            <Link
              href="/hub/dispatch?tab=settlement"
              className="font-bold text-bw-cobalt underline hover:text-bw-ink"
            >
              التسليم للمندوب (بانتظار التسوية)
            </Link>
            . جاري توجيهك تلقائياً الآن...
          </Notice>

          <div>
            <Link href="/hub/dispatch?tab=settlement">
              <Button size="sm">
                <span>الانتقال إلى التسليم للمندوب</span>
              </Button>
            </Link>
          </div>
        </div>
      </Page>
    </HubShell>
  )
}

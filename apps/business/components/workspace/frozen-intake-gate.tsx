'use client'

import * as React from 'react'
import Link from 'next/link'
import { Skeleton, StateBlock } from '@/components/bw/primitives'
import { api } from '@/lib/api'

/** Nav entries for supplier files and stock updates, shown only outside BROADCAST_ON_DEMAND. */
export const FROZEN_NAV_IDS = ['products', 'updates']

/** The active sourcing mode, or null until the API answers. The API itself refuses frozen routes; this only keeps the UI honest. */
export function useSourcingMode(enabled = true): string | null {
  const [mode, setMode] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (!enabled) return
    let live = true
    api<{ mode: string }>('/rfq/mode').then((result) => { if (live) setMode(result.mode) }).catch(() => { if (live) setMode('UNKNOWN') })
    return () => { live = false }
  }, [enabled])
  return mode
}

/** Replaces a supplier-file page with a plain statement while intake is frozen, so nobody works on a flow the API refuses. */
export function FrozenIntakeGate({ children }: { children: React.ReactNode }) {
  const mode = useSourcingMode()
  if (mode === null) return <div className="p-6"><Skeleton className="h-24 w-full" /></div>
  if (mode !== 'BROADCAST_ON_DEMAND') return <>{children}</>
  return (
    <div className="p-6">
      <StateBlock kind="empty" title="مفيش رفع ملفات أو تحديث مخزون دلوقتي"
        body="الطلبات بتوصلك مباشرة من طلبات التوريد المفتوحة، ومش محتاج ترفع منتجات أو كميات."
        action={<Link className="font-semibold text-bw-action-ink underline" href="/supplier/rfq">طلبات التوريد المفتوحة</Link>} />
    </div>
  )
}

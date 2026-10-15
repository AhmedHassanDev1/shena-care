'use client'

import * as React from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { CheckCircle2, CircleDashed, ScanLine } from 'lucide-react'
import { Button, Code, Notice, Skeleton } from '@/components/bw/primitives'
import { CommandError } from '@/components/workspace/kit'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { api, ApiError, newKey } from '@/lib/api'
import { useApi, useCommand } from '@/lib/use-api'

interface PrepState {
  shipmentId: string; status: string; orderNumber: string | null
  session: { id: string; status: string } | null
  lines: Array<{ skuId: string; quantity: number; scanned: number; sku: { productName: string; variantName: string; skuCode: string; barcode: string | null } | null }>
  rejectedScans: Array<{ barcode: string | null; errorReason: string | null; at: string }>
}
interface ScanResult { id: string; isSuccessful: boolean; errorReason: string | null; skuId: string | null }

const REASONS: Record<string, string> = {
  EXCESS_QUANTITY: 'القطعة دي زيادة عن المطلوب — رجّعها مكانها',
  PRODUCT_IDENTITY_REVIEW_REQUIRED: 'الباركود ده مش معروف — محتاج مراجعة، ماتحطوش في الطرد',
  PRODUCT_IDENTITY_MISMATCH: 'منتج غلط — مش من الطلب ده',
  NOT_IN_ORDER: 'المنتج ده مش في الطلب',
  WRONG_ITEM: 'منتج غلط — مش من الطلب ده، ماتحطوش في الطرد',
}

/** Scanner station (task mode): one order, scan every unit; completion unlocks only on server confirmation. */
export default function PrepStation() {
  const { shipmentId } = useParams<{ shipmentId: string }>()
  return (
    <RoleShell role="hub" active="pick" mode="task" task="تجهيز طلب" exitHref="/hub/prepare">
      <Station shipmentId={shipmentId} />
    </RoleShell>
  )
}

function Station({ shipmentId }: { shipmentId: string }) {
  const { data, error, loading, reload } = useApi<PrepState>(`/fulfillment/shipments/${shipmentId}/preparation`)
  const [code, setCode] = React.useState('')
  const [last, setLast] = React.useState<{ ok: boolean; text: string } | null>(null)
  const input = React.useRef<HTMLInputElement>(null)
  const scan = useCommand((sessionId: string, barcode: string, clientScanId: string) =>
    api<ScanResult>(`/fulfillment/preparation-sessions/${sessionId}/scan`, { body: { barcodeScanned: barcode, clientScanId } }))
  const complete = useCommand((sessionId: string) => api(`/fulfillment/preparation-sessions/${sessionId}/complete`, { method: 'POST' }))

  React.useEffect(() => { input.current?.focus() }, [data])

  if (error) return <div className="p-6"><LoadError message={error.message} onRetry={reload} /></div>
  if (!data) return <div className="p-6">{loading ? <Skeleton className="h-64 w-full" /> : null}</div>
  const session = data.session
  const allScanned = data.lines.every((l) => l.scanned >= l.quantity)
  const finished = session?.status === 'completed' || ['prepared', 'ready_to_pack', 'packing', 'packed'].includes(data.status)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const barcode = code.trim()
    if (!barcode || !session) return
    setCode('')
    // The scan id makes a retried submit (lost response, double Enter) count once on the server.
    const result = await scan.execute(session.id, barcode, newKey())
    if (result) {
      setLast(result.isSuccessful ? { ok: true, text: `اتأكد: ${barcode}` } : { ok: false, text: REASONS[result.errorReason ?? ''] ?? result.errorReason ?? 'مرفوض' })
      reload()
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 text-bw-on-kohl">
      <h1 className="font-bw-display text-bw-title font-semibold">طلب <Code>{data.orderNumber ?? '—'}</Code></h1>
      {finished ? (
        <div className="space-y-3 rounded-bw-card bg-bw-surface p-4 text-bw-ink">
          <Notice tone="ok" title="التجهيز اكتمل وتأكد من السيرفر">الخطوة الجاية: طباعة الإيصال وبوليصة الشحن ثم التغليف.</Notice>
          <Link href="/hub/pack" className="font-semibold text-bw-action-ink underline">للتغليف والطباعة</Link>
        </div>
      ) : (
        <form onSubmit={submit} className="flex gap-2">
          <label htmlFor="scan" className="sr-only">امسح الباركود</label>
          <div className="flex flex-1 items-center gap-2 rounded-full bg-bw-surface px-4 text-bw-ink">
            <ScanLine className="size-5" aria-hidden />
            <input id="scan" ref={input} dir="ltr" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} placeholder="امسح باركود القطعة"
              className="h-bw-touch flex-1 bg-transparent bw-code outline-none" disabled={!session || scan.pending} />
          </div>
          <Button type="submit" variant="onKohl" size="touch" loading={scan.pending} disabled={!code.trim()}>تأكيد</Button>
        </form>
      )}
      {last && !finished ? <div className="text-bw-ink"><Notice tone={last.ok ? 'ok' : 'danger'} title={last.text} /></div> : null}
      {scan.error ? <div className="text-bw-ink"><CommandError error={scan.error} /></div> : null}

      <ul className="space-y-2">
        {data.lines.map((l) => {
          const done = l.scanned >= l.quantity
          return (
            <li key={l.skuId} className="flex items-center gap-3 rounded-bw-card bg-bw-kohl-raised p-3">
              {done ? <CheckCircle2 className="size-6 text-bw-on-kohl-action" aria-hidden /> : <CircleDashed className="size-6 text-bw-on-kohl-soft" aria-hidden />}
              <div className="min-w-0 flex-1">
                <p className="font-semibold"><bdi>{l.sku ? `${l.sku.productName} · ${l.sku.variantName}` : l.skuId}</bdi></p>
                <p className="text-bw-small text-bw-on-kohl-soft"><Code>{l.sku?.skuCode ?? ''}</Code>{l.sku?.barcode ? <> · <Code>{l.sku.barcode}</Code></> : null}</p>
              </div>
              <span className="text-bw-heading font-semibold"><Code>{`${l.scanned}/${l.quantity}`}</Code></span>
              <span className="sr-only">{done ? 'اكتمل' : 'لسه'}</span>
            </li>
          )
        })}
      </ul>

      {data.rejectedScans.length ? (
        <details className="text-bw-small text-bw-on-kohl-soft">
          <summary>مسحات مرفوضة (<Code>{data.rejectedScans.length}</Code>)</summary>
          <ul className="mt-1 space-y-1">{data.rejectedScans.map((r, i) => <li key={i}><Code>{r.barcode ?? '—'}</Code> · {REASONS[r.errorReason ?? ''] ?? r.errorReason}</li>)}</ul>
        </details>
      ) : null}

      {!finished && session ? (
        <div className="space-y-2">
          <Button variant="onKohl" size="touch" className="w-full" loading={complete.pending} disabled={!allScanned}
            onClick={async () => { if (await complete.execute(session.id)) reload() }}>
            {allScanned ? 'تأكيد اكتمال التجهيز' : 'امسح كل القطع الأول'}
          </Button>
          {complete.error ? <div className="text-bw-ink"><CommandError error={complete.error instanceof ApiError ? complete.error : null} /></div> : null}
        </div>
      ) : null}
    </div>
  )
}

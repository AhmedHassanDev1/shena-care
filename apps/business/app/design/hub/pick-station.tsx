'use client'

import * as React from 'react'
import { AlertTriangle, CheckCircle2, CircleDashed, Loader2, Printer, ScanLine, XCircle } from 'lucide-react'
import { WorkspaceFrame } from '@/components/bw/workspace-frame'
import { Button, Code, DesignNotes, LabelPreview } from '@/components/bw/primitives'
import { cn } from '@/lib/utils'
import type { ScreenState } from '../states'

type Line = { sku: string; barcode: string; name: string; variant: string; qty: number; confirmed: number; pending: number }
type Feedback = { tone: 'ok' | 'warn' | 'danger' | 'pending'; title: string; body: React.ReactNode }

/* Synthetic reference order. Counts move to "confirmed" only after the (simulated) server accepts the scan. */
const baseLines: Line[] = [
  { sku: 'SKU-SRM-030', barcode: '6224000112233', name: 'سيروم نياسيناميد 10%', variant: '30 مل', qty: 2, confirmed: 2, pending: 0 },
  { sku: 'SKU-CRM-250', barcode: '6224000445566', name: 'كريم مرطب للبشرة الجافة', variant: '250 مل', qty: 1, confirmed: 0, pending: 0 },
  { sku: 'SKU-SUN-050', barcode: '6224000778899', name: 'واقي شمس SPF 50', variant: '50 مل', qty: 1, confirmed: 0, pending: 0 },
]
const doneLines = baseLines.map((l) => ({ ...l, confirmed: l.qty }))

const feedbackStyle = {
  ok: { cls: 'border-bw-on-kohl-action text-bw-on-kohl-action', Icon: CheckCircle2 },
  warn: { cls: 'border-bw-on-kohl-warn text-bw-on-kohl-warn', Icon: AlertTriangle },
  danger: { cls: 'border-bw-on-kohl-danger text-bw-on-kohl-danger', Icon: XCircle },
  pending: { cls: 'border-bw-on-kohl-soft text-bw-on-kohl-soft', Icon: Loader2 },
}

export function HubPickStation({ state }: { state: ScreenState<'hub'> }) {
  const [lines, setLines] = React.useState<Line[]>(state === 'complete' ? doneLines : baseLines)
  const [value, setValue] = React.useState('')
  const [completion, setCompletion] = React.useState<'idle' | 'pending' | 'confirmed'>(state === 'complete' ? 'confirmed' : 'idle')
  const [feedback, setFeedback] = React.useState<Feedback | null>(
    state === 'mismatch'
      ? { tone: 'danger', title: 'الصنف ده مش في الطلب', body: <>الباركود <Code>6224000990011</Code> مش من بنود <Code>ORD-20406</Code>. رجّعه مكانه وامسح الصنف الصح.</> }
      : state === 'error'
        ? { tone: 'warn', title: 'المسح متسجلش — مفيش اتصال بالسيرفر', body: 'العدّ ما اتغيرش. اتأكد من الشبكة وامسح تاني.' }
        : state === 'complete'
          ? { tone: 'ok', title: 'السيرفر أكد اكتمال التجهيز', body: <>الطلب <Code>ORD-20406</Code> جاهز للتغليف والطباعة.</> }
          : null,
  )
  const input = React.useRef<HTMLInputElement>(null)
  // A scanner types into whatever has focus: keep the scan field focused from the moment the task opens.
  React.useEffect(() => input.current?.focus(), [])

  const total = lines.reduce((s, l) => s + l.qty, 0)
  const confirmed = lines.reduce((s, l) => s + l.confirmed, 0)
  const pending = lines.reduce((s, l) => s + l.pending, 0)
  const allConfirmed = confirmed === total && pending === 0

  const scan = (e: React.FormEvent) => {
    e.preventDefault()
    const code = value.trim()
    setValue('')
    input.current?.focus()
    if (!code) return
    const line = lines.find((l) => l.barcode === code || l.sku === code)
    if (!line) {
      setFeedback({ tone: 'danger', title: 'الصنف ده مش في الطلب', body: <>الباركود <Code>{code}</Code> مش من بنود الطلب. رجّعه مكانه.</> })
      return
    }
    if (line.confirmed + line.pending >= line.qty) {
      setFeedback({ tone: 'warn', title: 'الكمية المطلوبة اكتملت', body: <><bdi>{line.name}</bdi> — مطلوب <Code>{line.qty}</Code> بس. متحطش قطعة زيادة.</> })
      return
    }
    setLines((ls) => ls.map((l) => (l.sku === line.sku ? { ...l, pending: l.pending + 1 } : l)))
    setFeedback({ tone: 'pending', title: 'بنأكد المسح…', body: <bdi>{line.name}</bdi> })
    window.setTimeout(() => {
      setLines((ls) => ls.map((l) => (l.sku === line.sku ? { ...l, pending: l.pending - 1, confirmed: l.confirmed + 1 } : l)))
      setFeedback({ tone: 'ok', title: 'اتأكد', body: <><bdi>{line.name}</bdi> · {line.variant}</> })
    }, 700)
  }

  const complete = () => {
    setCompletion('pending')
    window.setTimeout(() => {
      setCompletion('confirmed')
      setFeedback({ tone: 'ok', title: 'السيرفر أكد اكتمال التجهيز', body: <>الطلب <Code>ORD-20406</Code> جاهز للتغليف والطباعة.</> })
    }, 900)
  }

  const fb = feedback ? feedbackStyle[feedback.tone] : null

  return (
    <WorkspaceFrame role="hub" active="pick" mode="task" operator="أحمد ف. · محطة 2" task="تجهيز طلب">
      <div className="mx-auto grid max-w-6xl gap-4 p-4 lg:grid-cols-[1fr_20rem] lg:p-6">
        <div className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-bw-small text-bw-on-kohl-soft">طلب واحد نشط</p>
              <h1 className="font-bw-display text-bw-title font-semibold">
                <Code>ORD-20406</Code>
              </h1>
            </div>
            <p className="text-bw-heading" aria-live="polite">
              <Code className="font-bw-display text-bw-figure font-semibold">{confirmed}</Code>
              <span className="text-bw-on-kohl-soft"> من <Code>{total}</Code> قطع مؤكدة</span>
            </p>
          </div>

          <div className="h-2 overflow-hidden rounded-full bg-bw-kohl-raised" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={confirmed} aria-label="تقدم التجهيز">
            <div className="h-full bg-bw-on-kohl-action transition-[width] duration-300" style={{ width: `${(confirmed / total) * 100}%` }} />
          </div>

          {completion !== 'confirmed' ? (
            <form onSubmit={scan} className="space-y-2">
              <label htmlFor="scan" className="block text-bw-small font-semibold">
                امسح باركود الصنف أو اكتب الكود
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <ScanLine className="pointer-events-none absolute inset-y-0 start-3 my-auto size-5 text-bw-on-kohl-action" aria-hidden />
                  <input
                    ref={input}
                    id="scan"
                    autoFocus
                    autoComplete="off"
                    dir="ltr"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder="6224000…"
                    className="bw-code h-bw-touch w-full rounded-bw-field border-[1.5px] border-bw-on-kohl-soft bg-bw-kohl-raised ps-11 pe-3 text-bw-heading text-bw-on-kohl placeholder:text-bw-on-kohl-soft"
                  />
                </div>
                <Button type="submit" variant="onKohl" size="touch">
                  تسجيل
                </Button>
              </div>
              <p className="text-bw-small text-bw-on-kohl-soft">
                للتجربة: <button type="button" className="min-h-6 underline" onClick={() => setValue('6224000445566')}><Code>6224000445566</Code></button> ·{' '}
                <button type="button" className="min-h-6 underline" onClick={() => setValue('6224000778899')}><Code>6224000778899</Code></button> ·{' '}
                <button type="button" className="min-h-6 underline" onClick={() => setValue('6224000990011')}><Code>6224000990011</Code></button>
              </p>
            </form>
          ) : null}

          {feedback && fb ? (
            <div role={feedback.tone === 'danger' ? 'alert' : 'status'} className={cn('flex gap-3 rounded-bw-card border-[1.5px] bg-bw-kohl-raised p-4', fb.cls)}>
              <fb.Icon className={cn('size-7 shrink-0', feedback.tone === 'pending' && 'animate-spin')} aria-hidden />
              <div>
                <p className="text-bw-heading font-semibold">{feedback.title}</p>
                <p className="text-bw-on-kohl">{feedback.body}</p>
              </div>
            </div>
          ) : null}

          <ul className="divide-y divide-bw-kohl-raised rounded-bw-card border border-bw-kohl-raised">
            {lines.map((l) => {
              const done = l.confirmed === l.qty
              return (
                <li key={l.sku} className={cn('flex flex-wrap items-center gap-3 p-4', done && 'opacity-80')}>
                  {done ? (
                    <CheckCircle2 className="size-6 shrink-0 text-bw-on-kohl-action" aria-hidden />
                  ) : (
                    <CircleDashed className="size-6 shrink-0 text-bw-on-kohl-soft" aria-hidden />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      <bdi>{l.name}</bdi> <span className="text-bw-on-kohl-soft">· {l.variant}</span>
                    </p>
                    <p className="text-bw-small text-bw-on-kohl-soft">
                      <Code>{l.sku}</Code> · <Code>{l.barcode}</Code>
                    </p>
                  </div>
                  <p className="text-bw-heading">
                    <Code>
                      <span className="font-semibold">{l.confirmed}</span>
                      <span className="text-bw-on-kohl-soft">/{l.qty}</span>
                    </Code>
                  </p>
                  <span className="w-28 text-bw-small">
                    {done ? (
                      <span className="text-bw-on-kohl-action">اتأكد</span>
                    ) : l.pending ? (
                      <span className="text-bw-on-kohl-soft">بيتأكد…</span>
                    ) : (
                      <span className="text-bw-on-kohl-soft">مستني مسح</span>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>

        <aside className="space-y-4">
          <div className="space-y-3 rounded-bw-card border border-bw-kohl-raised p-4">
            <p className="font-semibold">إنهاء التجهيز</p>
            <p className="text-bw-small text-bw-on-kohl-soft">
              بيتفعل لما كل القطع تتأكد من السيرفر. العدّ على الشاشة لوحده مش كفاية.
            </p>
            <Button variant="onKohl" size="touch" className="w-full" disabled={!allConfirmed || completion !== 'idle'} loading={completion === 'pending'} onClick={complete}>
              {completion === 'confirmed' ? 'اكتمل' : 'إنهاء التجهيز'}
            </Button>
          </div>

          <div className={cn('space-y-3 rounded-bw-card border border-bw-kohl-raised p-4', completion !== 'confirmed' && 'opacity-60')}>
            <p className="flex items-center gap-2 font-semibold">
              <Printer className="size-5" aria-hidden />
              بوليصة حرارية <Code>100×150</Code> مم
            </p>
            {completion === 'confirmed' ? (
              <>
                <LabelPreview
                  code="SHP-20406-01"
                  lines={[
                    ['المنطقة', 'مصر الجديدة'],
                    ['القطع', <Code key="p">4</Code>],
                    ['التحصيل', 'عند الاستلام'],
                  ]}
                />
                <Button variant="onKohl" size="touch" className="w-full">
                  <Printer className="size-5" aria-hidden />
                  اطبع البوليصة
                </Button>
              </>
            ) : (
              <p className="text-bw-small text-bw-on-kohl-soft">الطباعة متاحة بعد تأكيد اكتمال التجهيز.</p>
            )}
          </div>
        </aside>

        <div className="lg:col-span-2 [&_details]:border-bw-kohl-raised [&_details]:bg-bw-kohl-raised [&_details]:text-bw-on-kohl [&_li]:text-bw-on-kohl-soft">
          <DesignNotes
            reusable={['Code لكل باركود وSKU', 'إطار "مهمة" بخروج صريح', 'LabelPreview', 'حالة pending ≠ confirmed على كل بند']}
            specific={['سطح Kohl غامق للمحطة وإدخال واحد مركّز دايمًا', 'رد فعل كبير (أيقونة + كلام) بعد كل مسح', 'الإنهاء والطباعة مقفولين لحد تأكيد السيرفر']}
            open={['صوت/اهتزاز عند الخطأ في الماسح', 'مقاس الطابعة الحرارية الفعلي في المخزن']}
          />
        </div>
      </div>
    </WorkspaceFrame>
  )
}

'use client'

import * as React from 'react'
import { MapPin, Phone, ScanLine } from 'lucide-react'
import { WorkspaceFrame } from '@/components/bw/workspace-frame'
import {
  Button, Code, Dialog, DesignNotes, Field, Money, Notice, Section, StateBlock, StatusLabel, useDialog,
} from '@/components/bw/primitives'
import { cn } from '@/lib/utils'
import type { ScreenState } from '../states'

/* Synthetic reference stop. The driver sees only stops on its own assigned run. */
const stop = {
  run: 'RUN-0321',
  index: 3,
  count: 6,
  customer: 'هبة ت.',
  area: 'مصر الجديدة، القاهرة',
  address: 'شارع الأهرام، عمارة 12، الدور 4، شقة 8',
  note: 'كلّمني قبل ما توصل بـ 10 دقايق',
  package: 'SHP-20406-01',
  due: 1050,
}
const custodyBefore = 1840

const reasons = ['العميل مبيردش', 'العنوان غلط أو ناقص', 'العميل رفض الاستلام', 'العميل طلب ميعاد تاني'] as const

type Outcome = { kind: 'delivered'; collected: number } | { kind: 'failed'; reason: string } | null

export function DriverDeliveryStop({ state }: { state: ScreenState<'driver'> }) {
  const [scanned, setScanned] = React.useState(state !== 'default')
  const [scanValue, setScanValue] = React.useState('')
  const [scanError, setScanError] = React.useState<string>()
  const [amount, setAmount] = React.useState('')
  const [reason, setReason] = React.useState<string>('')
  const [saving, setSaving] = React.useState(false)
  const [outcome, setOutcome] = React.useState<Outcome>(
    state === 'delivered' ? { kind: 'delivered', collected: stop.due } : state === 'failed' ? { kind: 'failed', reason: reasons[0] } : null,
  )
  const failSheet = useDialog()
  const outcomeRef = React.useRef<HTMLDivElement>(null)
  const initialOutcome = React.useRef(outcome)
  React.useEffect(() => {
    if (outcome && outcome !== initialOutcome.current) outcomeRef.current?.focus()
  }, [outcome])

  const collected = Number(amount)
  const amountValid = amount.trim() !== '' && Number.isFinite(collected) && collected >= 0
  const differs = amountValid && collected !== stop.due

  const verify = (e: React.FormEvent) => {
    e.preventDefault()
    if (scanValue.trim() === stop.package) {
      setScanned(true)
      setScanError(undefined)
    } else {
      setScanError('البوليصة دي مش بتاعة المحطة دي. اتأكد إنك ماسك الشحنة الصح.')
    }
  }

  const save = (next: Exclude<Outcome, null>) => {
    setSaving(true)
    window.setTimeout(() => {
      setSaving(false)
      failSheet.close()
      setOutcome(next)
    }, 800)
  }

  const custody = custodyBefore + (outcome?.kind === 'delivered' ? outcome.collected : 0)

  return (
    <WorkspaceFrame role="driver" active="run" mode="mobile" operator="محمود ح.">
      <div className="space-y-4 p-4">
        {state === 'empty' ? (
          <Section>
            <StateBlock kind="empty" title="مفيش مشوار متسجل عليك النهارده" body="أول ما المخزن يسلمك شحنات، المحطات هتظهر هنا بالترتيب." />
          </Section>
        ) : (
          <>
            <div className="flex items-center justify-between text-bw-small text-bw-ink-soft">
              <span>
                مشوار <Code>{stop.run}</Code>
              </span>
              <span>
                محطة <Code>{stop.index}</Code> من <Code>{stop.count}</Code>
              </span>
            </div>

            <Section>
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h1 className="font-bw-display text-bw-title font-semibold">{stop.customer}</h1>
                    <p className="text-bw-ink-soft">{stop.area}</p>
                  </div>
                  {outcome?.kind === 'delivered' ? (
                    <StatusLabel tone="ok">اتسلم</StatusLabel>
                  ) : outcome?.kind === 'failed' ? (
                    <StatusLabel tone="warn">محاولة فشلت</StatusLabel>
                  ) : (
                    <StatusLabel tone="pending">في الطريق</StatusLabel>
                  )}
                </div>
                <p>{stop.address}</p>
                <p className="rounded-bw-field bg-bw-sunken px-3 py-2 text-bw-small">ملاحظة العميل: {stop.note}</p>
                <div className="grid grid-cols-2 gap-2">
                  <a href="#" className="inline-flex h-bw-touch items-center justify-center gap-2 rounded-full border-[1.5px] border-bw-line-field font-semibold">
                    <Phone className="size-5" aria-hidden />
                    اتصل
                  </a>
                  <a href="#" className="inline-flex h-bw-touch items-center justify-center gap-2 rounded-full border-[1.5px] border-bw-line-field font-semibold">
                    <MapPin className="size-5" aria-hidden />
                    الخريطة
                  </a>
                </div>
              </div>
            </Section>

            {outcome ? (
              <div ref={outcomeRef} tabIndex={-1} className="outline-none">
                {outcome.kind === 'delivered' ? (
                  <Notice tone="ok" title="اتسجل التسليم والتحصيل">
                    استلمت <Money value={outcome.collected} /> · إيصال <Code>DLV-20406-01</Code> · <Code>14:32</Code>
                  </Notice>
                ) : (
                  <Notice tone="warn" title="المحاولة اتسجلت — الطلب ما اتلغاش">
                    السبب: {outcome.reason}. الشحنة لسه في عهدتك؛ رجّعها للمخزن آخر المشوار. الإدارة هتحدد المحاولة الجاية.
                  </Notice>
                )}
              </div>
            ) : (
              <>
                <Section title="1. طابق الشحنة">
                  {scanned ? (
                    <StatusLabel tone="ok">
                      الشحنة مطابقة · <Code>{stop.package}</Code>
                    </StatusLabel>
                  ) : (
                    <form onSubmit={verify} className="space-y-2">
                      <Field
                        label="امسح البوليصة أو اكتب رقمها"
                        ltr
                        autoComplete="off"
                        value={scanValue}
                        onChange={(e) => setScanValue(e.target.value)}
                        error={scanError}
                        placeholder="SHP-…"
                      />
                      <Button type="submit" variant="secondary" size="touch" className="w-full">
                        <ScanLine className="size-5" aria-hidden />
                        طابق
                      </Button>
                      <button type="button" className="min-h-6 text-bw-small text-bw-ink-soft underline" onClick={() => setScanValue(stop.package)}>
                        للتجربة: <Code>{stop.package}</Code>
                      </button>
                    </form>
                  )}
                </Section>

                <Section title="2. التحصيل عند الاستلام" className={cn(!scanned && 'opacity-60')}>
                  <div className="space-y-3">
                    <p className="flex items-baseline justify-between">
                      <span>المطلوب من العميل</span>
                      <Money value={stop.due} className="font-bw-display text-bw-figure font-semibold" />
                    </p>
                    <Field
                      label="المبلغ اللي استلمته فعلًا (جنيه)"
                      inputMode="decimal"
                      ltr
                      disabled={!scanned}
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                    {differs ? (
                      <Notice tone="warn" title="المبلغ مختلف عن المطلوب">
                        هيتسجل الفرق <Money value={Math.abs(stop.due - collected)} /> ويتراجع في المخزن. متكملش لو العميل لسه هيدفع الباقي.
                      </Notice>
                    ) : null}
                  </div>
                </Section>
              </>
            )}

            <Section title="عهدتك النهارده">
              <dl className="space-y-2">
                <div className="flex justify-between">
                  <dt className="text-bw-ink-soft">فلوس محصّلة معاك</dt>
                  <dd className="font-semibold"><Money value={custody} /></dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-bw-ink-soft">الحالة</dt>
                  <dd><StatusLabel tone="pending">عهدة — مش متسوّاة</StatusLabel></dd>
                </div>
              </dl>
              <p className="mt-2 text-bw-small text-bw-ink-soft">الفلوس دي ملك شينا كير لحد ما تسلمها للمخزن ويتعمل لها تسوية. التسوية مش بتتعمل من التطبيق ده.</p>
            </Section>

            {!outcome ? (
              <div className="sticky bottom-14 grid gap-2 rounded-bw-card border border-bw-line bg-bw-surface p-3 shadow-sm">
                <Button size="touch" disabled={!scanned || !amountValid} loading={saving} onClick={() => save({ kind: 'delivered', collected })}>
                  اتسلم واستلمت المبلغ
                </Button>
                <Button variant="danger" size="touch" disabled={saving} onClick={failSheet.open}>
                  المحاولة فشلت
                </Button>
              </div>
            ) : (
              <Button size="touch" className="w-full">المحطة الجاية</Button>
            )}
          </>
        )}

        <DesignNotes
          reusable={['Section وField وNotice وStatusLabel', 'Sheet (dialog أصلي) للأسباب', 'Money وCode بأرقام LTR', 'إطار الموبايل بتابات سفلية 52px']}
          specific={['مطابقة البوليصة قبل ما التحصيل يتفتح', 'العهدة ≠ التسوية، مكتوبة بالكلام', 'المحاولة الفاشلة مش إلغاء للطلب', 'المندوب بيشوف محطات مشواره بس']}
          open={['عدد المحاولات وسياسة الإرجاع (GLO-139)', 'هل نطلب صورة/توقيع عند التسليم؟', 'حد التسامح في فرق التحصيل']}
        />
      </div>

      <Dialog
        dialogRef={failSheet.ref}
        variant="sheet"
        title="سجّل محاولة فاشلة"
        footer={
          <>
            <Button variant="secondary" onClick={failSheet.close} disabled={saving}>
              رجوع
            </Button>
            <Button disabled={!reason} loading={saving} onClick={() => save({ kind: 'failed', reason })}>
              سجّل المحاولة
            </Button>
          </>
        }
      >
        <fieldset className="space-y-2">
          <legend className="mb-2 font-semibold">إيه اللي حصل؟</legend>
          {reasons.map((r) => (
            <label key={r} className="flex min-h-bw-touch items-center gap-3 rounded-bw-field border border-bw-line px-3">
              <input type="radio" name="reason" value={r} checked={reason === r} onChange={() => setReason(r)} className="size-5 accent-bw-action" />
              {r}
            </label>
          ))}
        </fieldset>
        <p className="mt-3 text-bw-small text-bw-ink-soft">الطلب مش هيتلغي. الشحنة بتفضل في عهدتك لحد ما ترجعها للمخزن.</p>
      </Dialog>
    </WorkspaceFrame>
  )
}

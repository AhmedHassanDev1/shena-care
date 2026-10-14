'use client'

import * as React from 'react'
import { CheckCheck } from 'lucide-react'
import { WorkspaceFrame } from '@/components/bw/workspace-frame'
import {
  Button, Code, Dialog, DesignNotes, Field, Money, Notice, PageHeader, Section, StateBlock, StatusLabel, Stepper, useDialog,
} from '@/components/bw/primitives'
import type { ScreenState } from '../states'

type Line = {
  id: string
  name: string
  size: string
  supplierCode: string
  supplierName: string
  requested: number
  unitCost: number
  confirmed: number
  costChanged: boolean
  newCost: string
}

/* Synthetic reference content: the supplier sees only its own PO lines and its own offer cost. */
const initialLines: Line[] = [
  { id: 'l1', name: 'سيروم نياسيناميد 10%', size: '30 مل', supplierCode: 'DLT-88231', supplierName: 'Niacin Serum 30ml', requested: 3, unitCost: 210, confirmed: 3, costChanged: false, newCost: '' },
  { id: 'l2', name: 'كريم مرطب للبشرة الجافة', size: '250 مل', supplierCode: 'DLT-10442', supplierName: 'Hydra Cream 250', requested: 2, unitCost: 300, confirmed: 2, costChanged: false, newCost: '' },
  { id: 'l3', name: 'واقي شمس SPF 50', size: '50 مل', supplierCode: 'DLT-57120', supplierName: 'Sun Fluid 50+', requested: 4, unitCost: 265, confirmed: 4, costChanged: false, newCost: '' },
]

const partialLines: Line[] = initialLines.map((l) =>
  l.id === 'l1' ? { ...l, confirmed: 0 } : l.id === 'l3' ? { ...l, confirmed: 2, costChanged: true, newCost: '280' } : l,
)

function ProductName({ line }: { line: Line }) {
  return (
    <>
      <bdi>{line.name}</bdi> — {line.size}
    </>
  )
}

function lineStatus(l: Line) {
  if (l.confirmed === 0) return <StatusLabel tone="danger">مش متاح</StatusLabel>
  if (l.confirmed < l.requested) return <StatusLabel tone="warn">متاح جزئي</StatusLabel>
  return <StatusLabel tone="ok">متاح بالكامل</StatusLabel>
}

function costError(l: Line) {
  if (!l.costChanged) return undefined
  const n = Number(l.newCost)
  return l.newCost.trim() === '' || !Number.isFinite(n) || n <= 0 ? 'اكتب التكلفة الجديدة للوحدة بالجنيه' : undefined
}

export function SupplierPoConfirmation({ state }: { state: ScreenState<'supplier'> }) {
  const [lines, setLines] = React.useState<Line[]>(state === 'partial' ? partialLines : initialLines)
  const [submitting, setSubmitting] = React.useState(false)
  const [receipt, setReceipt] = React.useState(state === 'confirmed')
  const review = useDialog()
  const receiptRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    if (receipt && state !== 'confirmed') receiptRef.current?.focus()
  }, [receipt, state])

  const update = (id: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)))
  const confirmAll = () => setLines((ls) => ls.map((l) => ({ ...l, confirmed: l.requested })))
  const hasErrors = lines.some((l) => costError(l))
  const effectiveCost = (l: Line) => (l.costChanged && !costError(l) ? Number(l.newCost) : l.unitCost)
  const total = lines.reduce((sum, l) => sum + l.confirmed * effectiveCost(l), 0)
  const shortLines = lines.filter((l) => l.confirmed < l.requested).length

  const submit = () => {
    setSubmitting(true)
    window.setTimeout(() => {
      setSubmitting(false)
      review.close()
      setReceipt(true)
    }, 900)
  }

  return (
    <WorkspaceFrame role="supplier" active="pos" mode="mobile" operator="مورد الدلتا">
      <div className="space-y-4 p-4">
        {state === 'forbidden' ? (
          <Section>
            <StateBlock kind="forbidden" title="أمر الشراء ده مش متاح لحسابك" body="ممكن يكون اللينك غلط أو الأمر مش تبعك. بتشوف بس أوامر الشراء المبعوتة لشركتك." />
          </Section>
        ) : state === 'empty' ? (
          <Section>
            <StateBlock kind="empty" title="مفيش أوامر شراء مستنياك" body="أول ما شينا كير تبعتلك أمر شراء هيظهر هنا وهيوصلك إشعار." />
          </Section>
        ) : receipt ? (
          <>
            <div ref={receiptRef} tabIndex={-1} className="outline-none">
              <Notice tone="ok" title="اتبعت تأكيدك لشينا كير">
                رقم الإيصال <Code>CNF-1042-01</Code> · النهارده <Code>11:18</Code>
              </Notice>
            </div>
            <Section title={<>أمر شراء <Code>PO-1042</Code></>}>
              <ul className="divide-y divide-bw-line">
                {lines.map((l) => (
                  <li key={l.id} className="flex items-start justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="font-semibold"><ProductName line={l} /></p>
                      <p className="text-bw-small text-bw-ink-soft">
                        مؤكد <Code>{l.confirmed}</Code> من <Code>{l.requested}</Code> · <Money value={effectiveCost(l)} /> للوحدة
                      </p>
                    </div>
                    {lineStatus(l)}
                  </li>
                ))}
              </ul>
              <p className="mt-3 flex justify-between border-t border-bw-line pt-3 font-semibold">
                إجمالي المؤكد <Money value={total} />
              </p>
            </Section>
            <p className="text-bw-small text-bw-ink-soft">لو محتاج تعدّل بعد التأكيد، كلّم فريق المشتريات في شينا كير.</p>
          </>
        ) : (
          <>
            <PageHeader eyebrow="أمر شراء من شينا كير" title="PO-1042" meta={<>اتبعت النهارده <Code>10:05</Code> · <Code>{lines.length}</Code> بنود</>} />
            <Button variant="secondary" size="touch" className="w-full" onClick={confirmAll}>
              <CheckCheck className="size-5" aria-hidden />
              كله متاح بالكميات المطلوبة
            </Button>

            <ul className="space-y-3">
              {lines.map((l) => {
                const err = costError(l)
                return (
                  <li key={l.id} className="space-y-3 rounded-bw-card border border-bw-line bg-bw-surface p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-0.5">
                        <p className="font-semibold"><ProductName line={l} /></p>
                        <p className="text-bw-small text-bw-ink-soft">
                          عندك: <Code>{l.supplierCode}</Code> · <bdi>{l.supplierName}</bdi>
                        </p>
                      </div>
                      {lineStatus(l)}
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="text-bw-small">
                        <p>
                          المطلوب <Code className="font-semibold">{l.requested}</Code>
                        </p>
                        <p className="text-bw-ink-soft">
                          تكلفة عرضك <Money value={l.unitCost} />
                        </p>
                      </div>
                      <div className="space-y-1 text-center">
                        <p className="text-bw-small font-semibold">المتاح عندك</p>
                        <Stepper label={`الكمية المتاحة: ${l.name} ${l.size}`} value={l.confirmed} max={l.requested} onChange={(n) => update(l.id, { confirmed: n })} />
                      </div>
                    </div>
                    <label className="flex min-h-bw-touch items-center gap-3 text-bw-small">
                      <input
                        type="checkbox"
                        className="size-5 accent-bw-action"
                        checked={l.costChanged}
                        onChange={(e) => update(l.id, { costChanged: e.target.checked })}
                      />
                      التكلفة اتغيرت
                    </label>
                    {l.costChanged ? (
                      <Field
                        label="التكلفة الجديدة للوحدة (جنيه)"
                        inputMode="decimal"
                        ltr
                        value={l.newCost}
                        onChange={(e) => update(l.id, { newCost: e.target.value })}
                        error={err}
                        hint="شينا كير بتراجع أي تغيير في التكلفة قبل اعتماده."
                      />
                    ) : null}
                  </li>
                )
              })}
            </ul>

            <div className="sticky bottom-14 space-y-2 rounded-bw-card border border-bw-line bg-bw-surface p-3 shadow-sm">
              <p className="flex justify-between text-bw-small">
                <span>
                  {shortLines ? <><Code>{shortLines}</Code> بند ناقص</> : 'كل البنود متاحة'}
                </span>
                <Money value={total} className="font-semibold" />
              </p>
              <Button size="touch" className="w-full" disabled={hasErrors} onClick={review.open}>
                راجع وأكّد
              </Button>
              {hasErrors ? <p className="text-bw-small text-bw-danger">كمّل التكلفة الجديدة الأول.</p> : null}
            </div>
          </>
        )}

        <DesignNotes
          reusable={['Stepper لمس 52px', 'Field بأرقام LTR ورسالة خطأ بأيقونة', 'StatusLabel لكل بند', 'Sheet (dialog أصلي) للمراجعة النهائية', 'Notice كإيصال']}
          specific={['اسم شينا كير + كود واسم المورد على نفس البند', 'زرار "كله متاح" قبل البنود', 'المورد مش بيشوف سعر البيع ولا الهامش ولا بيانات العميل ولا موردين تانيين']}
          open={['هل المورد يقدر يعدّل بعد التأكيد؟', 'مهلة الرد على أمر الشراء (GAP-04)']}
        />
      </div>

      <Dialog
        dialogRef={review.ref}
        variant="sheet"
        title="تأكيد نهائي"
        footer={
          <>
            <Button variant="secondary" onClick={review.close} disabled={submitting}>
              رجوع للتعديل
            </Button>
            <Button onClick={submit} loading={submitting}>
              أكّد وابعت
            </Button>
          </>
        }
      >
        <ul className="divide-y divide-bw-line">
          {lines.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3 py-2 text-bw-small">
              <span className="min-w-0"><ProductName line={l} /></span>
              <span className="shrink-0">
                <Code><span className="font-semibold">{l.confirmed}</span>/{l.requested}</Code>
                {l.costChanged && !costError(l) ? <> · <Money value={Number(l.newCost)} /></> : null}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 flex justify-between border-t border-bw-line pt-3 font-semibold">
          الإجمالي <Money value={total} />
        </p>
        <p className="mt-2 text-bw-small text-bw-ink-soft">التأكيد بيتسجل باسم حسابك وبيوصل لشينا كير فورًا.</p>
      </Dialog>
    </WorkspaceFrame>
  )
}

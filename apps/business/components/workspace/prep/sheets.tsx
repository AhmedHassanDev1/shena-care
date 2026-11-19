'use client'

import * as React from 'react'
import { BadgeDollarSign, Barcode, ChevronLeft, ExternalLink, Minus, Plus, ScanSearch } from 'lucide-react'
import { Button, Dialog, Field, useDialog } from '@/components/bw/primitives'
import { Flash } from '@/components/bw/ops'
import { type ApiError, api, newKey } from '@/lib/api'
import { productUrl } from '@/lib/purchase-batch'
import { useApi, useCommand } from '@/lib/use-api'
import { type DeskLine, type DeskOrder, MANUAL_CHECKS as ALL_CHECKS, MANUAL_REASON, REJECT, type ScanResult, productMeta, productTitle } from './model'
import { Thumb } from './product'
import { registerUnits } from './register'


/** A bottom sheet that opens as soon as it is mounted and tells its owner when it closes (button, Esc or backdrop). */
function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const dialog = useDialog()
  React.useEffect(() => { dialog.ref.current?.showModal() }, [dialog.ref])
  return <Dialog dialogRef={dialog.ref} title={title} variant="sheet" onClose={onClose}>{children}</Dialog>
}

export type SheetKind = 'menu' | 'manual' | 'barcode' | 'price'
export type ActionKind = Exclude<SheetKind, 'menu'>
export interface ActionItem { kind: ActionKind; label: string; hint: string; icon: React.ElementType }

/** The actions of one product that are not part of the scan flow; the popover (desktop) and the bottom sheet (phone) list the same ones. */
export function actionItems(line: DeskLine, canPrice: boolean): ActionItem[] {
  const items: Array<ActionItem & { show: boolean }> = [
    { kind: 'manual', label: 'تسجيل بدون باركود', hint: 'قارن العبوة بالبيانات وأكّد القطعة بنفسك', icon: ScanSearch, show: true },
    { kind: 'barcode', label: line.barcode ? 'تعديل الباركود' : 'إضافة باركود', hint: line.barcode ? 'لو الباركود المسجّل غلط' : 'المنتج ده من غير باركود متسجّل', icon: Barcode, show: true },
    { kind: 'price', label: 'تعديل سعر البيع في الموقع', hint: 'بيسري على الطلبات الجديدة بس', icon: BadgeDollarSign, show: canPrice },
  ]
  return items.filter((item) => item.show)
}

/** The same actions as a bottom sheet (phone). Opens over the preparation screen; nothing is navigated away from. */
export function ActionsSheet({ line, canPrice, onPick, onClose }: { line: DeskLine; canPrice: boolean; onPick: (kind: ActionKind) => void; onClose: () => void }) {
  const items = actionItems(line, canPrice)
  return (
    <Sheet title={productTitle(line)} onClose={onClose}>
      <ul className="space-y-2">
        {items.map(({ kind, label, hint, icon: Icon }) => (
          <li key={kind}>
            <button type="button" onClick={() => onPick(kind)} className="flex min-h-14 w-full items-center gap-3 rounded-bw-card border border-bw-line bg-bw-surface px-4 py-3 text-start hover:bg-bw-sunken">
              <Icon className="size-5 shrink-0 text-bw-ink-soft" aria-hidden />
              <span className="min-w-0 flex-1"><span className="block text-bw-body font-semibold text-bw-ink">{label}</span><span className="block text-[12px] text-bw-ink-soft">{hint}</span></span>
              <ChevronLeft className="size-4 shrink-0 text-bw-ink-subtle" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  )
}

/**
 * Manual confirmation: the employee compares the physical pack with what the catalog says it must be and confirms it themselves.
 * Recorded as a manual verification (the server stores the reason and the four identity checks), never as a barcode scan.
 */
export function ManualSheet({ line, hubId, orderId, onDone, onClose }: { line: DeskLine; hubId: string; orderId: string; onDone: (order: DeskOrder | null, recorded: number, requested: number) => void; onClose: () => void }) {
  // One server call per unit (the scan API records one unit each, every one audited), so the quantity below is only how many are sent in a row.
  const confirm = useCommand(() => api<ScanResult>(`/fulfillment/locations/${hubId}/desk/orders/${orderId}/scan`, {
    body: { clientScanId: newKey(), skuId: line.skuId, manualReason: MANUAL_REASON, manualChecks: ALL_CHECKS },
  }))
  const [refused, setRefused] = React.useState<string | null>(null)
  // What can still be registered right now: never more than is required, nor more than was bought. The default is all of it.
  const room = Math.max(Math.min(line.required, line.purchased) - line.received, 1)
  const [wanted, setWanted] = React.useState(room)
  const count = Math.min(Math.max(wanted, 1), room)
  const link = productUrl(line)
  const rows: Array<[string, string | null]> = [
    ['الماركة', line.brandName], ['الحجم', line.size], ['النوع', line.variantName], ['كود المنتج', line.skuCode], ['الباركود المسجّل', line.barcode ?? 'مفيش'],
  ]
  return (
    <Sheet title="تأكيد القطعة بالعين" onClose={onClose}>
      <div className="space-y-4">
        <div className="flex justify-center"><Thumb line={line} size="xl" /></div>
        <div>
          <p className="text-bw-heading font-semibold text-bw-ink"><bdi>{productTitle(line)}</bdi></p>
          <p className="text-bw-small text-bw-ink-soft"><bdi>{productMeta(line)}</bdi></p>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-bw-small">
          {rows.filter(([, value]) => value).map(([label, value]) => (
            <React.Fragment key={label}><dt className="text-bw-ink-soft">{label}</dt><dd className="font-semibold text-bw-ink"><bdi>{value}</bdi></dd></React.Fragment>
          ))}
        </dl>
        <p className="rounded-bw-field bg-bw-sunken/60 px-3 py-2 text-[12px] text-bw-ink-soft">قارن العبوة اللي في إيدك بالصورة والبيانات دي. هتتسجّل «تحقق يدوي» باسمك، مش مسح باركود.</p>
        <div className="flex items-center justify-between gap-3">
          <span id="manual-qty" className="text-bw-small font-semibold text-bw-ink">عدد القطع<span className="ms-1.5 text-[12px] font-normal text-bw-ink-soft">(المتاح <bdi className="tabular-nums">{room}</bdi>)</span></span>
          <div role="group" aria-labelledby="manual-qty" className="flex items-center gap-1">
            <button type="button" disabled={count <= 1 || confirm.pending} aria-label="نقّص العدد" onClick={() => setWanted(count - 1)}
              className="grid size-bw-control place-items-center rounded-full border border-bw-line bg-bw-surface text-bw-ink hover:bg-bw-sunken disabled:cursor-not-allowed disabled:opacity-60"><Minus className="size-4" aria-hidden /></button>
            <span className="min-w-10 text-center text-bw-heading font-semibold tabular-nums text-bw-ink" dir="ltr" aria-live="polite">{count}</span>
            <button type="button" disabled={count >= room || confirm.pending} aria-label="زوّد العدد" onClick={() => setWanted(count + 1)}
              className="grid size-bw-control place-items-center rounded-full bg-bw-action text-bw-on-action hover:bg-bw-action-hover disabled:cursor-not-allowed disabled:bg-bw-sunken disabled:text-bw-ink-subtle"><Plus className="size-4" aria-hidden /></button>
          </div>
        </div>
        {confirm.error ? <Flash tone="danger">{confirm.error.message}</Flash> : null}
        {refused ? <Flash tone="danger">{refused}</Flash> : null}
        <Button size="touch" className="w-full" loading={confirm.pending} onClick={async () => {
          setRefused(null)
          const outcome = await registerUnits<DeskOrder>(count, async () => {
            const result = await confirm.execute()
            if (!result) return undefined
            return { refusal: result.outcome === 'rejected' ? REJECT[result.code ?? ''] ?? 'التسجيل اترفض.' : null, order: result.order }
          })
          if (outcome.refusal) setRefused(outcome.refusal)
          // Only what the server confirmed is reported, even when a later unit was refused or failed: each unit was decided on its own.
          if (outcome.done > 0) onDone(outcome.last, outcome.done, count)
          if (outcome.complete) onClose()
        }}>{count > 1 ? `تأكيد وإضافة ${count} قطع` : 'تأكيد وإضافة القطعة'}</Button>
        {link ? <a href={link} target="_blank" rel="noreferrer" className="flex min-h-11 items-center justify-center gap-1.5 text-bw-small font-semibold text-bw-cobalt underline-offset-4 hover:underline">تفاصيل المنتج<ExternalLink className="size-4" aria-hidden /></a> : null}
      </div>
    </Sheet>
  )
}

const BARCODE_MESSAGES: Record<string, string> = {
  INVALID_BARCODE: 'الرقم ده مش باركود صحيح. اقراه تاني من العبوة.',
  BARCODE_ALREADY_USED: 'الباركود ده تابع لمنتج تاني، فمينفعش يتسجّل هنا.',
  SKU_ALREADY_HAS_BARCODE: 'المنتج ده ليه باركود متسجّل. التعديل بيتم من «تعديل الباركود» بصلاحية الكتالوج.',
  SKU_HAS_NO_BARCODE: 'المنتج ده ملوش باركود متسجّل. استخدم «إضافة باركود».',
  WRONG_ITEM: 'المنتج ده مش في الطلب.',
  CHECKS_INCOMPLETE: 'أكّد إن العبوة هي نفس المنتج بالظبط.',
}
const barcodeError = (error: ApiError | null) => (error ? BARCODE_MESSAGES[error.code ?? ''] ?? error.message : null)

/** Add a barcode to a product that has none (any Hub operator) or correct a wrong one (catalog reviewers); both audited by the API. */
export function BarcodeSheet({ line, hubId, orderId, canCorrect, initialCode, onDone, onClose }: {
  line: DeskLine; hubId: string; orderId: string; canCorrect: boolean; initialCode: string
  onDone: (order: DeskOrder | null, barcode: string) => void; onClose: () => void
}) {
  const correcting = !!line.barcode
  const [code, setCode] = React.useState(initialCode)
  const [same, setSame] = React.useState(false)
  const [note, setNote] = React.useState('')
  const key = React.useRef(newKey())
  const submit = useCommand((body: Record<string, unknown>) => api<{ order: DeskOrder | null; barcode: string }>(
    `/fulfillment/locations/${hubId}/desk/orders/${orderId}/${correcting ? 'correct-barcode' : 'register-barcode'}`, { body }))
  const valid = same && code.trim().length >= 8 && (!correcting || note.trim().length >= 5)

  if (correcting && !canCorrect) {
    return (
      <Sheet title="تعديل الباركود" onClose={onClose}>
        <div className="space-y-3">
          <p className="text-bw-small text-bw-ink-soft">الباركود المسجّل لـ <bdi className="font-semibold text-bw-ink">{productTitle(line)}</bdi>:</p>
          <p className="bw-code text-bw-heading font-semibold text-bw-ink" dir="ltr">{line.barcode}</p>
          <Flash tone="warn">تعديل باركود موجود بيحتاج صلاحية الكتالوج. اطلب من الإدارة تعدّله، وفي الأثناء كمّل بـ «تسجيل بدون باركود».</Flash>
        </div>
      </Sheet>
    )
  }
  return (
    <Sheet title={correcting ? 'تعديل الباركود' : 'إضافة باركود'} onClose={onClose}>
      <form className="space-y-4" onSubmit={async (event) => {
        event.preventDefault()
        const result = await submit.execute({
          clientScanId: key.current, skuId: line.skuId, barcode: code.trim(), checks: ALL_CHECKS,
          note: correcting ? note.trim() : 'المنتج من غير باركود في الكتالوج؛ العبوة اتقارنت بالصنف في الطلب',
        })
        if (result) { onDone(result.order, code.trim()); onClose() }
      }}>
        <div className="flex items-center gap-3 rounded-bw-card border border-bw-line bg-bw-surface p-3">
          <Thumb line={line} />
          <div className="min-w-0"><p className="text-bw-body font-semibold text-bw-ink"><bdi>{productTitle(line)}</bdi></p><p className="text-bw-small text-bw-ink-soft"><bdi>{productMeta(line)}</bdi></p></div>
        </div>
        {correcting ? <p className="text-bw-small text-bw-ink-soft">الباركود المسجّل حاليًا: <bdi className="bw-code font-semibold text-bw-ink" dir="ltr">{line.barcode}</bdi></p> : null}
        <Field label={correcting ? 'الباركود الصحيح المطبوع على العبوة' : 'الباركود المطبوع على العبوة'} ltr inputMode="numeric" autoComplete="off" autoFocus value={code}
          onChange={(event) => { setCode(event.target.value.replace(/\s/g, '')); key.current = newKey() }} hint="٨ أو ١٢ أو ١٣ أو ١٤ رقم. بيتسجّل للمنتج ده بس وبيتحفظ باسمك." className="[&_input]:h-bw-touch" />
        {correcting ? <Field label="سبب التعديل (٥ حروف على الأقل)" value={note} onChange={(event) => { setNote(event.target.value); key.current = newKey() }} className="[&_input]:h-bw-touch" /> : null}
        <label className="flex cursor-pointer items-start gap-3 rounded-bw-card border border-bw-line-field p-3 text-bw-body text-bw-ink">
          <input type="checkbox" className="mt-1 size-5" checked={same} onChange={(event) => setSame(event.target.checked)} />
          <span>العبوة اللي في إيدي هي نفس المنتج ده بالظبط: الماركة والنوع والحجم والعبوة.</span>
        </label>
        {barcodeError(submit.error) ? <Flash tone="danger">{barcodeError(submit.error)}</Flash> : null}
        <Button type="submit" size="touch" className="w-full" loading={submit.pending} disabled={!valid}>{correcting ? 'احفظ الباركود الجديد' : 'سجّل الباركود'}</Button>
      </form>
    </Sheet>
  )
}

interface CurrentPrice { id: string; amount: number; currency: string; compareAtAmount: number | null }

/** The storefront selling price of the product (authorized users only; the API enforces it). Affects future checkouts, never confirmed orders. */
export function PriceSheet({ line, onClose }: { line: DeskLine; onClose: () => void }) {
  const current = useApi<CurrentPrice>(`/commerce/prices/skus/${line.skuId}/current`)
  const [amount, setAmount] = React.useState('')
  const [saved, setSaved] = React.useState<number | null>(null)
  const save = useCommand((value: number) => api<CurrentPrice>(`/commerce/prices/skus/${line.skuId}/change`, { body: { amount: value } }))
  const missing = current.error?.status === 404
  const typed = /^\d+(\.\d{1,2})?$/.test(amount) && Number(amount) > 0 ? Number(amount) : null
  return (
    <Sheet title="سعر البيع في الموقع" onClose={onClose}>
      <form className="space-y-4" onSubmit={async (event) => {
        event.preventDefault()
        if (typed === null) return
        const result = await save.execute(typed)
        if (result) { setSaved(result.amount); current.reload() }
      }}>
        <div><p className="text-bw-body font-semibold text-bw-ink"><bdi>{productTitle(line)}</bdi></p><p className="text-bw-small text-bw-ink-soft"><bdi>{productMeta(line)}</bdi></p></div>
        {current.loading && !current.data ? <p className="text-bw-small text-bw-ink-soft">بنقرا السعر الحالي…</p> : null}
        {current.data ? <p className="text-bw-small text-bw-ink-soft">السعر الحالي: <strong className="tabular-nums text-bw-ink" dir="ltr">{current.data.amount} {current.data.currency}</strong></p> : null}
        {missing ? <Flash tone="warn">مفيش سعر بيع شغّال للمنتج ده. حدّده من الأدمن.</Flash> : current.error ? <Flash tone="danger">{current.error.message}</Flash> : null}
        <Field label="السعر الجديد · ج.م" ltr inputMode="decimal" autoComplete="off" value={amount} onChange={(event) => { setAmount(event.target.value.replace(/[^\d.]/g, '')); setSaved(null) }} className="[&_input]:h-bw-touch" />
        <p className="rounded-bw-field bg-bw-sunken/60 px-3 py-2 text-[12px] text-bw-ink-soft">السعر الجديد بيسري على أي طلب جديد وعلى العربات اللي لسه ماكملتش الدفع. الطلبات المؤكدة، ومنها اللي بتتجهز دلوقتي، بتفضل بسعرها.</p>
        {saved !== null ? <Flash tone="ok">اتحفظ السعر الجديد: {saved} ج.م</Flash> : null}
        {save.error ? <Flash tone="danger">{save.error.message}</Flash> : null}
        <Button type="submit" size="touch" className="w-full" loading={save.pending} disabled={typed === null || missing}>احفظ السعر الجديد</Button>
      </form>
    </Sheet>
  )
}

export type { DeskOrder }

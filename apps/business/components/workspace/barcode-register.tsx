'use client'

import * as React from 'react'
import { Button, Code, Field, Select as BwSelect } from '@/components/bw/primitives'
import { Flash } from '@/components/bw/ops'
import { ApiError, api, newKey } from '@/lib/api'
import { useCommand } from '@/lib/use-api'

export interface RegisterLine { skuId: string; productName: string | null; brandName: string | null; variantName: string | null; barcode: string | null }
export const CHECKS = [['brand', 'الماركة'], ['variant', 'النوع'], ['size', 'الحجم'], ['pack', 'العبوة']] as const

/** What each refusal of the registration means for the person at the desk. Nothing was saved in any of these cases. */
const REFUSAL: Record<string, string> = {
  INVALID_BARCODE: 'الرقم ده مش باركود صحيح (غالباً رقم ناقص أو غلط). اقرأه تاني من العبوة أو امسحه بالماسح.',
  WRONG_ITEM: 'المنتج ده مش في الطلب ده.',
  BARCODE_ALREADY_USED: 'الباركود ده متسجّل لمنتج تاني في الكتالوج. مايتسجّلش تاني؛ لو العبوة جديدة اطلب مراجعة الكتالوج.',
  SKU_ALREADY_HAS_BARCODE: 'المنتج ده ليه باركود متسجّل خلاص. باركود مختلف لنفس المنتج بيتراجع من الكتالوج.',
  CHECKS_INCOMPLETE: 'لازم تتأكد من الماركة والنوع والحجم والعبوة كلهم قبل التسجيل.',
  ORDER_NOT_OPEN: 'الطلب ده اتلغى أو اتقفل.',
}

/**
 * Registers the barcode a product is missing, after the person physically compared the exact pack with the order line (brand, variant,
 * size, pack). The server refuses mistyped codes, codes that belong to another product and products that already have a code; every
 * outcome is on the order's audit trail. Only products that have no barcode yet can be registered here.
 */
export function BarcodeRegisterForm({ orderId, hubId, lines, initialCode, initialSkuId, onRegistered, onCancel }: {
  orderId: string; hubId: string; lines: RegisterLine[]; initialCode: string; initialSkuId?: string
  onRegistered: (result: { barcode: string; order: unknown }) => void; onCancel: () => void
}) {
  const eligible = lines.filter((line) => !line.barcode)
  const [skuId, setSkuId] = React.useState(initialSkuId && eligible.some((l) => l.skuId === initialSkuId) ? initialSkuId : eligible[0]?.skuId ?? '')
  const [code, setCode] = React.useState(initialCode)
  const [note, setNote] = React.useState('')
  const [checks, setChecks] = React.useState<string[]>([])
  const key = React.useRef(newKey())
  const register = useCommand((body: Record<string, unknown>) => api<{ registered: boolean; barcode: string; order: unknown }>(`/fulfillment/locations/${hubId}/desk/orders/${orderId}/register-barcode`, { body }))
  const line = eligible.find((l) => l.skuId === skuId) ?? null
  const refusal = (register.error as ApiError | null)?.code ? REFUSAL[(register.error as ApiError).code!] : null

  if (eligible.length === 0) {
    return (
      <div className="space-y-3 rounded-bw-field border border-bw-line p-3">
        <Flash tone="warn">كل أصناف الطلب ده ليها باركود متسجّل، فالباركود ده مش بتاع أي صنف ناقص. رجّع القطعة مكانها، أو لو العبوة اتغيّرت اطلب مراجعة الكتالوج.</Flash>
        <Button variant="secondary" size="sm" onClick={onCancel}>إغلاق</Button>
      </div>
    )
  }
  const reset = () => { key.current = newKey() }
  return (
    <form className="space-y-3 rounded-bw-field border border-bw-line p-3" onSubmit={async (event) => {
      event.preventDefault()
      const result = await register.execute({ clientScanId: key.current, skuId, barcode: code.trim(), checks, note: note.trim() })
      if (result?.registered) onRegistered({ barcode: result.barcode, order: result.order })
    }}>
      <p className="text-bw-small font-semibold text-bw-ink">تسجيل باركود ناقص</p>
      <p className="text-[12px] text-bw-ink-soft">الباركود بيتسجّل لمنتج واحد بس، بعد ما تقارن العبوة اللي في إيدك بالصنف. بيتسجّل باسمك وبيفضل في السجل.</p>
      <BwSelect label="العبوة دي هي أنهي صنف في الطلب؟" value={skuId} onChange={(event) => { setSkuId(event.target.value); reset() }}
        options={eligible.map((l) => ({ value: l.skuId, label: [l.productName, l.brandName, l.variantName].filter(Boolean).join(' · ') }))} />
      <Field label="الباركود على العبوة" ltr inputMode="numeric" autoComplete="off" value={code} onChange={(event) => { setCode(event.target.value.replace(/\s/g, '')); reset() }}
        hint="٨ أو ١٢ أو ١٣ أو ١٤ رقم. تقدر تمسحه بالماسح هنا." />
      <fieldset className="space-y-1 text-bw-small">
        <legend className="mb-1 font-semibold">اتأكدت إن العبوة مطابقة تماماً من:</legend>
        <div className="flex flex-wrap gap-3">
          {CHECKS.map(([value, text]) => (
            <label key={value} className="flex items-center gap-1">
              <input type="checkbox" checked={checks.includes(value)} onChange={(event) => { setChecks(event.target.checked ? [...checks, value] : checks.filter((c) => c !== value)); reset() }} />
              {text}{line && value === 'brand' && line.brandName ? <span className="text-bw-ink-soft"> (<bdi>{line.brandName}</bdi>)</span> : null}
              {line && value === 'variant' && line.variantName ? <span className="text-bw-ink-soft"> (<bdi>{line.variantName}</bdi>)</span> : null}
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="ليه الباركود مش متسجّل؟ وإيه اللي قارنته؟ (٥ حروف على الأقل)" value={note} onChange={(event) => { setNote(event.target.value); reset() }} />
      {refusal ? <Flash tone="danger">{refusal}</Flash> : register.error ? <Flash tone="danger">{register.error.message}{register.error.code ? <> · <Code>{register.error.code}</Code></> : null}</Flash> : null}
      <div className="flex gap-2">
        <Button type="submit" loading={register.pending} disabled={!skuId || !code.trim() || checks.length !== CHECKS.length || note.trim().length < 5}>تسجيل الباركود</Button>
        <Button type="button" variant="secondary" onClick={onCancel}>إلغاء</Button>
      </div>
    </form>
  )
}

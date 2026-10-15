'use client'

import * as React from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { api, ApiError } from '@/lib/api'
import { code128B } from '@/lib/code128'

interface Documents {
  shipmentId: string; orderNumber: string; currency: string
  customerReceipt: {
    orderNumber: string; orderedAt: string; subtotal: number; discountTotal: number | null; shippingFee: number; total: number; codDue: number
    lines: Array<{ name: string | null; variant: string | null; skuCode: string | null; quantity: number; unitPrice: number; discount: number | null; lineTotal: number }>
  }
  shippingSlip: {
    barcode: string; orderNumber: string; recipientName: string; recipientPhone: string; governorate: string | null; area: string | null
    address: string; deliveryNotes: string | null; codDue: number; packageCount: number; itemCount: number
  }
}

/** Amount: the number is an LTR isolate, the currency word stays Arabic text beside it. */
const egp = (n: number) => <><bdi className="ltr">{n.toLocaleString('en-US', { maximumFractionDigits: 2 })}</bdi> ج.م</>

/**
 * Code 128 printed along the paper (rotated): at 0.25 mm per module (2 dots on a 203 dpi head) a
 * shipment code is ~94 mm long, wider than the 72 mm printable width, so it runs down the slip.
 * Bars are drawn horizontally; the scanner reads it like any Code 128 label.
 */
const MODULE_MM = 0.25
function Barcode({ value }: { value: string }) {
  const widths = code128B(value)
  const quiet = 10
  const total = widths.reduce((a, b) => a + b, 0) + quiet * 2
  let y = quiet
  const bars: React.ReactNode[] = []
  widths.forEach((w, i) => {
    if (i % 2 === 0) bars.push(<rect key={i} x={0} y={y} width={40} height={w} fill="black" />)
    y += w
  })
  return (
    <svg viewBox={`0 0 40 ${total}`} width="40mm" height={`${total * MODULE_MM}mm`} preserveAspectRatio="none" role="img" aria-label={value}
      shapeRendering="crispEdges" style={{ display: 'block', margin: '0 auto' }}>
      <rect width={40} height={total} fill="white" />
      {bars}
    </svg>
  )
}

/**
 * 80 mm thermal output (72 mm printable). `doc=receipt` goes inside the parcel; `doc=slip` is the
 * external shipping slip. Opening this page is a preview — the operator confirms the paper result.
 */
function PrintDocument() {
  const { shipmentId } = useParams<{ shipmentId: string }>()
  const params = useSearchParams()
  const doc = params.get('doc') === 'slip' ? 'slip' : 'receipt'
  const autoPrint = params.get('preview') !== '1'
  const [data, setData] = React.useState<Documents | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    api<Documents>(`/fulfillment/shipments/${shipmentId}/documents`)
      .then(setData)
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : String(e)))
  }, [shipmentId])

  React.useEffect(() => {
    if (!data || !autoPrint) return
    const id = window.setTimeout(() => window.print(), 400)
    return () => window.clearTimeout(id)
  }, [data, autoPrint])

  return (
    <>
      <style>{`
        @page { size: 80mm auto; margin: 0; }
        html, body { background: white !important; color: black !important; margin: 0; }
        .thermal { width: 72mm; margin: 0 auto; padding: 3mm 0; font-family: var(--font-plex-sans-arabic), sans-serif; font-size: 11pt; line-height: 1.35; color: black; }
        .thermal h1 { font-size: 14pt; margin: 0 0 2mm; text-align: center; }
        .thermal .row { display: flex; justify-content: space-between; gap: 2mm; }
        .thermal .rule { border-top: 1px dashed black; margin: 2mm 0; }
        .thermal .big { font-size: 15pt; font-weight: 700; }
        .thermal .ltr { direction: ltr; unicode-bidi: isolate; font-variant-numeric: tabular-nums; }
        .screen-only { text-align: center; padding: 8px; font-family: sans-serif; }
        @media print { .screen-only { display: none; } }
      `}</style>
      <div className="screen-only">
        <button type="button" onClick={() => window.print()} style={{ padding: '8px 16px', border: '1px solid black', borderRadius: 999, background: 'white' }}>اطبع</button>
        <p style={{ fontSize: 12 }}>معاينة — أكّد نتيجة الورق في شاشة التغليف بعد الطباعة.</p>
      </div>
      {error ? <p className="screen-only" role="alert">مقدرناش نجيب بيانات الطباعة: {error}</p> : null}
      {data && doc === 'receipt' ? (
        <div className="thermal">
          <h1>شينا كير</h1>
          <div className="row"><span>طلب</span><span className="ltr">{data.customerReceipt.orderNumber}</span></div>
          <div className="row"><span>التاريخ</span><span className="ltr">{new Date(data.customerReceipt.orderedAt).toLocaleDateString('en-GB')}</span></div>
          <div className="rule" />
          {data.customerReceipt.lines.map((l, i) => (
            <div key={i} style={{ marginBottom: '1.5mm' }}>
              <div><bdi>{l.name ?? l.skuCode}</bdi>{l.variant ? <> · <bdi>{l.variant}</bdi></> : null}</div>
              <div className="row"><span><bdi className="ltr">{l.quantity} ×</bdi> {egp(l.unitPrice)}</span><span>{egp(l.lineTotal)}</span></div>
            </div>
          ))}
          <div className="rule" />
          <div className="row"><span>المنتجات</span><span>{egp(data.customerReceipt.subtotal)}</span></div>
          {data.customerReceipt.discountTotal ? <div className="row"><span>وفّرت (من السعر قبل الخصم)</span><span>{egp(data.customerReceipt.discountTotal)}</span></div> : null}
          <div className="row"><span>التوصيل</span><span>{egp(data.customerReceipt.shippingFee)}</span></div>
          <div className="row big"><span>الإجمالي</span><span>{egp(data.customerReceipt.total)}</span></div>
          <div className="row"><span>المطلوب عند الاستلام</span><span>{egp(data.customerReceipt.codDue)}</span></div>
          <div className="rule" />
          <p style={{ textAlign: 'center', margin: 0 }}>شكراً لاختيارك شينا كير</p>
        </div>
      ) : null}
      {data && doc === 'slip' ? (
        <div className="thermal">
          <h1>بوليصة شحن</h1>
          <Barcode value={data.shippingSlip.barcode} />
          <p className="ltr" style={{ textAlign: 'center', margin: '1mm 0', fontWeight: 700 }}>{data.shippingSlip.barcode}</p>
          <div className="rule" />
          <div className="row"><span>طلب</span><span className="ltr">{data.shippingSlip.orderNumber}</span></div>
          <div className="big">{data.shippingSlip.recipientName}</div>
          <div className="ltr" style={{ textAlign: 'start' }}>{data.shippingSlip.recipientPhone}</div>
          <div>{[data.shippingSlip.address, data.shippingSlip.area, data.shippingSlip.governorate].filter(Boolean).join('، ')}</div>
          {data.shippingSlip.deliveryNotes ? <div>ملاحظات: {data.shippingSlip.deliveryNotes}</div> : null}
          <div className="rule" />
          <div className="row big"><span>تحصيل</span><span>{egp(data.shippingSlip.codDue)}</span></div>
          <div className="row"><span>عدد الطرود</span><span className="ltr">{data.shippingSlip.packageCount}</span></div>
          <div className="row"><span>عدد القطع</span><span className="ltr">{data.shippingSlip.itemCount}</span></div>
        </div>
      ) : null}
    </>
  )
}

export default function PrintPage() {
  return (
    <React.Suspense fallback={null}>
      <PrintDocument />
    </React.Suspense>
  )
}

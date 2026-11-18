'use client'

import * as React from 'react'
import {
  Barcode,
  CheckCircle2,
  Clock,
  Package,
  QrCode,
  Scan,
  ShieldCheck,
  Sparkles,
  Truck,
  X,
} from 'lucide-react'
import { Button, Code, Notice, Skeleton, StatusLabel } from '@/components/bw/primitives'
import { api } from '@/lib/api'
import { getDevShipmentBarcode } from '@/lib/dev-barcode'
import { shortId } from '@/lib/labels'
import { cn } from '@/lib/utils'

export interface ContinuousScanStop {
  sequence: number
  shipmentId: string
  orderNumber?: string | null
  recipientName?: string | null
  area?: string | null
  address?: string | null
  handedOver: boolean
}

export interface ContinuousHandoffModalProps {
  runId: string
  runTitle?: string
  driverName?: string
  isOpen: boolean
  onClose: () => void
  onComplete?: () => void
}

export function ContinuousHandoffModal({
  runId,
  runTitle,
  driverName,
  isOpen,
  onClose,
  onComplete,
}: ContinuousHandoffModalProps) {
  const [stops, setStops] = React.useState<ContinuousScanStop[]>([])
  const [loading, setLoading] = React.useState(true)
  const [barcodeInput, setBarcodeInput] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const [feedback, setFeedback] = React.useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const inputRef = React.useRef<HTMLInputElement | null>(null)

  // Fetch batch details and stops
  const loadBatchStops = React.useCallback(async () => {
    try {
      setLoading(true)
      const data = await api<{
        stops: Array<{
          sequence: number
          shipmentId: string
          orderNumber: string | null
          area: string | null
          handedOver: boolean
        }>
      }>(`/fulfillment/delivery-batches/${runId}`)
      if (data?.stops) {
        setStops(data.stops)
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'تعذر تحميل بيانات المشوار' })
    } finally {
      setLoading(false)
    }
  }, [runId])

  React.useEffect(() => {
    if (isOpen) {
      loadBatchStops()
      setFeedback(null)
      setBarcodeInput('')
      setTimeout(() => inputRef.current?.focus(), 150)
    }
  }, [isOpen, loadBatchStops])

  const totalStops = stops.length
  const handedOverCount = stops.filter((s) => s.handedOver).length
  const allComplete = totalStops > 0 && handedOverCount === totalStops

  // Process barcode scan
  const handleScanBarcode = async (codeToScan: string) => {
    const rawCode = codeToScan.trim()
    if (!rawCode) return

    try {
      setSubmitting(true)
      setFeedback(null)

      const result = await api<{
        success: boolean
        shipmentId: string
        orderId: string
        alreadyScanned: boolean
        totalStops: number
        scannedStopsCount: number
        isComplete: boolean
      }>(`/fulfillment/delivery-batches/${runId}/handoff-scan`, {
        method: 'POST',
        body: { barcode: rawCode },
      })

      if (result.success) {
        // Update local state immediately
        setStops((prev) =>
          prev.map((s) => (s.shipmentId === result.shipmentId ? { ...s, handedOver: true } : s))
        )

        if (result.alreadyScanned) {
          setFeedback({
            type: 'success',
            message: 'تم استلام هذا الطرد مسبقاً في عهدة الجولة.',
          })
        } else {
          setFeedback({
            type: 'success',
            message: `تم التحقق بنجاح! الطرد في العهدة (${result.scannedStopsCount} من ${result.totalStops}).`,
          })
        }

        setBarcodeInput('')

        if (result.isComplete && onComplete) {
          onComplete()
        }
      }
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err?.message || 'الباركود الممسوح غير متطابق مع أي طرد في هذا المشوار.',
      })
    } finally {
      setSubmitting(false)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }

  // Quick dev barcode simulator
  const handleDevScan = async (shipmentId: string) => {
    const barcode = await getDevShipmentBarcode(shipmentId)
    if (barcode) {
      await handleScanBarcode(barcode)
    }
  }

  if (!isOpen) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="continuous-scan-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-bw-kohl/70 backdrop-blur-xs animate-in fade-in"
    >
      <div className="relative flex flex-col w-full max-w-lg max-h-[92vh] sm:max-h-[85vh] bg-bw-surface text-bw-ink rounded-t-bw-overlay sm:rounded-bw-overlay border border-bw-line shadow-bw-overlay overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-bw-line p-4">
          <div className="flex items-center gap-2.5">
            <div className="grid size-9 place-items-center rounded-lg bg-bw-cobalt/10 border border-bw-cobalt/30 text-bw-cobalt">
              <Scan className="size-5" />
            </div>
            <div>
              <h2 id="continuous-scan-title" className="font-bold text-sm text-bw-ink flex items-center gap-2">
                <span>مسح تسليم الطرود المتواصل</span>
                <span className="font-mono text-xs text-bw-ink-soft">#{shortId(runId)}</span>
              </h2>
              <p className="text-xs text-bw-ink-soft">
                {driverName ? `المندوب: ${driverName}` : (runTitle || 'استلام طرود المشوار بالباركود')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-bw-field p-1.5 text-bw-ink-soft hover:bg-bw-sunken hover:text-bw-ink transition-colors cursor-pointer"
            aria-label="إغلاق نافذة المسح"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Progress Bar & Counter */}
        <div className="bg-bw-sunken/40 border-b border-bw-line px-4 py-3 space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold">
            <span className="flex items-center gap-1.5 text-bw-ink">
              <Package className="size-3.5 text-bw-cobalt" />
              <span>إجمالي الاستلام:</span>
            </span>
            <span className={cn('font-mono', allComplete ? 'text-bw-ok font-bold' : 'text-bw-ink')}>
              {handedOverCount} / {totalStops} طرد
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-bw-sunken">
            <div
              className={cn(
                'h-full transition-all duration-300',
                allComplete ? 'bg-bw-ok' : 'bg-bw-cobalt'
              )}
              style={{ width: `${totalStops ? (handedOverCount / totalStops) * 100 : 0}%` }}
            />
          </div>
          {allComplete ? (
            <div className="flex items-center gap-2 rounded-bw-field bg-bw-ok/10 border border-bw-ok/30 px-2.5 py-1.5 text-xs text-bw-ok font-semibold">
              <Sparkles className="size-4 shrink-0" />
              <span>اكتمل استلام جميع طرود المشوار بنجاح! جاهز للانطلاق.</span>
            </div>
          ) : (
            <p className="text-[11px] text-bw-ink-subtle">
              وجّه قارئ الباركود نحو كل طرد بالترتيب أو ادخل الباركود يدوياً.
            </p>
          )}
        </div>

        {/* Barcode Scanner Input Form */}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleScanBarcode(barcodeInput)
          }}
          className="border-b border-bw-line p-4 bg-bw-surface space-y-2"
        >
          <div className="relative flex items-center gap-2">
            <div className="relative flex-1">
              <input
                ref={inputRef}
                type="text"
                value={barcodeInput}
                onChange={(e) => setBarcodeInput(e.target.value)}
                placeholder="امسح أو اكتب الباركود (e.g. SHP-XXXXXXXX)..."
                disabled={submitting || allComplete}
                className="w-full rounded-bw-field border border-bw-line bg-bw-surface px-3 py-2 text-xs font-mono text-bw-ink placeholder:text-bw-ink-subtle focus:border-bw-cobalt focus:outline-hidden disabled:opacity-50"
                autoComplete="off"
                autoFocus
              />
              <Barcode className="absolute end-2.5 top-1/2 -translate-y-1/2 size-4 text-bw-ink-subtle pointer-events-none" />
            </div>
            <Button
              type="submit"
              size="sm"
              loading={submitting}
              disabled={!barcodeInput.trim() || submitting || allComplete}
              className="text-xs shrink-0"
            >
              مسح
            </Button>
          </div>

          {feedback ? (
            <div
              className={cn(
                'rounded-bw-field px-3 py-2 text-xs flex items-center gap-2 transition-all',
                feedback.type === 'success'
                  ? 'bg-bw-ok/10 border border-bw-ok/30 text-bw-ok'
                  : 'bg-bw-danger/10 border border-bw-danger/30 text-bw-danger'
              )}
            >
              {feedback.type === 'success' ? (
                <CheckCircle2 className="size-3.5 shrink-0" />
              ) : (
                <X className="size-3.5 shrink-0" />
              )}
              <span className="flex-1">{feedback.message}</span>
            </div>
          ) : null}
        </form>

        {/* Parcel Stops Checklist */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full rounded-bw-field" />
              <Skeleton className="h-12 w-full rounded-bw-field" />
              <Skeleton className="h-12 w-full rounded-bw-field" />
            </div>
          ) : stops.length === 0 ? (
            <div className="text-center py-6 text-xs text-bw-ink-soft">
              لا توجد طرود مسندة لهذا المشوار حالياً.
            </div>
          ) : (
            stops.map((stop) => {
              const orderNum = stop.orderNumber ? stop.orderNumber.replace(/^ORD-/, '#') : shortId(stop.shipmentId)

              return (
                <div
                  key={stop.shipmentId}
                  className={cn(
                    'flex items-center justify-between gap-3 rounded-bw-card border p-2.5 transition-all',
                    stop.handedOver
                      ? 'border-bw-ok/40 bg-bw-ok/5'
                      : 'border-bw-line bg-bw-surface hover:border-bw-ink-soft/40'
                  )}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className={cn(
                        'grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold border',
                        stop.handedOver
                          ? 'bg-bw-ok/20 text-bw-ok border-bw-ok/40'
                          : 'bg-bw-sunken text-bw-ink-soft border-bw-line'
                      )}
                    >
                      {stop.handedOver ? <CheckCircle2 className="size-4" /> : stop.sequence}
                    </span>

                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-xs text-bw-ink">
                          <Code>{orderNum}</Code>
                        </span>
                        {stop.handedOver ? (
                          <StatusLabel tone="ok">في العهدة</StatusLabel>
                        ) : (
                          <span className="text-[11px] text-bw-warn font-medium flex items-center gap-1">
                            <Clock className="size-3" /> بانتظار المسح
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-bw-ink-soft truncate">
                        {[stop.area, stop.address].filter(Boolean).join(' · ') || 'عنوان العميل'}
                      </p>
                    </div>
                  </div>

                  {/* Dev mode simulation button */}
                  {!stop.handedOver && process.env.NODE_ENV !== 'production' ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => handleDevScan(stop.shipmentId)}
                      disabled={submitting}
                      className="text-[11px] px-2 py-1 shrink-0"
                    >
                      مسح تجريبي
                    </Button>
                  ) : null}
                </div>
              )
            })
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-bw-line p-3 bg-bw-surface flex items-center justify-between gap-2">
          <span className="text-[11px] text-bw-ink-subtle">
            {allComplete ? 'جميع الطرود مكتملة' : `متبقي ${totalStops - handedOverCount} طرود`}
          </span>
          <Button
            type="button"
            variant={allComplete ? 'primary' : 'secondary'}
            size="sm"
            onClick={onClose}
            className="text-xs"
          >
            {allComplete ? 'إتمام ومتابعة' : 'إغلاق'}
          </Button>
        </div>
      </div>
    </div>
  )
}

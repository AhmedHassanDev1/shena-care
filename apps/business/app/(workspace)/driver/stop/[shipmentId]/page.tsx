'use client'

import * as React from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import {
  AlertCircle,
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronRight,
  Clock,
  Coins,
  MapPin,
  MessageCircle,
  Navigation,
  Package,
  Phone,
  UserRound,
  XCircle,
} from 'lucide-react'
import {
  Button,
  Code,
  Dialog,
  Field,
  Notice,
  Section,
  Skeleton,
  StateBlock,
  useDialog,
} from '@/components/bw/primitives'
import { useToast, useToastLift } from '@/components/bw/toast'
import { CameraScanner } from '@/components/workspace/camera-scanner'
import { CopyId } from '@/components/workspace/copy-id'
import { CommandError, Egp, TextArea } from '@/components/workspace/kit'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { api } from '@/lib/api'
import {
  formatNavigationUrl,
  formatPhoneUrl,
  formatWhatsAppUrl,
  setActiveDeliveryStopId,
  useActiveDeliveryStop,
} from '@/lib/courier-actions'
import {
  FAILURE_REASONS,
  INSTRUCTION_REASONS,
  shortId,
} from '@/lib/labels'
import { useApi, useCommand } from '@/lib/use-api'
import { cn } from '@/lib/utils'
import type { DriverRun, DriverStop } from '../../page'

/**
 * Quick visual reasons tailored for mobile couriers:
 * High-visibility icons and short, clear Arabic phrases.
 */
const QUICK_REASONS = [
  { code: 'CUSTOMER_UNREACHABLE', icon: '📵', label: 'العميل لا يرد / مغلق' },
  { code: 'CUSTOMER_NOT_FOUND', icon: '🏠', label: 'العميل مش متواجد' },
  { code: 'ITEM_MISMATCH', icon: '📦', label: 'رفض الاستلام / غير مطابق' },
  { code: 'ADDRESS_NOT_FOUND', icon: '📍', label: 'العنوان خطأ أو غير واضح' },
  { code: 'RESCHEDULE_REQUESTED', icon: '⏰', label: 'طلب تأجيل الميعاد' },
  { code: 'OTHER', icon: '✏️', label: 'سبب آخر (اكتب ملاحظة)' },
]

/**
 * Driver Stop Details — تفاصيل المحطة والطلب
 * Designed specifically for one-handed courier operation on mobile:
 * - Huge phone, WhatsApp, and navigation action cards
 * - "جاري توصيله حالياً" animated live indicator triggered when clicking Map
 * - Huge high-contrast cash collection box
 * - Exactly two primary outcomes: "تم التسليم" and "تعذر التسليم"
 */
export default function DriverStopPage() {
  const { shipmentId } = useParams<{ shipmentId: string }>()
  // Polled like the trips list: the delivered / failed buttons appear the moment the hub releases the run,
  // without the courier having to reload the page.
  const { data, error, loading, reload } = useApi<DriverRun[]>('/fulfillment/driver/runs', { pollMs: 8000 })

  const run = data?.find((r) => r.stops.some((s) => s.shipmentId === shipmentId))
  const stop = run?.stops.find((s) => s.shipmentId === shipmentId)

  return (
    <RoleShell role="driver" active="run" mode="mobile">
      <div className="space-y-3.5 p-3 sm:p-4 pb-28 max-w-lg mx-auto">
        {/* Navigation back to trips */}
        <div className="flex items-center justify-between">
          <Link
            href="/driver"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-bw-ink-soft hover:text-bw-ink transition-colors p-1"
          >
            <ChevronRight className="size-4" aria-hidden />
            <span>العودة للمشوار {run ? <Code>#{shortId(run.id)}</Code> : ''}</span>
          </Link>
          {stop ? (
            <span className="text-xs text-bw-ink-subtle">
              محطة <Code>{stop.sequence}</Code> من <Code>{run?.stops.length}</Code>
            </span>
          ) : null}
        </div>

        {error ? <LoadError message={error.message} onRetry={reload} /> : null}
        {!data && loading ? <Skeleton className="h-64 w-full rounded-2xl" /> : null}
        {data && !stop ? (
          <StateBlock
            kind="forbidden"
            title="الطرد ده مش في مشوارك"
            body="تقدر تشوف بس الطرود والمحطات المتعيّنة ليك حالياً."
          />
        ) : null}

        {run && stop ? (
          <StopOperationalBody runStatus={run.status} stop={stop} onChanged={reload} />
        ) : null}
      </div>
    </RoleShell>
  )
}

function StopOperationalBody({
  runStatus,
  stop,
  onChanged,
}: {
  runStatus: string
  stop: DriverStop
  onChanged: () => void
}) {
  const [activeDeliveryId, setActiveId] = useActiveDeliveryStop()
  const isActiveDelivery = activeDeliveryId === stop.shipmentId

  const isStopActive = stop.attemptStatus === 'active'
  const isDelivered = stop.status === 'delivered' || stop.attemptStatus === 'delivered'
  const isFailed = stop.status === 'failed' || stop.attemptStatus === 'failed'

  const toast = useToast()

  // Communication & navigation link targets
  const fullAddress = [stop.address, stop.area, stop.governorate].filter(Boolean).join('، ')
  const phoneUrl = formatPhoneUrl(stop.recipientPhone)
  const whatsAppUrl = formatWhatsAppUrl(stop.recipientPhone)
  const navResult = formatNavigationUrl(stop.location, fullAddress)

  // Start navigation & activate "Currently delivering" status with animation
  // The map always opens (it is a plain link). The stop only becomes "currently delivering" once the server
  // accepted it, and a refusal is said out loud instead of being swallowed.
  const handleStartNavigation = () => {
    if (isDelivered || isFailed) return
    if (!stop.handedOver) {
      toast.warning('امسح باركود الطرد الأول عشان يتسجل في عهدتك، وبعدها ابدأ التوصيل')
      return
    }
    if (runStatus !== 'dispatched') {
      toast.warning('المشوار لسه ماخرجش. امسح باقي طرود المشوار وهيخرج تلقائياً، ولو كلها اتمسحت كلّم المخزن')
      return
    }
    if (stop.status === 'out_for_delivery') {
      setActiveId(stop.shipmentId)
      return
    }
    api(`/fulfillment/shipments/${stop.shipmentId}/events`, {
      body: { type: 'OUT_FOR_DELIVERY' },
    })
      .then(() => {
        setActiveId(stop.shipmentId)
        toast.success('تم تفعيل المشوار: أنت في الطريق للعميل الآن 🚗')
        onChanged()
      })
      .catch((err: unknown) => {
        toast.error(err instanceof Error && err.message ? err.message : 'تعذر تسجيل بدء التوصيل، حاول مرة تانية')
      })
  }

  return (
    <div className="space-y-3">
      {/* ── Live In-Progress Delivery Motion Banner ── */}
      {isActiveDelivery && !isDelivered && !isFailed && (
        <div className="relative overflow-hidden rounded-2xl border-2 border-emerald-500/80 bg-gradient-to-r from-emerald-950/70 via-emerald-900/50 to-emerald-950/70 p-4 shadow-[0_0_24px_rgba(16,185,129,0.25)] ring-1 ring-emerald-400/40 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className="relative flex size-3.5 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-80" />
                <span className="relative inline-flex rounded-full size-3.5 bg-emerald-500" />
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm text-emerald-300">جاري التوصيل للعميل الآن</span>
                  <span className="text-[10px] font-bold bg-emerald-500/25 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-500/50">
                    المحطة النشطة 🚗
                  </span>
                </div>
                <p className="text-xs text-emerald-200/80 truncate mt-0.5">
                  مسار الخريطة مفعل — متوجه إلى {stop.recipientName}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setActiveId(null)}
              className="text-[11px] font-semibold text-emerald-200/70 hover:text-white bg-emerald-900/70 rounded-full px-2.5 py-1 border border-emerald-500/40 cursor-pointer shrink-0"
            >
              إلغاء التحديد
            </button>
          </div>
        </div>
      )}

      {/* ── 1. Customer & Address Primary Card ── */}
      <section className="rounded-2xl border border-bw-line bg-bw-surface p-4 space-y-3 shadow-bw-card">
        {/* Customer Header */}
        <div className="flex items-start justify-between gap-2 border-b border-bw-line/70 pb-3">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <UserRound className="size-5 text-bw-ink-soft shrink-0" aria-hidden />
              <h1 className="text-lg font-bold text-bw-ink truncate">{stop.recipientName}</h1>
            </div>
            <div className="flex items-center gap-2 text-xs text-bw-ink-soft">
              <span className="font-mono text-xs">#{stop.orderNumber.replace(/^ORD-/, '').slice(0, 8)}</span>
              <CopyId value={stop.orderNumber} muted className="text-[11px]" />
              <span>·</span>
              <span><Code>{stop.itemCount}</Code> قطع</span>
            </div>
          </div>

          <div className="shrink-0 text-end">
            {isDelivered ? (
              <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/30">
                <CheckCircle2 className="size-3.5" aria-hidden />
                تم التسليم
              </span>
            ) : isFailed ? (
              <span className="inline-flex items-center gap-1 text-xs font-bold text-rose-400 bg-rose-500/10 px-2.5 py-1 rounded-full border border-rose-500/30">
                <AlertCircle className="size-3.5" aria-hidden />
                تعذر التسليم
              </span>
            ) : stop.handedOver ? (
              <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/30">
                <Package className="size-3.5" aria-hidden />
                في عهدتك
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded-full border border-amber-500/30">
                <Clock className="size-3.5" aria-hidden />
                لم يُستلم بعد
              </span>
            )}
          </div>
        </div>

        {/* Delivery Address */}
        <div className="space-y-1">
          <span className="text-[11px] text-bw-ink-subtle flex items-center gap-1 font-medium">
            <MapPin className="size-3.5 text-bw-ink-subtle" aria-hidden />
            عنوان التوصيل
          </span>
          <p className="text-sm font-semibold text-bw-ink leading-relaxed">
            {fullAddress || 'لا يوجد عنوان مسجل'}
          </p>
          {stop.deliveryNotes ? (
            <div className="rounded-xl bg-amber-500/10 border border-amber-500/25 p-2.5 text-xs text-amber-300 flex items-start gap-2 mt-2">
              <span className="font-bold text-amber-400 shrink-0">ملاحظة:</span>
              <span className="leading-snug">{stop.deliveryNotes}</span>
            </div>
          ) : null}
        </div>

        {/* Operator instructions if any */}
        {stop.operatorInstruction ? (
          <Notice
            tone="warn"
            title={`توجيه من المخزن: ${INSTRUCTION_REASONS[stop.operatorInstruction.reason] ?? stop.operatorInstruction.reason}`}
          >
            {stop.operatorInstruction.note}
          </Notice>
        ) : null}

        {/* ── 2. Three Action Buttons (Call, WhatsApp, Map) ── */}
        <div className="grid grid-cols-3 gap-2 pt-1">
          {phoneUrl ? (
            <a
              href={phoneUrl}
              className="flex flex-col items-center justify-center gap-1 h-13 rounded-2xl border border-blue-500/25 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 active:scale-95 transition-all cursor-pointer shadow-sm"
            >
              <Phone className="size-4.5" aria-hidden />
              <span className="text-xs font-bold">اتصال</span>
            </a>
          ) : (
            <div className="flex flex-col items-center justify-center gap-1 h-13 rounded-2xl border border-bw-line bg-bw-sunken text-bw-ink-subtle cursor-not-allowed opacity-60">
              <Phone className="size-4.5" aria-hidden />
              <span className="text-xs font-medium">لا يوجد هاتف</span>
            </div>
          )}

          {whatsAppUrl ? (
            <a
              href={whatsAppUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col items-center justify-center gap-1 h-13 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 active:scale-95 transition-all cursor-pointer shadow-sm"
            >
              <MessageCircle className="size-4.5" aria-hidden />
              <span className="text-xs font-bold">واتساب</span>
            </a>
          ) : (
            <div className="flex flex-col items-center justify-center gap-1 h-13 rounded-2xl border border-bw-line bg-bw-sunken text-bw-ink-subtle cursor-not-allowed opacity-60">
              <MessageCircle className="size-4.5" aria-hidden />
              <span className="text-xs font-medium">لا يوجد واتساب</span>
            </div>
          )}

          {navResult.url ? (
            <a
              href={navResult.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleStartNavigation}
              className={cn(
                'flex flex-col items-center justify-center gap-1 h-13 rounded-2xl border active:scale-95 transition-all cursor-pointer shadow-sm',
                isActiveDelivery
                  ? 'border-emerald-500 bg-emerald-600 text-white shadow-[0_0_16px_rgba(16,185,129,0.35)] animate-pulse'
                  : 'border-bw-cobalt/40 bg-bw-cobalt text-white hover:bg-bw-cobalt-hover'
              )}
            >
              <Navigation className={cn('size-4.5', isActiveDelivery && 'animate-spin')} style={isActiveDelivery ? { animationDuration: '4s' } : undefined} aria-hidden />
              <span className="text-xs font-bold">{isActiveDelivery ? 'الخريطة مفعلة' : 'الطريق'}</span>
            </a>
          ) : (
            <div className="flex flex-col items-center justify-center gap-1 h-13 rounded-2xl border border-bw-line bg-bw-sunken text-bw-ink-subtle cursor-not-allowed opacity-60">
              <Navigation className="size-4.5" aria-hidden />
              <span className="text-xs font-medium">مافيش موقع</span>
            </div>
          )}
        </div>
      </section>

      {/* ── 3. Modern Sleek Payment Widget (Only shown when not yet delivered) ── */}
      {!isDelivered && (
        <section className="rounded-2xl border border-bw-line bg-gradient-to-b from-bw-surface to-bw-sunken/80 p-4 shadow-bw-card">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-bw-ink-soft flex items-center gap-1.5">
              <Coins className="size-4 text-emerald-400" aria-hidden />
              {stop.codDue > 0 ? 'التحصيل المطلوب' : 'حالة الدفع'}
            </span>
            {stop.codDue > 0 ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
                <span className="size-1.5 rounded-full bg-emerald-400" />
                استلام كاش نقدي
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-bw-cobalt/10 text-bw-cobalt border border-bw-cobalt/25">
                مدفوع أونلاين بالكامل
              </span>
            )}
          </div>

          <div className="mt-3 flex items-baseline justify-between border-t border-bw-line/60 pt-3">
            <div className="flex items-baseline gap-1.5">
              <span className="font-bw-display text-3xl font-black text-bw-ink tracking-tight">
                {stop.codDue > 0 ? stop.codDue : 0}
              </span>
              <span className="text-sm font-bold text-bw-ink-soft">ج.م</span>
            </div>

            {stop.codDue > 0 ? (
              <span className="text-[11px] text-bw-ink-subtle font-medium">
                تحصيل قبل تسليم الطرد
              </span>
            ) : (
              <span className="text-xs font-bold text-bw-cobalt">
                لا تستلم كاش من العميل
              </span>
            )}
          </div>
        </section>
      )}

      {/* ── 4. Contextual Delivery Actions ── */}

      {/* State A: Awaiting Pickup (Planning & Not Handed Over) */}
      {!stop.handedOver && (
        <HandoffAction stop={stop} onChanged={onChanged} />
      )}

      {/* State B: Received in Custody, but Run not yet dispatched */}
      {stop.handedOver && runStatus === 'planning' && (
        <section className="rounded-2xl border border-bw-emerald/25 bg-bw-emerald-soft p-4 space-y-2">
          <div className="flex items-center gap-2 text-bw-emerald font-semibold text-sm">
            <CheckCircle2 className="size-5 shrink-0" aria-hidden />
            <span>الطرد في عهدتك بنجاح</span>
          </div>
          <p className="text-xs text-bw-ink-soft leading-relaxed">
            تم تسجيل استلام الطرد في عهدتك. المشوار بيخرج تلقائياً أول ما تمسح كل طروده؛ ولو كلها اتمسحت وما خرجش، كلّم المخزن.
          </p>
          <p className="text-xs font-semibold text-bw-ink">
            أزرار «تم التسليم» و«تعذر التسليم» بتظهر هنا تلقائياً أول ما المشوار يخرج.
          </p>
        </section>
      )}

      {/* State C: Out for Delivery (Handed over, Run is dispatched & Attempt is active) */}
      {stop.handedOver && runStatus === 'dispatched' && isStopActive && stop.status !== 'failed' && (
        <DispatchedOutcomeAction stop={stop} onChanged={onChanged} />
      )}

      {/* State D: Failed Attempt Result */}
      {isFailed && (
        <section className="rounded-2xl border border-rose-500/25 bg-gradient-to-b from-rose-950/20 via-bw-surface to-bw-surface p-4 space-y-2 shadow-bw-card">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="size-8 rounded-full bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400">
                <AlertCircle className="size-4.5" aria-hidden />
              </span>
              <div>
                <h2 className="text-sm font-bold text-bw-ink">تعذر تسليم الطلب</h2>
                <p className="text-[11px] text-bw-ink-soft">الطرد في عهدتك للعودة للمخزن</p>
              </div>
            </div>
            <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-rose-500/15 text-rose-400 border border-rose-500/30">
              مرتجع عهدة
            </span>
          </div>
        </section>
      )}

      {/* State E: Successfully Delivered Result — Sleek unified modern receipt */}
      {isDelivered && (
        <section className="rounded-2xl border border-emerald-500/25 bg-gradient-to-b from-emerald-950/20 via-bw-surface to-bw-surface p-4 space-y-3.5 shadow-bw-card">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="size-8 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                <CheckCircle2 className="size-4.5" aria-hidden />
              </span>
              <div>
                <h2 className="text-sm font-bold text-bw-ink">تم التسليم بنجاح</h2>
                <p className="text-[11px] text-bw-ink-soft">المحطة مكتملة وبانتظار تسوية المخزن</p>
              </div>
            </div>
            <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
              مكتمل ✔
            </span>
          </div>

          {/* Clean Receipt Breakdown */}
          {stop.codDue > 0 ? (
            <div className="rounded-xl border border-bw-line/70 bg-bw-sunken/80 p-3 flex items-center justify-between text-xs">
              <div className="space-y-0.5">
                <span className="text-[10px] text-bw-ink-subtle block">المطلوب</span>
                <span className="font-bold text-bw-ink"><Egp value={stop.codDue} /></span>
              </div>

              <div className="space-y-0.5 text-center">
                <span className="text-[10px] text-bw-ink-subtle block">المحصل</span>
                <span className="font-bold text-emerald-400">
                  <Egp value={stop.cashDeclared ?? stop.codDue} />
                </span>
              </div>

              {stop.cashDeclared !== null && stop.cashDeclared < stop.codDue ? (
                <div className="space-y-0.5 text-end border-s border-bw-line ps-3">
                  <span className="text-[10px] text-rose-400 block font-medium">عجز مالي</span>
                  <span className="font-bold text-rose-400">
                    -<Egp value={stop.codDue - stop.cashDeclared} />
                  </span>
                </div>
              ) : (
                <div className="space-y-0.5 text-end border-s border-bw-line ps-3">
                  <span className="text-[10px] text-bw-ink-subtle block">الحالة</span>
                  <span className="font-semibold text-emerald-400">مسدد بالكامل</span>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-bw-line/70 bg-bw-sunken/80 px-3 py-2 flex items-center justify-between text-xs">
              <span className="text-bw-ink-soft">طلب مدفوع أونلاين</span>
              <span className="font-semibold text-bw-cobalt">لم يتم تحصيل كاش</span>
            </div>
          )}
        </section>
      )}
    </div>
  )
}

/**
 * Barcode Handoff Action (Pickup Custody).
 */
function HandoffAction({ stop, onChanged }: { stop: DriverStop; onChanged: () => void }) {
  const [code, setCode] = React.useState('')
  const [showCamera, setShowCamera] = React.useState(false)
  const toast = useToast()

  const scan = useCommand((barcode: string) =>
    api(`/fulfillment/shipments/${stop.shipmentId}/events`, {
      body: { type: 'HANDOFF_SCANNED', barcode: barcode.trim() },
    })
  )

  const isSubmitting = React.useRef(false)

  // One path for typing, a hardware scanner and the camera: the label's own barcode, sent exactly as read.
  const takeCustody = async (barcode: string) => {
    if (!barcode.trim() || isSubmitting.current || scan.pending) return
    isSubmitting.current = true
    try {
      const res = await scan.execute(barcode)
      if (res) {
        toast.success('تم استلام الطرد في عهدتك بنجاح')
        setCode('')
        setShowCamera(false)
        onChanged()
      }
    } catch {
      // Handled by scan.error
    } finally {
      isSubmitting.current = false
    }
  }

  const handleBarcodeSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    void takeCustody(code)
  }

  return (
    <Section title="استلام الطرد من المخزن">
      <div className="space-y-3">
        <p className="text-xs text-bw-ink-soft">
          امسح باركود البوليصة الملصق على الطرد لتأكيد استلامه في عهدتك قبل التحرك من المخزن.
        </p>

        {/* Camera scanner toggle */}
        {showCamera ? (
          <div className="space-y-2">
            <CameraScanner
              onCode={(scannedCode) => {
                // The waybill's barcode is taken straight from the camera and submitted; no extra tap.
                setCode(scannedCode)
                setShowCamera(false)
                void takeCustody(scannedCode)
              }}
              onClose={() => setShowCamera(false)}
            />
            <CommandError error={scan.error} />
          </div>
        ) : (
          <form className="space-y-3" onSubmit={handleBarcodeSubmit}>
            <Field
              label="باركود البوليصة (SHP-...)"
              ltr
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="SHP-..."
              autoFocus
            />

            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="touch"
                onClick={() => setShowCamera(true)}
                className="flex-1 text-xs font-semibold cursor-pointer"
              >
                <Camera className="size-4" aria-hidden />
                <span>تشغيل الكاميرا</span>
              </Button>
            </div>

            <Button
              type="submit"
              size="touch"
              variant="primary"
              className="w-full font-bold bg-bw-action text-bw-on-action hover:bg-bw-action-hover"
              loading={scan.pending}
              disabled={!code.trim() || scan.pending}
            >
              تأكيد استلام الطرد في عهدتي
            </Button>

            <CommandError error={scan.error} />
          </form>
        )}
      </div>
    </Section>
  )
}

/**
 * Dispatched Outcome Action Bar & Bottom Sheets:
 * Exactly two primary actions for mobile courier:
 * 1. "تم التسليم" (green)
 * 2. "تعذر التسليم" (red)
 */
function DispatchedOutcomeAction({
  stop,
  onChanged,
}: {
  stop: DriverStop
  onChanged: () => void
}) {
  const deliveredSheet = useDialog()
  const failedSheet = useDialog()
  const toast = useToast()

  const stickyBarRef = React.useRef<HTMLDivElement>(null)
  useToastLift(stickyBarRef, true, true)

  const [cashInput, setCashInput] = React.useState(String(stop.codDue))
  const [confirmedCashCheck, setConfirmedCashCheck] = React.useState(false)

  const [reasonCode, setReasonCode] = React.useState('CUSTOMER_UNREACHABLE')
  const [failureNotes, setFailureNotes] = React.useState('')

  const delivered = useCommand(() =>
    api(`/fulfillment/shipments/${stop.shipmentId}/events`, {
      body: { type: 'DELIVERED', collectedAmount: Number(cashInput) },
    })
  )

  const failed = useCommand(() =>
    api(`/fulfillment/shipments/${stop.shipmentId}/events`, {
      body: {
        type: 'FAILED',
        reasonCode,
        ...(failureNotes.trim() ? { notes: failureNotes.trim() } : {}),
      },
    })
  )

  const amount = Number(cashInput)
  const isCashValid =
    cashInput.trim() !== '' &&
    Number.isFinite(amount) &&
    amount >= 0 &&
    Math.round(amount * 100) === amount * 100

  const isDelivering = React.useRef(false)
  const isFailing = React.useRef(false)

  // Handle successful delivery submission
  const handleDeliveredSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isDelivering.current || delivered.pending) return
    if (!isCashValid || !confirmedCashCheck) return
    isDelivering.current = true
    try {
      const res = await delivered.execute()
      if (res) {
        setActiveDeliveryStopId(null)
        toast.success('تم تسجيل التسليم والتحصيل بنجاح')
        deliveredSheet.close()
        onChanged()
      }
    } finally {
      isDelivering.current = false
    }
  }

  // Handle failed delivery submission
  const handleFailedSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isFailing.current || failed.pending) return
    if (!reasonCode) return
    if (reasonCode === 'OTHER' && !failureNotes.trim()) return
    isFailing.current = true
    try {
      const res = await failed.execute()
      if (res) {
        setActiveDeliveryStopId(null)
        toast.warning('تم تسجيل تعذر التسليم — الطرد في عهدتك')
        failedSheet.close()
        onChanged()
      }
    } finally {
      isFailing.current = false
    }
  }

  return (
    <>
      {/* Sticky Bottom Action Bar for Quick One-Thumb Mobile Access */}
      <div
        ref={stickyBarRef}
        className="fixed inset-x-0 bottom-[52px] z-20 border-t border-bw-line bg-bw-page/95 backdrop-blur p-3 max-w-md mx-auto"
      >
        <div className="grid grid-cols-2 gap-2.5">
          <Button
            size="touch"
            variant="primary"
            onClick={() => {
              setCashInput(String(stop.codDue))
              setConfirmedCashCheck(false)
              deliveredSheet.open()
            }}
            className="w-full h-12 text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-500 shadow-sm cursor-pointer"
          >
            <CheckCircle2 className="size-5" aria-hidden />
            تم التسليم
          </Button>

          <Button
            size="touch"
            variant="danger"
            onClick={() => {
              setReasonCode('CUSTOMER_UNREACHABLE')
              setFailureNotes('')
              failedSheet.open()
            }}
            className="w-full h-12 text-sm font-bold shadow-sm cursor-pointer"
          >
            <XCircle className="size-5" aria-hidden />
            تعذر التسليم
          </Button>
        </div>
      </div>

      {/* ── 1. Successful Delivery & COD Bottom Sheet ── */}
      <Dialog
        dialogRef={deliveredSheet.ref}
        title="تأكيد تسليم الطلب وتحصيل المبلغ"
        variant="sheet"
      >
        <form className="space-y-4" onSubmit={handleDeliveredSubmit}>
          {/* Sleek Modern Amount Due Overview */}
          <div className="rounded-2xl border border-bw-line bg-gradient-to-b from-bw-surface to-bw-sunken p-3.5 flex items-center justify-between">
            <div className="space-y-0.5">
              <span className="text-xs font-bold text-bw-ink block">المطلوب تحصيله كاش</span>
              <span className="text-[11px] text-bw-ink-soft">المبلغ المسجل على البوليصة</span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="font-bw-display text-2xl font-black text-bw-ink"><Egp value={stop.codDue} /></span>
            </div>
          </div>

          {/* Actual Collected Amount Input */}
          <div className="space-y-1.5">
            <Field
              label="المبلغ المحصل فعلياً من العميل"
              ltr
              inputMode="decimal"
              value={cashInput}
              onChange={(e) => setCashInput(e.target.value)}
              placeholder="0.00"
            />
            {amount !== stop.codDue ? (
              <button
                type="button"
                onClick={() => setCashInput(String(stop.codDue))}
                className="text-xs font-semibold text-bw-cobalt hover:underline block text-start cursor-pointer"
              >
                تعبئة المبلغ المطلوب كاملاً (<Egp value={stop.codDue} />)
              </button>
            ) : null}
          </div>

          {/* Warning when declared amount differs from COD due */}
          {isCashValid && amount !== stop.codDue ? (
            <Notice tone="warn" title="المبلغ المحصل يختلف عن المطلوب">
              المطلوب <Egp value={stop.codDue} /> بينما المحصل <Egp value={amount} />. سيتم تسجيل هذا الفرق كعجز أو زيادة عند توريد النقدية في المخزن.
            </Notice>
          ) : null}

          {/* Explicit Confirmation Checkbox */}
          <label className="flex items-start gap-2.5 rounded-2xl border border-bw-line p-3 text-xs text-bw-ink cursor-pointer bg-bw-veil-1">
            <input
              type="checkbox"
              className="size-4 mt-0.5 accent-emerald-500 rounded shrink-0 cursor-pointer"
              checked={confirmedCashCheck}
              onChange={(e) => setConfirmedCashCheck(e.target.checked)}
            />
            <span className="leading-relaxed font-medium">
              أؤكد تسليم الطرد للعميل واستلام مبلغ <strong className="text-emerald-400 font-bold"><Egp value={amount || 0} /></strong> نقدياً في عهدتي.
            </span>
          </label>

          <div className="flex gap-2 pt-2">
            <Button
              type="submit"
              size="touch"
              className="flex-1 font-bold bg-emerald-600 text-white hover:bg-emerald-500"
              loading={delivered.pending}
              disabled={!isCashValid || !confirmedCashCheck || delivered.pending}
            >
              تأكيد التسليم والتحصيل
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="touch"
              disabled={delivered.pending}
              onClick={() => deliveredSheet.close()}
            >
              إلغاء
            </Button>
          </div>

          <CommandError error={delivered.error} />
        </form>
      </Dialog>

      {/* ── 2. Failed Delivery Bottom Sheet ── */}
      <Dialog
        dialogRef={failedSheet.ref}
        title="تسجيل تعذر التسليم"
        variant="sheet"
      >
        <form className="space-y-4" onSubmit={handleFailedSubmit}>
          <p className="text-xs text-bw-ink-soft">
            اختر السبب الفعلي لتعذر التسليم بلمسة واحدة:
          </p>

          {/* Visual reason tiles for quick one-thumb selection */}
          <div className="grid grid-cols-2 gap-2">
            {QUICK_REASONS.map((r) => {
              const isSelected = reasonCode === r.code
              return (
                <button
                  key={r.code}
                  type="button"
                  onClick={() => setReasonCode(r.code)}
                  className={cn(
                    'flex items-center gap-2.5 p-3 rounded-2xl border text-start transition-all cursor-pointer',
                    isSelected
                      ? 'border-bw-danger bg-bw-danger/15 text-bw-ink font-bold shadow-sm ring-1 ring-bw-danger/50'
                      : 'border-bw-line bg-bw-surface text-bw-ink-soft hover:bg-bw-sunken hover:text-bw-ink'
                  )}
                >
                  <span className="text-xl shrink-0" aria-hidden>{r.icon}</span>
                  <span className="text-xs leading-snug">{r.label}</span>
                </button>
              )
            })}
          </div>

          {/* Standard Select Dropdown kept in sync for screen readers & full test suite compatibility */}
          <div className="space-y-1.5 pt-1">
            <label htmlFor="failure-reason-select" className="block text-xs font-semibold text-bw-ink">
              سبب تعذر التسليم <span className="text-bw-danger">*</span>
            </label>
            <select
              id="failure-reason-select"
              name="reasonCode"
              value={reasonCode}
              onChange={(e) => setReasonCode(e.target.value)}
              required
              className="w-full h-11 rounded-2xl border border-bw-line-field bg-bw-surface px-3 text-xs font-semibold text-bw-ink focus:border-bw-action focus:outline-none cursor-pointer"
            >
              {Object.entries(FAILURE_REASONS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          {/* Notes field: required if OTHER, optional otherwise */}
          <div className="space-y-1">
            <TextArea
              label={reasonCode === 'OTHER' ? 'تفاصيل السبب (مطلوب)' : 'ملاحظات إضافية (اختياري)'}
              value={failureNotes}
              onChange={setFailureNotes}
              rows={2}
            />
            {reasonCode === 'OTHER' && !failureNotes.trim() ? (
              <p className="text-[11px] text-bw-danger flex items-center gap-1">
                <AlertCircle className="size-3" aria-hidden />
                يرجى كتابة سبب تعذر التسليم بالتفصيل.
              </p>
            ) : null}
          </div>

          {/* Custody reminder */}
          <div className="rounded-2xl bg-amber-500/10 border border-amber-500/25 p-2.5 text-[11px] text-amber-300 space-y-1">
            <p className="font-bold flex items-center gap-1">
              <AlertTriangle className="size-3.5 text-amber-400" aria-hidden />
              تنبيه العهدة
            </p>
            <p className="leading-relaxed">
              الطرد يظل في عهدتك الشخصية حتى تسليمه لمسؤول المخزن في نهاية المشوار.
            </p>
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              type="submit"
              variant="danger"
              size="touch"
              className="flex-1 font-bold h-12"
              loading={failed.pending}
              disabled={!reasonCode || (reasonCode === 'OTHER' && !failureNotes.trim()) || failed.pending}
            >
              تسجيل تعذر التسليم
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="touch"
              disabled={failed.pending}
              onClick={() => failedSheet.close()}
            >
              إلغاء
            </Button>
          </div>

          <CommandError error={failed.error} />
        </form>
      </Dialog>
    </>
  )
}

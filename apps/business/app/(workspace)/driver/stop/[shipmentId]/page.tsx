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
  MapPin,
  MessageCircle,
  Navigation,
  Phone,
  Wallet,
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
  StatusLabel,
  useDialog,
} from '@/components/bw/primitives'
import { useToast, useToastLift } from '@/components/bw/toast'
import { CameraScanner } from '@/components/workspace/camera-scanner'
import { CopyId } from '@/components/workspace/copy-id'
import { CommandError, Egp, Status, TextArea } from '@/components/workspace/kit'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { api } from '@/lib/api'
import {
  formatNavigationUrl,
  formatPhoneUrl,
  formatWhatsAppUrl,
} from '@/lib/courier-actions'
import { getDevShipmentBarcode } from '@/lib/dev-barcode'
import {
  FAILURE_REASONS,
  INSTRUCTION_REASONS,
  SHIPMENT_STATUS,
  shortId,
} from '@/lib/labels'
import { useApi, useCommand } from '@/lib/use-api'
import { cn } from '@/lib/utils'
import type { DriverRun, DriverStop } from '../../page'

/**
 * Driver Stop Details — تفاصيل المحطة والطلب
 * Mobile-first operational interface prioritizing customer contact, COD collection, and contextual actions.
 */
export default function DriverStopPage() {
  const { shipmentId } = useParams<{ shipmentId: string }>()
  const { data, error, loading, reload } = useApi<DriverRun[]>('/fulfillment/driver/runs')

  const run = data?.find((r) => r.stops.some((s) => s.shipmentId === shipmentId))
  const stop = run?.stops.find((s) => s.shipmentId === shipmentId)

  return (
    <RoleShell role="driver" active="run" mode="mobile">
      <div className="space-y-3.5 p-3 sm:p-4 pb-28">
        {/* Navigation back to trips */}
        <div className="flex items-center justify-between">
          <Link
            href="/driver"
            className="inline-flex items-center gap-1 text-xs font-semibold text-bw-ink-soft hover:text-bw-ink transition-colors"
          >
            <ChevronRight className="size-4" aria-hidden />
            العودة للمشوار {run ? <Code>#{shortId(run.id)}</Code> : ''}
          </Link>
          {stop ? (
            <span className="text-xs text-bw-ink-subtle">
              محطة <Code>{stop.sequence}</Code> من <Code>{run?.stops.length}</Code>
            </span>
          ) : null}
        </div>

        {error ? <LoadError message={error.message} onRetry={reload} /> : null}
        {!data && loading ? <Skeleton className="h-64 w-full rounded-bw-card" /> : null}
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
  const isStopActive = stop.attemptStatus === 'active'
  const isDelivered = stop.status === 'delivered' || stop.attemptStatus === 'delivered'
  const isFailed = stop.status === 'failed' || stop.attemptStatus === 'failed'

  // Communication & navigation link targets
  const fullAddress = [stop.address, stop.area, stop.governorate].filter(Boolean).join('، ')
  const phoneUrl = formatPhoneUrl(stop.recipientPhone)
  const whatsAppUrl = formatWhatsAppUrl(stop.recipientPhone)
  const navResult = formatNavigationUrl(stop.location, fullAddress)

  return (
    <div className="space-y-3">
      {/* 1. Customer & Address Primary Card */}
      <section className="rounded-bw-card border border-bw-line bg-bw-surface p-3.5 space-y-3 shadow-bw-card">
        {/* Customer Header */}
        <div className="flex items-start justify-between gap-2 border-b border-bw-line pb-3">
          <div className="min-w-0 space-y-1">
            <span className="text-[11px] font-semibold text-bw-ink-soft">العميل المستلم</span>
            <h1 className="text-base font-bold text-bw-ink truncate">{stop.recipientName}</h1>
            <div className="flex items-center gap-2 text-xs text-bw-ink-soft">
              <span className="text-bw-ink-subtle">طلب:</span>
              <CopyId value={stop.orderNumber} muted className="text-xs" />
              <span>·</span>
              <span><Code>{stop.itemCount}</Code> قطع</span>
            </div>
          </div>

          <div className="shrink-0 text-end">
            <Status map={SHIPMENT_STATUS} value={stop.status} />
            <div className="mt-1">
              {stop.handedOver ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-bw-emerald">
                  <span className="size-1.5 rounded-full bg-bw-emerald" />
                  في عهدتك
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-bw-warn">
                  <Clock className="size-3" />
                  لم يُستلم بعد
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Delivery Address */}
        <div className="space-y-1">
          <span className="text-[11px] text-bw-ink-subtle flex items-center gap-1">
            <MapPin className="size-3" aria-hidden />
            عنوان التوصيل
          </span>
          <p className="text-sm font-medium text-bw-ink leading-relaxed">
            {fullAddress || 'لا يوجد عنوان مسجل'}
          </p>
          {stop.deliveryNotes ? (
            <div className="rounded-bw-field bg-bw-sunken p-2 text-xs text-bw-ink-soft flex items-start gap-1.5">
              <span className="font-semibold text-bw-ink shrink-0">ملاحظة العميل:</span>
              <span>{stop.deliveryNotes}</span>
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

        {/* 2. Communication and Navigation Action Bar (Touch targets >= 44px) */}
        <div className="grid grid-cols-3 gap-2 pt-1">
          {/* Phone call */}
          {phoneUrl ? (
            <a
              href={phoneUrl}
              className="inline-flex h-11 items-center justify-center gap-1.5 rounded-bw-field border border-bw-line-field bg-bw-surface text-xs font-semibold text-bw-ink hover:bg-bw-sunken active:scale-[0.98] transition-all"
            >
              <Phone className="size-4 text-bw-cobalt" aria-hidden />
              <span>اتصال</span>
            </a>
          ) : (
            <button
              type="button"
              disabled
              className="inline-flex h-11 items-center justify-center gap-1.5 rounded-bw-field border border-bw-line bg-bw-sunken text-xs font-semibold text-bw-ink-subtle cursor-not-allowed"
            >
              <Phone className="size-4 text-bw-ink-subtle" aria-hidden />
              <span>لا يوجد هاتف</span>
            </button>
          )}

          {/* WhatsApp deep link */}
          {whatsAppUrl ? (
            <a
              href={whatsAppUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 items-center justify-center gap-1.5 rounded-bw-field border border-bw-emerald/30 bg-bw-emerald-soft text-xs font-semibold text-bw-emerald hover:brightness-110 active:scale-[0.98] transition-all"
            >
              <MessageCircle className="size-4 text-bw-emerald" aria-hidden />
              <span>واتساب</span>
            </a>
          ) : (
            <button
              type="button"
              disabled
              className="inline-flex h-11 items-center justify-center gap-1.5 rounded-bw-field border border-bw-line bg-bw-sunken text-xs font-semibold text-bw-ink-subtle cursor-not-allowed"
            >
              <MessageCircle className="size-4 text-bw-ink-subtle" aria-hidden />
              <span>لا يوجد واتساب</span>
            </button>
          )}

          {/* Navigation */}
          {navResult.url ? (
            <a
              href={navResult.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 items-center justify-center gap-1.5 rounded-bw-field bg-bw-action text-xs font-semibold text-bw-on-action shadow-bw-sheen hover:bg-bw-action-hover active:scale-[0.98] transition-all"
            >
              <Navigation className="size-4" aria-hidden />
              <span>الطريق</span>
            </a>
          ) : (
            <button
              type="button"
              disabled
              className="inline-flex h-11 items-center justify-center gap-1.5 rounded-bw-field border border-bw-line bg-bw-sunken text-xs font-semibold text-bw-ink-subtle cursor-not-allowed"
            >
              <Navigation className="size-4 text-bw-ink-subtle" aria-hidden />
              <span>مافيش موقع</span>
            </button>
          )}
        </div>
      </section>

      {/* 3. COD Amount to Collect Box */}
      <section className="rounded-bw-card border border-bw-line bg-bw-surface p-3.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="grid size-10 place-items-center rounded-full bg-bw-action-soft text-bw-action-ink border border-bw-line">
            <Wallet className="size-5" aria-hidden />
          </div>
          <div>
            <span className="text-[11px] text-bw-ink-soft">المطلوب تحصيله (دفع عند الاستلام)</span>
            <p className="font-bw-display text-lg font-bold text-bw-ink">
              <Egp value={stop.codDue} />
            </p>
          </div>
        </div>

        {stop.cashDeclared !== null ? (
          <div className="text-end">
            <span className="text-[11px] text-bw-ink-soft">المعلن تحصيله</span>
            <p className="text-sm font-bold text-bw-ok">
              <Egp value={stop.cashDeclared} />
            </p>
          </div>
        ) : null}
      </section>

      {/* 4. Contextual Delivery Actions */}

      {/* State A: Awaiting Pickup (Planning & Not Handed Over) */}
      {!stop.handedOver && (
        <HandoffAction stop={stop} onChanged={onChanged} />
      )}

      {/* State B: Received in Custody, but Run not yet dispatched */}
      {stop.handedOver && runStatus === 'planning' && (
        <section className="rounded-bw-card border border-bw-emerald/25 bg-bw-emerald-soft p-4 space-y-2">
          <div className="flex items-center gap-2 text-bw-emerald font-semibold text-sm">
            <CheckCircle2 className="size-5 shrink-0" aria-hidden />
            <span>الطرد في عهدتك بنجاح</span>
          </div>
          <p className="text-xs text-bw-ink-soft leading-relaxed">
            تم تسجيل استلام الطرد في عهدتك. في انتظار تأكيد المخزن لخروج المشوار لبدء التوصيل إلى العميل.
          </p>
        </section>
      )}

      {/* State C: Out for Delivery (Handed over, Run is dispatched & Attempt is active) */}
      {stop.handedOver && runStatus === 'dispatched' && isStopActive && stop.status !== 'failed' && (
        <DispatchedOutcomeAction stop={stop} onChanged={onChanged} />
      )}

      {/* State D: Failed Attempt Result — Clearly indicates custody retention awaiting Hub return */}
      {isFailed && (
        <section className="rounded-bw-card border border-bw-danger/30 bg-bw-danger-soft p-4 space-y-3">
          <div className="flex items-center gap-2 text-bw-danger font-semibold text-sm">
            <AlertCircle className="size-5 shrink-0" aria-hidden />
            <span>محاولة فاشلة مسجلة — الطرد في عهدتك</span>
          </div>
          <div className="space-y-1.5 text-xs text-bw-ink-soft">
            <p className="font-semibold text-bw-ink">
              حالة الطرد: <span className="text-bw-warn font-semibold">مرتجع مع المندوب (في الطريق للمخزن)</span>
            </p>
            <p className="leading-relaxed">
              الطرد لا يزال في عهدتك الشخصية حتى تسليمه الفعلي لمسؤول المخزن في نهاية المشوار.
            </p>
            <p className="leading-relaxed text-[11px] text-bw-ink-subtle">
              سيقوم مسؤول المخزن بمسح باركود البوليصة لتأكيد استلام المرتجع وإتمام التسوية المالية والمخزنية.
            </p>
          </div>
        </section>
      )}

      {/* State E: Successfully Delivered Result */}
      {isDelivered && (
        <section className="rounded-bw-card border border-bw-emerald/30 bg-bw-emerald-soft p-4 space-y-2">
          <div className="flex items-center gap-2 text-bw-emerald font-semibold text-sm">
            <CheckCircle2 className="size-5 shrink-0" aria-hidden />
            <span>تم تسليم الطلب بنجاح</span>
          </div>
          <p className="text-xs text-bw-ink-soft leading-relaxed">
            {stop.cashDeclared !== null ? (
              <>
                أعلنت استلام مبلغ <strong className="text-bw-ok"><Egp value={stop.cashDeclared} /></strong> نقدياً من العميل. سيتم تأكيد العد والتسوية النهائية في المخزن.
              </>
            ) : (
              'تم تأكيد التسليم وإغلاق المحطة بنجاح.'
            )}
          </p>
        </section>
      )}
    </div>
  )
}

/**
 * Pickup & Handoff Scan (Awaiting Pickup)
 * Allows hardware scan, camera scanner, manual typing, and development testing input.
 */
function HandoffAction({ stop, onChanged }: { stop: DriverStop; onChanged: () => void }) {
  const [code, setCode] = React.useState('')
  const [showCamera, setShowCamera] = React.useState(false)
  const [devBarcode, setDevBarcode] = React.useState<string | null>(null)
  const toast = useToast()

  React.useEffect(() => {
    let cancelled = false
    getDevShipmentBarcode(stop.shipmentId).then((res) => {
      if (!cancelled) setDevBarcode(res)
    })
    return () => {
      cancelled = true
    }
  }, [stop.shipmentId])

  const scan = useCommand(() =>
    api(`/fulfillment/shipments/${stop.shipmentId}/events`, {
      body: { type: 'HANDOFF_SCANNED', barcode: code.trim() },
    })
  )

  const isSubmitting = React.useRef(false)

  const handleBarcodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!code.trim() || isSubmitting.current || scan.pending) return
    isSubmitting.current = true
    try {
      const res = await scan.execute()
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
                setCode(scannedCode)
                setShowCamera(false)
              }}
              onClose={() => setShowCamera(false)}
            />
          </div>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowCamera(true)}
            className="w-full text-xs"
          >
            <Camera className="size-4" aria-hidden />
            مسح الباركود باستخدام كاميرا الموبايل
          </Button>
        )}

        {/* Barcode input form */}
        <form className="space-y-2.5" onSubmit={handleBarcodeSubmit}>
          <Field
            label="رقم باركود البوليصة"
            ltr
            autoComplete="off"
            placeholder="SHP-..."
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />

          {/* Development-only helper button (strictly excluded in production) */}
          {devBarcode ? (
            <div className="rounded-bw-field border border-dashed border-bw-cobalt/40 bg-bw-cobalt-soft p-2 text-xs flex items-center justify-between gap-2">
              <span className="text-bw-ink-soft text-[11px]">بيئة تطوير: باركود صالح للاختبار</span>
              <button
                type="button"
                onClick={() => setCode(devBarcode)}
                className="font-semibold text-bw-cobalt hover:underline text-[11px]"
              >
                تعبئة باركود الاختبار
              </button>
            </div>
          ) : null}

          <Button
            type="submit"
            size="touch"
            className="w-full"
            loading={scan.pending}
            disabled={!code.trim() || scan.pending}
          >
            تأكيد استلام الطرد في عهدتي
          </Button>
          <CommandError error={scan.error} />
        </form>
      </div>
    </Section>
  )
}

/**
 * Primary Delivery Outcomes (Out for Delivery)
 * Shows sticky dual action bar: "تم التسليم" and "تعذر التسليم", backed by Bottom Sheets.
 * Prevents accidental double submissions and updates state only after server confirmation.
 */
function DispatchedOutcomeAction({ stop, onChanged }: { stop: DriverStop; onChanged: () => void }) {
  const deliveredSheet = useDialog()
  const failedSheet = useDialog()
  const toast = useToast()

  const stickyBarRef = React.useRef<HTMLDivElement>(null)
  // Lifts the single toast above the sticky bottom action bar so they never overlap
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

  // Guard against accidental double submissions
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
            className="w-full text-sm font-bold bg-bw-action text-bw-on-action hover:bg-bw-action-hover"
          >
            <CheckCircle2 className="size-4" aria-hidden />
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
            className="w-full text-sm font-bold"
          >
            <XCircle className="size-4" aria-hidden />
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
          {/* Amount Due Overview */}
          <div className="rounded-bw-card border border-bw-line bg-bw-sunken p-3 space-y-1">
            <span className="text-[11px] text-bw-ink-soft">المبلغ المطلوب من العميل (ثابت)</span>
            <p className="font-bw-display text-lg font-bold text-bw-ink">
              <Egp value={stop.codDue} />
            </p>
            <p className="text-[11px] text-bw-ink-subtle">
              إجمالي الطلب مؤكد ولا يمكن تغييره دون الرجوع للإدارة.
            </p>
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
            {/* Quick full-amount shortcut */}
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
          <label className="flex items-start gap-2.5 rounded-bw-field border border-bw-line p-2.5 text-xs text-bw-ink cursor-pointer bg-bw-veil-1">
            <input
              type="checkbox"
              className="size-4 mt-0.5 accent-bw-action rounded shrink-0 cursor-pointer"
              checked={confirmedCashCheck}
              onChange={(e) => setConfirmedCashCheck(e.target.checked)}
            />
            <span className="leading-relaxed">
              أؤكد تسليم الطرد للعميل واستلام مبلغ <strong className="text-bw-ink"><Egp value={amount || 0} /></strong> نقدياً في عهدتي.
            </span>
          </label>

          <div className="flex gap-2 pt-2">
            <Button
              type="submit"
              size="touch"
              className="flex-1"
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
        <form className="space-y-3.5" onSubmit={handleFailedSubmit}>
          <p className="text-xs text-bw-ink-soft">
            اختر السبب الفعلي لتعذر التسليم. يظل الطرد في عهدتك حتى إعادته إلى المخزن.
          </p>

          {/* Required Dropdown: سبب تعذر التسليم */}
          <div className="space-y-1.5">
            <label htmlFor="failure-reason-select" className="block text-xs font-semibold text-bw-ink">
              سبب تعذر التسليم <span className="text-bw-danger">*</span>
            </label>
            <select
              id="failure-reason-select"
              name="reasonCode"
              value={reasonCode}
              onChange={(e) => setReasonCode(e.target.value)}
              required
              className="w-full h-11 rounded-bw-field border border-bw-line-field bg-bw-surface px-3 text-xs font-semibold text-bw-ink focus:border-bw-action focus:outline-none cursor-pointer"
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
          <div className="rounded-bw-field bg-bw-warn-soft border border-bw-warn/25 p-2.5 text-[11px] text-bw-warn space-y-1">
            <p className="font-semibold flex items-center gap-1">
              <AlertTriangle className="size-3.5" aria-hidden />
              تنبيه العهدة
            </p>
            <p className="leading-relaxed">
              تسجيل تعذر التسليم لا يعني إرجاع الطرد للمخزن تلقائياً. يجب تسليم الطرد يدوياً لمسؤول المخزن ليقوم بمسح البوليصة وتأكيد الاستلام.
            </p>
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              type="submit"
              variant="danger"
              size="touch"
              className="flex-1"
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

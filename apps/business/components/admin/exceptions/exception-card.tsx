'use client'

import * as React from 'react'
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Clock,
  FileText,
  History,
  Store,
  Truck,
  Wallet,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { OperationalException } from './exception-types'

export function ExceptionCard({
  exc,
  onResolve,
}: {
  exc: OperationalException
  onResolve: (exc: OperationalException) => void
}) {
  const [isTimelineOpen, setIsTimelineOpen] = React.useState(false)

  return (
    <div className="sc-q flex-col sm:flex-row items-start sm:items-center gap-4 p-4 rounded-xl border border-white/[0.08] bg-bw-surface">
      {/* Category / Severity Icon */}
      <div
        className={cn(
          'sc-q-tile shrink-0 flex items-center justify-center size-10 rounded-xl',
          exc.severity === 'critical' ? 'bg-red-500/15 text-[#fb7185] border border-red-500/30' : 'bg-amber-500/15 text-[#f5a524] border border-amber-500/30'
        )}
      >
        {exc.category === 'supply' && <Store className="size-5" />}
        {exc.category === 'delivery' && <Truck className="size-5" />}
        {exc.category === 'hub' && <Clock className="size-5" />}
        {exc.category === 'cash' && <Wallet className="size-5" />}
      </div>

      {/* Exception Information & Automation Traceability */}
      <div className="flex-1 w-full space-y-2">
        <div className="sc-q-head flex flex-wrap items-center gap-2">
          <span className="font-bold text-white text-sm">{exc.title}</span>
          {exc.severity === 'critical' && <span className="sc-badge t-danger">حرج</span>}
          {exc.severity === 'urgent' && <span className="sc-badge t-warning">عاجل</span>}
          <span className="sc-badge font-mono text-[10px] bg-red-500/10 text-[#fb7185] border border-[#fb7185]/30">
            استنفاد الأتمتة
          </span>
        </div>

        {/* Failure Reason */}
        <div className="p-2.5 rounded-lg border border-amber-500/20 bg-amber-500/[0.04] text-xs text-[#f5a524] flex items-start gap-2">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <div className="flex-1 leading-relaxed">
            <b className="font-semibold text-white ml-1">سبب الاستثناء:</b>
            {exc.failureReason}
          </div>
        </div>

        <div className="text-xs text-[#a1a1aa] leading-relaxed">{exc.detail}</div>

        <div className="sc-q-meta flex flex-wrap items-center gap-2 text-xs text-bw-ink-subtle">
          <span>المسؤول: <b className="text-white">{exc.assignedRole}</b></span>
          <span className="sep" />
          <span>الانتظار: {exc.waitingTime}</span>
          <span className="sep" />
          <span className={cn('sc-sla font-semibold', exc.slaStatus === 'over' ? 'text-[#fb7185]' : 'text-[#f5a524]')}>
            {exc.slaLabel}
          </span>
          <span className="sep" />
          <span>الطلبات: <b className="text-white font-mono">{exc.affectedOrders.join('، ')}</b></span>
        </div>

        {/* Collapsible History of Automatic Attempts */}
        <div className="pt-1">
          <button
            type="button"
            onClick={() => setIsTimelineOpen(!isTimelineOpen)}
            className="inline-flex items-center gap-1.5 text-[11px] text-[#ff783d] hover:underline cursor-pointer"
          >
            <History className="size-3.5" />
            <span>سجل المحاولات الآلية السابقة ({exc.autoAttempts.length} محاولات فشلت)</span>
            {isTimelineOpen ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
          </button>

          {isTimelineOpen && (
            <div className="mt-2 space-y-1.5 p-3 rounded-lg bg-black/40 border border-white/[0.06] text-[11px] animate-in fade-in">
              <div className="text-[#a1a1aa] font-semibold mb-1">
                مسار الفحص والبدائل التلقائية للنظام المركزي:
              </div>
              {exc.autoAttempts.map((att, i) => (
                <div key={i} className="flex items-start gap-2 border-e-2 border-[#ff783d]/40 pe-2 py-0.5">
                  <span className="font-mono text-[#82828c] shrink-0">{att.time}</span>
                  <div className="flex-1">
                    <span className="text-white font-medium">{att.action}</span>
                    <span className="text-[#fb7185] mx-1.5">[{att.outcome}]</span>
                    <p className="text-[#82828c] text-[10px] mt-0.5">{att.reason}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Action Button */}
      <div className="sc-q-actions shrink-0 self-end sm:self-center">
        <button
          type="button"
          onClick={() => onResolve(exc)}
          className="sc-btn sm primary flex items-center gap-1.5 cursor-pointer"
        >
          <FileText className="size-3.5" />
          <span>مراجعة وحل الاستثناء</span>
        </button>
      </div>
    </div>
  )
}

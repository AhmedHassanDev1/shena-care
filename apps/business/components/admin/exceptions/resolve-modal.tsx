'use client'

import * as React from 'react'
import Link from 'next/link'
import { AlertTriangle, CheckCheck, History, ShieldCheck, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AllowedOutcome, OperationalException } from './exception-types'

export function ResolveExceptionModal({
  exc,
  onClose,
  onConfirm,
  isResolving,
}: {
  exc: OperationalException
  onClose: () => void
  onConfirm: (exc: OperationalException, outcome: AllowedOutcome, justification: string) => void
  isResolving: boolean
}) {
  const [selectedOutcomeId, setSelectedOutcomeId] = React.useState<string>(exc.allowedOutcomes[0]?.id || '')
  const [justification, setJustification] = React.useState<string>('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const outcome = exc.allowedOutcomes.find((o) => o.id === selectedOutcomeId)
    if (!outcome || justification.trim().length < 10) return
    onConfirm(exc, outcome, justification.trim())
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in"
    >
      <div className="sc-card w-full max-w-2xl max-h-[90vh] flex flex-col p-6 space-y-4 shadow-2xl border-white/[0.18]">
        {/* Modal Header */}
        <div className="flex items-start justify-between border-b border-white/[0.08] pb-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-semibold text-[#ff783d] tracking-wide uppercase">
                قرار إداري استثنائي (Human Intervention)
              </span>
              {exc.severity === 'critical' ? (
                <span className="sc-badge t-danger">حرج</span>
              ) : (
                <span className="sc-badge t-warning">عاجل</span>
              )}
            </div>
            <h3 className="text-base font-bold text-white">{exc.title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="sc-btn sm ghost cursor-pointer"
            aria-label="إلغاء"
          >
            <X className="size-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="overflow-y-auto space-y-4 pe-1 max-h-[60vh]">
          {/* Failure Reason Alert */}
          <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.05] p-3.5 text-xs text-[#f5a524]">
            <div className="font-bold text-white mb-1 flex items-center gap-2">
              <AlertTriangle className="size-4 text-[#f5a524]" />
              <span>سبب تعثر المعالجة الآلية وتجاوز السياسات:</span>
            </div>
            <p className="leading-relaxed">{exc.failureReason}</p>
          </div>

          {/* Automated Resolution Attempts History */}
          <div className="rounded-xl border border-white/[0.08] bg-black/40 p-3.5 space-y-2">
            <div className="flex items-center justify-between text-xs border-b border-white/[0.06] pb-2">
              <span className="font-semibold text-white flex items-center gap-1.5">
                <History className="size-3.5 text-[#ff783d]" />
                <span>سجل محاولات المعالجة الآلية السابقة ({exc.autoAttempts.length})</span>
              </span>
              <span className="text-[10px] text-[#fb7185] font-mono">استنفاد البدائل التلقائية</span>
            </div>
            <div className="space-y-2 pt-1">
              {exc.autoAttempts.map((att, idx) => (
                <div key={idx} className="flex items-start gap-2.5 text-[11px] border-e-2 border-[#ff783d]/40 pe-2.5">
                  <span className="font-mono text-[#82828c] shrink-0">{att.time}</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-white">{att.action}</span>
                      <span className="text-[#fb7185] text-[10px]">[{att.outcome}]</span>
                    </div>
                    <p className="text-[10px] text-[#a1a1aa] mt-0.5">{att.reason}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Affected Orders with Links */}
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 text-xs flex items-center justify-between">
            <div>
              <span className="text-[#82828c] block text-[11px]">الطلبات المتأثرة بالقرار:</span>
              <div className="flex items-center gap-1.5 mt-1">
                {exc.affectedOrders.map((ord) => (
                  <Link
                    key={ord}
                    href="/admin/orders"
                    className="px-2 py-0.5 rounded font-mono text-xs bg-white/[0.06] text-white hover:text-[#ff783d] transition-colors"
                  >
                    {ord}
                  </Link>
                ))}
              </div>
            </div>
            <div className="text-end">
              <span className="text-[#82828c] block text-[11px]">الجهة المسؤولة:</span>
              <b className="text-white text-xs">{exc.assignedRole}</b>
            </div>
          </div>

          {/* Authorized Alternative Outcomes (Radio Group) */}
          <div className="space-y-2">
            <label className="block text-xs font-bold text-white">
              اختر الإجراء الإداري المعتمد للحل:
            </label>
            <div className="space-y-2">
              {exc.allowedOutcomes.map((outcome) => (
                <label
                  key={outcome.id}
                  className={cn(
                    'flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors',
                    selectedOutcomeId === outcome.id
                      ? 'border-[#ff783d] bg-[#ff783d]/[0.08]'
                      : 'border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04]'
                  )}
                >
                  <input
                    type="radio"
                    name="resolutionOutcome"
                    value={outcome.id}
                    checked={selectedOutcomeId === outcome.id}
                    onChange={() => setSelectedOutcomeId(outcome.id)}
                    className="mt-1 size-4 text-[#ff783d] focus:ring-[#ff783d] border-white/20 bg-black"
                  />
                  <div className="flex-1">
                    <div className="text-xs font-semibold text-white">{outcome.label}</div>
                    <p className="text-[11px] text-[#a1a1aa] mt-0.5">{outcome.description}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Mandatory Documented Justification Note */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="resolution-justification" className="font-bold text-white">
                توثيق سبب القرار الإداري (إلزامي للتدقيق والمساءلة):
              </label>
              <span className="text-[10px] text-[#82828c]">
                {justification.trim().length} / 10 أحرف كحد أدنى
              </span>
            </div>
            <textarea
              id="resolution-justification"
              rows={3}
              required
              placeholder="اكتب التبرير الإداري لاتخاذ هذا القرار والجهة المنسق معها (مثال: تم التنسيق هاتفياً مع العميل والموافقة على الصنف البديل المتاح بالمخزن المركزي)..."
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              className="w-full rounded-xl border border-white/[0.12] bg-white/[0.03] p-3 text-xs text-white placeholder:text-[#82828c] focus:border-[#ff783d] focus:outline-none focus:ring-1 focus:ring-[#ff783d]"
            />
          </div>

          {/* Verification Warning */}
          <div className="rounded-lg bg-white/[0.02] border border-white/[0.06] p-2.5 text-[11px] text-[#82828c] flex items-center gap-2">
            <ShieldCheck className="size-4 text-[#34d27b] shrink-0" />
            <span>
              يتم التحقق آلياً من حالة الطلبات المرتبطة، وتدوين بصمة القرار وتوقيع المستخدم في سجل التدقيق الإداري.
            </span>
          </div>

          {/* Modal Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-white/[0.08]">
            <button
              type="button"
              onClick={onClose}
              className="sc-btn cursor-pointer"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={
                isResolving ||
                !selectedOutcomeId ||
                justification.trim().length < 10
              }
              className="sc-btn primary flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {isResolving ? (
                <>
                  <span className="size-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  <span>جاري التحقق والتنفيذ...</span>
                </>
              ) : (
                <>
                  <CheckCheck className="size-4" />
                  <span>تأكيد وتنفيذ القرار الإداري</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

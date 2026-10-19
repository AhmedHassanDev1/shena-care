'use client'

import * as React from 'react'
import { History, X } from 'lucide-react'
import type { AuditRecord } from './exception-types'

export function AuditTrailModal({
  records,
  onClose,
}: {
  records: AuditRecord[]
  onClose: () => void
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in"
    >
      <div className="sc-card w-full max-w-2xl max-h-[85vh] flex flex-col p-6 space-y-4 shadow-2xl border-white/[0.15]">
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
          <div className="flex items-center gap-2">
            <History className="size-4.5 text-[#ff783d]" />
            <h3 className="text-lg font-bold text-white">سجل القرارات الإدارية والاستثناءات المحلولة</h3>
            <span className="sc-badge t-success font-mono text-xs">{records.length} قرارات موثقة</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="sc-btn sm ghost cursor-pointer"
            aria-label="إغلاق"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="overflow-y-auto space-y-3 pe-1 max-h-[50vh]">
          {records.length === 0 ? (
            <p className="text-xs text-bw-ink-soft py-6 text-center">لا توجد قرارات إدارية مسجلة في هذه الجلسة بعد.</p>
          ) : (
            records.map((record) => (
              <div key={record.id} className="p-3.5 rounded-xl border border-white/[0.08] bg-white/[0.02] space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-white">{record.title}</span>
                  <span className="font-mono text-[11px] text-[#34d27b]">{record.resolvedAt}</span>
                </div>
                <div className="text-xs text-[#ff783d] font-semibold">
                  الإجراء المنفذ: {record.outcomeLabel}
                </div>
                <div className="p-2.5 rounded bg-black/40 border border-white/[0.05] text-[11px] text-[#a1a1aa] leading-relaxed">
                  <b className="text-white block mb-0.5">التبرير الموثق:</b>
                  {record.justification}
                </div>
                <div className="flex items-center justify-between text-[10px] text-[#82828c] pt-1">
                  <span>الموقع والمنفذ: <b className="text-white">{record.resolvedBy}</b></span>
                  <span>الطلبات: <b className="text-white font-mono">{record.affectedOrders.join('، ')}</b></span>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="flex justify-end pt-3 border-t border-white/[0.08]">
          <button
            type="button"
            onClick={onClose}
            className="sc-btn cursor-pointer"
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  )
}

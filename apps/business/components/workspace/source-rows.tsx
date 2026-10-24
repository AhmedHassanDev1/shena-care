'use client'

import { Notice } from '@/components/bw/primitives'

export interface SourceRowSummary {
  total: number
  admitted: number
  invalid: number
  duplicate: number
  outOfScope: number
  notAdmitted: Array<{ sourceRow: number; supplierSku: string; outcome: string; reason: string | null }>
}

const OUTCOME_LABEL: Record<string, string> = {
  INVALID: 'صف غير صالح',
  DUPLICATE: 'مكرر في الملف',
  OUT_OF_SCOPE: 'خارج نطاق المتجر',
}

/** Rows that never became catalog candidates or offers; shown so a clean-looking preview is never a silent drop. */
export function SourceRowOutcomes({ summary }: { summary?: SourceRowSummary }) {
  if (!summary || summary.notAdmitted.length === 0) return null
  return (
    <Notice
      tone={summary.invalid > 0 ? 'danger' : 'info'}
      title={`${summary.notAdmitted.length} من ${summary.total} صفاً في الملف لم يُقبل (${summary.invalid} غير صالح، ${summary.duplicate} مكرر، ${summary.outOfScope} خارج النطاق)`}
    >
      <p className="mb-2">هذه الصفوف لن تتحول إلى عروض أو منتجات. صحّح الملف وأعد رفعه إذا كانت مقصودة.</p>
      <ul className="space-y-1 text-xs">
        {summary.notAdmitted.slice(0, 50).map((row) => (
          <li key={`${row.sourceRow}-${row.outcome}`} className="flex flex-wrap gap-x-2">
            <span className="font-mono">#{row.sourceRow}</span>
            {row.supplierSku ? <span className="font-mono">{row.supplierSku}</span> : null}
            <span className="font-bold">{OUTCOME_LABEL[row.outcome] ?? row.outcome}</span>
            {row.reason ? <span dir="auto">— {row.reason}</span> : null}
          </li>
        ))}
      </ul>
      {summary.notAdmitted.length > 50 ? <p className="mt-1 text-xs">وعدد {summary.notAdmitted.length - 50} صفاً آخر غير معروض.</p> : null}
    </Notice>
  )
}

'use client'

import { Notice } from '@/components/bw/primitives'

export interface SourceRowSummary {
  total: number
  admitted: number
  invalid: number
  duplicate: number
  outOfScope: number
  policyHeld?: number
  policySkipped?: number
  skippedByReason?: Array<{ reason: string; count: number }>
  notAdmitted: Array<{ sourceRow: number; supplierSku: string; outcome: string; reason: string | null }>
}

const OUTCOME_LABEL: Record<string, string> = {
  INVALID: 'صف غير صالح',
  DUPLICATE: 'مكرر في الملف',
  OUT_OF_SCOPE: 'خارج نطاق المتجر',
  POLICY_SKIP: 'مستبعد بسياسة العلامة والتصنيف — SKIP',
  POLICY_HOLD: 'معلق لمراجعة العلامة أو التصنيف — HOLD',
}

/** Rows that never became catalog candidates or offers; shown so a clean-looking preview is never a silent drop. */
export function SourceRowOutcomes({ summary }: { summary?: SourceRowSummary }) {
  // Excluded rows arrive as counts per reason, so the row list alone cannot say whether anything was left out.
  const notAdmittedCount = summary ? summary.total - summary.admitted : 0
  if (!summary || notAdmittedCount <= 0) return null
  return (
    <Notice
      tone={summary.invalid > 0 ? 'danger' : 'info'}
      title={`${notAdmittedCount} من ${summary.total} صفاً في الملف لم يُقبل (${summary.invalid} غير صالح، ${summary.duplicate} مكرر، ${summary.outOfScope} مستبعد، ${summary.policyHeld ?? 0} معلق للمراجعة)`}
    >
      <p className="mb-2">هذه الصفوف لن تتحول إلى عروض أو منتجات. صفوف HOLD تنتظر مراجعة الإدارة للأسماء أو ربط التصنيف، ثم إعادة الفحص بإصدار معتمد.</p>
      {summary.skippedByReason?.length ? (
        <ul className="mb-2 space-y-1 text-xs">
          {summary.skippedByReason.map((group) => (
            <li key={group.reason} className="flex flex-wrap gap-x-2">
              <span className="font-bold">{OUTCOME_LABEL.POLICY_SKIP}</span>
              <span>{group.count} صف</span>
              <span dir="auto">— {group.reason}</span>
            </li>
          ))}
        </ul>
      ) : null}
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

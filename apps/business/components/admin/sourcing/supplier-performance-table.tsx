'use client'

import * as React from 'react'

export interface SupplierPerfRow {
  name: string
  area: string
  poCount: number
  onTimeRate: number
  avgResponseHours: number
  statusTone: 'ok' | 'warn' | 'danger'
  statusLabel: string
}

export const DEMO_SUPPLIER_PERF: SupplierPerfRow[] = [
  {
    name: 'صيدلية النور والهدى',
    area: 'المعادي',
    poCount: 57,
    onTimeRate: 94.2,
    avgResponseHours: 1.2,
    statusTone: 'ok',
    statusLabel: 'موثوق',
  },
  {
    name: 'صيدلية العزبي',
    area: 'مدينة نصر',
    poCount: 48,
    onTimeRate: 91.5,
    avgResponseHours: 1.5,
    statusTone: 'ok',
    statusLabel: 'موثوق',
  },
  {
    name: 'صيدلية الحياة',
    area: 'الدقي',
    poCount: 39,
    onTimeRate: 84.6,
    avgResponseHours: 2.8,
    statusTone: 'warn',
    statusLabel: 'يحتاج متابعة',
  },
  {
    name: 'صيدلية صيدناوي',
    area: 'المهندسين',
    poCount: 32,
    onTimeRate: 78.1,
    avgResponseHours: 3.6,
    statusTone: 'danger',
    statusLabel: 'تنبيه تأخير',
  },
  {
    name: 'مستودع الأمل للأدوية',
    area: 'وسط البلد',
    poCount: 26,
    onTimeRate: 96.0,
    avgResponseHours: 0.9,
    statusTone: 'ok',
    statusLabel: 'ممتاز',
  },
]

export function SupplierPerformanceTable({
  suppliers = DEMO_SUPPLIER_PERF,
}: {
  suppliers?: SupplierPerfRow[]
}) {
  return (
    <div className="sc-table-wrap overflow-x-auto">
      <table className="sc-table w-full text-xs">
        <thead>
          <tr className="border-b border-white/[0.08] text-bw-ink-subtle text-start">
            <th className="py-2.5 px-3">اسم المورد والمنطقة</th>
            <th className="py-2.5 px-3">أوامر التوريد</th>
            <th className="py-2.5 px-3">التأكيد في الموعد</th>
            <th className="py-2.5 px-3">متوسط الاستجابة</th>
            <th className="py-2.5 px-3">التقييم التشغيلي</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.06]">
          {suppliers.map((s, idx) => (
            <tr key={idx} className="hover:bg-white/[0.02] transition-colors">
              <td className="py-3 px-3">
                <span className="font-semibold text-white block">{s.name}</span>
                <span className="text-[11px] text-bw-ink-subtle">{s.area}</span>
              </td>
              <td className="py-3 px-3">
                <span className="sc-num font-mono font-bold text-white">{s.poCount}</span>
              </td>
              <td className="py-3 px-3">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-20 rounded-full bg-white/[0.08] overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${s.onTimeRate}%`,
                        background:
                          s.onTimeRate >= 90
                            ? 'var(--sc-green)'
                            : s.onTimeRate >= 80
                            ? 'var(--sc-amber)'
                            : 'var(--sc-rose)',
                      }}
                    />
                  </div>
                  <span className="sc-num text-xs font-mono">{s.onTimeRate}%</span>
                </div>
              </td>
              <td className="py-3 px-3">
                <span className="sc-num font-mono">{s.avgResponseHours}</span>{' '}
                <span className="text-bw-ink-subtle text-[11px]">ساعة</span>
              </td>
              <td className="py-3 px-3">
                {s.statusTone === 'ok' && (
                  <span className="sc-badge t-success">{s.statusLabel}</span>
                )}
                {s.statusTone === 'warn' && (
                  <span className="sc-badge t-warning">{s.statusLabel}</span>
                )}
                {s.statusTone === 'danger' && (
                  <span className="sc-badge t-danger">{s.statusLabel}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

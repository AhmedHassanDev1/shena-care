'use client'

import * as React from 'react'

export interface ZoneData {
  zone: string
  governorate: 'القاهرة' | 'الجيزة'
  shipmentCount: number
  successRate: number
  failedCount: number
}

export const CAIRO_GIZA_ZONES: ZoneData[] = [
  {
    zone: 'مدينة نصر ومصر الجديدة',
    governorate: 'القاهرة',
    shipmentCount: 72,
    successRate: 95.8,
    failedCount: 3,
  },
  {
    zone: 'التجمع والقاهرة الجديدة',
    governorate: 'القاهرة',
    shipmentCount: 48,
    successRate: 97.9,
    failedCount: 1,
  },
  {
    zone: 'الدقي والمهندسين',
    governorate: 'الجيزة',
    shipmentCount: 42,
    successRate: 95.2,
    failedCount: 2,
  },
  {
    zone: 'المعادي والمقطم',
    governorate: 'القاهرة',
    shipmentCount: 36,
    successRate: 94.4,
    failedCount: 2,
  },
  {
    zone: '6 أكتوبر والشيخ زايد',
    governorate: 'الجيزة',
    shipmentCount: 31,
    successRate: 90.3,
    failedCount: 3,
  },
]

export function ZonePerformanceList({ zones = CAIRO_GIZA_ZONES }: { zones?: ZoneData[] }) {
  return (
    <div className="sc-barlist space-y-3">
      {zones.map((z, idx) => (
        <div key={idx} className="sc-bl space-y-1">
          <div className="sc-bl-name flex items-center justify-between text-xs">
            <span className="font-medium text-white">
              <span className="text-[#34d27b] me-1">[{z.governorate}]</span>
              {z.zone}
            </span>
            <span className="sc-caption text-[11px] text-bw-ink-subtle">{z.shipmentCount} شحنة</span>
          </div>

          <div className="sc-bl-track h-2 w-full rounded-full bg-white/[0.06] overflow-hidden">
            <div
              className="sc-bl-fill h-full rounded-full transition-all duration-300"
              style={{
                width: `${z.successRate}%`,
                background: z.successRate >= 94 ? 'var(--sc-green)' : 'var(--sc-orange)',
              }}
            />
          </div>

          <div className="sc-bl-val flex items-center justify-between text-[11px] text-bw-ink-subtle">
            <b className={z.successRate >= 94 ? 'sc-num text-[#34d27b]' : 'sc-num text-[#ff783d]'}>
              {z.successRate}% تسليم ناجح
            </b>
            <span className="text-[#fb7185] font-mono">{z.failedCount} فشل</span>
          </div>
        </div>
      ))}
    </div>
  )
}

'use client'

import * as React from 'react'
import Link from 'next/link'
import { CheckCircle2 } from 'lucide-react'

export interface PipelineData {
  placed: number
  sourcing: number
  hubReceiving: number
  packing: number
  ready: number
  courier: number
  delivered: number
  overdue: {
    placed: number
    sourcing: number
    hubReceiving: number
    packing: number
    ready: number
    courier: number
  }
}

export function PipelineTracker({ pipeline }: { pipeline: PipelineData }) {
  const totalOverdue =
    pipeline.overdue.placed +
    pipeline.overdue.sourcing +
    pipeline.overdue.hubReceiving +
    pipeline.overdue.packing +
    pipeline.overdue.ready +
    pipeline.overdue.courier

  return (
    <section aria-label="مسار تدفق الطلبات" className="sc-card">
      <div className="sc-card-head flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="sc-card-title">مسار تجهيز وشحن الطلبات</h2>
          <div className="sc-card-note text-xs text-bw-ink-subtle flex items-center gap-2">
            <span>التدفق اللحظي لطلبات العملاء عبر مراحل التوريد والمخزن المركزي والتوصيل الميداني</span>
            <span className="sep" />
            <span className="text-[#34d27b]">نطاق العمليات: القاهرة والجيزة</span>
          </div>
        </div>

        <div className="sc-pipe-stats flex items-center gap-4 text-xs">
          <div className="sc-stat">
            <span className="text-bw-ink-soft">المكتمل اليوم: </span>
            <b className="sc-num text-[#34d27b]">{pipeline.delivered}</b>
          </div>
          <div className="sc-stat">
            <span className="text-bw-ink-soft">إجمالي المتأخر: </span>
            <b className="sc-num text-[#fb7185]">{totalOverdue}</b>
          </div>
          <div className="sc-stat">
            <span className="text-bw-ink-soft">قيد التجهيز بالمخزن: </span>
            <b className="sc-num text-white">{pipeline.packing}</b>
          </div>
        </div>
      </div>

      {/* 7 Stages */}
      <div className="sc-stages grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5 mt-4">
        {/* Stage 1: طلبات جديدة */}
        <Link href="/admin/orders?status=placed" className="sc-stage" title="عرض الطلبات الجديدة">
          <div className="sc-stage-top">
            <span className="sc-stage-name">1. طلبات جديدة</span>
          </div>
          <div className="sc-stage-count sc-num">{pipeline.placed}</div>
          <div className="sc-stage-bar">
            <span className="ok" style={{ width: '88%' }} />
            <span className="late" style={{ width: '12%' }} />
          </div>
          <div className="sc-stage-meta">
            <span className="late-txt">{pipeline.overdue.placed} متأخرة</span>
            <span className="time">متوسط 15 د</span>
          </div>
        </Link>

        {/* Stage 2: توريد الموردين */}
        <Link href="/admin/sourcing" className="sc-stage is-bottleneck" title="عرض أوامر التوريد والشراء">
          <div className="sc-stage-top">
            <span className="sc-stage-name">2. توريد الموردين</span>
            <span className="sc-stage-flag">
              <span className="sc-badge t-warning text-[10px] px-1 py-0 h-4">متابعة</span>
            </span>
          </div>
          <div className="sc-stage-count sc-num text-[#f5a524]">{pipeline.sourcing}</div>
          <div className="sc-stage-bar">
            <span className="ok" style={{ width: '75%' }} />
            <span className="late" style={{ width: '25%' }} />
          </div>
          <div className="sc-stage-meta">
            <span className="late-txt has text-[#f5a524]">{pipeline.overdue.sourcing} متأخرة</span>
            <span className="time over">متوسط 3.2 س</span>
          </div>
        </Link>

        {/* Stage 3: استلام المخزن */}
        <Link href="/admin/hub" className="sc-stage" title="متابعة استلامات المخزن المركزي">
          <div className="sc-stage-top">
            <span className="sc-stage-name">3. استلام المخزن</span>
          </div>
          <div className="sc-stage-count sc-num">{pipeline.hubReceiving}</div>
          <div className="sc-stage-bar">
            <span className="ok" style={{ width: '95%' }} />
            <span className="late" style={{ width: '5%' }} />
          </div>
          <div className="sc-stage-meta">
            <span className="late-txt">{pipeline.overdue.hubReceiving} متأخرة</span>
            <span className="time">متوسط 45 د</span>
          </div>
        </Link>

        {/* Stage 4: تجهيز وتغليف */}
        <Link href="/admin/hub" className="sc-stage" title="متابعة محطات التجهيز والتغليف">
          <div className="sc-stage-top">
            <span className="sc-stage-name">4. تجهيز وتغليف</span>
          </div>
          <div className="sc-stage-count sc-num">{pipeline.packing}</div>
          <div className="sc-stage-bar">
            <span className="ok" style={{ width: '89%' }} />
            <span className="late" style={{ width: '11%' }} />
          </div>
          <div className="sc-stage-meta">
            <span className="late-txt">{pipeline.overdue.packing} متأخرة</span>
            <span className="time">متوسط 1.5 س</span>
          </div>
        </Link>

        {/* Stage 5: جاهز للشحن */}
        <Link href="/admin/delivery" className="sc-stage" title="عرض الشحنات الجاهزة للتسليم">
          <div className="sc-stage-top">
            <span className="sc-stage-name">5. جاهز للشحن</span>
          </div>
          <div className="sc-stage-count sc-num">{pipeline.ready}</div>
          <div className="sc-stage-bar">
            <span className="ok" style={{ width: '100%' }} />
          </div>
          <div className="sc-stage-meta">
            <span className="late-txt">0 متأخرة</span>
            <span className="time">متوسط 30 د</span>
          </div>
        </Link>

        {/* Stage 6: مع المندوب */}
        <Link href="/admin/delivery" className="sc-stage" title="تتبع مشاوير مناديب التوصيل">
          <div className="sc-stage-top">
            <span className="sc-stage-name">6. مع المندوب</span>
          </div>
          <div className="sc-stage-count sc-num">{pipeline.courier}</div>
          <div className="sc-stage-bar">
            <span className="ok" style={{ width: '91%' }} />
            <span className="late" style={{ width: '9%' }} />
          </div>
          <div className="sc-stage-meta">
            <span className="late-txt">{pipeline.overdue.courier} متأخرة</span>
            <span className="time">متوسط 2.4 س</span>
          </div>
        </Link>

        {/* Stage 7: تم التسليم */}
        <Link href="/admin/orders?status=delivered" className="sc-stage is-done" title="عرض الطلبات المسلمة">
          <div className="sc-stage-top">
            <span className="sc-stage-name">7. تم التسليم</span>
            <CheckCircle2 className="size-3.5 text-[#34d27b] ms-auto" />
          </div>
          <div className="sc-stage-count sc-num text-[#34d27b]">{pipeline.delivered}</div>
          <div className="sc-stage-bar">
            <span className="ok" style={{ width: '100%', background: 'var(--sc-green)' }} />
          </div>
          <div className="sc-stage-meta">
            <span className="late-txt text-[#34d27b]">94% في الموعد</span>
            <span className="time">متوسط 4.1 س</span>
          </div>
        </Link>
      </div>
    </section>
  )
}

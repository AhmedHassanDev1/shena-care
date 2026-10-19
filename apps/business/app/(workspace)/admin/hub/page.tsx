'use client'

import * as React from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  ExternalLink,
  PackageCheck,
  PackageOpen,
  Printer,
  RefreshCw,
  ScanLine,
  Warehouse,
} from 'lucide-react'
import { Code, DataTable, PageHeader, Section, Skeleton, StateBlock, StatusLabel } from '@/components/bw/primitives'
import { Egp, Page, Select, Status } from '@/components/workspace/kit'
import { LoadError, RoleShell, useMe } from '@/components/workspace/role-shell'
import { formatDateTime, shortId } from '@/lib/labels'
import { useApi } from '@/lib/use-api'
import { cn } from '@/lib/utils'

interface HubReceivableItem {
  id: string
  purchaseOrderId: string
  supplierName: string
  skuTitle: string
  skuCode: string
  expectedQuantity: number
  receivedQuantity: number
  readyAt: string | null
}

interface HubShipmentItem {
  id: string
  orderNumber: string
  destinationArea: string
  itemCount: number
  prepStatus: 'allocated' | 'picking' | 'packed' | 'labeled'
  slaElapsedMinutes: number
  dispatchedAt: string | null
}

const DEMO_RECEIVABLES: HubReceivableItem[] = [
  {
    id: 'rec-1',
    purchaseOrderId: 'PO-1042',
    supplierName: 'صيدلية النور والهدى (المعادي)',
    skuTitle: 'سيروم هيالورونيك أسيد 30 مل',
    skuCode: 'SKU-HA-30',
    expectedQuantity: 25,
    receivedQuantity: 0,
    readyAt: '10:15 ص',
  },
  {
    id: 'rec-2',
    purchaseOrderId: 'PO-1043',
    supplierName: 'مستودع الأمل للأدوية (وسط البلد)',
    skuTitle: 'كريم مرطب سيرافي 454 جم',
    skuCode: 'SKU-CV-454',
    expectedQuantity: 40,
    receivedQuantity: 18,
    readyAt: '10:30 ص',
  },
  {
    id: 'rec-3',
    purchaseOrderId: 'PO-1045',
    supplierName: 'صيدلية العزبي (مدينة نصر)',
    skuTitle: 'واقي شمس لاروش بوزيه 50 مل',
    skuCode: 'SKU-LR-50',
    expectedQuantity: 15,
    receivedQuantity: 0,
    readyAt: '10:50 ص',
  },
]

const DEMO_HUB_SHIPMENTS: HubShipmentItem[] = [
  {
    id: 'shp-891',
    orderNumber: '#1203',
    destinationArea: 'مدينة نصر - الحي السابع',
    itemCount: 3,
    prepStatus: 'picking',
    slaElapsedMinutes: 18,
    dispatchedAt: null,
  },
  {
    id: 'shp-892',
    orderNumber: '#1204',
    destinationArea: 'المعادي - دجلة',
    itemCount: 2,
    prepStatus: 'packed',
    slaElapsedMinutes: 24,
    dispatchedAt: null,
  },
  {
    id: 'shp-893',
    orderNumber: '#1205',
    destinationArea: 'الدقي - شارع مصدق',
    itemCount: 4,
    prepStatus: 'labeled',
    slaElapsedMinutes: 29,
    dispatchedAt: null,
  },
  {
    id: 'shp-894',
    orderNumber: '#1206',
    destinationArea: 'المهندسين - شارع سوريا',
    itemCount: 1,
    prepStatus: 'allocated',
    slaElapsedMinutes: 38,
    dispatchedAt: null,
  },
]

export default function AdminHubPage() {
  const me = useMe()
  const primaryHub = me.hubLocations[0] || { id: 'hub-cairo-central', name: 'المخزن المركزي - المعادي' }

  const [activeTab, setActiveTab] = React.useState<'overview' | 'receivables' | 'shipments'>('overview')

  return (
    <RoleShell role="admin" active="hub" mode="desktop">
      <div className="sc-glow p-4 sm:p-6 lg:p-8 space-y-6 max-w-[1680px] mx-auto min-h-screen">
        {/* Header */}
        <div className="sc-pagehead flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="sc-title-row flex items-center gap-2.5">
              <h1 className="sc-page-title">إدارة المخزن والتجهيز</h1>
              <span className="sc-badge t-success">
                <Warehouse className="size-3.5" />
                {primaryHub.name} · نشط
              </span>
              <span className="sc-badge text-xs bg-white/[0.04]">
                يخدم نطاق القاهرة والجيزة
              </span>
            </div>
            <p className="sc-takeaway text-xs text-bw-ink-soft mt-1">
              إشراف ومتابعة تدفق استلام بضائع الموردين، ومحطات الفحص، والتجهيز، والتغليف قبل التسليم لأسطول المناديب.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/hub"
              className="sc-btn sm flex items-center gap-1.5"
              title="الانتقال إلى واجهة محطة المخزن الميدانية"
            >
              <ExternalLink className="size-3.5" />
              <span>محطة المخزن الميدانية</span>
            </Link>
          </div>
        </div>

        {/* 4 Hub Throughput KPIs */}
        <section aria-label="مؤشرات أداء المخزن" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="sc-card p-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-bw-ink-subtle">
              <span>متوسط وقت التجهيز (SLA)</span>
              <Clock className="size-4 text-[#f5a524]" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="sc-num text-2xl font-bold text-[#f5a524]">31.5 دقيقة</span>
              <span className="text-[11px] text-bw-ink-subtle">المستهدف &lt; 30 د</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-white/[0.08] overflow-hidden">
              <div className="h-full bg-amber-400 rounded-full" style={{ width: '85%' }} />
            </div>
            <span className="text-[10px] text-[#f5a524] block">زيادة 4.2 دقيقة عن المستهدف المعتمد</span>
          </div>

          <div className="sc-card p-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-bw-ink-subtle">
              <span>قيد التجهيز والتغليف</span>
              <ScanLine className="size-4 text-[#34d27b]" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="sc-num text-2xl font-bold text-white">28 شحنة</span>
              <span className="text-[11px] text-[#34d27b]">طاقة 85%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-white/[0.08] overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full" style={{ width: '85%' }} />
            </div>
            <span className="text-[10px] text-bw-ink-subtle block">توزيع على 4 طاولات تعبئة نشطة</span>
          </div>

          <div className="sc-card p-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-bw-ink-subtle">
              <span>استلامات بانتظار الفحص</span>
              <PackageOpen className="size-4 text-[#60a5fa]" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="sc-num text-2xl font-bold text-white">22 صنف</span>
              <span className="text-[11px] text-[#60a5fa]">من 3 موردين</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-white/[0.08] overflow-hidden">
              <div className="h-full bg-blue-400 rounded-full" style={{ width: '60%' }} />
            </div>
            <span className="text-[10px] text-bw-ink-subtle block">معدل الفحص: 12 دقيقة / دفعة</span>
          </div>

          <div className="sc-card p-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-bw-ink-subtle">
              <span>جاهز للانطلاق (ختم وتغليف)</span>
              <PackageCheck className="size-4 text-[#34d27b]" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="sc-num text-2xl font-bold text-[#34d27b]">15 طرد</span>
              <span className="text-[11px] text-bw-ink-subtle">بانتظار تسليم الكباتن</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-white/[0.08] overflow-hidden">
              <div className="h-full bg-emerald-400 rounded-full" style={{ width: '100%' }} />
            </div>
            <span className="text-[10px] text-bw-ink-subtle block">مرتبة حسب مسارات الأحياء</span>
          </div>
        </section>

        {/* Operational Stations Quick Jump */}
        <section aria-label="محطات العمليات المباشرة" className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Link
            href="/hub/receive"
            className="sc-card p-3.5 flex items-center justify-between hover:border-[#34d27b]/40 transition-colors group"
          >
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-xl bg-blue-500/15 text-blue-400 border border-blue-500/25">
                <PackageOpen className="size-4.5" />
              </div>
              <div>
                <b className="text-xs font-bold text-white block group-hover:text-[#34d27b] transition-colors">
                  محطة الاستلام والفحص
                </b>
                <span className="text-[11px] text-bw-ink-subtle">مطابقة باركود المورد وصلاحية الدفعة</span>
              </div>
            </div>
            <ArrowLeft className="size-4 text-bw-ink-subtle group-hover:translate-x-[-2px] transition-transform" />
          </Link>

          <Link
            href="/hub/prepare"
            className="sc-card p-3.5 flex items-center justify-between hover:border-[#34d27b]/40 transition-colors group"
          >
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400 border border-amber-500/25">
                <ScanLine className="size-4.5" />
              </div>
              <div>
                <b className="text-xs font-bold text-white block group-hover:text-[#34d27b] transition-colors">
                  محطة التجهيز والتجميع
                </b>
                <span className="text-[11px] text-bw-ink-subtle">مسح قطع الطلبات وإرفاق الهدايا</span>
              </div>
            </div>
            <ArrowLeft className="size-4 text-bw-ink-subtle group-hover:translate-x-[-2px] transition-transform" />
          </Link>

          <Link
            href="/hub/pack"
            className="sc-card p-3.5 flex items-center justify-between hover:border-[#34d27b]/40 transition-colors group"
          >
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-xl bg-emerald-500/15 text-[#34d27b] border border-[#34d27b]/25">
                <Printer className="size-4.5" />
              </div>
              <div>
                <b className="text-xs font-bold text-white block group-hover:text-[#34d27b] transition-colors">
                  التغليف والطباعة الحرارية
                </b>
                <span className="text-[11px] text-bw-ink-subtle">طباعة بوليصة الشحن وبطاقة الطرد</span>
              </div>
            </div>
            <ArrowLeft className="size-4 text-bw-ink-subtle group-hover:translate-x-[-2px] transition-transform" />
          </Link>
        </section>

        {/* Tabbed In-Depth Queues */}
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b border-white/[0.08] pb-2">
            <div className="sc-seg" role="tablist">
              <button
                type="button"
                role="tab"
                aria-pressed={activeTab === 'overview'}
                onClick={() => setActiveTab('overview')}
              >
                شحنات قيد التجهيز بالمخزن ({DEMO_HUB_SHIPMENTS.length})
              </button>
              <button
                type="button"
                role="tab"
                aria-pressed={activeTab === 'receivables'}
                onClick={() => setActiveTab('receivables')}
              >
                استلامات الموردين الواردة ({DEMO_RECEIVABLES.length})
              </button>
            </div>
            <span className="text-xs text-bw-ink-subtle">
              المخزن المركزي · المعادي
            </span>
          </div>

          {activeTab === 'overview' && (
            <div className="sc-card space-y-4">
              <div className="sc-card-head flex items-center justify-between">
                <div>
                  <h2 className="sc-card-title">شحنات قيد الإعداد والتغليف بالمخزن</h2>
                  <p className="sc-caption mt-0.5">متابعة زمن إنجاز الطرود لتفادي تأخير مواعيد انطلاق دورات التوصيل</p>
                </div>
              </div>

              <div className="sc-table-wrap overflow-x-auto">
                <table className="sc-table w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/[0.08] text-bw-ink-subtle text-start">
                      <th className="py-2.5 px-3">رقم الطلب</th>
                      <th className="py-2.5 px-3">منطقة التسليم</th>
                      <th className="py-2.5 px-3">القطع</th>
                      <th className="py-2.5 px-3">مرحلة الإعداد</th>
                      <th className="py-2.5 px-3">زمن المعالجة</th>
                      <th className="py-2.5 px-3 text-end">إجراء</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06]">
                    {DEMO_HUB_SHIPMENTS.map((s) => (
                      <tr key={s.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="py-3 px-3 font-mono font-bold text-white">
                          <Link href="/admin/orders" className="hover:text-[#34d27b]">
                            {s.orderNumber}
                          </Link>
                        </td>
                        <td className="py-3 px-3 text-white">{s.destinationArea}</td>
                        <td className="py-3 px-3 font-mono">{s.itemCount} قطع</td>
                        <td className="py-3 px-3">
                          {s.prepStatus === 'allocated' && <span className="sc-badge">تم تخصيص المخزون</span>}
                          {s.prepStatus === 'picking' && <span className="sc-badge t-warning">قيد التجميع</span>}
                          {s.prepStatus === 'packed' && <span className="sc-badge t-info">تم التغليف</span>}
                          {s.prepStatus === 'labeled' && <span className="sc-badge t-success">مختوم للشحن</span>}
                        </td>
                        <td className="py-3 px-3 font-mono">
                          <span className={cn('text-xs font-semibold', s.slaElapsedMinutes > 30 ? 'text-[#fb7185]' : 'text-white')}>
                            {s.slaElapsedMinutes} دقيقة
                          </span>
                          {s.slaElapsedMinutes > 30 && <span className="text-[10px] text-[#fb7185] ms-1">(تجاوز SLA)</span>}
                        </td>
                        <td className="py-3 px-3 text-end">
                          <Link href="/hub/prepare" className="sc-btn sm">
                            فحص المحطة
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'receivables' && (
            <div className="sc-card space-y-4">
              <div className="sc-card-head flex items-center justify-between">
                <div>
                  <h2 className="sc-card-title">استلامات بضائع الموردين الواردة</h2>
                  <p className="sc-caption mt-0.5">البضائع الصادرة بأوامر شراء والتي تصل إلى رصيف استلام مخزن المعادي</p>
                </div>
              </div>

              <div className="sc-table-wrap overflow-x-auto">
                <table className="sc-table w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/[0.08] text-bw-ink-subtle text-start">
                      <th className="py-2.5 px-3">أمر الشراء</th>
                      <th className="py-2.5 px-3">اسم المورد</th>
                      <th className="py-2.5 px-3">المنتج والكود</th>
                      <th className="py-2.5 px-3">الكمية المتوقعة</th>
                      <th className="py-2.5 px-3">الوارد فعلياً</th>
                      <th className="py-2.5 px-3">الموعد المستهدف</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06]">
                    {DEMO_RECEIVABLES.map((r) => (
                      <tr key={r.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="py-3 px-3 font-mono font-bold text-white">
                          <Link href="/admin/sourcing" className="hover:text-[#ff783d]">
                            {r.purchaseOrderId}
                          </Link>
                        </td>
                        <td className="py-3 px-3 text-white font-medium">{r.supplierName}</td>
                        <td className="py-3 px-3">
                          <span className="text-white block">{r.skuTitle}</span>
                          <span className="text-[10px] font-mono text-bw-ink-subtle">{r.skuCode}</span>
                        </td>
                        <td className="py-3 px-3 font-mono font-bold">{r.expectedQuantity} عبوة</td>
                        <td className="py-3 px-3 font-mono">
                          <span className={r.receivedQuantity > 0 ? 'text-[#34d27b]' : 'text-bw-ink-subtle'}>
                            {r.receivedQuantity}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-bw-ink-subtle">{r.readyAt || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </RoleShell>
  )
}

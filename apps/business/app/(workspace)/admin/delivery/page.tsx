'use client'

import * as React from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  ExternalLink,
  MapPin,
  Phone,
  RefreshCw,
  Route,
  ShieldAlert,
  Truck,
  UserRound,
  Wallet,
} from 'lucide-react'
import { Code, DataTable, PageHeader, Section, Skeleton, StateBlock, StatusLabel } from '@/components/bw/primitives'
import { Egp, Page, Select, Status } from '@/components/workspace/kit'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { ZonePerformanceList, CAIRO_GIZA_ZONES } from '@/components/admin/delivery/zone-performance'
import { useApi } from '@/lib/use-api'
import { cn } from '@/lib/utils'

interface CourierRunItem {
  id: string
  driverName: string
  driverPhone: string
  zone: string
  totalStops: number
  completedStops: number
  status: 'active' | 'completed' | 'paused'
  expectedCod: number
  collectedCod: number
}

interface FailedDeliveryItem {
  orderId: string
  orderNumber: string
  customerName: string
  customerPhone: string
  zone: string
  failureReason: string
  attemptCount: number
  lastAttemptAt: string
}

const DEMO_COURIER_RUNS: CourierRunItem[] = [
  {
    id: 'run-101',
    driverName: 'محمود عبد الفتاح',
    driverPhone: '01019283741',
    zone: 'مدينة نصر - مصر الجديدة',
    totalStops: 14,
    completedStops: 11,
    status: 'active',
    expectedCod: 5400,
    collectedCod: 4250,
  },
  {
    id: 'run-102',
    driverName: 'كريم عثمان',
    driverPhone: '01192837465',
    zone: 'التجمع الخامس - القاهرة الجديدة',
    totalStops: 12,
    completedStops: 10,
    status: 'active',
    expectedCod: 6100,
    collectedCod: 5120,
  },
  {
    id: 'run-103',
    driverName: 'عمر الصاوي',
    driverPhone: '01283746591',
    zone: 'الدقي - المهندسين',
    totalStops: 15,
    completedStops: 14,
    status: 'active',
    expectedCod: 4800,
    collectedCod: 4500,
  },
  {
    id: 'run-104',
    driverName: 'حسام البدري',
    driverPhone: '01582736452',
    zone: '6 أكتوبر - الشيخ زايد',
    totalStops: 10,
    completedStops: 6,
    status: 'active',
    expectedCod: 3900,
    collectedCod: 2400,
  },
]

const DEMO_FAILED_DELIVERIES: FailedDeliveryItem[] = [
  {
    orderId: 'ord-1189',
    orderNumber: '#1189',
    customerName: 'أحمد إبراهيم',
    customerPhone: '01012345678',
    zone: 'الحي السابع - مدينة نصر',
    failureReason: 'تعارض إحداثيات GPS وعدم الرد هاتفياً بعد محاولتين',
    attemptCount: 2,
    lastAttemptAt: '10:10 ص',
  },
  {
    orderId: 'ord-1199',
    orderNumber: '#1199',
    customerName: 'نور إبراهيم',
    customerPhone: '01123456789',
    zone: 'الحي المتميز - 6 أكتوبر',
    failureReason: 'العميل طلب تأجيل الاستلام للغد (سفر طارئ)',
    attemptCount: 1,
    lastAttemptAt: '08:55 ص',
  },
]

export default function AdminDeliveryPage() {
  const [activeTab, setActiveTab] = React.useState<'zones' | 'runs' | 'exceptions'>('zones')

  return (
    <RoleShell role="admin" active="delivery" mode="desktop">
      <div className="sc-glow p-4 sm:p-6 lg:p-8 space-y-6 max-w-[1680px] mx-auto min-h-screen">
        {/* Header */}
        <div className="sc-pagehead flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="sc-title-row flex items-center gap-2.5">
              <h1 className="sc-page-title">عمليات التوصيل والمناديب</h1>
              <span className="sc-badge t-success">
                <Truck className="size-3.5" />
                4 مشاوير نشطة
              </span>
              <span className="sc-badge text-xs bg-white/[0.04]">
                قطاعات القاهرة والجيزة
              </span>
            </div>
            <p className="sc-takeaway text-xs text-bw-ink-soft mt-1">
              إشراف ومتابعة أسطول التوزيع الميداني، والتزام مسارات الأحياء، ونسب الإنجاز ومعالجة معلقات التسليم.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/hub/dispatch"
              className="sc-btn sm flex items-center gap-1.5"
              title="الانتقال إلى محطة خروج وتوزيع المخزن الميدانية"
            >
              <ExternalLink className="size-3.5" />
              <span>محطة خروج المخزن</span>
            </Link>
          </div>
        </div>

        {/* 4 Delivery KPIs */}
        <section aria-label="مؤشرات أداء التوصيل" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="sc-card p-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-bw-ink-subtle">
              <span>نسبة إتمام التوصيل</span>
              <CheckCircle2 className="size-4 text-[#34d27b]" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="sc-num text-2xl font-bold text-[#34d27b]">93.5%</span>
              <span className="text-[11px] text-bw-ink-subtle">المستهدف 95.0%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-white/[0.08] overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full" style={{ width: '93.5%' }} />
            </div>
            <span className="text-[10px] text-[#34d27b] block">157 من 168 شحنة تسليم اليوم</span>
          </div>

          <div className="sc-card p-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-bw-ink-subtle">
              <span>مع المناديب للتوصيل</span>
              <Truck className="size-4 text-[#60a5fa]" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="sc-num text-2xl font-bold text-white">47 شحنة</span>
              <span className="text-[11px] text-[#60a5fa]">+12% عن الأمس</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-white/[0.08] overflow-hidden">
              <div className="h-full bg-blue-500 rounded-full" style={{ width: '70%' }} />
            </div>
            <span className="text-[10px] text-bw-ink-subtle block">موزعة على 4 كباتن بالميدان</span>
          </div>

          <div className="sc-card p-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-bw-ink-subtle">
              <span>محاولات تسليم فاشلة</span>
              <AlertTriangle className="size-4 text-[#fb7185]" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="sc-num text-2xl font-bold text-[#fb7185]">5 شحنات</span>
              <span className="text-[11px] text-[#fb7185]">تتطلب قراراً</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-white/[0.08] overflow-hidden">
              <div className="h-full bg-red-500 rounded-full" style={{ width: '35%' }} />
            </div>
            <span className="text-[10px] text-bw-ink-subtle block">إعادة جدولة أو تدقيق العنوان</span>
          </div>

          <div className="sc-card p-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-bw-ink-subtle">
              <span>بانتظار تعيين مندوب</span>
              <Clock className="size-4 text-[#f5a524]" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="sc-num text-2xl font-bold text-white">4 شحنات</span>
              <span className="text-[11px] text-[#f5a524]">مسار الدقي</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-white/[0.08] overflow-hidden">
              <div className="h-full bg-amber-500 rounded-full" style={{ width: '40%' }} />
            </div>
            <span className="text-[10px] text-bw-ink-subtle block">جاهزة ومختومة بالمخزن المركزي</span>
          </div>
        </section>

        {/* Tabbed Content: Zones Coverage | Courier Runs | Exceptions */}
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b border-white/[0.08] pb-2">
            <div className="sc-seg" role="tablist">
              <button
                type="button"
                role="tab"
                aria-pressed={activeTab === 'zones'}
                onClick={() => setActiveTab('zones')}
              >
                تغطية الأحياء والمناطق (القاهرة والجيزة)
              </button>
              <button
                type="button"
                role="tab"
                aria-pressed={activeTab === 'runs'}
                onClick={() => setActiveTab('runs')}
              >
                مشاوير الكباتن الحالية ({DEMO_COURIER_RUNS.length})
              </button>
              <button
                type="button"
                role="tab"
                aria-pressed={activeTab === 'exceptions'}
                onClick={() => setActiveTab('exceptions')}
              >
                معلقات التسليم والمحاولات الفاشلة ({DEMO_FAILED_DELIVERIES.length})
              </button>
            </div>
            <span className="text-xs text-bw-ink-subtle">
              أسطول التوصيل النشط
            </span>
          </div>

          {/* Tab 1: Zone Performance */}
          {activeTab === 'zones' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
              <div className="lg:col-span-2 sc-card p-5 space-y-4">
                <div className="sc-card-head flex items-center justify-between">
                  <div>
                    <h2 className="sc-card-title">نسب التسليم الميداني حسب المناطق</h2>
                    <p className="sc-caption mt-0.5">معدلات الوصول والتسليم الناجح لقطاعات القاهرة الكبرى المعتمدة</p>
                  </div>
                </div>
                <ZonePerformanceList />
              </div>

              {/* Geographic Overview Side Card */}
              <div className="sc-card p-5 space-y-4">
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                  سياسات التوزيع المعتمدة
                </h3>
                <ul className="space-y-3 text-xs text-bw-ink-soft">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="size-4 text-[#34d27b] shrink-0 mt-0.5" />
                    <span>تأكيد إحداثيات الموقع (GPS Pin) إلزامي لجميع طلبات العملاء قبل الإسناد.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="size-4 text-[#34d27b] shrink-0 mt-0.5" />
                    <span>الحد الأقصى لسعة حقيبة المندوب في الدورة الواحدة: 12-15 طرد.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="size-4 text-[#34d27b] shrink-0 mt-0.5" />
                    <span>تجميد الشحنة وتصعيدها للإدارة فور فشل المحاولة الميدانية الثانية.</span>
                  </li>
                </ul>
              </div>
            </div>
          )}

          {/* Tab 2: Active Courier Runs */}
          {activeTab === 'runs' && (
            <div className="sc-card space-y-4">
              <div className="sc-card-head flex items-center justify-between">
                <div>
                  <h2 className="sc-card-title">مشاوير مناديب التوصيل النشطة</h2>
                  <p className="sc-caption mt-0.5">متابعة الموقع والمحطات المنجزة والمبالغ النقدية المحصلة لحظياً</p>
                </div>
              </div>

              <div className="sc-table-wrap overflow-x-auto">
                <table className="sc-table w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/[0.08] text-bw-ink-subtle text-start">
                      <th className="py-2.5 px-3">الكابتن</th>
                      <th className="py-2.5 px-3">منطقة المسار</th>
                      <th className="py-2.5 px-3">المحطات المنجزة</th>
                      <th className="py-2.5 px-3">النقدية المحصلة (COD)</th>
                      <th className="py-2.5 px-3">الحالة</th>
                      <th className="py-2.5 px-3 text-end">اتصال</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06]">
                    {DEMO_COURIER_RUNS.map((run) => (
                      <tr key={run.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="py-3 px-3">
                          <span className="font-bold text-white block">{run.driverName}</span>
                          <span className="text-[11px] font-mono text-bw-ink-subtle" dir="ltr">{run.driverPhone}</span>
                        </td>
                        <td className="py-3 px-3 text-white">{run.zone}</td>
                        <td className="py-3 px-3 font-mono">
                          <span className="text-[#34d27b] font-bold">{run.completedStops}</span> / {run.totalStops} محطة
                        </td>
                        <td className="py-3 px-3 font-mono">
                          <span className="text-white font-bold">{run.collectedCod.toLocaleString('en-US')}</span> / {run.expectedCod.toLocaleString('en-US')} ج.م
                        </td>
                        <td className="py-3 px-3">
                          <span className="sc-badge t-success">في المسار</span>
                        </td>
                        <td className="py-3 px-3 text-end">
                          <a href={`tel:${run.driverPhone}`} className="sc-btn sm">
                            <Phone className="size-3.5" />
                            <span>اتصال</span>
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Tab 3: Failed Deliveries & Recovery Queue */}
          {activeTab === 'exceptions' && (
            <div className="sc-card space-y-4">
              <div className="sc-card-head flex items-center justify-between">
                <div>
                  <h2 className="sc-card-title">معلقات التوصيل ومحاولات التسليم الفاشلة</h2>
                  <p className="sc-caption mt-0.5">شحنات واجهت تعثر ميداني وتحتاج لتدقيق إداري أو إعادة جدولة</p>
                </div>
              </div>

              <div className="space-y-3">
                {DEMO_FAILED_DELIVERIES.map((f) => (
                  <div key={f.orderId} className="p-4 rounded-xl border border-red-500/20 bg-red-500/[0.02] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div className="space-y-1.5 flex-1">
                      <div className="flex items-center gap-2">
                        <Link href={`/admin/orders/${f.orderId}`} className="font-mono font-bold text-white hover:text-[#34d27b]">
                          {f.orderNumber}
                        </Link>
                        <span className="text-white font-semibold">· {f.customerName}</span>
                        <span className="sc-badge t-danger font-mono text-[10px]">فشل محاولة {f.attemptCount}</span>
                      </div>
                      <p className="text-xs text-[#fb7185]">{f.failureReason}</p>
                      <div className="text-[11px] text-bw-ink-subtle flex items-center gap-2">
                        <span>المنطقة: {f.zone}</span>
                        <span>·</span>
                        <span>آخر محاولة: {f.lastAttemptAt}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Link href="/admin/exceptions" className="sc-btn sm primary">
                        معالجة في مركز الاستثناءات
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </RoleShell>
  )
}

'use client'

import * as React from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  CheckCircle2,
  Filter,
  History,
  Layers,
  Search,
  ShieldAlert,
  Store,
  Truck,
  Wallet,
  Clock,
  ArrowRight,
  RefreshCw,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { RoleShell } from '@/components/workspace/role-shell'
import { ExceptionCard } from '@/components/admin/exceptions/exception-card'
import { ResolveExceptionModal } from '@/components/admin/exceptions/resolve-modal'
import { AuditTrailModal } from '@/components/admin/exceptions/audit-trail-modal'
import {
  INITIAL_EXCEPTIONS,
  type AllowedOutcome,
  type AuditRecord,
  type OperationalException,
} from '@/components/admin/exceptions/exception-types'

export default function AdminExceptionsPage() {
  const [exceptions, setExceptions] = React.useState<OperationalException[]>(INITIAL_EXCEPTIONS)
  const [auditRecords, setAuditRecords] = React.useState<AuditRecord[]>([
    {
      id: 'aud-001',
      exceptionId: 'exc-archived-1',
      title: 'تعذر التوصيل لتلف الملصق برقم التتبع #TRK-9812',
      resolvedAt: 'اليوم، 09:15 ص',
      resolvedBy: 'مدير العمليات المركزية',
      outcomeLabel: 'إعادة طباعة الباركود والإدراج بمسار التوصيل المسائي',
      justification: 'تم التحقق من سلامة البضاعة وتأكيد عنوان العميل هاتفياً.',
      affectedOrders: ['#1145'],
    },
    {
      id: 'aud-002',
      exceptionId: 'exc-archived-2',
      title: 'عجز توريد معجون تبييض أسنان - صيدلية الشروق',
      resolvedAt: 'أمس، 05:40 م',
      resolvedBy: 'مسؤول التوريد المركزي',
      outcomeLabel: 'اعتماد صنف بديل معتمد وإشعار العملاء',
      justification: 'موافقة العميل على الحجم البديل هاتفياً مع تثبيت السعر الأصلي.',
      affectedOrders: ['#1089', '#1091'],
    },
  ])

  const [selectedCategory, setSelectedCategory] = React.useState<string>('all')
  const [selectedSeverity, setSelectedSeverity] = React.useState<string>('all')
  const [searchQuery, setSearchQuery] = React.useState<string>('')
  const [activeModalExc, setActiveModalExc] = React.useState<OperationalException | null>(null)
  const [isAuditModalOpen, setIsAuditModalOpen] = React.useState<boolean>(false)
  const [toastMessage, setToastMessage] = React.useState<string | null>(null)
  const [isResolving, setIsResolving] = React.useState(false)

  const showToast = (msg: string) => {
    setToastMessage(msg)
    setTimeout(() => setToastMessage(null), 4500)
  }

  const handleOpenResolve = (exc: OperationalException) => {
    setActiveModalExc(exc)
  }

  const handleConfirmResolve = (
    exc: OperationalException,
    outcome: AllowedOutcome,
    justification: string
  ) => {
    setIsResolving(true)
    setTimeout(() => {
      // Create audit log record
      const newAudit: AuditRecord = {
        id: `aud-${Date.now().toString().slice(-4)}`,
        exceptionId: exc.id,
        title: exc.title,
        resolvedAt: 'الآن',
        resolvedBy: 'مدير النظام (Admin)',
        outcomeLabel: outcome.label,
        justification,
        affectedOrders: exc.affectedOrders,
      }

      setAuditRecords((prev) => [newAudit, ...prev])
      setExceptions((prev) => prev.filter((item) => item.id !== exc.id))
      setIsResolving(false)
      setActiveModalExc(null)
      showToast(`تم تنفيذ القرار الإداري وتوثيقه في سجل التدقيق: ${outcome.label}`)
    }, 400)
  }

  // Filtered exceptions
  const filteredExceptions = exceptions.filter((exc) => {
    if (selectedCategory !== 'all' && exc.category !== selectedCategory) return false
    if (selectedSeverity !== 'all' && exc.severity !== selectedSeverity) return false
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      const matchesTitle = exc.title.toLowerCase().includes(q)
      const matchesReason = exc.failureReason.toLowerCase().includes(q)
      const matchesOrders = exc.affectedOrders.some((ord) => ord.toLowerCase().includes(q))
      if (!matchesTitle && !matchesReason && !matchesOrders) return false
    }
    return true
  })

  const criticalCount = exceptions.filter((e) => e.severity === 'critical').length
  const breachedSlaCount = exceptions.filter((e) => e.slaStatus === 'over').length

  return (
    <RoleShell role="admin" active="exceptions" mode="desktop">
      <div className="space-y-6 animate-in fade-in pb-12">
        {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-3 rounded-xl bg-emerald-500/90 text-white font-medium text-sm shadow-xl shadow-emerald-500/20 border border-emerald-400/40 backdrop-blur-md transition-all">
          <CheckCircle2 className="size-4 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/[0.08] pb-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="sc-badge t-danger flex items-center gap-1.5">
              <ShieldAlert className="size-3.5" />
              تدخل إداري بشري إلزامي
            </span>
            <span className="text-xs text-bw-ink-soft">
              استنفاد مسارات الأتمتة المسموحة
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-3">
            مركز إدارة الاستثناءات التشغيلية
            <span className="sc-badge font-mono text-sm bg-red-500/15 text-[#fb7185] border-red-500/30">
              {exceptions.length} استثناء نشط
            </span>
          </h1>
          <p className="text-xs text-bw-ink-soft mt-1 leading-relaxed max-w-3xl">
            تجمع هذه الشاشة كافة الحالات المعطلة التي استنفدت محاولات المعالجة التلقائية وبدائل الموردين والمسارات الآلية.
            يتطلب كل استثناء قراراً إدارياً موثقاً بسبب إلزامي لضمان الامتثال والمساءلة التشغيلية.
          </p>
        </div>

        {/* Header Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsAuditModalOpen(true)}
            className="sc-btn md secondary flex items-center gap-2 cursor-pointer"
          >
            <History className="size-4 text-[#ff783d]" />
            <span>سجل القرارات والتدقيق</span>
            <span className="sc-badge font-mono text-[11px] bg-white/[0.06] text-white">
              {auditRecords.length}
            </span>
          </button>
        </div>
      </div>

      {/* Overview Stat Counters */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <div className="sc-card p-4 space-y-1 border-white/[0.08] bg-bw-surface">
          <div className="flex items-center justify-between text-xs text-bw-ink-soft">
            <span>إجمالي الاستثناءات</span>
            <AlertTriangle className="size-3.5 text-[#ff783d]" />
          </div>
          <div className="text-2xl font-bold font-mono text-white">{exceptions.length}</div>
          <div className="text-[11px] text-bw-ink-muted">تنتظر قرار الإدارة</div>
        </div>

        <div className="sc-card p-4 space-y-1 border-red-500/20 bg-red-500/[0.03]">
          <div className="flex items-center justify-between text-xs text-[#fb7185]">
            <span>حرجة تتطلب إجراء عاجل</span>
            <ShieldAlert className="size-3.5 text-[#fb7185]" />
          </div>
          <div className="text-2xl font-bold font-mono text-[#fb7185]">{criticalCount}</div>
          <div className="text-[11px] text-bw-ink-muted">توقف تسليم الطلب للعميل</div>
        </div>

        <div className="sc-card p-4 space-y-1 border-amber-500/20 bg-amber-500/[0.03]">
          <div className="flex items-center justify-between text-xs text-[#f5a524]">
            <span>تجاوزت مهلة SLA</span>
            <Clock className="size-3.5 text-[#f5a524]" />
          </div>
          <div className="text-2xl font-bold font-mono text-[#f5a524]">{breachedSlaCount}</div>
          <div className="text-[11px] text-bw-ink-muted">تجاوزت نافذة الحل القياسية</div>
        </div>

        <div className="sc-card p-4 space-y-1 border-emerald-500/20 bg-emerald-500/[0.03]">
          <div className="flex items-center justify-between text-xs text-emerald-400">
            <span>استثناءات محلولة موثقة</span>
            <CheckCircle2 className="size-3.5 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-emerald-400">{auditRecords.length}</div>
          <div className="text-[11px] text-bw-ink-muted">تم اعتمادها وتدوين سببها</div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="sc-card p-4 space-y-3 border-white/[0.08] bg-bw-surface">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          {/* Search Input */}
          <div className="relative flex-1">
            <Search className="absolute right-3.5 top-1/2 -translate-y-1/2 size-4 text-bw-ink-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="البحث برقم الطلب، عنوان الاستثناء، أو سبب التعثر..."
              className="w-full pl-3 pr-10 py-2 text-xs rounded-xl bg-black/40 border border-white/[0.08] text-white placeholder-bw-ink-muted focus:outline-none focus:border-emerald-500 transition-colors"
            />
          </div>

          {/* Severity Quick Filter */}
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-xs text-bw-ink-soft hidden md:inline ml-1">الأهمية:</span>
            {[
              { id: 'all', label: 'الكل' },
              { id: 'critical', label: 'حرجة فقط' },
              { id: 'urgent', label: 'عاجلة' },
            ].map((sev) => (
              <button
                key={sev.id}
                type="button"
                onClick={() => setSelectedSeverity(sev.id)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors',
                  selectedSeverity === sev.id
                    ? 'bg-white/10 text-white border border-white/20'
                    : 'text-bw-ink-soft hover:text-white hover:bg-white/[0.04]'
                )}
              >
                {sev.label}
              </button>
            ))}
          </div>
        </div>

        {/* Domain Category Filter Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-white/[0.06]">
          {[
            { id: 'all', label: 'كافة المجالات التشغيلية', count: exceptions.length, icon: Layers },
            {
              id: 'supply',
              label: 'التوريد والموردين',
              count: exceptions.filter((e) => e.category === 'supply').length,
              icon: Store,
            },
            {
              id: 'delivery',
              label: 'التوصيل والمناديب',
              count: exceptions.filter((e) => e.category === 'delivery').length,
              icon: Truck,
            },
            {
              id: 'hub',
              label: 'المخزن والتجهيز',
              count: exceptions.filter((e) => e.category === 'hub').length,
              icon: Clock,
            },
            {
              id: 'cash',
              label: 'المطابقات المالية والتحصيل',
              count: exceptions.filter((e) => e.category === 'cash').length,
              icon: Wallet,
            },
          ].map((cat) => {
            const Icon = cat.icon
            const active = selectedCategory === cat.id
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setSelectedCategory(cat.id)}
                className={cn(
                  'flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium cursor-pointer transition-colors border',
                  active
                    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                    : 'text-bw-ink-soft border-transparent hover:text-white hover:bg-white/[0.04]'
                )}
              >
                <Icon className="size-3.5" />
                <span>{cat.label}</span>
                <span
                  className={cn(
                    'px-1.5 py-0.2 rounded-full font-mono text-[10px]',
                    active ? 'bg-emerald-500/25 text-emerald-300' : 'bg-white/[0.06] text-bw-ink-soft'
                  )}
                >
                  {cat.count}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Exception Cards Stream */}
      <div className="space-y-3">
        {filteredExceptions.length === 0 ? (
          <div className="sc-card p-12 text-center border-white/[0.08] bg-bw-surface space-y-3">
            <CheckCircle2 className="size-10 text-emerald-400 mx-auto" />
            <h3 className="text-base font-bold text-white">لا توجد استثناءات تتطلب تدخلاً بشرياً حالياً</h3>
            <p className="text-xs text-bw-ink-soft max-w-md mx-auto">
              كافة محاولات التوريد، الفرز، والتوصيل الآلية تسير ضمن المعدلات الطبيعية وبدون تعثر غير قابل للحل الآلي.
            </p>
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="sc-btn sm secondary inline-flex items-center gap-1.5 mt-2"
              >
                مسح معايير البحث
              </button>
            )}
          </div>
        ) : (
          filteredExceptions.map((exc) => (
            <ExceptionCard
              key={exc.id}
              exc={exc}
              onResolve={handleOpenResolve}
            />
          ))
        )}
      </div>

      {/* Resolution Modal */}
      {activeModalExc && (
        <ResolveExceptionModal
          exc={activeModalExc}
          onClose={() => setActiveModalExc(null)}
          onConfirm={handleConfirmResolve}
          isResolving={isResolving}
        />
      )}

      {/* Audit Trail Modal */}
      {isAuditModalOpen && (
        <AuditTrailModal
          records={auditRecords}
          onClose={() => setIsAuditModalOpen(false)}
        />
      )}
      </div>
    </RoleShell>
  )
}

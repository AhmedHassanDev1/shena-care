'use client'

import * as React from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  Eye,
  FileSpreadsheet,
  Layers,
  Loader2,
  RefreshCw,
  Search,
  Sliders,
  Tag,
  UploadCloud,
  X,
  XCircle,
} from 'lucide-react'
import { Button, Code, Field, Notice, PageHeader, Skeleton, StateBlock } from '@/components/bw/primitives'
import { CommandError, Egp } from '@/components/workspace/kit'
import { LoadError, RoleShell, useMe } from '@/components/workspace/role-shell'
import { api, type ApiError } from '@/lib/api'
import { formatDateTime, shortId } from '@/lib/labels'
import { useApi, useCommand } from '@/lib/use-api'

export interface JobDiffSummary {
  jobId: string
  supplierId: string
  mode: string
  totalRows: number
  counters: {
    updated: number
    created: number
    unchanged: number
    review: number
    skipped: number
    error: number
    deactivationsPending: number
  }
  rows: Array<{
    itemId: string
    supplierSkuCode: string
    matchedSkuId: string | null
    canonicalSkuCode: string | null
    productName: string
    action: string
    reasons: string[]
    before: { costPrice: number | null; currency?: string | null; isAvailable: boolean | null } | null
    after: { costPrice: number | null; currency?: string | null; isAvailable: boolean | null }
    priceChangePercent: number | null
    isLargePriceJump: boolean
    isRetailOnly?: boolean
    isPriceOnly?: boolean
  }>
  deactivationCandidates?: Array<{
    skuId: string
    skuCode: string
    productName: string
    currentCost: number
    isAvailable: boolean
  }>
  requiresDeactivationApproval: boolean
}

export interface CommitJobResult {
  jobId: string
  supplierId: string
  status: string
  committedCount: number
  unchangedCount: number
  heldForReviewCount: number
  skippedCount: number
  errorCount: number
  deactivatedCount: number
}

export interface IngestionUploadResult {
  jobId: string
  sourceKey: string
  formatFingerprint?: string
  profileId?: string
  status: string
  requiresMapping: boolean
  reused?: boolean
  totalRows?: number
  importedItemsCount?: number
  sampleHeaders?: string[]
  sampleRows?: Record<string, any>[]
  proposedMapping?: Record<string, string>
  unmappedHeaders?: string[]
  isComplete?: boolean
}

export interface SupplierOffer {
  id: string
  supplierId: string
  skuId: string
  costPrice: number
  currency: string
  isAvailable: boolean
  lastObservedAt: string
  lastConfirmedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface IngestionJob {
  id: string
  supplierId: string
  mode: 'FULL_SNAPSHOT' | 'PARTIAL_UPDATE'
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'
  totalItems: number
  processedItems: number
  matchedCount: number
  createdCount: number
  failedCount: number
  sourceFileName?: string | null
  createdAt: string
  items?: Array<{
    id: string
    supplierSkuCode: string
    name: string
    brand: string
    price: number
    currency: string
    status: string
    rejectionReason?: string | null
  }>
}

type MainTab = 'offers' | 'upload' | 'history'

export default function SupplierCatalogPage() {
  return (
    <RoleShell role="supplier" active="catalog" mode="mobile">
      <CatalogBody />
    </RoleShell>
  )
}

function CatalogBody() {
  const me = useMe()
  const supplierId = me.supplierId

  const [activeTab, setActiveTab] = React.useState<MainTab>('offers')

  // Offers query
  const offersApi = useApi<SupplierOffer[]>(
    supplierId ? `/sourcing/offers?supplierId=${supplierId}` : null,
    { pollMs: 30000 }
  )

  // Ingestion jobs query
  const jobsApi = useApi<IngestionJob[]>('/ingestion/jobs', { pollMs: 30000 })

  const offers = offersApi.data ?? []
  const availableCount = offers.filter((o) => o.isAvailable).length
  const unavailableCount = offers.filter((o) => !o.isAvailable).length

  return (
    <div className="space-y-4 p-4">
      <PageHeader
        title="منتجاتي وأسعاري"
        meta={`إدارة أسعار الشراء المعتمدة وتوفر الأصناف لدى ${me.supplierName ?? 'المورد'}`}
      />

      {/* Operational Summary Pill Bar */}
      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-xl border border-white/[0.08] bg-bw-surface/80 p-2.5">
          <p className="text-bw-ink-subtle text-[11px]">إجمالي العروض</p>
          <p className="font-mono text-lg font-bold text-white">{offers.length}</p>
        </div>
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-2.5">
          <p className="text-emerald-400 text-[11px]">متوفر للطلب</p>
          <p className="font-mono text-lg font-bold text-emerald-300">{availableCount}</p>
        </div>
        <div className="rounded-xl border border-white/[0.08] bg-bw-surface/80 p-2.5">
          <p className="text-bw-ink-subtle text-[11px]">غير متوفر / نفد</p>
          <p className="font-mono text-lg font-bold text-bw-ink-soft">{unavailableCount}</p>
        </div>
      </div>

      {/* Navigation Segment Tabs */}
      <div className="flex border-b border-white/[0.08] text-xs">
        <button
          type="button"
          onClick={() => setActiveTab('offers')}
          className={`flex-1 pb-2.5 text-center font-semibold transition-colors border-b-2 ${
            activeTab === 'offers'
              ? 'border-[#34d27b] text-[#34d27b]'
              : 'border-transparent text-bw-ink-soft hover:text-white'
          }`}
        >
          عروضي الحالية ({offers.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('upload')}
          className={`flex-1 pb-2.5 text-center font-semibold transition-colors border-b-2 ${
            activeTab === 'upload'
              ? 'border-[#34d27b] text-[#34d27b]'
              : 'border-transparent text-bw-ink-soft hover:text-white'
          }`}
        >
          رفع ملف أسعار جديد
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('history')}
          className={`flex-1 pb-2.5 text-center font-semibold transition-colors border-b-2 ${
            activeTab === 'history'
              ? 'border-[#34d27b] text-[#34d27b]'
              : 'border-transparent text-bw-ink-soft hover:text-white'
          }`}
        >
          سجل التحديثات ({jobsApi.data?.length ?? 0})
        </button>
      </div>

      {/* Tab 1: Live Offers */}
      {activeTab === 'offers' ? (
        <OffersListTab
          offers={offers}
          loading={offersApi.loading}
          error={offersApi.error}
          reload={offersApi.reload}
        />
      ) : null}

      {/* Tab 2: File Upload */}
      {activeTab === 'upload' ? (
        <FileUploadTab
          supplierId={supplierId}
          onSuccess={() => {
            offersApi.reload()
            jobsApi.reload()
            setActiveTab('history')
          }}
        />
      ) : null}

      {/* Tab 3: Upload History & Inspection */}
      {activeTab === 'history' ? (
        <JobsHistoryTab
          jobs={jobsApi.data ?? []}
          loading={jobsApi.loading}
          error={jobsApi.error}
          reload={jobsApi.reload}
        />
      ) : null}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* Offers List Tab                                                            */
/* ─────────────────────────────────────────────────────────────────────────── */

function OffersListTab({
  offers,
  loading,
  error,
  reload,
}: {
  offers: SupplierOffer[]
  loading: boolean
  error: ApiError | null
  reload: () => void
}) {
  const [filterAvailability, setFilterAvailability] = React.useState<'all' | 'available' | 'unavailable'>('all')
  const [search, setSearch] = React.useState('')
  const [editingOffer, setEditingOffer] = React.useState<SupplierOffer | null>(null)

  const filtered = React.useMemo(() => {
    return offers.filter((o) => {
      if (filterAvailability === 'available' && !o.isAvailable) return false
      if (filterAvailability === 'unavailable' && o.isAvailable) return false
      if (search.trim()) {
        const q = search.trim().toLowerCase()
        if (!o.skuId.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [offers, filterAvailability, search])

  return (
    <div className="space-y-3">
      {/* Search & Filter */}
      <div className="relative">
        <Search className="pointer-events-none absolute start-3 top-3 size-4 text-bw-ink-subtle" />
        <input
          type="text"
          placeholder="بحث بمعرف الصنف (SKU ID)..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-10 w-full rounded-xl border border-white/[0.08] bg-bw-surface/90 pe-3 ps-9 text-xs text-bw-ink placeholder:text-bw-ink-subtle transition-all focus:border-[#34d27b] focus:outline-none focus:ring-1 focus:ring-[#34d27b]/30 shadow-inner"
        />
      </div>

      <div className="flex gap-1.5 overflow-x-auto text-xs pb-1">
        <button
          type="button"
          onClick={() => setFilterAvailability('all')}
          className={`rounded-full px-3 py-1 font-medium transition-colors ${
            filterAvailability === 'all'
              ? 'bg-bw-ink text-bw-surface font-semibold'
              : 'border border-white/[0.08] bg-bw-surface text-bw-ink-soft'
          }`}
        >
          الكل ({offers.length})
        </button>
        <button
          type="button"
          onClick={() => setFilterAvailability('available')}
          className={`rounded-full px-3 py-1 font-medium transition-colors ${
            filterAvailability === 'available'
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/35 font-semibold'
              : 'border border-white/[0.08] bg-bw-surface text-bw-ink-soft'
          }`}
        >
          متوفر فقط
        </button>
        <button
          type="button"
          onClick={() => setFilterAvailability('unavailable')}
          className={`rounded-full px-3 py-1 font-medium transition-colors ${
            filterAvailability === 'unavailable'
              ? 'bg-red-500/20 text-red-300 border border-red-500/35 font-semibold'
              : 'border border-white/[0.08] bg-bw-surface text-bw-ink-soft'
          }`}
        >
          غير متوفر
        </button>
      </div>

      {error ? <LoadError message={error.message} onRetry={reload} /> : null}

      {!offers.length && loading ? (
        <div className="space-y-2">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
      ) : null}

      {!loading && offers.length === 0 ? (
        <StateBlock
          kind="empty"
          title="لا توجد عروض أسعار مسجلة"
          body="يمكنك رفع قائمة أصنافك وأسعارك من تبويب 'رفع ملف أسعار جديد'."
        />
      ) : null}

      {!loading && offers.length > 0 && filtered.length === 0 ? (
        <StateBlock
          kind="empty"
          title="لا توجد نتائج مطابقة"
          body="جرب تغيير الفلتر أو مسح كلمة البحث."
        />
      ) : null}

      <div className="space-y-2.5">
        {filtered.map((offer) => (
          <OfferCard
            key={offer.id}
            offer={offer}
            onEdit={() => setEditingOffer(offer)}
            onChanged={reload}
          />
        ))}
      </div>

      {/* Edit Offer Modal */}
      {editingOffer ? (
        <EditOfferDialog
          offer={editingOffer}
          onClose={() => setEditingOffer(null)}
          onSuccess={() => {
            setEditingOffer(null)
            reload()
          }}
        />
      ) : null}
    </div>
  )
}

function OfferCard({
  offer,
  onEdit,
  onChanged,
}: {
  offer: SupplierOffer
  onEdit: () => void
  onChanged: () => void
}) {
  const toggle = useCommand(() =>
    api(`/sourcing/offers/${offer.id}/confirm-availability`, {
      method: 'POST',
      body: { isAvailable: !offer.isAvailable },
    })
  )

  const handleToggle = async () => {
    const res = await toggle.execute()
    if (res) onChanged()
  }

  return (
    <div className="rounded-xl border border-white/[0.08] bg-bw-surface/90 p-3.5 space-y-2.5 transition-all hover:border-white/[0.15]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-bold text-white">
              SKU: <Code className="text-[#34d27b]">{shortId(offer.skuId)}</Code>
            </span>
            {offer.isAvailable ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.2 text-[10px] font-bold text-emerald-400">
                <span className="size-1.5 rounded-full bg-emerald-400" />
                متوفر
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 border border-red-500/30 px-2 py-0.2 text-[10px] font-bold text-red-400">
                <span className="size-1.5 rounded-full bg-red-400" />
                غير متوفر
              </span>
            )}
          </div>
          <p className="text-[11px] text-bw-ink-subtle">
            المعرف الكامل: <span className="font-mono text-[10px]">{offer.skuId}</span>
          </p>
        </div>

        <div className="text-end shrink-0">
          <p className="text-[11px] text-bw-ink-subtle">سعر الشراء</p>
          <p className="font-mono text-base font-extrabold text-white">
            <Egp value={offer.costPrice} />
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-white/[0.06] pt-2 text-[11px]">
        <span className="text-bw-ink-subtle flex items-center gap-1">
          <Clock className="size-3" />
          آخر تحديث: {formatDateTime(offer.lastObservedAt ?? offer.updatedAt)}
        </span>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={toggle.pending}
            onClick={handleToggle}
            className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-all ${
              offer.isAvailable
                ? 'border border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
                : 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
            }`}
          >
            {toggle.pending ? (
              <Loader2 className="size-3 animate-spin" />
            ) : offer.isAvailable ? (
              'تعطيل التوفر'
            ) : (
              'تأكيد التوفر'
            )}
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="rounded-lg border border-white/[0.1] bg-white/[0.04] px-2.5 py-1 text-xs font-medium text-white hover:bg-white/[0.08]"
          >
            تعديل السعر
          </button>
        </div>
      </div>
      {toggle.error ? <CommandError error={toggle.error} /> : null}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* Edit Offer Dialog                                                           */
/* ─────────────────────────────────────────────────────────────────────────── */

function EditOfferDialog({
  offer,
  onClose,
  onSuccess,
}: {
  offer: SupplierOffer
  onClose: () => void
  onSuccess: () => void
}) {
  const [costPrice, setCostPrice] = React.useState(String(offer.costPrice))
  const [isAvailable, setIsAvailable] = React.useState(offer.isAvailable)

  const save = useCommand(() =>
    api(`/sourcing/offers/${offer.id}`, {
      method: 'PATCH',
      body: {
        costPrice: Number(costPrice),
        isAvailable,
      },
    })
  )

  const isValidPrice = Number(costPrice) > 0

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isValidPrice) return
    const res = await save.execute()
    if (res) onSuccess()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs">
      <div className="w-full max-w-sm rounded-2xl border border-white/[0.1] bg-bw-surface p-5 space-y-4 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
          <h3 className="font-bold text-white text-sm">تعديل عرض وسعر التوريد</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-bw-ink-subtle hover:text-white"
          >
            <X className="size-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div className="text-xs text-bw-ink-soft space-y-1">
            <p>معرف الصنف: <Code className="text-white">{shortId(offer.skuId)}</Code></p>
            <p className="text-[10px] text-bw-ink-subtle truncate">{offer.skuId}</p>
          </div>

          <Field
            label="سعر الشراء المعتمد (ج.م)"
            ltr
            inputMode="decimal"
            value={costPrice}
            onChange={(e) => setCostPrice(e.target.value)}
            error={!isValidPrice ? 'يجب إدخال سعر شراء صحيح أكبر من صفر' : undefined}
          />

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-bw-ink">حالة التوفر بالمخزون:</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setIsAvailable(true)}
                className={`h-9 rounded-xl border text-xs font-semibold transition-all ${
                  isAvailable
                    ? 'border-emerald-500 bg-emerald-500/20 text-emerald-300'
                    : 'border-white/[0.08] bg-bw-surface text-bw-ink-soft'
                }`}
              >
                متوفر للطلب
              </button>
              <button
                type="button"
                onClick={() => setIsAvailable(false)}
                className={`h-9 rounded-xl border text-xs font-semibold transition-all ${
                  !isAvailable
                    ? 'border-red-500 bg-red-500/20 text-red-300'
                    : 'border-white/[0.08] bg-bw-surface text-bw-ink-soft'
                }`}
              >
                غير متوفر / نافد
              </button>
            </div>
          </div>

          <CommandError error={save.error} />

          <div className="flex gap-2 pt-2 border-t border-white/[0.08]">
            <Button
              type="button"
              variant="secondary"
              className="flex-1"
              onClick={onClose}
            >
              إلغاء
            </Button>
            <Button
              type="submit"
              className="flex-1 bg-[#34d27b] text-black font-bold hover:bg-[#2eb96c]"
              loading={save.pending}
              disabled={!isValidPrice}
            >
              حفظ وتأكيد
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* File Upload Tab                                                             */
/* ─────────────────────────────────────────────────────────────────────────── */

function FileUploadTab({
  supplierId,
  onSuccess,
}: {
  supplierId: string | null
  onSuccess: () => void
}) {
  const [step, setStep] = React.useState<'SELECT' | 'MAPPING' | 'DIFF' | 'RECEIPT'>('SELECT')
  const [mode, setMode] = React.useState<'PARTIAL_UPDATE' | 'FULL_SNAPSHOT'>('PARTIAL_UPDATE')
  const [file, setFile] = React.useState<File | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  // Upload result & job ID
  const [uploadResult, setUploadResult] = React.useState<IngestionUploadResult | null>(null)
  const [currentJobId, setCurrentJobId] = React.useState<string | null>(null)

  // Mapping state
  const [mapping, setMapping] = React.useState<Record<string, string>>({})
  const [saveAsProfile, setSaveAsProfile] = React.useState(true)
  const [profileName, setProfileName] = React.useState('')

  // Diff & commit state
  const [diff, setDiff] = React.useState<JobDiffSummary | null>(null)
  const [diffLoading, setDiffLoading] = React.useState(false)
  const [commitResult, setCommitResult] = React.useState<CommitJobResult | null>(null)

  // Upload command
  const upload = useCommand(async () => {
    if (!file || !supplierId) return null
    const formData = new FormData()
    formData.append('file', file)
    formData.append('supplierId', supplierId)
    formData.append('mode', mode)

    const res = await api<IngestionUploadResult>('/ingestion/jobs/upload', {
      method: 'POST',
      body: formData,
    })

    setUploadResult(res)
    setCurrentJobId(res.jobId)

    if (res.requiresMapping) {
      setMapping(res.proposedMapping ?? {})
      setProfileName(`قالب ${file.name.replace(/\.[^/.]+$/, '')}`)
      setStep('MAPPING')
    } else {
      await loadDiff(res.jobId)
      setStep('DIFF')
    }
    return res
  })

  // Load diff for job
  const loadDiff = async (jobId: string) => {
    setDiffLoading(true)
    try {
      const data = await api<JobDiffSummary>(`/ingestion/jobs/${jobId}/diff`)
      setDiff(data)
    } finally {
      setDiffLoading(false)
    }
  }

  // Apply mapping command
  const applyMapping = useCommand(async () => {
    if (!currentJobId) return null
    await api(`/ingestion/jobs/${currentJobId}/mapping`, {
      method: 'POST',
      body: {
        mapping,
        saveAsProfile,
        profileName: profileName.trim() || undefined,
      },
    })
    await loadDiff(currentJobId)
    setStep('DIFF')
    return true
  })

  // Commit offers command
  const commit = useCommand(async () => {
    if (!currentJobId) return null
    const res = await api<CommitJobResult>(`/ingestion/jobs/${currentJobId}/commit-offers`, {
      method: 'POST',
      body: {
        autoApplyLowRisk: true,
        declaredCompleteAssortment: mode === 'FULL_SNAPSHOT',
      },
    })
    setCommitResult(res)
    setStep('RECEIPT')
    return res
  })

  return (
    <div className="space-y-4">
      {/* Policy Notice */}
      <Notice tone="info" title="قواعد الأمان والاعتماد لقوائم الأسعار والمخزون">
        <ul className="list-disc ps-4 space-y-1 mt-1 text-[11px]">
          <li><strong>التحديث الجزئي (Partial Update):</strong> يحدث الأسعار والأصناف المذكورة بالملف فقط دون حذف أي عروض سابقة.</li>
          <li><strong>اللقطة الكاملة (Full Snapshot):</strong> يقارن كامل تشكيلة أصنافكم؛ أي عروض سابقة غير موجودة تتطلب موافقة إدارية قبل التعطيل.</li>
          <li><strong>سعر الشراء الفعلي:</strong> أسعار التوريد هي تكلفة الشراء الصافية المتفق عليها من المورد لشراء شيناكير، ولا تخلط مع سعر البيع للمستهلك.</li>
          <li><strong>الأصناف الجديدة:</strong> أي منتج غير مسجل في كتالوج شيناكير يُحال تلقائياً كمُرشح (Candidate) للمراجعة الإدارية ولا يُنشر بدون تدقيق.</li>
        </ul>
      </Notice>

      {/* Step 1: Select Mode & Upload File */}
      {step === 'SELECT' ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            await upload.execute()
          }}
          className="space-y-4"
        >
          {/* Import Mode Selector */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-bw-ink">نمط تحديث القائمة:</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setMode('PARTIAL_UPDATE')}
                className={`text-start rounded-xl border p-3 transition-all ${
                  mode === 'PARTIAL_UPDATE'
                    ? 'border-[#34d27b] bg-[#34d27b]/10 text-white shadow-[0_0_12px_rgba(52,210,123,0.15)]'
                    : 'border-white/[0.08] bg-bw-surface hover:border-white/[0.15] text-bw-ink-soft'
                }`}
              >
                <div className="flex items-center justify-between pb-1">
                  <span className="font-bold text-xs text-white">تحديث جزئي آمن (Partial Update)</span>
                  {mode === 'PARTIAL_UPDATE' ? <Check className="size-4 text-[#34d27b]" /> : null}
                </div>
                <p className="text-[11px] text-bw-ink-subtle">
                  النمط الموصى به: تحديث أسعار أو كميات الأصناف المذكورة فقط دون المساس بباقي منتجاتكم.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setMode('FULL_SNAPSHOT')}
                className={`text-start rounded-xl border p-3 transition-all ${
                  mode === 'FULL_SNAPSHOT'
                    ? 'border-[#34d27b] bg-[#34d27b]/10 text-white shadow-[0_0_12px_rgba(52,210,123,0.15)]'
                    : 'border-white/[0.08] bg-bw-surface hover:border-white/[0.15] text-bw-ink-soft'
                }`}
              >
                <div className="flex items-center justify-between pb-1">
                  <span className="font-bold text-xs text-white">لقطة كاملة للتشكيلة (Full Snapshot)</span>
                  {mode === 'FULL_SNAPSHOT' ? <Check className="size-4 text-[#34d27b]" /> : null}
                </div>
                <p className="text-[11px] text-bw-ink-subtle">
                  قائمة شاملة لكامل المخزون المتاح لديكم. الأصناف غير الموجودة بالملف تُعرض وتتطلب مراجعة.
                </p>
              </button>
            </div>
          </div>

          {/* File Dropzone */}
          <div
            onClick={() => fileInputRef.current?.click()}
            className="cursor-pointer rounded-2xl border-2 border-dashed border-white/[0.15] bg-bw-surface/70 p-6 text-center transition-all hover:border-[#34d27b]/50 hover:bg-bw-surface"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.[0]) setFile(e.target.files[0])
              }}
            />

            <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-[#34d27b] border border-emerald-500/20 mb-3 shadow-[0_0_16px_rgba(52,210,123,0.15)]">
              <UploadCloud className="size-6" />
            </div>

            <p className="text-sm font-bold text-white">
              {file ? file.name : 'انقر لاختيار ملف الأسعار والمخزون'}
            </p>
            <p className="text-xs text-bw-ink-subtle mt-1">
              {file
                ? `${(file.size / 1024).toFixed(1)} كيلوبايت · جاهز للرفع والتحليل`
                : 'اسحب الملف هنا أو تصفح من جهازك (Excel أو CSV)'}
            </p>
          </div>

          {file ? (
            <div className="flex items-center justify-between rounded-xl border border-white/[0.08] bg-bw-surface p-3 text-xs">
              <div className="flex items-center gap-2 text-white font-medium">
                <FileSpreadsheet className="size-4 text-[#34d27b]" />
                <span className="truncate max-w-[200px]">{file.name}</span>
              </div>
              <button
                type="button"
                onClick={() => setFile(null)}
                className="text-bw-ink-subtle hover:text-white"
              >
                <X className="size-4" />
              </button>
            </div>
          ) : null}

          <CommandError error={upload.error} />

          <Button
            type="submit"
            size="touch"
            className="w-full h-12 text-sm font-bold bg-[#34d27b] text-black hover:bg-[#2eb96c] shadow-[0_4px_16px_rgba(52,210,123,0.3)]"
            loading={upload.pending}
            disabled={!file}
          >
            رفع الملف وتحليل القائمة
          </Button>
        </form>
      ) : null}

      {/* Step 2: Mapping Wizard for New Spreadsheets */}
      {step === 'MAPPING' && uploadResult ? (
        <div className="space-y-4">
          <Notice tone="info" title="تم اكتشاف ملف جديد يحتاج مطابقة الأعمدة">
            هذا الملف لا يطابق أي قالب معتمد سابقاً. يرجى تحديد الأعمدة المقابلة للحقول الأساسية لاستخراج البيانات بأمان.
          </Notice>

          <div className="rounded-2xl border border-white/[0.08] bg-bw-surface/80 p-4 space-y-4">
            <h3 className="text-xs font-bold text-white flex items-center gap-2">
              <Sliders className="size-4 text-[#34d27b]" />
              مطابقة أعمدة الملف مع حقول شيناكير
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-bw-ink-soft mb-1 font-semibold">كود الصنف لديك (Supplier SKU) *</label>
                <select
                  value={mapping.supplierSku ?? ''}
                  onChange={(e) => setMapping({ ...mapping, supplierSku: e.target.value })}
                  className="h-9 w-full rounded-lg border border-white/[0.1] bg-bw-surface px-2.5 text-xs text-white"
                >
                  <option value="">— اختر العمود —</option>
                  {uploadResult.sampleHeaders?.map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-bw-ink-soft mb-1 font-semibold">اسم الصنف أو المنتج *</label>
                <select
                  value={mapping.name ?? ''}
                  onChange={(e) => setMapping({ ...mapping, name: e.target.value })}
                  className="h-9 w-full rounded-lg border border-white/[0.1] bg-bw-surface px-2.5 text-xs text-white"
                >
                  <option value="">— اختر العمود —</option>
                  {uploadResult.sampleHeaders?.map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-bw-ink-soft mb-1 font-semibold">سعر التوريد المعتمد (ج.م) *</label>
                <select
                  value={mapping.price ?? ''}
                  onChange={(e) => setMapping({ ...mapping, price: e.target.value })}
                  className="h-9 w-full rounded-lg border border-white/[0.1] bg-bw-surface px-2.5 text-xs text-white"
                >
                  <option value="">— اختر العمود —</option>
                  {uploadResult.sampleHeaders?.map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-bw-ink-soft mb-1 font-semibold">الماركة / Brand</label>
                <select
                  value={mapping.brand ?? ''}
                  onChange={(e) => setMapping({ ...mapping, brand: e.target.value })}
                  className="h-9 w-full rounded-lg border border-white/[0.1] bg-bw-surface px-2.5 text-xs text-white"
                >
                  <option value="">— اختياري —</option>
                  {uploadResult.sampleHeaders?.map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-bw-ink-soft mb-1 font-semibold">الباركود الدولي</label>
                <select
                  value={mapping.barcode ?? ''}
                  onChange={(e) => setMapping({ ...mapping, barcode: e.target.value })}
                  className="h-9 w-full rounded-lg border border-white/[0.1] bg-bw-surface px-2.5 text-xs text-white"
                >
                  <option value="">— اختياري —</option>
                  {uploadResult.sampleHeaders?.map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-bw-ink-soft mb-1 font-semibold">الكمية المتاحة بالمخزون</label>
                <select
                  value={mapping.quantity ?? ''}
                  onChange={(e) => setMapping({ ...mapping, quantity: e.target.value })}
                  className="h-9 w-full rounded-lg border border-white/[0.1] bg-bw-surface px-2.5 text-xs text-white"
                >
                  <option value="">— اختياري (تترك كمجهول) —</option>
                  {uploadResult.sampleHeaders?.map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Profile persistence */}
            <div className="border-t border-white/[0.08] pt-3 space-y-2">
              <label className="flex items-center gap-2 text-xs text-white cursor-pointer">
                <input
                  type="checkbox"
                  checked={saveAsProfile}
                  onChange={(e) => setSaveAsProfile(e.target.checked)}
                  className="rounded border-white/20 bg-bw-surface text-[#34d27b] focus:ring-[#34d27b]"
                />
                <span>حفظ هذا القالب كنمط معتمد لتطبيق المطابقة تلقائياً في المرات القادمة</span>
              </label>

              {saveAsProfile ? (
                <Field
                  label="اسم القالب"
                  placeholder="مثال: أسعار مصنع العامرية"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                />
              ) : null}
            </div>

            <CommandError error={applyMapping.error} />

            <div className="flex gap-2 pt-2">
              <Button
                type="button"
                variant="secondary"
                className="flex-1"
                onClick={() => setStep('SELECT')}
              >
                إلغاء والعودة
              </Button>
              <Button
                type="button"
                className="flex-1 bg-[#34d27b] text-black font-bold hover:bg-[#2eb96c]"
                loading={applyMapping.pending}
                disabled={!mapping.supplierSku || !mapping.name || !mapping.price}
                onClick={async () => {
                  await applyMapping.execute()
                }}
              >
                تطبيق المطابقة واستخراج البنود
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Step 3: Staged Diff Preview & Commit */}
      {step === 'DIFF' ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-white text-sm">
                معاينة الفروقات قبل الاعتماد (Staged Diff)
              </h3>
              <p className="text-[11px] text-bw-ink-subtle">
                قارن التغييرات في الأسعار والتوفر وتأكد من الأصناف قبل حفظها رسمياً.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setStep('SELECT')
                setFile(null)
              }}
              className="text-xs text-bw-ink-soft hover:text-white"
            >
              إلغاء والبدء من جديد
            </button>
          </div>

          {diffLoading ? (
            <div className="space-y-2 py-4">
              <Skeleton className="h-16 w-full rounded-xl" />
              <Skeleton className="h-32 w-full rounded-xl" />
            </div>
          ) : null}

          {diff ? (
            <DiffReviewSection
              diff={diff}
              committing={commit.pending}
              commitError={commit.error}
              onCommit={async () => {
                await commit.execute()
              }}
            />
          ) : null}
        </div>
      ) : null}

      {/* Step 4: Confirmed Action Receipt */}
      {step === 'RECEIPT' && commitResult ? (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-6 text-center space-y-4 shadow-xl">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-emerald-500/20 text-[#34d27b] border border-emerald-500/30 shadow-[0_0_20px_rgba(52,210,123,0.2)]">
            <CheckCircle2 className="size-8" />
          </div>

          <div className="space-y-1">
            <h3 className="font-bold text-white text-base">تم اعتماد وتطبيق العروض بنجاح</h3>
            <p className="text-xs text-bw-ink-soft">
              تم تحديث عروض الأسعار والتوفر في قاعدة البيانات وهي الآن سارية ومتاحة في عمليات شيناكير.
            </p>
          </div>

          {/* Receipt Stats Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs pt-2">
            <div className="rounded-xl border border-white/[0.08] bg-bw-surface/70 p-2.5">
              <p className="text-bw-ink-subtle text-[10px]">العروض المعتمدة</p>
              <p className="font-mono text-base font-bold text-emerald-300">{commitResult.committedCount}</p>
            </div>
            <div className="rounded-xl border border-white/[0.08] bg-bw-surface/70 p-2.5">
              <p className="text-bw-ink-subtle text-[10px]">مطابقة دون تغيير</p>
              <p className="font-mono text-base font-bold text-white">{commitResult.unchangedCount}</p>
            </div>
            <div className="rounded-xl border border-white/[0.08] bg-bw-surface/70 p-2.5">
              <p className="text-bw-ink-subtle text-[10px]">محال للمراجعة</p>
              <p className="font-mono text-base font-bold text-amber-300">{commitResult.heldForReviewCount}</p>
            </div>
            <div className="rounded-xl border border-white/[0.08] bg-bw-surface/70 p-2.5">
              <p className="text-bw-ink-subtle text-[10px]">تم تخطيها</p>
              <p className="font-mono text-base font-bold text-bw-ink-soft">{commitResult.skippedCount}</p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 pt-2">
            <Button
              className="flex-1 bg-[#34d27b] text-black font-bold hover:bg-[#2eb96c]"
              onClick={onSuccess}
            >
              عرض عروضي المحدثة
            </Button>
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => {
                setStep('SELECT')
                setFile(null)
                setUploadResult(null)
                setDiff(null)
                setCommitResult(null)
              }}
            >
              رفع ملف أسعار آخر
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function DiffReviewSection({
  diff,
  committing,
  commitError,
  onCommit,
}: {
  diff: JobDiffSummary
  committing: boolean
  commitError: ApiError | null
  onCommit: () => void
}) {
  const [rowFilter, setRowFilter] = React.useState<'all' | 'updated' | 'review' | 'unchanged' | 'skipped'>('all')

  const filteredRows = React.useMemo(() => {
    return diff.rows.filter((r) => {
      if (rowFilter === 'updated') return r.action === 'UPDATE'
      if (rowFilter === 'review') return r.action === 'REVIEW'
      if (rowFilter === 'unchanged') return r.action === 'UNCHANGED'
      if (rowFilter === 'skipped') return r.action === 'SKIP' || r.action === 'ERROR'
      return true
    })
  }, [diff.rows, rowFilter])

  return (
    <div className="space-y-3.5">
      {/* Counters Pill Bar */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center text-xs">
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2">
          <p className="text-emerald-400 text-[10px]">محدثة</p>
          <p className="font-mono text-base font-bold text-emerald-300">{diff.counters.updated}</p>
        </div>
        <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-2">
          <p className="text-blue-400 text-[10px]">جديدة</p>
          <p className="font-mono text-base font-bold text-blue-300">{diff.counters.created}</p>
        </div>
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-2">
          <p className="text-amber-400 text-[10px]">مراجعة إدارية</p>
          <p className="font-mono text-base font-bold text-amber-300">{diff.counters.review}</p>
        </div>
        <div className="rounded-xl border border-white/[0.08] bg-bw-surface/70 p-2">
          <p className="text-bw-ink-subtle text-[10px]">بدون تغيير</p>
          <p className="font-mono text-base font-bold text-white">{diff.counters.unchanged}</p>
        </div>
        <div className="rounded-xl border border-white/[0.08] bg-bw-surface/70 p-2">
          <p className="text-bw-ink-subtle text-[10px]">متخطاة</p>
          <p className="font-mono text-base font-bold text-bw-ink-soft">{diff.counters.skipped}</p>
        </div>
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-2">
          <p className="text-red-400 text-[10px]">أخطاء</p>
          <p className="font-mono text-base font-bold text-red-300">{diff.counters.error}</p>
        </div>
      </div>

      {/* Deactivations Warning Banner */}
      {diff.requiresDeactivationApproval ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300 space-y-1">
          <div className="flex items-center gap-2 font-bold">
            <AlertTriangle className="size-4" />
            <span>تنبيه: {diff.counters.deactivationsPending} أصناف لم تُذكر في ملف اللقطة الكاملة</span>
          </div>
          <p className="text-[11px] text-amber-200/90 leading-relaxed">
            التعطيل التلقائي للعروض غير المذكورة محظور نظاماً لمنع الخطأ البشري. سيتم اعتماد التحديثات للأصناف المذكورة فقط، وتُحال البنود الغائبة لمراجعة فريق شيناكير الإداري.
          </p>
        </div>
      ) : null}

      {/* Filter Tabs */}
      <div className="flex gap-1.5 overflow-x-auto text-xs pb-1">
        <button
          type="button"
          onClick={() => setRowFilter('all')}
          className={`rounded-full px-3 py-1 font-medium transition-colors ${
            rowFilter === 'all'
              ? 'bg-bw-ink text-bw-surface font-semibold'
              : 'border border-white/[0.08] bg-bw-surface text-bw-ink-soft'
          }`}
        >
          الكل ({diff.rows.length})
        </button>
        <button
          type="button"
          onClick={() => setRowFilter('updated')}
          className={`rounded-full px-3 py-1 font-medium transition-colors ${
            rowFilter === 'updated'
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/35 font-semibold'
              : 'border border-white/[0.08] bg-bw-surface text-bw-ink-soft'
          }`}
        >
          المحدثة فقط ({diff.counters.updated})
        </button>
        <button
          type="button"
          onClick={() => setRowFilter('review')}
          className={`rounded-full px-3 py-1 font-medium transition-colors ${
            rowFilter === 'review'
              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/35 font-semibold'
              : 'border border-white/[0.08] bg-bw-surface text-bw-ink-soft'
          }`}
        >
          المحالة للمراجعة ({diff.counters.review})
        </button>
        <button
          type="button"
          onClick={() => setRowFilter('unchanged')}
          className={`rounded-full px-3 py-1 font-medium transition-colors ${
            rowFilter === 'unchanged'
              ? 'bg-white/20 text-white font-semibold'
              : 'border border-white/[0.08] bg-bw-surface text-bw-ink-soft'
          }`}
        >
          بدون تغيير ({diff.counters.unchanged})
        </button>
      </div>

      {/* Rows List */}
      <div className="max-h-96 overflow-y-auto space-y-2 pe-1">
        {filteredRows.map((row) => (
          <div
            key={row.itemId}
            className="rounded-xl border border-white/[0.06] bg-bw-surface/70 p-3 text-xs space-y-2 hover:border-white/[0.12] transition-colors"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 space-y-0.5">
                <p className="font-bold text-white truncate">{row.productName}</p>
                <div className="flex flex-wrap items-center gap-2 text-[10px] text-bw-ink-subtle">
                  <span>كود المورد: <Code className="font-mono text-white">{row.supplierSkuCode}</Code></span>
                  {row.canonicalSkuCode ? (
                    <span>SKU: <Code className="font-mono text-emerald-300">{row.canonicalSkuCode}</Code></span>
                  ) : null}
                </div>
              </div>

              <RowActionBadge action={row.action} isLargePriceJump={row.isLargePriceJump} />
            </div>

            {/* Price & Availability Diff */}
            <div className="grid grid-cols-2 gap-2 border-t border-white/[0.04] pt-2 text-[11px]">
              <div>
                <span className="text-bw-ink-subtle">سعر الشراء: </span>
                {row.before?.costPrice !== null && row.before?.costPrice !== undefined ? (
                  <span className="line-through text-bw-ink-subtle me-1.5">
                    <Egp value={row.before.costPrice} />
                  </span>
                ) : (
                  <span className="text-bw-ink-subtle me-1.5">جديد</span>
                )}
                <ArrowRight className="inline size-3 text-bw-ink-subtle mx-0.5" />
                <span className="font-mono font-bold text-white ms-1">
                  <Egp value={row.after.costPrice} />
                </span>
                {row.priceChangePercent !== null ? (
                  <span
                    className={`ms-1.5 text-[10px] font-bold ${
                      row.priceChangePercent > 0 ? 'text-amber-400' : 'text-emerald-400'
                    }`}
                  >
                    ({row.priceChangePercent > 0 ? '+' : ''}{row.priceChangePercent}%)
                  </span>
                ) : null}
              </div>

              <div className="text-end">
                <span className="text-bw-ink-subtle">التوفر: </span>
                <span className={row.after.isAvailable ? 'text-emerald-400 font-medium' : 'text-bw-ink-soft'}>
                  {row.after.isAvailable ? 'متوفر' : 'غير متوفر'}
                </span>
              </div>
            </div>

            {row.action === 'REVIEW' ? (
              <p className="text-[10px] text-amber-300/90 bg-amber-500/10 rounded-lg p-1.5 border border-amber-500/20">
                صنف جديد غير مسجل في الكتالوج — سيحال لمراجعة واعتماد مسؤولي شيناكير، ولا يُنشر للمستهلك تلقائياً.
              </p>
            ) : null}
          </div>
        ))}
      </div>

      <CommandError error={commitError} />

      {/* Commit Action Button */}
      <Button
        size="touch"
        className="w-full h-12 text-sm font-bold bg-[#34d27b] text-black hover:bg-[#2eb96c] shadow-[0_4px_16px_rgba(52,210,123,0.3)]"
        loading={committing}
        onClick={onCommit}
      >
        اعتماد وتطبيق التحديثات المؤهلة ({diff.counters.updated + diff.counters.created} عروض)
      </Button>
    </div>
  )
}

function RowActionBadge({
  action,
  isLargePriceJump,
}: {
  action: string
  isLargePriceJump: boolean
}) {
  if (isLargePriceJump) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 border border-amber-500/40 px-2 py-0.5 text-[10px] font-bold text-amber-300">
        <AlertTriangle className="size-3" />
        قفزة سعرية
      </span>
    )
  }

  switch (action) {
    case 'UPDATE':
      return (
        <span className="inline-flex items-center rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.2 text-[10px] font-bold text-emerald-400">
          تحديث
        </span>
      )
    case 'CREATE':
      return (
        <span className="inline-flex items-center rounded-full bg-blue-500/15 border border-blue-500/30 px-2 py-0.2 text-[10px] font-bold text-blue-400">
          جديد
        </span>
      )
    case 'REVIEW':
      return (
        <span className="inline-flex items-center rounded-full bg-amber-500/15 border border-amber-500/30 px-2 py-0.2 text-[10px] font-bold text-amber-300">
          مراجعة كتالوج
        </span>
      )
    case 'UNCHANGED':
      return (
        <span className="inline-flex items-center rounded-full bg-white/[0.05] border border-white/[0.08] px-2 py-0.2 text-[10px] font-medium text-bw-ink-soft">
          دون تغيير
        </span>
      )
    case 'SKIP':
      return (
        <span className="inline-flex items-center rounded-full bg-red-500/15 border border-red-500/30 px-2 py-0.2 text-[10px] font-medium text-red-400">
          متخطى
        </span>
      )
    default:
      return null
  }
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* Ingestion Jobs History Tab                                                  */
/* ─────────────────────────────────────────────────────────────────────────── */

function JobsHistoryTab({
  jobs,
  loading,
  error,
  reload,
}: {
  jobs: IngestionJob[]
  loading: boolean
  error: ApiError | null
  reload: () => void
}) {
  const [selectedJobId, setSelectedJobId] = React.useState<string | null>(null)
  const [diffJobId, setDiffJobId] = React.useState<string | null>(null)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-bw-ink-soft">
        <span>سجل عمليات الرفع السابقة وحالات المعالجة</span>
        <button
          type="button"
          onClick={reload}
          className="flex items-center gap-1 text-[#34d27b] hover:underline"
        >
          <RefreshCw className="size-3" />
          تحديث السجل
        </button>
      </div>

      {error ? <LoadError message={error.message} onRetry={reload} /> : null}

      {!jobs.length && loading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : null}

      {!loading && jobs.length === 0 ? (
        <StateBlock
          kind="empty"
          title="لا يوجد سجل عمليات رفع سابقة"
          body="عند رفع ملفات أسعار، ستظهر مراحل التدقيق والمطابقة وتحديث المخزون هنا."
        />
      ) : null}

      <div className="space-y-2.5">
        {jobs.map((job) => (
          <div
            key={job.id}
            className="rounded-xl border border-white/[0.08] bg-bw-surface/90 p-3.5 space-y-2 transition-all hover:border-white/[0.15]"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold text-white">
                    دفعة #{shortId(job.id)}
                  </span>
                  <JobStatusBadge status={job.status} />
                </div>
                <p className="text-[11px] text-bw-ink-subtle">
                  الملف: {job.sourceFileName ?? 'رفع بيانات مباشر'} · النمط: {job.mode === 'PARTIAL_UPDATE' ? 'تحديث جزئي' : 'تحديث كامل'}
                </p>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setDiffJobId(job.id)}
                  className="rounded-lg border border-[#34d27b]/30 bg-[#34d27b]/10 px-2.5 py-1 text-xs font-semibold text-[#34d27b] hover:bg-[#34d27b]/20 flex items-center gap-1"
                >
                  <Eye className="size-3" />
                  معاينة الفروقات
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedJobId(job.id)}
                  className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-xs font-medium text-white hover:bg-white/[0.08] flex items-center gap-1"
                >
                  البنود
                </button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 border-t border-white/[0.06] pt-2 text-[11px] text-bw-ink-subtle text-center">
              <div>
                <span>إجمالي السطور: </span>
                <span className="font-mono font-bold text-white">{job.totalItems}</span>
              </div>
              <div>
                <span>تمت المطابقة: </span>
                <span className="font-mono font-bold text-emerald-400">{job.matchedCount ?? 0}</span>
              </div>
              <div>
                <span>المرفوض/الأخطاء: </span>
                <span className="font-mono font-bold text-red-400">{job.failedCount ?? 0}</span>
              </div>
            </div>

            <div className="text-[10px] text-bw-ink-subtle pt-0.5">
              تاريخ الرفع: {formatDateTime(job.createdAt)}
            </div>
          </div>
        ))}
      </div>

      {/* Inspect Job Items Dialog */}
      {selectedJobId ? (
        <JobInspectionDialog
          jobId={selectedJobId}
          onClose={() => setSelectedJobId(null)}
        />
      ) : null}

      {/* Inspect Job Diff Dialog */}
      {diffJobId ? (
        <JobDiffInspectionDialog
          jobId={diffJobId}
          onClose={() => setDiffJobId(null)}
          onCommitted={reload}
        />
      ) : null}
    </div>
  )
}

function JobDiffInspectionDialog({
  jobId,
  onClose,
  onCommitted,
}: {
  jobId: string
  onClose: () => void
  onCommitted: () => void
}) {
  const diffApi = useApi<JobDiffSummary>(`/ingestion/jobs/${jobId}/diff`)
  const diff = diffApi.data

  const commit = useCommand(async () => {
    await api(`/ingestion/jobs/${jobId}/commit-offers`, {
      method: 'POST',
      body: { autoApplyLowRisk: true },
    })
    onCommitted()
    onClose()
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-white/[0.1] bg-bw-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/[0.08] p-4">
          <div>
            <h3 className="font-bold text-white text-sm">
              معاينة فروقات الدفعة #{shortId(jobId)}
            </h3>
            <p className="text-[11px] text-bw-ink-subtle">
              {diff ? `إجمالي السطور: ${diff.totalRows} · النمط: ${diff.mode}` : 'جاري التحميل...'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-bw-ink-subtle hover:text-white"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {diffApi.loading ? (
            <div className="space-y-2 py-6">
              <Skeleton className="h-16 w-full rounded-xl" />
              <Skeleton className="h-28 w-full rounded-xl" />
            </div>
          ) : null}

          {diffApi.error ? (
            <LoadError message={diffApi.error.message} onRetry={diffApi.reload} />
          ) : null}

          {diff ? (
            <DiffReviewSection
              diff={diff}
              committing={commit.pending}
              commitError={commit.error}
              onCommit={async () => {
                await commit.execute()
              }}
            />
          ) : null}
        </div>

        <div className="border-t border-white/[0.08] p-3 text-end">
          <Button variant="secondary" onClick={onClose}>
            إغلاق
          </Button>
        </div>
      </div>
    </div>
  )
}

function JobStatusBadge({ status }: { status: IngestionJob['status'] }) {
  switch (status) {
    case 'COMPLETED':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.2 text-[10px] font-bold text-emerald-400">
          <CheckCircle2 className="size-3" />
          مكتمل بنجاح
        </span>
      )
    case 'PROCESSING':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/15 border border-blue-500/30 px-2 py-0.2 text-[10px] font-bold text-blue-400 animate-pulse">
          <Loader2 className="size-3 animate-spin" />
          قيد المعالجة
        </span>
      )
    case 'PENDING':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 border border-amber-500/30 px-2 py-0.2 text-[10px] font-bold text-amber-400">
          <Clock className="size-3" />
          في الانتظار
        </span>
      )
    case 'FAILED':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 border border-red-500/30 px-2 py-0.2 text-[10px] font-bold text-red-400">
          <XCircle className="size-3" />
          فشل التحقق
        </span>
      )
  }
}

function JobInspectionDialog({
  jobId,
  onClose,
}: {
  jobId: string
  onClose: () => void
}) {
  const jobDetail = useApi<IngestionJob>(`/ingestion/jobs/${jobId}`)
  const job = jobDetail.data

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-white/[0.1] bg-bw-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/[0.08] p-4">
          <div>
            <h3 className="font-bold text-white text-sm">
              معاينة بنود الدفعة #{shortId(jobId)}
            </h3>
            <p className="text-[11px] text-bw-ink-subtle">
              {job ? `إجمالي البنود: ${job.totalItems} · المعالجة: ${job.processedItems}` : 'جاري التحميل...'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-bw-ink-subtle hover:text-white"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {jobDetail.loading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full rounded-xl" />
              <Skeleton className="h-12 w-full rounded-xl" />
              <Skeleton className="h-12 w-full rounded-xl" />
            </div>
          ) : null}

          {jobDetail.error ? (
            <LoadError message={jobDetail.error.message} onRetry={jobDetail.reload} />
          ) : null}

          {job?.items && job.items.length === 0 ? (
            <p className="text-center text-xs text-bw-ink-subtle py-8">
              لا توجد سطور مفصلة محفوظة لهذه الدفعة.
            </p>
          ) : null}

          {job?.items?.map((item) => (
            <div
              key={item.id}
              className="rounded-xl border border-white/[0.06] bg-bw-surface/70 p-3 text-xs space-y-1"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-bold text-white">{item.name}</p>
                  <p className="text-[11px] text-emerald-400 font-medium">{item.brand}</p>
                </div>
                <div className="text-end shrink-0">
                  <p className="font-mono font-bold text-white">
                    <Egp value={item.price} />
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-white/[0.04] text-[10px] text-bw-ink-subtle">
                <span>كود المورد: <Code className="font-mono">{item.supplierSkuCode}</Code></span>
                <span className={item.status === 'REJECTED' ? 'text-red-400' : 'text-emerald-400'}>
                  {item.status}
                </span>
              </div>
              {item.rejectionReason ? (
                <p className="text-[10px] text-red-400/90 pt-0.5">سبب الرفض: {item.rejectionReason}</p>
              ) : null}
            </div>
          ))}
        </div>

        <div className="border-t border-white/[0.08] p-3 text-end">
          <Button variant="secondary" onClick={onClose}>
            إغلاق
          </Button>
        </div>
      </div>
    </div>
  )
}

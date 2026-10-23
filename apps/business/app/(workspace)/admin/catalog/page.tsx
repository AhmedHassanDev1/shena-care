'use client'

import * as React from 'react'
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Eye,
  FileEdit,
  FileQuestion,
  FileSpreadsheet,
  HelpCircle,
  ImageIcon,
  Info,
  Layers,
  Loader2,
  Package,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Store,
  Upload,
  X,
  XCircle,
} from 'lucide-react'
import { Button, Code, DataTable, Field, Notice, PageHeader, Section, Skeleton, StateBlock } from '@/components/bw/primitives'
import { CommandError, Egp, Page, Select, Status } from '@/components/workspace/kit'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { api, ApiError } from '@/lib/api'
import { formatDateTime, shortId } from '@/lib/labels'
import { useApi, useCommand } from '@/lib/use-api'

export interface CandidateItem {
  id: string
  jobId: string
  supplierSkuCode: string
  name: string
  brand: string
  category?: string
  barcode?: string
  price: number
  priceType?: string
  currency: string
  status: string
  rejectionReason?: string | null
  createdAt: string
  updatedAt: string
}

export interface ReviewRecord {
  candidateId: string
  supplierId: string
  sourceFile: {
    fileName: string
    jobId: string
    uploadedAt: string
  }
  originalRow: Record<string, unknown>
  normalizedIdentity: {
    name: string
    brand: string
    category?: string
    size?: number
    sizeUnit?: string
    barcode?: string
    supplierSkuCode: string
    costPrice: number
    currency: string
  }
  dependencies: {
    brandStatus: 'CANONICAL' | 'APPROVED_DRAFT' | 'PENDING_REVIEW' | 'REJECTED' | 'NOT_FOUND'
    productLineStatus: 'CANONICAL' | 'APPROVED_DRAFT' | 'PENDING_REVIEW' | 'NOT_FOUND' | 'NONE'
    activeIngredients: Array<{ name: string; inciName?: string; family?: string }>
    routinePlacement?: {
      stepOrder: number
      stepType: string
      timing: string
      frequency: string
      requiresDaytimeSunscreen: boolean
      warnings?: string[]
    }
  }
  contentDraft?: {
    titleEn?: string
    titleAr?: string
    shortDescriptionAr?: string
    descriptionAr?: string
    benefitsAr?: string[]
    usageInstructionsAr?: string[]
    isApproved: boolean
  }
  mediaDraft?: {
    verifiedPackshots: Array<{
      url: string
      variantName: string
      size: number
      sizeUnit: string
      sourceUrl: string
      sourceType: string
      barcode?: string
    }>
    hasRequiredVerifiedPackshot: boolean
  }
  policyConflicts: string[]
  canPublish: boolean
  auditTrail?: Array<{
    action: string
    actorId?: string
    timestamp: string
    reason?: string
    requestedInfo?: string
  }>
}

export interface BrandDraft {
  id: string
  name: string
  canonicalName: string
  slug: string
  aliases: string[]
  country?: string | null
  officialWebsiteUrl?: string | null
  status: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED'
  reviewedBy?: string | null
  reviewedAt?: string | null
  rejectionReason?: string | null
  createdAt: string
}

export interface ExportProfileItem {
  id: string
  supplierId: string
  supplierName?: string
  formatFingerprint: string
  version: number
  isApproved: boolean
  approvedBy?: string | null
  sampleHeaders: string[]
  mapping: Record<string, any>
  name: string
  createdAt?: string
}

type TabKey = 'candidates' | 'brands' | 'profiles'

export default function AdminCatalogReview() {
  const [activeTab, setActiveTab] = React.useState<TabKey>('candidates')
  const [statusFilter, setStatusFilter] = React.useState<string>('review_required')
  const [selectedCandidateId, setSelectedCandidateId] = React.useState<string | null>(null)

  // Candidates query
  const candidatesApi = useApi<CandidateItem[]>(
    `/ingestion/candidates${statusFilter ? `?status=${statusFilter}` : ''}`,
    { pollMs: 30000 }
  )

  // Brand drafts query
  const brandDraftsApi = useApi<BrandDraft[]>('/ingestion/brands/drafts?status=PENDING_REVIEW', {
    pollMs: 30000,
  })

  // Profiles query (pending mapping proposals)
  const profilesApi = useApi<ExportProfileItem[]>('/ingestion/profiles', {
    pollMs: 30000,
  })

  const candidates = candidatesApi.data ?? []
  const brandDrafts = brandDraftsApi.data ?? []
  const profiles = profilesApi.data ?? []

  const pendingReviewCount = candidates.filter((c) => c.status === 'review_required').length
  const brandDraftsCount = brandDrafts.length
  const pendingProfilesCount = profiles.filter((p) => !p.isApproved).length

  return (
    <RoleShell
      role="admin"
      active="catalog"
      mode="desktop"
      counts={{ catalog: pendingReviewCount + brandDraftsCount + pendingProfilesCount }}
    >
      <Page>
        <PageHeader
          title="مراجعة الكتالوج والمنتجات"
          meta="المراجعة التحريرية الشاملة لمنتجات الموردين، مسودات البراندات، قوالب المطابقة واعتماد النشر"
        />

        {/* Tab Navigation */}
        <div className="flex items-center gap-3 border-b border-white/[0.08] text-sm">
          <button
            type="button"
            onClick={() => setActiveTab('candidates')}
            className={`flex items-center gap-2 pb-3 font-semibold transition-colors border-b-2 ${
              activeTab === 'candidates'
                ? 'border-[#34d27b] text-[#34d27b]'
                : 'border-transparent text-bw-ink-soft hover:text-white'
            }`}
          >
            <Package className="size-4" />
            <span>منتجات بانتظار المراجعة ({candidates.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('brands')}
            className={`flex items-center gap-2 pb-3 font-semibold transition-colors border-b-2 ${
              activeTab === 'brands'
                ? 'border-[#34d27b] text-[#34d27b]'
                : 'border-transparent text-bw-ink-soft hover:text-white'
            }`}
          >
            <Store className="size-4" />
            <span>مسودات البراندات ({brandDraftsCount})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('profiles')}
            className={`flex items-center gap-2 pb-3 font-semibold transition-colors border-b-2 ${
              activeTab === 'profiles'
                ? 'border-[#34d27b] text-[#34d27b]'
                : 'border-transparent text-bw-ink-soft hover:text-white'
            }`}
          >
            <FileSpreadsheet className="size-4" />
            <span>قوالب مطابقة معلقة ({pendingProfilesCount})</span>
          </button>
        </div>

        {/* Tab 1: Candidates Review */}
        {activeTab === 'candidates' ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Select
                  className="w-48"
                  label="الحالة"
                  value={statusFilter}
                  onChange={(val) => setStatusFilter(val)}
                  options={[
                    ['', 'الكل'],
                    ['review_required', 'مطلوب مراجعة'],
                    ['pending', 'معلق (جاهز للتحرير)'],
                    ['approved', 'معتمد (جاهز للنشر)'],
                    ['published', 'تم النشر'],
                    ['rejected', 'مرفوض'],
                  ]}
                />
                <Button variant="ghost" onClick={() => candidatesApi.reload()}>
                  <RefreshCw className="size-3.5" />
                  <span>تحديث</span>
                </Button>
              </div>
            </div>

            {candidatesApi.error ? (
              <LoadError message={candidatesApi.error.message} onRetry={candidatesApi.reload} />
            ) : null}

            {!candidatesApi.data && candidatesApi.loading ? (
              <Skeleton className="h-48 w-full rounded-2xl" />
            ) : null}

            {candidates.length === 0 && !candidatesApi.loading ? (
              <StateBlock
                kind="empty"
                title="لا توجد منتجات بانتظار المراجعة"
                body="جميع المنتجات الواردة من الموردين تمت معالجتها أو مطابقتها آلياً."
              />
            ) : null}

            {candidates.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {candidates.map((candidate) => (
                  <CandidateCard
                    key={candidate.id}
                    candidate={candidate}
                    onOpenReview={() => setSelectedCandidateId(candidate.id)}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Tab 2: Brand Drafts Review */}
        {activeTab === 'brands' ? (
          <div className="space-y-4">
            {brandDraftsApi.error ? (
              <LoadError message={brandDraftsApi.error.message} onRetry={brandDraftsApi.reload} />
            ) : null}

            {!brandDraftsApi.data && brandDraftsApi.loading ? (
              <Skeleton className="h-48 w-full rounded-2xl" />
            ) : null}

            {brandDrafts.length === 0 && !brandDraftsApi.loading ? (
              <StateBlock
                kind="empty"
                title="لا توجد مسودات براندات معلقة"
                body="كل البراندات الواردة تم التحقق منها أو اعتمادها مسبقاً."
              />
            ) : null}

            {brandDrafts.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {brandDrafts.map((draft) => (
                  <BrandDraftCard
                    key={draft.id}
                    draft={draft}
                    onChanged={() => brandDraftsApi.reload()}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Tab 3: Pending Mapping Proposals (GLO-274) */}
        {activeTab === 'profiles' ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-white text-sm">مراجعة قوالب مطابقة الأعمدة للموردين (GLO-274)</h3>
                <p className="text-xs text-bw-ink-subtle mt-0.5">
                  اعتماد دلالات التكلفة والكميات رسمياً؛ لن يتم قبول أصناف أي ملف إلا بعد اعتماد قالبه المحدد بدلالات صحيحة.
                </p>
              </div>
              <Button variant="ghost" onClick={() => profilesApi.reload()}>
                <RefreshCw className="size-3.5" />
                <span>تحديث</span>
              </Button>
            </div>

            {profilesApi.error ? (
              <LoadError message={profilesApi.error.message} onRetry={profilesApi.reload} />
            ) : null}

            {!profilesApi.data && profilesApi.loading ? (
              <Skeleton className="h-48 w-full rounded-2xl" />
            ) : null}

            {profiles.length === 0 && !profilesApi.loading ? (
              <StateBlock
                kind="empty"
                title="لا توجد قوالب مطابقة معلقة"
                body="جميع قوالب الموردين معتمدة أو لم تُرسل قوالب جديدة للمراجعة بعد."
              />
            ) : null}

            {profiles.length > 0 ? (
              <div className="grid grid-cols-1 gap-4">
                {profiles.map((profile) => (
                  <MappingProfileApprovalCard
                    key={profile.id}
                    profile={profile}
                    onApproved={() => profilesApi.reload()}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Detailed Candidate Review Modal */}
        {selectedCandidateId ? (
          <CandidateReviewModal
            candidateId={selectedCandidateId}
            onClose={() => setSelectedCandidateId(null)}
            onUpdated={() => {
              candidatesApi.reload()
            }}
          />
        ) : null}
      </Page>
    </RoleShell>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* Candidate Card Component                                                    */
/* ─────────────────────────────────────────────────────────────────────────── */

function CandidateCard({
  candidate,
  onOpenReview,
}: {
  candidate: CandidateItem
  onOpenReview: () => void
}) {
  return (
    <div className="sc-card p-4 border-white/[0.08] bg-bw-surface hover:border-white/20 transition-all flex flex-col justify-between gap-3">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="sc-badge t-warning text-[10px]">{candidate.status}</span>
          <span className="font-mono text-[11px] text-bw-ink-subtle">
            {shortId(candidate.id)}
          </span>
        </div>

        <div>
          <h4 className="text-xs font-bold text-white line-clamp-2">{candidate.name}</h4>
          <p className="text-[11px] text-emerald-400 font-semibold mt-0.5">{candidate.brand}</p>
        </div>

        <div className="flex items-center gap-3 text-[11px] text-bw-ink-soft pt-1 border-t border-white/[0.05]">
          <div>
            <span>السعر: </span>
            <span className="font-mono text-white font-bold">{candidate.price} {candidate.currency}</span>
          </div>
          {candidate.barcode ? (
            <div>
              <span>الباركود: </span>
              <span className="font-mono text-bw-ink-subtle">{candidate.barcode}</span>
            </div>
          ) : null}
        </div>
      </div>

      <Button variant="secondary" className="w-full mt-2" onClick={onOpenReview}>
        <Eye className="size-3.5" />
        <span>عرض سجل المراجعة الشامل</span>
      </Button>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* Candidate Review Modal                                                      */
/* ─────────────────────────────────────────────────────────────────────────── */

function CandidateReviewModal({
  candidateId,
  onClose,
  onUpdated,
}: {
  candidateId: string
  onClose: () => void
  onUpdated: () => void
}) {
  const { data: record, error, loading, reload } = useApi<ReviewRecord>(
    `/ingestion/candidates/${candidateId}/review-record`
  )

  const [activeTab, setActiveTab] = React.useState<'overview' | 'correction' | 'requestMore'>('overview')

  // Commands
  const [correctionReason, setCorrectionReason] = React.useState('')
  const [correctName, setCorrectName] = React.useState('')
  const [correctCategory, setCorrectCategory] = React.useState('')
  const [correctBarcode, setCorrectBarcode] = React.useState('')
  const [requestedInfo, setRequestedInfo] = React.useState('')
  const [rejectReason, setRejectReason] = React.useState('')

  // Media review and packshot upload states (GLO-276/279 · Contracts C3 & C4)
  const [packshots, setPackshots] = React.useState<Array<{
    url: string
    sourceUrl: string
    sourceType: 'OFFICIAL_MANUFACTURER' | 'TRUSTED_DISTRIBUTOR'
    barcode: string
    size: number
    sizeUnit: string
    variantName: string
  }>>([])
  const [uploadingPackshot, setUploadingPackshot] = React.useState(false)
  const [showPackshotForm, setShowPackshotForm] = React.useState(false)
  const [newPackshotUrl, setNewPackshotUrl] = React.useState('')
  const [packshotSourceUrl, setPackshotSourceUrl] = React.useState('')
  const [packshotSourceType, setPackshotSourceType] = React.useState<'OFFICIAL_MANUFACTURER' | 'TRUSTED_DISTRIBUTOR'>('OFFICIAL_MANUFACTURER')
  const [packshotBarcode, setPackshotBarcode] = React.useState('')
  const [packshotSize, setPackshotSize] = React.useState<number>(100)
  const [packshotSizeUnit, setPackshotSizeUnit] = React.useState('ml')
  const [packshotVariant, setPackshotVariant] = React.useState('Standard')
  const [publishSuccessNotice, setPublishSuccessNotice] = React.useState(false)
  const [approvalErrors, setApprovalErrors] = React.useState<string[]>([])

  React.useEffect(() => {
    if (record?.normalizedIdentity) {
      setCorrectName(record.normalizedIdentity.name || '')
      setCorrectCategory(record.normalizedIdentity.category || '')
      setCorrectBarcode(record.normalizedIdentity.barcode || '')
      setPackshotBarcode(record.normalizedIdentity.barcode || '')
      if (record.normalizedIdentity.size) setPackshotSize(record.normalizedIdentity.size)
      if (record.normalizedIdentity.sizeUnit) setPackshotSizeUnit(record.normalizedIdentity.sizeUnit)
    }
  }, [record])

  const handlePackshotFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingPackshot(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await api<{ url: string; type: string }>(`/ingestion/candidates/${candidateId}/media`, {
        method: 'POST',
        body: formData,
      })
      setNewPackshotUrl(res.url)
      setPackshotBarcode(record?.normalizedIdentity?.barcode || '')
      setPackshotSize(record?.normalizedIdentity?.size || 100)
      setPackshotSizeUnit(record?.normalizedIdentity?.sizeUnit || 'ml')
      setShowPackshotForm(true)
    } catch (err: any) {
      alert(err?.message || 'فشل رفع ملف الصورة')
    } finally {
      setUploadingPackshot(false)
    }
  }

  const correctCmd = useCommand(async () => {
    return api(`/ingestion/candidates/${candidateId}/correct`, {
      method: 'PATCH',
      body: {
        name: correctName.trim() || undefined,
        category: correctCategory.trim() || undefined,
        barcode: correctBarcode.trim() || undefined,
        reason: correctionReason.trim(),
      },
    })
  })

  const requestMoreCmd = useCommand(async () => {
    return api(`/ingestion/candidates/${candidateId}/request-more`, {
      method: 'POST',
      body: { requestedInfo: requestedInfo.trim() },
    })
  })

  const approveCandidateCmd = useCommand(async () => {
    setApprovalErrors([])
    const allMedia = [
      ...(record?.mediaDraft?.verifiedPackshots || []),
      ...packshots,
    ]
    const mediaReviews = allMedia.map((m) => ({
      url: m.url,
      sourceUrl: m.sourceUrl,
      sourceType: m.sourceType as 'OFFICIAL_MANUFACTURER' | 'TRUSTED_DISTRIBUTOR',
      barcode: m.barcode || record?.normalizedIdentity?.barcode || 'NO-BARCODE',
      size: Number(m.size) || record?.normalizedIdentity?.size || 100,
      sizeUnit: m.sizeUnit || record?.normalizedIdentity?.sizeUnit || 'ml',
      variantName: m.variantName || 'Standard',
    }))

    try {
      const res = await api(`/ingestion/candidates/${candidateId}/approve`, {
        method: 'PATCH',
        body: {
          createNewProduct: true,
          mediaReviews: mediaReviews.length > 0 ? mediaReviews : undefined,
          confirmUsageRules: true,
        },
      })
      reload()
      onUpdated()
      return res
    } catch (err: any) {
      if (Array.isArray(err?.message)) {
        setApprovalErrors(err.message)
      } else if (typeof err?.message === 'string') {
        setApprovalErrors([err.message])
      } else {
        setApprovalErrors(['فشل اعتماد المرشح. يرجى مراجعة موانع الاعتماد المطلوبة.'])
      }
      return null
    }
  })

  const rejectCandidateCmd = useCommand(async () => {
    return api(`/ingestion/candidates/${candidateId}/reject`, {
      method: 'PATCH',
      body: { reason: rejectReason.trim() },
    })
  })

  const publishCmd = useCommand(async () => {
    const res = await api(`/ingestion/candidates/${candidateId}/publish`, {
      method: 'POST',
      body: {},
    })
    setPublishSuccessNotice(true)
    return res
  })

  const generateContentCmd = useCommand(async () => {
    return api(`/ingestion/candidates/${candidateId}/content/generate`, {
      method: 'POST',
      body: {},
    })
  })

  const approveContentCmd = useCommand(async () => {
    return api(`/ingestion/candidates/${candidateId}/content/approve`, {
      method: 'POST',
      body: {},
    })
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl border border-white/[0.12] bg-[#121417] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-3.5 bg-bw-surface/60">
          <div className="flex items-center gap-2.5">
            <div className="size-8 rounded-lg bg-emerald-500/15 text-[#34d27b] flex items-center justify-center">
              <Package className="size-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">
                سجل المراجعة والاعتماد التحريري للمنتج
              </h3>
              <p className="text-[11px] font-mono text-bw-ink-subtle">ID: {candidateId}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-bw-ink-soft hover:text-white hover:bg-white/[0.05]"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Body content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error ? <LoadError message={error.message} onRetry={reload} /> : null}
          {loading && !record ? <Skeleton className="h-64 w-full rounded-xl" /> : null}

          {record ? (
            <div className="space-y-4">
              {/* Conflicts or blockers alert */}
              {record.policyConflicts && record.policyConflicts.length > 0 ? (
                <div className="rounded-xl border border-red-500/25 bg-red-500/[0.05] p-3 text-xs space-y-1">
                  <div className="flex items-center gap-2 text-red-400 font-bold">
                    <ShieldAlert className="size-4" />
                    <span>تنبيهات السياسة أو موانع النشر المكتشفة ({record.policyConflicts.length})</span>
                  </div>
                  <ul className="list-disc list-inside space-y-0.5 text-bw-ink-soft text-[11px] pr-2">
                    {record.policyConflicts.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/* Identity & Basic Info */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="sc-card p-3.5 border-white/[0.06] bg-white/[0.02] space-y-2">
                  <p className="text-[11px] font-bold text-bw-ink-subtle">بيانات الهوية المطابقة</p>
                  <div className="space-y-1 text-xs">
                    <div>
                      <span className="text-bw-ink-soft">الاسم: </span>
                      <span className="text-white font-semibold">{record.normalizedIdentity.name}</span>
                    </div>
                    <div>
                      <span className="text-bw-ink-soft">البراند: </span>
                      <span className="text-emerald-400 font-semibold">{record.normalizedIdentity.brand}</span>
                    </div>
                    <div>
                      <span className="text-bw-ink-soft">الباركود: </span>
                      <span className="font-mono text-white">{record.normalizedIdentity.barcode || '— غير متوفر'}</span>
                    </div>
                    <div>
                      <span className="text-bw-ink-soft">سعر الشراء: </span>
                      <span className="font-mono text-white font-bold">{record.normalizedIdentity.costPrice} {record.normalizedIdentity.currency}</span>
                    </div>
                  </div>
                </div>

                <div className="sc-card p-3.5 border-white/[0.06] bg-white/[0.02] space-y-2">
                  <p className="text-[11px] font-bold text-bw-ink-subtle">التبعيات المعرفية</p>
                  <div className="space-y-1 text-xs">
                    <div>
                      <span className="text-bw-ink-soft">حالة البراند: </span>
                      <span className="font-semibold text-white">{record.dependencies.brandStatus}</span>
                    </div>
                    <div>
                      <span className="text-bw-ink-soft">المكونات الفعالة: </span>
                      <span className="text-white">
                        {record.dependencies.activeIngredients.map((i) => i.name).join('، ') || '— لا توجد'}
                      </span>
                    </div>
                    {record.dependencies.routinePlacement ? (
                      <div>
                        <span className="text-bw-ink-soft">خطوة الروتين: </span>
                        <span className="text-white font-semibold">
                          {record.dependencies.routinePlacement.stepType} (توقيت: {record.dependencies.routinePlacement.timing})
                        </span>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              {/* Media & Packshot Status (GLO-276/279 · Contracts C3 & C4) */}
              <div className="sc-card p-3.5 border-white/[0.06] bg-white/[0.02] space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ImageIcon className="size-4 text-emerald-400" />
                    <p className="text-[11px] font-bold text-bw-ink-subtle">الصور والباك شوت الموثق (Packshots)</p>
                  </div>
                  {record.mediaDraft?.hasRequiredVerifiedPackshot || packshots.length > 0 ? (
                    <span className="sc-badge t-success text-[10px]">باك شوت موثق مطابق</span>
                  ) : (
                    <span className="sc-badge t-error text-[10px]">مطلوب باك شوت رسمي</span>
                  )}
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  {record.mediaDraft?.verifiedPackshots?.map((m, idx) => (
                    <div key={idx} className="flex items-center gap-2 p-2 rounded-lg bg-black/40 border border-white/[0.05] text-xs">
                      <ImageIcon className="size-4 text-emerald-400 shrink-0" />
                      <div>
                        <p className="text-[11px] text-white font-semibold">{m.variantName} ({m.size}{m.sizeUnit})</p>
                        <p className="text-[10px] text-bw-ink-subtle truncate max-w-xs">{m.sourceUrl}</p>
                      </div>
                    </div>
                  ))}
                  {packshots.map((m, idx) => (
                    <div key={'p-' + idx} className="flex items-center gap-2 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs">
                      <CheckCircle2 className="size-4 text-emerald-400 shrink-0" />
                      <div>
                        <p className="text-[11px] text-white font-semibold">{m.variantName} ({m.size}{m.sizeUnit})</p>
                        <p className="text-[10px] text-emerald-300 truncate max-w-xs">{m.sourceUrl}</p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Upload Packshot Controls */}
                <div className="pt-2 border-t border-white/[0.04]">
                  <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/10 text-white text-xs font-semibold">
                    <Upload className="size-3.5 text-emerald-400" />
                    <span>{uploadingPackshot ? 'جاري رفع الملف...' : 'رفع صورة باك شوت رسمية للعبوة'}</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      disabled={uploadingPackshot}
                      onChange={handlePackshotFileUpload}
                    />
                  </label>
                </div>

                {/* Packshot Review Details Modal/Drawer */}
                {showPackshotForm ? (
                  <div className="p-3.5 rounded-xl bg-black/60 border border-emerald-500/30 space-y-3 mt-2">
                    <div className="flex items-center gap-2 text-xs font-bold text-emerald-400">
                      <CheckCircle2 className="size-4" />
                      <span>توثيق دلالات صورة العبوة المرفوعة (Media Verification)</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      <div>
                        <label className="text-[10px] text-bw-ink-soft block mb-1">رابط صفحة المصنع الموثوقة (https إلزامي)</label>
                        <input
                          type="url"
                          placeholder="https://brand.com/products/example"
                          value={packshotSourceUrl}
                          onChange={(e) => setPackshotSourceUrl(e.target.value)}
                          className="h-8 w-full rounded border border-white/[0.1] bg-black/40 px-2 text-xs text-white"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-bw-ink-soft block mb-1">نوع المصدر</label>
                        <select
                          value={packshotSourceType}
                          onChange={(e) => setPackshotSourceType(e.target.value as any)}
                          className="h-8 w-full rounded border border-white/[0.1] bg-black/40 px-2 text-xs text-white"
                        >
                          <option value="OFFICIAL_MANUFACTURER">المصنع الرسمي (OFFICIAL_MANUFACTURER)</option>
                          <option value="TRUSTED_DISTRIBUTOR">الموزع المعتمد (TRUSTED_DISTRIBUTOR)</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] text-bw-ink-soft block mb-1">الباركود المطبوع على العبوة</label>
                        <input
                          type="text"
                          value={packshotBarcode}
                          onChange={(e) => setPackshotBarcode(e.target.value)}
                          className="h-8 w-full rounded border border-white/[0.1] bg-black/40 px-2 text-xs text-white font-mono"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] text-bw-ink-soft block mb-1">الحجم الصافي</label>
                          <input
                            type="number"
                            value={packshotSize}
                            onChange={(e) => setPackshotSize(Number(e.target.value))}
                            className="h-8 w-full rounded border border-white/[0.1] bg-black/40 px-2 text-xs text-white"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-bw-ink-soft block mb-1">الوحدة</label>
                          <select
                            value={packshotSizeUnit}
                            onChange={(e) => setPackshotSizeUnit(e.target.value)}
                            className="h-8 w-full rounded border border-white/[0.1] bg-black/40 px-2 text-xs text-white"
                          >
                            <option value="ml">ml</option>
                            <option value="g">g</option>
                            <option value="l">l</option>
                            <option value="kg">kg</option>
                            <option value="oz">oz</option>
                          </select>
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-2 border-t border-white/[0.06]">
                      <Button variant="ghost" onClick={() => setShowPackshotForm(false)}>إلغاء</Button>
                      <Button
                        variant="primary"
                        disabled={!packshotSourceUrl.startsWith('https://')}
                        onClick={() => {
                          setPackshots([
                            ...packshots,
                            {
                              url: newPackshotUrl,
                              sourceUrl: packshotSourceUrl.trim(),
                              sourceType: packshotSourceType,
                              barcode: packshotBarcode.trim(),
                              size: Number(packshotSize),
                              sizeUnit: packshotSizeUnit,
                              variantName: packshotVariant.trim() || 'Standard',
                            },
                          ])
                          setShowPackshotForm(false)
                        }}
                        className="bg-[#34d27b] text-black font-bold h-8 px-4"
                      >
                        حفظ التوثيق للصورة
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>

              {/* Storefront Content Draft */}
              <div className="sc-card p-3.5 border-white/[0.06] bg-white/[0.02] space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-bold text-bw-ink-subtle">المحتوى التحريري للمتجر (عربي / إنجليزي)</p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      loading={generateContentCmd.pending}
                      onClick={async () => {
                        await generateContentCmd.execute()
                        reload()
                      }}
                    >
                      <Sparkles className="size-3.5 text-amber-400" />
                      <span>توليد المحتوى الحتمي</span>
                    </Button>
                    {record.contentDraft && !record.contentDraft.isApproved ? (
                      <Button
                        variant="secondary"
                        loading={approveContentCmd.pending}
                        onClick={async () => {
                          await approveContentCmd.execute()
                          reload()
                        }}
                      >
                        <CheckCircle2 className="size-3.5 text-emerald-400" />
                        <span>اعتماد المحتوى</span>
                      </Button>
                    ) : null}
                  </div>
                </div>

                {record.contentDraft ? (
                  <div className="space-y-2 text-xs pt-1">
                    <div className="rounded-lg bg-black/30 p-2.5 border border-white/[0.04]">
                      <p className="text-bw-ink-soft text-[11px]">العنوان بالمتجر:</p>
                      <p className="text-white font-bold text-xs">{record.contentDraft.titleAr}</p>
                      <p className="text-bw-ink-subtle text-[11px] font-mono">{record.contentDraft.titleEn}</p>
                    </div>
                    {record.contentDraft.shortDescriptionAr ? (
                      <div className="rounded-lg bg-black/30 p-2.5 border border-white/[0.04]">
                        <p className="text-bw-ink-soft text-[11px]">الوصف المختصر:</p>
                        <p className="text-white text-xs">{record.contentDraft.shortDescriptionAr}</p>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-xs text-bw-ink-soft">لم يتم توليد مسودة محتوى تحريري بعد.</p>
                )}
              </div>

              {/* Editorial Actions Segment */}
              <div className="flex items-center gap-2 border-t border-white/[0.08] pt-3 text-xs">
                <button
                  type="button"
                  onClick={() => setActiveTab('overview')}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition-colors ${
                    activeTab === 'overview' ? 'bg-white/10 text-white' : 'text-bw-ink-soft hover:text-white'
                  }`}
                >
                  القرارات والاعتماد
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('correction')}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition-colors ${
                    activeTab === 'correction' ? 'bg-white/10 text-white' : 'text-bw-ink-soft hover:text-white'
                  }`}
                >
                  تصحيح حقول الهوية
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('requestMore')}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition-colors ${
                    activeTab === 'requestMore' ? 'bg-white/10 text-white' : 'text-bw-ink-soft hover:text-white'
                  }`}
                >
                  طلب إيضاحات من المورد
                </button>
              </div>

              {/* Sub-Tab 1: Overview Decisions */}
              {activeTab === 'overview' ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-bw-surface/80 border border-white/[0.08]">
                    <div className="flex items-center gap-2">
                      <Button
                        variant="primary"
                        disabled={!record.canPublish}
                        loading={publishCmd.pending}
                        onClick={async () => {
                          const res = await publishCmd.execute()
                          if (res) {
                            onUpdated()
                          }
                        }}
                      >
                        <ShieldCheck className="size-4" />
                        <span>نشر رسمي في الكتالوج</span>
                      </Button>

                      <Button
                        variant="secondary"
                        loading={approveCandidateCmd.pending}
                        onClick={async () => {
                          await approveCandidateCmd.execute()
                        }}
                      >
                        <CheckCircle2 className="size-4 text-emerald-400" />
                        <span>اعتماد المراجعة</span>
                      </Button>
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="سبب الرفض..."
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        className="h-8 rounded-lg border border-white/[0.1] bg-black/40 px-2.5 text-xs text-white"
                      />
                      <Button
                        variant="danger"
                        disabled={!rejectReason.trim()}
                        loading={rejectCandidateCmd.pending}
                        onClick={async () => {
                          await rejectCandidateCmd.execute()
                          reload()
                          onUpdated()
                        }}
                      >
                        <XCircle className="size-4" />
                        <span>رفض</span>
                      </Button>
                    </div>
                  </div>

                  {approvalErrors.length > 0 ? (
                    <div className="rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-xs text-red-300 space-y-1">
                      <p className="font-bold flex items-center gap-1.5 text-red-400">
                        <AlertCircle className="size-3.5" />
                        <span>موانع الاعتماد:</span>
                      </p>
                      <ul className="list-disc list-inside space-y-0.5 text-[11px]">
                        {approvalErrors.map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {publishSuccessNotice ? (
                    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-xs text-emerald-300 space-y-1">
                      <p className="font-bold flex items-center gap-1.5 text-emerald-400">
                        <CheckCircle2 className="size-4" />
                        <span>تم نشر المنتج بنجاح كـ SKU معتمد في الكتالوج!</span>
                      </p>
                      <p className="text-[11px] text-bw-ink-soft">
                        المنتج مسجل الآن برقم تعريفي رسمي. لتفعيله للمستهلكين في المتجر، توجه إلى شاشة تسعير الكتالوج لتعيين سعر البيع للمستهلك (`POST /commerce/prices`).
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* Sub-Tab 2: Field Corrections */}
              {activeTab === 'correction' ? (
                <div className="p-4 rounded-xl bg-bw-surface/80 border border-white/[0.08] space-y-3">
                  <h4 className="text-xs font-bold text-white">تصحيح حقول المنتج (إعادة المطابقة آلياً)</h4>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="الاسم المصحح" value={correctName} onChange={(e) => setCorrectName(e.target.value)} />
                    <Field label="التصنيف" value={correctCategory} onChange={(e) => setCorrectCategory(e.target.value)} />
                    <Field label="الباركود" value={correctBarcode} onChange={(e) => setCorrectBarcode(e.target.value)} />
                    <Field label="سبب التعديل (إلزامي)" value={correctionReason} onChange={(e) => setCorrectionReason(e.target.value)} />
                  </div>
                  <Button
                    variant="primary"
                    disabled={!correctionReason.trim()}
                    loading={correctCmd.pending}
                    onClick={async () => {
                      await correctCmd.execute()
                      reload()
                      onUpdated()
                    }}
                  >
                    حفظ التصحيح وتحديث المطابقة
                  </Button>
                </div>
              ) : null}

              {/* Sub-Tab 3: Request More Info */}
              {activeTab === 'requestMore' ? (
                <div className="p-4 rounded-xl bg-bw-surface/80 border border-white/[0.08] space-y-3">
                  <h4 className="text-xs font-bold text-white">طلب استيضاح أو شهادة تحليل من المورد</h4>
                  <textarea
                    rows={3}
                    placeholder="اكتب التوضيح المطلوب (مثل: يرجى موافاتنا بالشهادة التحليلية أو تأكيد الحجم)..."
                    value={requestedInfo}
                    onChange={(e) => setRequestedInfo(e.target.value)}
                    className="w-full rounded-lg border border-white/[0.1] bg-black/40 p-2.5 text-xs text-white"
                  />
                  <Button
                    variant="secondary"
                    disabled={!requestedInfo.trim()}
                    loading={requestMoreCmd.pending}
                    onClick={async () => {
                      await requestMoreCmd.execute()
                      reload()
                      onUpdated()
                    }}
                  >
                    إرسال الطلب للمورد
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* Brand Draft Card                                                            */
/* ─────────────────────────────────────────────────────────────────────────── */

function BrandDraftCard({
  draft,
  onChanged,
}: {
  draft: BrandDraft
  onChanged: () => void
}) {
  const [rejectReason, setRejectReason] = React.useState('')

  const approveCmd = useCommand(async () => {
    return api(`/ingestion/brands/drafts/${draft.id}/approve`, {
      method: 'POST',
      body: {},
    })
  })

  const rejectCmd = useCommand(async () => {
    return api(`/ingestion/brands/drafts/${draft.id}/reject`, {
      method: 'POST',
      body: { reason: rejectReason.trim() },
    })
  })

  return (
    <div className="sc-card p-4 border-white/[0.08] bg-bw-surface space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-bold text-white">{draft.name}</h4>
          <p className="text-[11px] text-emerald-400 font-mono">{draft.canonicalName}</p>
        </div>
        <span className="sc-badge t-warning text-[10px]">{draft.status}</span>
      </div>

      <div className="space-y-1 text-xs text-bw-ink-soft">
        {draft.country ? (
          <div>
            <span>بلد المنشأ: </span>
            <span className="text-white">{draft.country}</span>
          </div>
        ) : null}
        {draft.officialWebsiteUrl ? (
          <div className="flex items-center gap-1.5">
            <span>الموقع الرسمي: </span>
            <a
              href={draft.officialWebsiteUrl}
              target="_blank"
              rel="noreferrer"
              className="text-emerald-400 hover:underline flex items-center gap-1 font-mono text-[11px]"
            >
              <span>{draft.officialWebsiteUrl}</span>
              <ExternalLink className="size-3" />
            </a>
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/[0.05]">
        <Button
          variant="primary"
          loading={approveCmd.pending}
          onClick={async () => {
            if (await approveCmd.execute()) onChanged()
          }}
        >
          <CheckCircle2 className="size-3.5" />
          <span>اعتماد البراند</span>
        </Button>

        <div className="flex items-center gap-1.5">
          <input
            type="text"
            placeholder="سبب الرفض..."
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            className="h-8 rounded-lg border border-white/[0.1] bg-black/40 px-2 text-xs text-white w-32"
          />
          <Button
            variant="danger"
            disabled={!rejectReason.trim()}
            loading={rejectCmd.pending}
            onClick={async () => {
              if (await rejectCmd.execute()) onChanged()
            }}
          >
            <XCircle className="size-3.5" />
            <span>رفض</span>
          </Button>
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* Mapping Profile Approval Card (GLO-274 · Contract C1)                       */
/* ─────────────────────────────────────────────────────────────────────────── */

function MappingProfileApprovalCard({
  profile,
  onApproved,
}: {
  profile: ExportProfileItem
  onApproved: () => void
}) {
  const [documentKind, setDocumentKind] = React.useState<'PRICE_LIST' | 'STOCK_FEED' | 'SALES_INVOICE'>(
    (profile.mapping?.semantics?.documentKind as any) || 'PRICE_LIST'
  )
  const [priceBasis] = React.useState<'UNIT_PURCHASE_COST'>('UNIT_PURCHASE_COST')
  const [quantityBasis, setQuantityBasis] = React.useState<'ON_HAND' | 'AVAILABLE_TO_SELL'>('ON_HAND')
  const [discountBasis, setDiscountBasis] = React.useState<'PERCENT' | 'AMOUNT_PER_UNIT'>('PERCENT')
  const [errors, setErrors] = React.useState<string[]>([])
  const [successReceipt, setSuccessReceipt] = React.useState<{ importedJobs: string[] } | null>(null)

  const hasQuantity = Boolean(profile.mapping?.quantity)
  const hasDiscount = Boolean(profile.mapping?.discount)

  const approveCmd = useCommand(async () => {
    setErrors([])
    setSuccessReceipt(null)
    try {
      const res = await api<{ id: string; importedJobs?: string[] }>(`/ingestion/profiles/${profile.id}/approve`, {
        method: 'POST',
        body: {
          supplierId: profile.supplierId,
          semantics: {
            documentKind,
            priceBasis,
            quantityBasis: hasQuantity ? quantityBasis : undefined,
            discountBasis: hasDiscount ? discountBasis : undefined,
          },
        },
      })
      setSuccessReceipt({ importedJobs: res.importedJobs || [] })
      onApproved()
      return res
    } catch (err: any) {
      if (Array.isArray(err?.message)) {
        setErrors(err.message)
      } else if (typeof err?.message === 'string') {
        setErrors([err.message])
      } else {
        setErrors(['فشل اعتماد القالب. يرجى التحقق من استيفاء الدلالات المطلوبة.'])
      }
      return null
    }
  })

  return (
    <div className="sc-card p-5 border-white/[0.08] bg-bw-surface space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/[0.06] pb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400">
            <FileSpreadsheet className="size-5" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-white">{profile.name || 'قالب ملف مورد'}</h4>
            <div className="flex items-center gap-2 text-[11px] text-bw-ink-subtle font-mono mt-0.5">
              <span>المورد: {shortId(profile.supplierId)}</span>
              <span>·</span>
              <span>الإصدار: v{profile.version}</span>
              <span>·</span>
              <span>البصمة: {profile.formatFingerprint.slice(0, 12)}...</span>
            </div>
          </div>
        </div>

        <span className={`text-[10px] px-2.5 py-1 rounded-full font-bold ${
          profile.isApproved
            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
            : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
        }`}>
          {profile.isApproved ? 'معتمد رسمياً' : 'بانتظار موافقة الإدارة'}
        </span>
      </div>

      {/* Sample Headers and Mappings */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
        <div className="rounded-xl border border-white/[0.06] bg-black/20 p-3 space-y-2">
          <p className="font-bold text-bw-ink-subtle text-[11px]">أعمدة الملف المصدر (Headers)</p>
          <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
            {profile.sampleHeaders?.map((h, idx) => (
              <span key={idx} className="rounded bg-white/[0.06] px-2 py-0.5 font-mono text-[10px] text-white">
                {h}
              </span>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-white/[0.06] bg-black/20 p-3 space-y-2">
          <p className="font-bold text-bw-ink-subtle text-[11px]">المطابقة المعيارية المقترحة</p>
          <div className="grid grid-cols-2 gap-1 text-[11px]">
            <div><span className="text-bw-ink-soft">كود الصنف: </span><span className="font-mono text-white">{profile.mapping?.supplierSku || '—'}</span></div>
            <div><span className="text-bw-ink-soft">الاسم: </span><span className="text-white">{profile.mapping?.name || '—'}</span></div>
            <div><span className="text-bw-ink-soft">السعر: </span><span className="font-mono text-emerald-400 font-bold">{profile.mapping?.price || '—'}</span></div>
            <div><span className="text-bw-ink-soft">الباركود: </span><span className="font-mono text-white">{profile.mapping?.barcode || '—'}</span></div>
            <div><span className="text-bw-ink-soft">الكمية: </span><span className="text-white">{profile.mapping?.quantity || '—'}</span></div>
            <div><span className="text-bw-ink-soft">البراند: </span><span className="text-white">{profile.mapping?.brand || '—'}</span></div>
          </div>
        </div>
      </div>

      {/* Semantics Controls */}
      {!profile.isApproved ? (
        <div className="rounded-xl border border-white/[0.08] bg-black/40 p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs font-bold text-white">
            <CheckCircle2 className="size-4 text-[#34d27b]" />
            <span>تحديد الدلالات الإلزامية للاعتماد (Reviewer Semantics)</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div>
              <label className="block text-[11px] text-bw-ink-soft mb-1">نوع المستند (Document Kind)</label>
              <select
                value={documentKind}
                onChange={(e) => setDocumentKind(e.target.value as any)}
                className="h-9 w-full rounded-lg border border-white/[0.1] bg-black/50 px-2.5 text-xs text-white"
              >
                <option value="PRICE_LIST">قائمة أسعار (PRICE_LIST)</option>
                <option value="STOCK_FEED">تغذية مخزون (STOCK_FEED)</option>
                <option value="SALES_INVOICE">فاتورة بيع (SALES_INVOICE)</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] text-bw-ink-soft mb-1">أساس السعر (Price Basis)</label>
              <div className="h-9 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 flex items-center text-xs text-emerald-300 font-semibold">
                تكلفة وحدة الشراء (UNIT_PURCHASE_COST)
              </div>
            </div>

            {hasQuantity ? (
              <div>
                <label className="block text-[11px] text-bw-ink-soft mb-1">أساس الكمية (Quantity Basis)</label>
                <select
                  value={quantityBasis}
                  onChange={(e) => setQuantityBasis(e.target.value as any)}
                  className="h-9 w-full rounded-lg border border-white/[0.1] bg-black/50 px-2.5 text-xs text-white"
                >
                  <option value="ON_HAND">في المستودع (ON_HAND)</option>
                  <option value="AVAILABLE_TO_SELL">متاح للبيع (AVAILABLE_TO_SELL)</option>
                </select>
              </div>
            ) : null}

            {hasDiscount ? (
              <div>
                <label className="block text-[11px] text-bw-ink-soft mb-1">أساس الخصم (Discount Basis)</label>
                <select
                  value={discountBasis}
                  onChange={(e) => setDiscountBasis(e.target.value as any)}
                  className="h-9 w-full rounded-lg border border-white/[0.1] bg-black/50 px-2.5 text-xs text-white"
                >
                  <option value="PERCENT">نسبة مئوية (PERCENT)</option>
                  <option value="AMOUNT_PER_UNIT">مبلغ لكل وحدة (AMOUNT_PER_UNIT)</option>
                </select>
              </div>
            ) : null}
          </div>

          {errors.length > 0 ? (
            <div className="rounded-lg border border-red-500/25 bg-red-500/10 p-3 text-xs text-red-300 space-y-1">
              <p className="font-bold flex items-center gap-1.5 text-red-400">
                <AlertCircle className="size-3.5" />
                <span>ملاحظات مانعة للاعتماد:</span>
              </p>
              <ul className="list-disc list-inside space-y-0.5 text-[11px]">
                {errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {successReceipt ? (
            <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-3 text-xs text-emerald-300 space-y-1">
              <p className="font-bold flex items-center gap-1.5 text-emerald-400">
                <CheckCircle2 className="size-4" />
                <span>تم اعتماد القالب بنجاح!</span>
              </p>
              <p className="text-[11px] text-bw-ink-soft">
                تم قبول وإدخال الأصناف للعمليات المعلقة: {successReceipt.importedJobs.length} عملية استيراد.
              </p>
            </div>
          ) : null}

          <div className="flex justify-end pt-2 border-t border-white/[0.05]">
            <Button
              variant="primary"
              loading={approveCmd.pending}
              onClick={() => approveCmd.execute()}
              className="bg-[#34d27b] text-black font-bold h-9 px-5 hover:bg-[#2eb96c]"
            >
              <CheckCircle2 className="size-4 ms-1" />
              <span>اعتماد القالب وإدخال الأصناف المعلقة</span>
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

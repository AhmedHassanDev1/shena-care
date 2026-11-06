'use client'

import * as React from 'react'
import Link from 'next/link'
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronLeft,
  Clock,
  Eye,
  FileSpreadsheet,
  FileText,
  Filter,
  History,
  Info,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Store,
  Tag,
  UploadCloud,
  X,
  XCircle,
} from 'lucide-react'
import { Button, Code, Field, Notice, PageHeader, Section, Skeleton, StateBlock } from '@/components/bw/primitives'
import { CommandError, Egp } from '@/components/workspace/kit'
import { SourceRowOutcomes, type SourceRowSummary } from '@/components/workspace/source-rows'
import { LoadError, RoleShell, useMe } from '@/components/workspace/role-shell'
import { api, type ApiError } from '@/lib/api'
import { formatDateTime, shortId } from '@/lib/labels'
import { useCommand } from '@/lib/use-api'

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

export interface JobDiffSummary {
  jobId: string
  supplierId: string
  mode: string
  totalRows: number
  sourceRows?: SourceRowSummary
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

type WorkflowStep = 'MODE_SELECT' | 'FILE_UPLOAD' | 'COLUMN_MAPPING' | 'AWAITING_APPROVAL' | 'PREVIEW_DIFF' | 'RECEIPT'

export default function SupplierUpdatesWorkflowPage() {
  return (
    <RoleShell role="supplier" active="updates" mode="responsive">
      <UpdatesWorkflowContent />
    </RoleShell>
  )
}

function UpdatesWorkflowContent() {
  const me = useMe()
  const supplierId = me.supplierId

  // Workflow stage
  const [step, setStep] = React.useState<WorkflowStep>('MODE_SELECT')

  // Stage 1: Mode
  const [mode, setMode] = React.useState<'PARTIAL_UPDATE' | 'FULL_SNAPSHOT'>('PARTIAL_UPDATE')
  const [documentKind, setDocumentKind] = React.useState<'PRICE_LIST' | 'STOCK_FEED'>('PRICE_LIST')

  // Stage 2: File Upload
  const [file, setFile] = React.useState<File | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = React.useState(false)

  // Stage 3: Ingestion Job & Mapping
  const [uploadResult, setUploadResult] = React.useState<IngestionUploadResult | null>(null)
  const [currentJobId, setCurrentJobId] = React.useState<string | null>(null)
  const [checkingApproval, setCheckingApproval] = React.useState(false)
  const [mapping, setMapping] = React.useState<Record<string, string>>({
    supplierSku: '',
    name: '',
    price: '',
    barcode: '',
    brand: '',
    category: '',
    quantity: '',
    retailPrice: '',
    priceType: '',
    currency: 'EGP',
  })
  const [profileName, setProfileName] = React.useState('')

  // Stage 4: Preview Diff & Validation
  const [diff, setDiff] = React.useState<JobDiffSummary | null>(null)
  const [diffLoading, setDiffLoading] = React.useState(false)
  const [diffFilter, setDiffFilter] = React.useState<'all' | 'changes' | 'candidates' | 'errors'>('all')
  const [diffSearch, setDiffSearch] = React.useState('')
  const [confirmedRisk, setConfirmedRisk] = React.useState(false)

  // Stage 5: Commit Result
  const [commitResult, setCommitResult] = React.useState<CommitJobResult | null>(null)

  // Upload Command
  const upload = useCommand(async () => {
    if (!file || !supplierId) return null
    const formData = new FormData()
    formData.append('file', file)
    formData.append('supplierId', supplierId)
    formData.append('mode', mode)
    formData.append('documentKind', documentKind)

    const res = await api<IngestionUploadResult & { awaitingApproval?: boolean }>('/ingestion/jobs/upload', {
      method: 'POST',
      body: formData,
    })

    setUploadResult(res)
    setCurrentJobId(res.jobId)

    if (res.awaitingApproval) {
      setStep('AWAITING_APPROVAL')
      return res
    }

    if (res.requiresMapping) {
      // Pre-fill proposed mapping
      const p = res.proposedMapping ?? {}
      setMapping((prev) => ({
        ...prev,
        supplierSku: p.supplierSku ?? '',
        name: p.name ?? '',
        price: p.price ?? '',
        barcode: p.barcode ?? '',
        brand: p.brand ?? '',
        category: p.category ?? '',
        quantity: p.quantity ?? '',
        retailPrice: p.retailPrice ?? '',
        priceType: p.priceType ?? '',
      }))
      setProfileName(`قالب ملف ${file.name.replace(/\.[^/.]+$/, '')}`)
      setStep('COLUMN_MAPPING')
    } else {
      await loadDiff(res.jobId)
      setStep('PREVIEW_DIFF')
    }
    return res
  })

  // Load Diff
  const loadDiff = async (jobId: string) => {
    setDiffLoading(true)
    try {
      const data = await api<JobDiffSummary>(`/ingestion/jobs/${jobId}/diff`)
      setDiff(data)
    } finally {
      setDiffLoading(false)
    }
  }

  // Apply Mapping Command
  const applyMapping = useCommand(async () => {
    if (!currentJobId) return null
    const cleanMapping: Record<string, string> = {
      supplierSku: mapping.supplierSku.trim(),
      name: mapping.name.trim(),
      price: mapping.price.trim(),
    }
    if (mapping.barcode?.trim()) cleanMapping.barcode = mapping.barcode.trim()
    if (mapping.category?.trim()) cleanMapping.category = mapping.category.trim()
    if (mapping.brand?.trim()) cleanMapping.brand = mapping.brand.trim()
    if (mapping.quantity?.trim()) cleanMapping.quantity = mapping.quantity.trim()
    if (mapping.retailPrice?.trim()) cleanMapping.retailPrice = mapping.retailPrice.trim()
    if (mapping.priceType?.trim()) cleanMapping.priceType = mapping.priceType.trim()
    if (mapping.currency?.trim()) cleanMapping.currency = mapping.currency.trim()

    const res = await api<{ awaitingApproval?: boolean; status?: string; importedItemsCount?: number }>(`/ingestion/jobs/${currentJobId}/mapping`, {
      method: 'POST',
      body: {
        mapping: cleanMapping,
        profileName: profileName.trim() || undefined,
      },
    })
    if (res?.awaitingApproval || res?.status === 'review_required') {
      setStep('AWAITING_APPROVAL')
      return true
    }
    await loadDiff(currentJobId)
    setStep('PREVIEW_DIFF')
    return true
  })

  // Commit Offers Command
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

  // Filtered rows in diff
  const filteredDiffRows = React.useMemo(() => {
    if (!diff) return []
    return diff.rows.filter((row) => {
      if (diffFilter === 'changes' && !['UPDATE', 'CREATE'].includes(row.action)) return false
      if (diffFilter === 'candidates' && row.action !== 'SKIP') return false
      if (diffFilter === 'errors' && row.action !== 'ERROR') return false

      if (diffSearch.trim()) {
        const q = diffSearch.trim().toLowerCase()
        const matchesName = row.productName.toLowerCase().includes(q)
        const matchesSku = row.supplierSkuCode.toLowerCase().includes(q)
        const matchesCanonical = row.canonicalSkuCode?.toLowerCase().includes(q)
        if (!matchesName && !matchesSku && !matchesCanonical) return false
      }
      return true
    })
  }, [diff, diffFilter, diffSearch])

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto">
        {/* Header with History Link */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <PageHeader
            title="تحديث المخزون والأسعار"
            meta="نظام المعالجة الآمن لقوائم الأسعار والمخزون مع المطابقة التلقائية والمعاينة قبل الاعتماد"
          />
          <Link
            href="/supplier/updates/history"
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-bw-line bg-bw-surface px-3.5 text-xs font-semibold text-bw-ink-soft hover:bg-bw-sunken hover:text-bw-ink transition-all shadow-xs self-start sm:self-auto"
          >
            <History className="size-4 text-bw-ink-subtle" />
            <span>سجل العمليات السابقة</span>
          </Link>
        </div>

        {/* Stepper Component */}
        <div className="rounded-2xl border border-bw-line bg-bw-surface/80 p-3 sm:p-4 ">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            {[
              { id: 'MODE_SELECT', stepNum: 1, title: 'نمط التحديث', desc: 'جزئي أو شامل' },
              { id: 'FILE_UPLOAD', stepNum: 2, title: 'رفع الملف', desc: 'Excel / CSV' },
              { id: 'COLUMN_MAPPING', stepNum: 3, title: 'مطابقة الأعمدة', desc: 'الأكواد والأسعار' },
              { id: 'PREVIEW_DIFF', stepNum: 4, title: 'المعاينة والاعتماد', desc: 'فحص الفروقات' },
            ].map((s) => {
              const stepOrder: WorkflowStep[] = ['MODE_SELECT', 'FILE_UPLOAD', 'COLUMN_MAPPING', 'PREVIEW_DIFF', 'RECEIPT']
              const currentIndex = stepOrder.indexOf(step)
              const thisIndex = stepOrder.indexOf(s.id as WorkflowStep)
              const isCurrent = step === s.id || (s.id === 'PREVIEW_DIFF' && step === 'RECEIPT')
              const isCompleted = currentIndex > thisIndex

              return (
                <div
                  key={s.id}
                  className={`flex items-center gap-2.5 p-2.5 rounded-xl border transition-all ${
                    isCurrent
                      ? 'bg-bw-ok-soft border-bw-ok/40 text-bw-ink shadow-xs'
                      : isCompleted
                      ? 'bg-bw-surface border-bw-ok/40 text-bw-ok'
                      : 'border-transparent text-bw-ink-subtle'
                  }`}
                >
                  <span
                    className={`flex size-6 shrink-0 items-center justify-center rounded-lg font-mono text-xs font-bold ${
                      isCurrent
                        ? 'bg-bw-action text-bw-on-action shadow-xs'
                        : isCompleted
                        ? 'bg-bw-ok-soft text-bw-ok'
                        : 'bg-bw-surface text-bw-ink-subtle'
                    }`}
                  >
                    {isCompleted ? <Check className="size-3.5" /> : s.stepNum}
                  </span>
                  <div className="min-w-0">
                    <p className={`font-bold text-xs truncate ${isCurrent ? 'text-bw-ink' : ''}`}>
                      {s.title}
                    </p>
                    <p className="text-[10px] text-bw-ink-subtle truncate">{s.desc}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Guidance Panel: Streamlined and Operational */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-bw-line bg-bw-page p-3.5 text-xs text-bw-ink-soft">
          <div className="flex items-center gap-2.5">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-bw-ok-soft text-bw-ok">
              <ShieldCheck className="size-4" />
            </div>
            <div>
              <p className="font-bold text-bw-ink text-xs">معالجة آمنة ومعاينة فورية قبل النشر</p>
              <p className="text-[11px] text-bw-ink-subtle">
                يتم تحليل الملف وعرض الفروقات بالكامل؛ لن يطبق أي تعديل فعلي على الكتالوج إلا بعد تأكيدك النهائي.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold text-bw-ink-subtle shrink-0">
            <span className="inline-flex items-center gap-1 rounded-md bg-bw-surface px-2 py-0.5 border border-bw-line">
              <Check className="size-3 text-bw-ok" /> معاينة الفروقات
            </span>
            <span className="inline-flex items-center gap-1 rounded-md bg-bw-surface px-2 py-0.5 border border-bw-line">
              <AlertTriangle className="size-3 text-bw-warn" /> كشف قفزات الأسعار
            </span>
            <span className="inline-flex items-center gap-1 rounded-md bg-bw-surface px-2 py-0.5 border border-bw-line">
              <Tag className="size-3 text-bw-info" /> تدقيق الأصناف الجديدة
            </span>
          </div>
        </div>

        {/* STEP 1: Select Mode */}
        {step === 'MODE_SELECT' ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-bw-ink text-base">الخطوة الأولى: تحديد نمط التحديث</h3>
                <p className="text-xs text-bw-ink-subtle mt-0.5">
                  اختر بين تحديث جزئي سريع للأصناف الواردة بالملف، أو فحص شامل لكامل تشكيلة منتجاتكم.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Card 1: Partial Update (Recommended) */}
              <div
                onClick={() => setMode('PARTIAL_UPDATE')}
                className={`cursor-pointer rounded-2xl border p-5 transition-all space-y-3 relative ${
                  mode === 'PARTIAL_UPDATE'
                    ? 'border-bw-ok bg-bw-ok-soft '
                    : 'border-bw-line bg-bw-surface hover:border-bw-line-field'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1 rounded-full bg-bw-ok-soft text-bw-ok border border-bw-ok/40 px-2.5 py-0.5 text-[10px] font-bold">
                    ✓ الخيار الموصى به
                  </span>
                  {mode === 'PARTIAL_UPDATE' ? (
                    <CheckCircle2 className="size-5 text-bw-ok" />
                  ) : (
                    <div className="size-5 rounded-full border border-bw-line" />
                  )}
                </div>

                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <div className="flex size-7 items-center justify-center rounded-lg bg-bw-ok-soft text-bw-ok">
                      <Tag className="size-4" />
                    </div>
                    <h4 className="font-bold text-sm text-bw-ink">تحديث جزئي للأسعار والمخزون</h4>
                  </div>
                  <p className="text-xs text-bw-ink-soft leading-relaxed pt-1">
                    تحديث سريع للأصناف المذكورة في ملفكم فقط دون المساس بباقي منتجاتكم السابقة.
                  </p>
                </div>

                <div className="space-y-1.5 pt-2 border-t border-bw-line text-xs text-bw-ink-subtle">
                  <p className="flex items-center gap-1.5 text-bw-ok text-[11px]">
                    <span className="font-bold">✓</span> آمن 100%: لا يحذف أو يعطل أي منتج غير مذكور بالملف.
                  </p>
                  <p className="flex items-center gap-1.5 text-bw-ink-soft text-[11px]">
                    <span className="font-bold">✓</span> مثالي للقوائم اليومية، تغييرات الأسعار، وتعديلات التوفر.
                  </p>
                  <p className="flex items-center gap-1.5 text-bw-ink-soft text-[11px]">
                    <span className="font-bold">✓</span> اعتماد فوري مباشر بمجرد مراجعة جدول الفروقات.
                  </p>
                </div>
              </div>

              {/* Card 2: Full Snapshot (Advanced) */}
              <div
                onClick={() => setMode('FULL_SNAPSHOT')}
                className={`cursor-pointer rounded-2xl border p-5 transition-all space-y-3 relative ${
                  mode === 'FULL_SNAPSHOT'
                    ? 'border-bw-info bg-bw-info-soft '
                    : 'border-bw-line bg-bw-surface hover:border-bw-line-field'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1 rounded-full bg-bw-info-soft text-bw-info border border-bw-info/40 px-2.5 py-0.5 text-[10px] font-bold">
                    متقدم · فحص كامل التشكيلة
                  </span>
                  {mode === 'FULL_SNAPSHOT' ? (
                    <CheckCircle2 className="size-5 text-bw-info" />
                  ) : (
                    <div className="size-5 rounded-full border border-bw-line" />
                  )}
                </div>

                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <div className="flex size-7 items-center justify-center rounded-lg bg-bw-info-soft text-bw-info">
                      <Layers className="size-4" />
                    </div>
                    <h4 className="font-bold text-sm text-bw-ink">لقطة كاملة للمخزون (Full Snapshot)</h4>
                  </div>
                  <p className="text-xs text-bw-ink-soft leading-relaxed pt-1">
                    مقارنة شاملة لكامل تشكيلة منتجاتكم مع رصد أي أصناف سابقة غائبة عن الملف.
                  </p>
                </div>

                <div className="space-y-1.5 pt-2 border-t border-bw-line text-xs text-bw-ink-subtle">
                  <p className="flex items-center gap-1.5 text-bw-info text-[11px]">
                    <span className="font-bold">✓</span> فحص شامل: الأصناف الغائبة تدرج كمرشحة للتعطيل للمراجعة.
                  </p>
                  <p className="flex items-center gap-1.5 text-bw-ink-soft text-[11px]">
                    <span className="font-bold">✓</span> مخصص لتسويات الجرد الشامل وإعادة هيكلة الكتالوج بالكامل.
                  </p>
                  <p className="flex items-center gap-1.5 text-bw-ink-soft text-[11px]">
                    <span className="font-bold">✓</span> يتطلب مراجعة تأكيدية لمنع التعطيل العرضي للأصناف المستمرة.
                  </p>
                </div>
              </div>
            </div>

            {/* Mode Select CTA Bar */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-bw-line">
              <div className="flex items-center gap-2 text-xs text-bw-ink-subtle">
                <span>النمط المختار حالياً:</span>
                <span className={`font-bold ${mode === 'PARTIAL_UPDATE' ? 'text-bw-ok' : 'text-bw-info'}`}>
                  {mode === 'PARTIAL_UPDATE' ? 'تحديث جزئي (الآمن والموصى به)' : 'لقطة كاملة للمخزون (فحص تشكيلة)'}
                </span>
              </div>
              <Button
                type="button"
                className="bg-bw-action text-bw-on-action font-bold h-11 px-7 hover:bg-bw-action-hover w-full sm:w-auto"
                onClick={() => setStep('FILE_UPLOAD')}
              >
                <span>المتابعة إلى رفع الملف</span>
                <ChevronLeft className="size-4 ms-1.5" />
              </Button>
            </div>
          </div>
        ) : null}

        {/* STEP 2: File Upload (Drag & Drop) */}
        {step === 'FILE_UPLOAD' ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-bw-ink text-base">الخطوة الثانية: رفع ملف Excel أو CSV</h3>
              <button
                type="button"
                onClick={() => setStep('MODE_SELECT')}
                className="text-xs text-bw-ink-subtle hover:text-bw-ink"
              >
                تغيير النمط ({mode === 'PARTIAL_UPDATE' ? 'تحديث جزئي' : 'لقطة كاملة'})
              </button>
            </div>

            {/* Document Kind Selector */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pb-1">
              <div
                onClick={() => setDocumentKind('PRICE_LIST')}
                className={`cursor-pointer rounded-xl border p-3.5 text-xs transition-all flex items-center justify-between ${
                  documentKind === 'PRICE_LIST'
                    ? 'border-bw-ok bg-bw-ok-soft text-bw-ink shadow-xs'
                    : 'border-bw-line bg-bw-page text-bw-ink-soft hover:border-bw-line-field'
                }`}
              >
                <div className="space-y-0.5">
                  <p className="font-bold text-bw-ink text-xs">قائمة أسعار وتوريد (Price List)</p>
                  <p className="text-[11px] text-bw-ink-subtle">تتضمن أسعار الشراء وتحديثات التكلفة للأصناف</p>
                </div>
                {documentKind === 'PRICE_LIST' ? <CheckCircle2 className="size-4 text-bw-ok shrink-0" /> : null}
              </div>

              <div
                onClick={() => setDocumentKind('STOCK_FEED')}
                className={`cursor-pointer rounded-xl border p-3.5 text-xs transition-all flex items-center justify-between ${
                  documentKind === 'STOCK_FEED'
                    ? 'border-bw-ok bg-bw-ok-soft text-bw-ink shadow-xs'
                    : 'border-bw-line bg-bw-page text-bw-ink-soft hover:border-bw-line-field'
                }`}
              >
                <div className="space-y-0.5">
                  <p className="font-bold text-bw-ink text-xs">تغذية مخزون وتوافر (Stock Feed)</p>
                  <p className="text-[11px] text-bw-ink-subtle">تحديث كميات المخزون المتوفرة بالمستودع والجاهزة للطلب</p>
                </div>
                {documentKind === 'STOCK_FEED' ? <CheckCircle2 className="size-4 text-bw-ok shrink-0" /> : null}
              </div>
            </div>

            {/* Dropzone */}
            <div
              onDragOver={(e) => {
                e.preventDefault()
                setIsDragging(true)
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault()
                setIsDragging(false)
                if (e.dataTransfer.files?.[0]) {
                  setFile(e.dataTransfer.files[0])
                }
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition-all ${
                isDragging
                  ? 'border-bw-ok bg-bw-ok-soft'
                  : file
                  ? 'border-bw-ok/40 bg-bw-ok-soft'
                  : 'border-bw-line bg-bw-surface/70 hover:border-bw-ok/40 hover:bg-bw-surface'
              }`}
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

              <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-bw-ok-soft text-bw-ok border border-bw-ok/40 mb-3 ">
                <UploadCloud className="size-7" />
              </div>

              <p className="text-sm sm:text-base font-bold text-bw-ink">
                {file ? file.name : 'اسحب ملف الأسعار والمخزون إلى هنا أو انقر للاختيار'}
              </p>
              <p className="text-xs text-bw-ink-subtle mt-1.5">
                {file
                  ? `${(file.size / 1024).toFixed(1)} كيلوبايت · جاهز للتحليل والرفع المباشر`
                  : 'الملفات المدعومة: Excel (.xlsx, .xls) أو CSV (.csv) — حتى 15 ميجابايت'}
              </p>
            </div>

            {/* Selected File Card */}
            {file ? (
              <div className="flex items-center justify-between rounded-xl border border-bw-line bg-bw-surface p-3.5 text-xs">
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-bw-ok-soft text-bw-ok">
                    <FileSpreadsheet className="size-5" />
                  </div>
                  <div>
                    <p className="font-bold text-bw-ink">{file.name}</p>
                    <p className="text-[10px] text-bw-ink-subtle font-mono">
                      {(file.size / 1024).toFixed(1)} KB · صيغة صالحة
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setFile(null)}
                  className="rounded-lg p-1.5 text-bw-ink-subtle hover:bg-bw-sunken hover:text-bw-ink"
                >
                  <X className="size-4" />
                </button>
              </div>
            ) : null}

            <CommandError error={upload.error} />

            <div className="flex items-center justify-between pt-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setStep('MODE_SELECT')}
              >
                السابق
              </Button>
              <Button
                type="button"
                disabled={!file}
                loading={upload.pending}
                className="bg-bw-action text-bw-on-action font-bold h-11 px-6 hover:bg-bw-action-hover"
                onClick={async () => {
                  await upload.execute()
                }}
              >
                <span>رفع وتحليل الملف</span>
                <ChevronLeft className="size-4 ms-1" />
              </Button>
            </div>
          </div>
        ) : null}

        {/* STEP 3: Column Mapping (When required) */}
        {step === 'COLUMN_MAPPING' && uploadResult ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-bw-ink text-base">الخطوة الثالثة: مطابقة أعمدة الملف</h3>
                <p className="text-xs text-bw-ink-subtle">
                  لم يتم التعرف التلقائي على تخطيط هذا الملف من قبل. يرجى مطابقة الأعمدة الأساسية لحفظ القالب للاستخدام المستقبلي.
                </p>
              </div>
              <span className="text-xs font-mono text-bw-ok font-bold bg-bw-ok-soft px-2.5 py-1 rounded-lg border border-bw-ok/40">
                {uploadResult.totalRows ?? 0} صف بالملف
              </span>
            </div>

            {/* Mapping Grid */}
            <div className="rounded-2xl border border-bw-line bg-bw-surface p-4 sm:p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                {/* Required: SKU */}
                <div className="space-y-1.5">
                  <label className="block font-semibold text-bw-ink">
                    عمود كود الصنف للمورد (Supplier SKU) <span className="text-bw-danger">*</span>
                  </label>
                  <select
                    value={mapping.supplierSku}
                    onChange={(e) => setMapping({ ...mapping, supplierSku: e.target.value })}
                    className="h-10 w-full rounded-xl border border-bw-line bg-bw-page px-3 text-xs text-bw-ink focus:outline-none focus:border-bw-ok"
                  >
                    <option value="">— اختر العمود من الملف —</option>
                    {uploadResult.sampleHeaders?.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>

                {/* Required: Name */}
                <div className="space-y-1.5">
                  <label className="block font-semibold text-bw-ink">
                    عمود اسم المنتج (Product Name) <span className="text-bw-danger">*</span>
                  </label>
                  <select
                    value={mapping.name}
                    onChange={(e) => setMapping({ ...mapping, name: e.target.value })}
                    className="h-10 w-full rounded-xl border border-bw-line bg-bw-page px-3 text-xs text-bw-ink focus:outline-none focus:border-bw-ok"
                  >
                    <option value="">— اختر العمود من الملف —</option>
                    {uploadResult.sampleHeaders?.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>

                {/* Required: Price */}
                <div className="space-y-1.5">
                  <label className="block font-semibold text-bw-ink">
                    عمود سعر الشراء للمورد (Purchase Cost) <span className="text-bw-danger">*</span>
                  </label>
                  <select
                    value={mapping.price}
                    onChange={(e) => setMapping({ ...mapping, price: e.target.value })}
                    className="h-10 w-full rounded-xl border border-bw-line bg-bw-page px-3 text-xs text-bw-ink focus:outline-none focus:border-bw-ok"
                  >
                    <option value="">— اختر العمود من الملف —</option>
                    {uploadResult.sampleHeaders?.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>

                {/* Optional: Barcode */}
                <div className="space-y-1.5">
                  <label className="block font-semibold text-bw-ink">
                    عمود الباركود الدولي (Barcode / EAN) <span className="text-bw-ink-subtle text-[11px]">(موصى به للمطابقة الدقيقة)</span>
                  </label>
                  <select
                    value={mapping.barcode}
                    onChange={(e) => setMapping({ ...mapping, barcode: e.target.value })}
                    className="h-10 w-full rounded-xl border border-bw-line bg-bw-page px-3 text-xs text-bw-ink focus:outline-none focus:border-bw-ok"
                  >
                    <option value="">— اختياري: اختر عمود الباركود —</option>
                    {uploadResult.sampleHeaders?.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>

                {/* Optional: Brand */}
                <div className="space-y-1.5">
                  <label className="block font-semibold text-bw-ink">
                    عمود العلامة التجارية (Brand)
                  </label>
                  <select
                    value={mapping.brand}
                    onChange={(e) => setMapping({ ...mapping, brand: e.target.value })}
                    className="h-10 w-full rounded-xl border border-bw-line bg-bw-page px-3 text-xs text-bw-ink focus:outline-none focus:border-bw-ok"
                  >
                    <option value="">— اختياري: اختر عمود العلامة —</option>
                    {uploadResult.sampleHeaders?.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="supplier-category-column" className="block font-semibold text-bw-ink">عمود التصنيف — عدم تحديده يعلق الصفوف للمراجعة</label>
                  <select id="supplier-category-column" value={mapping.category} onChange={e => setMapping({ ...mapping, category: e.target.value })}
                    className="h-10 w-full rounded-xl border border-bw-line bg-bw-page px-3 text-xs text-bw-ink">
                    <option value="">— اختر عمود التصنيف —</option>
                    {uploadResult.sampleHeaders?.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="supplier-price-type-column" className="block font-semibold text-bw-ink">عمود نوع السعر — مطلوب إن كان الملف يذكره لكل صف؛ الصف الذي لا يقول إنه سعر شراء يُعلق للمراجعة</label>
                  <select id="supplier-price-type-column" value={mapping.priceType} onChange={e => setMapping({ ...mapping, priceType: e.target.value })}
                    className="h-10 w-full rounded-xl border border-bw-line bg-bw-page px-3 text-xs text-bw-ink">
                    <option value="">— اختر عمود نوع السعر —</option>
                    {uploadResult.sampleHeaders?.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
                {/* Optional: Quantity */}
                <div className="space-y-1.5">
                  <label className="block font-semibold text-bw-ink">
                    عمود الكمية المتاحة (Reported Quantity)
                  </label>
                  <select
                    value={mapping.quantity}
                    onChange={(e) => setMapping({ ...mapping, quantity: e.target.value })}
                    className="h-10 w-full rounded-xl border border-bw-line bg-bw-page px-3 text-xs text-bw-ink focus:outline-none focus:border-bw-ok"
                  >
                    <option value="">— اختياري: اختر عمود الكمية —</option>
                    {uploadResult.sampleHeaders?.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Save Profile Name */}
              <div className="pt-3 border-t border-bw-line space-y-1.5">
                <label className="block font-semibold text-xs text-bw-ink">
                  اسم القالب لحفظه واستخدامه تلقائياً في المرات القادمة:
                </label>
                <input
                  type="text"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  placeholder="مثال: قالب شركة الأمل لمنتجات العناية"
                  className="h-9.5 w-full rounded-xl border border-bw-line bg-bw-page px-3 text-xs text-bw-ink focus:outline-none focus:border-bw-ok"
                />
              </div>
            </div>

            <CommandError error={applyMapping.error} />

            <div className="flex items-center justify-between pt-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setStep('FILE_UPLOAD')}
              >
                السابق
              </Button>
              <Button
                type="button"
                disabled={!mapping.supplierSku || !mapping.name || !mapping.price}
                loading={applyMapping.pending}
                className="bg-bw-action text-bw-on-action font-bold h-11 px-6 hover:bg-bw-action-hover"
                onClick={async () => {
                  await applyMapping.execute()
                }}
              >
                <span>حفظ التخطيط وبدء التحليل والمطابقة</span>
                <ChevronLeft className="size-4 ms-1" />
              </Button>
            </div>
          </div>
        ) : null}

        {/* STEP: Awaiting Admin Approval */}
        {step === 'AWAITING_APPROVAL' ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-bw-warn/40 bg-bw-warn-soft p-6 sm:p-8 text-center space-y-4">
              <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-bw-warn-soft text-bw-warn border border-bw-warn/40 ">
                <Clock className="size-7" />
              </div>

              <div className="space-y-1.5 max-w-lg mx-auto">
                <h3 className="text-base sm:text-lg font-bold text-bw-ink">قالب الملف قيد المراجعة والاعتماد</h3>
                <p className="text-xs text-bw-ink-soft leading-relaxed">
                  تم إرسال القالب ومقترح مطابقة الأعمدة لإدارة شيناكير لمراجعته واعتماده لضمان دقة دلالات أسعار الشراء والكميات.
                </p>
                <div className="rounded-xl border border-bw-warn/40 bg-bw-page p-3 text-xs text-bw-warn font-semibold mt-2">
                  تم إرسال القالب للمراجعة — لن تظهر الأصناف في المعاينة حتى تتم الموافقة الرسمية من قبل الإدارة.
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-3 pt-3">
                <Button
                  variant="primary"
                  loading={checkingApproval}
                  onClick={async () => {
                    if (!currentJobId) return
                    setCheckingApproval(true)
                    try {
                      const job = await api<{ status: string; importedItemsCount: number }>(`/ingestion/jobs/${currentJobId}`)
                      if (job.status === 'pending' && job.importedItemsCount > 0) {
                        await loadDiff(currentJobId)
                        setStep('PREVIEW_DIFF')
                      } else {
                        alert('القالب لا يزال قيد المراجعة لدى فريق الإدارة. ستتم المعالجة فور اعتماد الدلالات.')
                      }
                    } catch (e: any) {
                      alert(e?.message || 'حدث خطأ أثناء فحص حالة القالب')
                    } finally {
                      setCheckingApproval(false)
                    }
                  }}
                  className="bg-bw-action text-bw-on-action font-bold h-10 px-5 hover:bg-bw-action-hover"
                >
                  <RefreshCw className="size-4 ms-1" />
                  <span>التحقق من حالة الاعتماد الآن</span>
                </Button>

                <Button
                  variant="ghost"
                  onClick={() => {
                    setStep('MODE_SELECT')
                    setFile(null)
                    setCurrentJobId(null)
                    setUploadResult(null)
                  }}
                  className="text-xs text-bw-ink-soft hover:text-bw-ink"
                >
                  بدء عملية تحديث جديدة
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {/* STEP 4: Preview Diff & Validation */}
        {step === 'PREVIEW_DIFF' ? (
          diffLoading ? (
            <div className="space-y-4 p-8 text-center rounded-2xl border border-bw-line bg-bw-surface">
              <Loader2 className="size-8 text-bw-ok animate-spin mx-auto" />
              <p className="text-sm font-bold text-bw-ink">جاري حساب الفروقات السعرية ومطابقة الأصناف مع الكتالوج...</p>
              <p className="text-xs text-bw-ink-subtle">نطابق الأكواد والباركودات ونفحص أي قفزات غير اعتيادية بالأسعار.</p>
            </div>
          ) : diff ? (
            <div className="space-y-6">
              {/* Diff Summary Counters Bar */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
                <div className="rounded-xl border border-bw-ok/40 bg-bw-ok-soft p-3 text-center space-y-0.5">
                  <span className="text-[10px] font-bold uppercase text-bw-ok">تحديث أسعار</span>
                  <p className="font-mono text-xl font-extrabold text-bw-ink">{diff.counters.updated}</p>
                </div>

                <div className="rounded-xl border border-bw-info/40 bg-bw-info-soft p-3 text-center space-y-0.5">
                  <span className="text-[10px] font-bold uppercase text-bw-info">إضافة لأول مرة</span>
                  <p className="font-mono text-xl font-extrabold text-bw-ink">{diff.counters.created}</p>
                </div>

                <div className="rounded-xl border border-bw-line bg-bw-surface p-3 text-center space-y-0.5">
                  <span className="text-[10px] font-bold uppercase text-bw-ink-subtle">بدون تغيير</span>
                  <p className="font-mono text-xl font-extrabold text-bw-ink">{diff.counters.unchanged}</p>
                </div>

                <div className="rounded-xl border border-bw-info/40 bg-bw-info-soft p-3 text-center space-y-0.5">
                  <span className="text-[10px] font-bold uppercase text-bw-info">مرشحون جدد</span>
                  <p className="font-mono text-xl font-extrabold text-bw-ink">{diff.counters.skipped}</p>
                </div>

                <div className="rounded-xl border border-bw-warn/40 bg-bw-warn-soft p-3 text-center space-y-0.5">
                  <span className="text-[10px] font-bold uppercase text-bw-warn">قفزات سعرية</span>
                  <p className="font-mono text-xl font-extrabold text-bw-ink">{diff.counters.review}</p>
                </div>

                <div className="rounded-xl border border-bw-danger/40 bg-bw-danger-soft p-3 text-center space-y-0.5">
                  <span className="text-[10px] font-bold uppercase text-bw-danger">أخطاء بالملف</span>
                  <p className="font-mono text-xl font-extrabold text-bw-ink">{diff.counters.error + (diff.sourceRows?.invalid ?? 0)}</p>
                </div>
              </div>

              {uploadResult?.reused ? (
                <Notice tone="info" title="هذا الملف سبق رفعه ومعالجته">
                  لم تُنشأ عملية جديدة ولم تتكرر أي أصناف أو عروض؛ هذه هي نتيجة العملية <Code>{shortId(uploadResult.jobId)}</Code> السابقة.
                </Notice>
              ) : null}

              <SourceRowOutcomes summary={diff.sourceRows} />

              {/* Candidate Protection Notice */}
              {diff.counters.skipped > 0 ? (
                <Notice tone="info" title={`تم رصد ${diff.counters.skipped} منتجاً جديداً غير مسجل مسبقاً`}>
                  الأصناف غير المطابقة بكتالوج شيناكير تُحال تلقائياً كـ (Product Candidates) للتدقيق الإداري ولا تُنشر تلقائياً بالمتجر حفاظاً على جودة الكتالوج.
                </Notice>
              ) : null}

              {/* Absent Snapshot Products Warning */}
              {diff.deactivationCandidates && diff.deactivationCandidates.length > 0 ? (
                <div className="rounded-2xl border border-bw-warn/40 bg-bw-warn-soft p-4 space-y-2">
                  <div className="flex items-center gap-2 text-bw-warn font-bold text-xs">
                    <AlertTriangle className="size-4" />
                    <span>تنبيه اللقطة الكاملة: {diff.deactivationCandidates.length} صنفاً مسجلاً بحسابكم لم يذكر في هذا الملف</span>
                  </div>
                  <p className="text-xs text-bw-ink-soft leading-relaxed">
                    لحماية تشكيلتكم من الحذف العرضي أو النسيان، لا يتم تعطيل هذه الأصناف تلقائياً. ستبقى العروض مفعلة وتتطلب مراجعة مستقلة.
                  </p>
                </div>
              ) : null}

              {/* Diff Filters Toolbar */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                <div className="flex rounded-xl border border-bw-line bg-bw-surface p-1 text-xs">
                  {(
                    [
                      ['all', `الكل (${diff.rows.length})`],
                      ['changes', `تحديثات (${diff.counters.updated + diff.counters.created})`],
                      ['candidates', `مرشحون جدد (${diff.counters.skipped})`],
                      ['errors', `أخطاء (${diff.counters.error})`],
                    ] as const
                  ).map(([fKey, fLabel]) => (
                    <button
                      key={fKey}
                      type="button"
                      onClick={() => setDiffFilter(fKey)}
                      className={`rounded-lg px-3 py-1 font-semibold transition-all ${
                        diffFilter === fKey
                          ? 'bg-bw-action text-bw-on-action shadow-xs'
                          : 'text-bw-ink-soft hover:text-bw-ink'
                      }`}
                    >
                      {fLabel}
                    </button>
                  ))}
                </div>

                <div className="relative w-full sm:w-64">
                  <Search className="pointer-events-none absolute start-3 top-2.5 size-3.5 text-bw-ink-subtle" />
                  <input
                    type="text"
                    placeholder="بحث في نتائج المعاينة..."
                    value={diffSearch}
                    onChange={(e) => setDiffSearch(e.target.value)}
                    className="h-8.5 w-full rounded-xl border border-bw-line bg-bw-surface pe-3 ps-8.5 text-xs text-bw-ink placeholder:text-bw-ink-subtle focus:border-bw-ok focus:outline-none"
                  />
                </div>
              </div>

              {/* Diff Table */}
              <div className="overflow-hidden rounded-2xl border border-bw-line bg-bw-surface shadow-md">
                <div className="overflow-x-auto">
                  <table className="w-full text-start text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-bw-line bg-bw-page text-bw-ink-subtle font-semibold text-[11px]">
                        <th className="py-3 px-4 text-start">المنتج وكود الصنف</th>
                        <th className="py-3 px-4 text-start">الإجراء المقترح</th>
                        <th className="py-3 px-4 text-end">السعر قبل</th>
                        <th className="py-3 px-4 text-end">السعر بعد</th>
                        <th className="py-3 px-4 text-center">نسبة التغير</th>
                        <th className="py-3 px-4 text-start">تفاصيل المطابقة أو الخطأ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-bw-line">
                      {filteredDiffRows.slice(0, 50).map((row) => {
                        const isError = row.action === 'ERROR'
                        const isCandidate = row.action === 'SKIP'
                        const isUpdated = row.action === 'UPDATE' || row.action === 'CREATE'

                        return (
                          <tr
                            key={row.itemId}
                            className={`hover:bg-bw-sunken transition-colors ${
                              isError
                                ? 'bg-bw-danger-soft'
                                : row.isLargePriceJump
                                ? 'bg-bw-warn-soft'
                                : ''
                            }`}
                          >
                            {/* Product & SKU */}
                            <td className="py-3 px-4 max-w-sm">
                              <div className="space-y-1">
                                <p className="font-bold text-bw-ink truncate text-xs leading-snug">
                                  {row.productName}
                                </p>
                                <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                                  <span className="font-mono font-semibold px-1.5 py-0.5 rounded-md bg-bw-sunken border border-bw-line text-bw-ok">
                                    SKU: {row.supplierSkuCode}
                                  </span>
                                  {row.canonicalSkuCode ? (
                                    <span className="font-mono text-bw-ink-subtle">
                                      كتالوج: <Code className="text-[10px] text-bw-ink-soft">{row.canonicalSkuCode}</Code>
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                            </td>

                            {/* Action Badge */}
                            <td className="py-3 px-4 whitespace-nowrap">
                              {row.action === 'UPDATE' ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-bw-ok-soft text-bw-ok px-2 py-0.5 text-[10px] font-bold">
                                  <Check className="size-3" />
                                  تحديث السعر
                                </span>
                              ) : row.action === 'CREATE' ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-bw-info-soft text-bw-info px-2 py-0.5 text-[10px] font-bold">
                                  <Plus className="size-3" />
                                  إضافة جديدة
                                </span>
                              ) : row.action === 'UNCHANGED' ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-bw-sunken text-bw-ink-subtle px-2 py-0.5 text-[10px] font-bold">
                                  بدون تغيير
                                </span>
                              ) : row.action === 'SKIP' ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-bw-info-soft text-bw-info px-2 py-0.5 text-[10px] font-bold">
                                  مرشح للمراجعة
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded-full bg-bw-danger-soft text-bw-danger px-2 py-0.5 text-[10px] font-bold">
                                  <AlertCircle className="size-3" />
                                  خطأ بالبيانات
                                </span>
                              )}
                            </td>

                            {/* Price Before */}
                            <td className="py-3 px-4 text-end font-mono text-bw-ink-soft whitespace-nowrap">
                              {row.before?.costPrice ? <Egp value={row.before.costPrice} /> : '—'}
                            </td>

                            {/* Price After */}
                            <td className="py-3 px-4 text-end font-mono font-bold text-bw-ink whitespace-nowrap">
                              {row.after.costPrice ? <Egp value={row.after.costPrice} /> : '—'}
                            </td>

                            {/* Change % */}
                            <td className="py-3 px-4 text-center font-mono whitespace-nowrap">
                              {row.priceChangePercent !== null ? (
                                <span
                                  className={`font-bold ${
                                    row.isLargePriceJump
                                      ? 'text-bw-warn underline decoration-bw-warn'
                                      : row.priceChangePercent > 0
                                      ? 'text-bw-ok'
                                      : 'text-bw-info'
                                  }`}
                                >
                                  {row.priceChangePercent > 0 ? '+' : ''}
                                  {row.priceChangePercent.toFixed(1)}%
                                </span>
                              ) : (
                                <span className="text-bw-ink-subtle text-[10px]">—</span>
                              )}
                            </td>

                            {/* Details / Reasons */}
                            <td className="py-3 px-4 text-bw-ink-soft text-[11px]">
                              {row.reasons.length > 0 ? (
                                <div className="space-y-0.5">
                                  {row.reasons.map((r, i) => (
                                    <p key={i} className="text-[10px] text-bw-ink-subtle truncate max-w-xs">
                                      {r === 'unmatched_candidate_requires_catalog_admission'
                                        ? 'صنف جديد: غير موجود بالكتالوج'
                                        : r.replace(/_/g, ' ')}
                                    </p>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-bw-ok text-[10px]">مطابق وجاهز للاعتماد</span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {filteredDiffRows.length > 50 ? (
                  <div className="p-3 text-center text-xs text-bw-ink-subtle border-t border-bw-line">
                    يتم عرض أول 50 صنفاً من إجمالي {filteredDiffRows.length} صنف بالمعاينة.
                  </div>
                ) : null}
              </div>

              {/* Confirmation Checkbox & Commit Bar */}
              <div className="rounded-2xl border border-bw-line bg-bw-page p-5 space-y-4 shadow-xl">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={confirmedRisk}
                    onChange={(e) => setConfirmedRisk(e.target.checked)}
                    className="size-4.5 rounded border-bw-line bg-bw-surface text-bw-ok focus:ring-0 mt-0.5 cursor-pointer"
                  />
                  <div className="space-y-0.5 text-xs">
                    <p className="font-bold text-bw-ink">
                      أؤكد مراجعة التغييرات السعرية وأوافق على اعتماد وتطبيق تحديثات المخزون لشيناكير
                    </p>
                    <p className="text-[11px] text-bw-ink-subtle">
                      سيتم تحديث {diff.counters.updated + diff.counters.created} صنفاً فورياً، وتحويل {diff.counters.skipped} منتجاً جديداً للمراجعة الإدارية.
                    </p>
                  </div>
                </label>

                <CommandError error={commit.error} />

                <div className="flex items-center justify-between gap-3 pt-2 border-t border-bw-line">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setStep('FILE_UPLOAD')}
                  >
                    إلغاء والعودة لرفع ملف آخر
                  </Button>

                  <Button
                    type="button"
                    disabled={!confirmedRisk}
                    loading={commit.pending}
                    className="bg-bw-action text-bw-on-action font-bold h-12 px-8 text-sm hover:bg-bw-action-hover "
                    onClick={async () => {
                      await commit.execute()
                    }}
                  >
                    <CheckCircle2 className="size-4 me-1.5" />
                    اعتماد وتطبيق التحديثات فورياً
                  </Button>
                </div>
              </div>
            </div>
          ) : null
        ) : null}

        {/* STEP 5: Receipt Results */}
        {step === 'RECEIPT' && commitResult ? (
          <div className="space-y-6">
            <div className="rounded-2xl border border-bw-ok/40 bg-bw-ok-soft p-6 text-center space-y-3">
              <div className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-bw-ok-soft text-bw-ok border border-bw-ok/40 ">
                <CheckCircle2 className="size-8" />
              </div>

              <h2 className="text-xl font-bold text-bw-ink">تم تطبيق وتحديث العروض بنجاح!</h2>
              <p className="text-xs text-bw-ink-soft max-w-lg mx-auto">
                تم اعتماد التعديلات وتحديث جداول التوريد وشراء شيناكير فورياً.
              </p>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4 max-w-2xl mx-auto text-xs">
                <div className="rounded-xl border border-bw-line bg-bw-page p-3 space-y-1">
                  <span className="text-[10px] text-bw-ink-subtle">عروض محدثة ومفعلة</span>
                  <p className="font-mono text-2xl font-extrabold text-bw-ok">
                    {commitResult.committedCount}
                  </p>
                </div>

                <div className="rounded-xl border border-bw-line bg-bw-page p-3 space-y-1">
                  <span className="text-[10px] text-bw-ink-subtle">بدون تغيير</span>
                  <p className="font-mono text-2xl font-extrabold text-bw-ink">
                    {commitResult.unchangedCount}
                  </p>
                </div>

                <div className="rounded-xl border border-bw-line bg-bw-page p-3 space-y-1">
                  <span className="text-[10px] text-bw-ink-subtle">مرشحون للمراجعة</span>
                  <p className="font-mono text-2xl font-extrabold text-bw-info">
                    {commitResult.heldForReviewCount + commitResult.skippedCount}
                  </p>
                </div>

                <div className="rounded-xl border border-bw-line bg-bw-page p-3 space-y-1">
                  <span className="text-[10px] text-bw-ink-subtle">أخطاء مستبعدة</span>
                  <p className="font-mono text-2xl font-extrabold text-bw-danger">
                    {commitResult.errorCount}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              <Link
                href="/supplier/products"
                className="inline-flex h-11 items-center gap-2 rounded-xl bg-bw-action px-6 text-xs font-bold text-bw-on-action hover:bg-bw-action-hover "
              >
                <Store className="size-4" />
                <span>عرض قائمة منتجاتي المحدثة</span>
              </Link>

              {currentJobId ? (
                <Link
                  href={`/supplier/updates/${currentJobId}`}
                  className="inline-flex h-11 items-center gap-2 rounded-xl border border-bw-line bg-bw-surface px-5 text-xs font-bold text-bw-ink hover:bg-bw-sunken"
                >
                  <Eye className="size-4" />
                  <span>فحص تفاصيل هذه العملية</span>
                </Link>
              ) : null}

              <button
                type="button"
                onClick={() => {
                  setStep('MODE_SELECT')
                  setFile(null)
                  setUploadResult(null)
                  setCurrentJobId(null)
                  setDiff(null)
                  setCommitResult(null)
                }}
                className="inline-flex h-11 items-center gap-2 rounded-xl border border-bw-line bg-bw-surface px-5 text-xs font-semibold text-bw-ink-soft hover:text-bw-ink"
              >
                <span>رفع ملف جديد</span>
              </button>
            </div>
          </div>
        ) : null}
      </div>
  )
}

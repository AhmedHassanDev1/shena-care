'use client'

import * as React from 'react'
import {
  CheckCircle2,
  FlaskConical,
  History,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  XCircle,
} from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import {
  Button,
  Code,
  Field,
  Notice,
  Select,
  Skeleton,
  StatusLabel,
  Switch,
} from '@/components/bw/primitives'
import { LoadError } from '@/components/workspace/role-shell'
import { useApi } from '@/lib/use-api'
import {
  BrandSummary,
  CategoryNode,
  EXCLUDED_CLASS_LABELS,
  PolicyBrandCategoryRule,
  PolicyBrandRule,
  PolicyCategoryRule,
  PolicyDocument,
  PolicyEvaluationResult,
  PolicyRuleEffect,
  PolicyStateResponse,
  flattenCategories,
  policyReasonLabel,
} from './catalog-utils'

const EMPTY_DOC: PolicyDocument = {
  mode: 'OPEN',
  brands: [],
  categories: [],
  brandCategoryRules: [],
  excludedTerms: [],
  disabledExcludedClasses: [],
}

export function AllowlistTab({
  brands,
  categories,
}: {
  brands: BrandSummary[]
  categories: CategoryNode[]
}) {
  const policyApi = useApi<PolicyStateResponse>('/catalog/policy')
  const [doc, setDoc] = React.useState<PolicyDocument>(EMPTY_DOC)
  const [reason, setReason] = React.useState('')
  const [dirty, setDirty] = React.useState(false)
  const [showHistory, setShowHistory] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const [newBrandId, setNewBrandId] = React.useState('')
  const [newExternalBrand, setNewExternalBrand] = React.useState('')
  const [newBrandEffect, setNewBrandEffect] = React.useState<PolicyRuleEffect>('ALLOW')
  const [newBrandAliases, setNewBrandAliases] = React.useState('')

  const [newCatId, setNewCatId] = React.useState('')
  const [newCatEffect, setNewCatEffect] = React.useState<PolicyRuleEffect>('ALLOW')

  const [pairBrandId, setPairBrandId] = React.useState('')
  const [pairCatId, setPairCatId] = React.useState('')
  const [pairEffect, setPairEffect] = React.useState<PolicyRuleEffect>('ALLOW')
  const [pairNote, setPairNote] = React.useState('')

  const [newTerm, setNewTerm] = React.useState('')

  const [simTitle, setSimTitle] = React.useState('')
  const [simBrandId, setSimBrandId] = React.useState('')
  const [simBrandName, setSimBrandName] = React.useState('')
  const [simCategoryId, setSimCategoryId] = React.useState('')
  const [simHardId, setSimHardId] = React.useState(false)
  const [simulating, setSimulating] = React.useState(false)
  const [simResult, setSimResult] = React.useState<PolicyEvaluationResult | null>(null)
  const [simError, setSimError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!policyApi.data) return
    setDoc(policyApi.data.current.document)
    setDirty(false)
  }, [policyApi.data])

  const flatCategories = React.useMemo(() => flattenCategories(categories), [categories])

  function updateDoc(updater: (prev: PolicyDocument) => PolicyDocument) {
    setDoc((prev) => updater(prev))
    setDirty(true)
    setNotice(null)
    setError(null)
  }

  function addBrandRule() {
    const aliases = newBrandAliases
      .split(/[,،]+/)
      .map((s) => s.trim())
      .filter(Boolean)

    if (newBrandId) {
      const canonical = brands.find((b) => b.id === newBrandId)
      if (!canonical) return
      if (doc.brands.some((b) => b.id === canonical.id)) {
        setError(`الماركة «${canonical.name}» مضافة بالفعل في قائمة القواعد.`)
        return
      }
      const nextRule: PolicyBrandRule = {
        id: canonical.id,
        name: canonical.name,
        effect: newBrandEffect,
        aliases: aliases.length ? aliases : canonical.aliases,
      }
      updateDoc((prev) => ({ ...prev, brands: [...prev.brands, nextRule] }))
      setNewBrandId('')
      setNewBrandAliases('')
      return
    }

    if (newExternalBrand.trim() && newBrandEffect === 'DENY') {
      const label = newExternalBrand.trim()
      if (doc.brands.some((b) => !b.id && b.name.toLowerCase() === label.toLowerCase())) {
        setError(`العلامة «${label}» مضافة بالفعل.`)
        return
      }
      updateDoc((prev) => ({
        ...prev,
        brands: [...prev.brands, { name: label, effect: 'DENY', aliases }],
      }))
      setNewExternalBrand('')
      setNewBrandAliases('')
    }
  }

  function addCategoryRule() {
    if (!newCatId) return
    const cat = flatCategories.find((c) => c.id === newCatId)
    if (!cat) return
    if (doc.categories.some((c) => c.id === cat.id)) {
      setError(`التصنيف «${cat.name}» موجود بالفعل في القواعد.`)
      return
    }
    const nextRule: PolicyCategoryRule = {
      id: cat.id,
      name: cat.name,
      effect: newCatEffect,
    }
    updateDoc((prev) => ({ ...prev, categories: [...prev.categories, nextRule] }))
    setNewCatId('')
  }

  function addPairRule() {
    if (!pairBrandId || !pairCatId) return
    const brand = brands.find((b) => b.id === pairBrandId)
    const cat = flatCategories.find((c) => c.id === pairCatId)
    if (!brand || !cat) return
    if (doc.brandCategoryRules.some((r) => r.brandId === brand.id && r.categoryId === cat.id)) {
      setError('هذا الاستثناء المركب مسجل بالفعل.')
      return
    }
    const rule: PolicyBrandCategoryRule = {
      brandId: brand.id,
      brandName: brand.name,
      categoryId: cat.id,
      categoryName: cat.name,
      effect: pairEffect,
      ...(pairNote.trim() ? { note: pairNote.trim() } : {}),
    }
    updateDoc((prev) => ({
      ...prev,
      brandCategoryRules: [...prev.brandCategoryRules, rule],
    }))
    setPairBrandId('')
    setPairCatId('')
    setPairNote('')
  }

  function addExcludedTerm() {
    const trimmed = newTerm.trim()
    if (trimmed.length < 2) return
    if (doc.excludedTerms.some((t) => t.toLowerCase() === trimmed.toLowerCase())) {
      setNewTerm('')
      return
    }
    updateDoc((prev) => ({
      ...prev,
      excludedTerms: [...prev.excludedTerms, trimmed],
    }))
    setNewTerm('')
  }

  async function savePolicy(event: React.FormEvent) {
    event.preventDefault()
    if (reason.trim().length < 3) {
      setError('اكتب سبب التعديل للمراجعة والتوثيق (3 أحرف على الأقل).')
      return
    }
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      await api<PolicyStateResponse>('/catalog/policy', {
        method: 'PUT',
        body: {
          ...doc,
          reason: reason.trim(),
        },
      })
      setNotice('تم اعتماد وحفظ سياسة قائمة السماح في سجل الإصدارات.')
      setReason('')
      setDirty(false)
      policyApi.reload()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذر حفظ السياسة.')
    } finally {
      setSaving(false)
    }
  }

  async function runSimulation(event: React.FormEvent) {
    event.preventDefault()
    if (!simTitle.trim()) {
      setSimError('أدخل عنوان المنتج للاختبار.')
      return
    }
    setSimulating(true)
    setSimError(null)
    try {
      const selectedBrand = brands.find((b) => b.id === simBrandId)
      const res = await api<PolicyEvaluationResult>('/catalog/policy/evaluate', {
        method: 'POST',
        body: {
          title: simTitle.trim(),
          ...(simBrandId ? { brandId: simBrandId } : {}),
          ...(selectedBrand
            ? { brandName: selectedBrand.name }
            : simBrandName.trim()
              ? { brandName: simBrandName.trim() }
              : {}),
          ...(simCategoryId ? { categoryId: simCategoryId } : {}),
          hasHardIdentifier: simHardId,
        },
      })
      setSimResult(res)
    } catch (err) {
      setSimError(err instanceof ApiError ? err.message : 'تعذر تشغيل محاكي القواعد.')
    } finally {
      setSimulating(false)
    }
  }

  if (policyApi.loading && !policyApi.data) {
    return <Skeleton className="h-80 w-full rounded-bw-card" />
  }

  if (policyApi.error) {
    return <LoadError message={policyApi.error.message} onRetry={policyApi.reload} />
  }

  const version = policyApi.data?.current.version ?? 0
  const history = policyApi.data?.history ?? []
  const systemClasses = policyApi.data?.systemExcludedClasses ?? []

  return (
    <section aria-label="قائمة السماح وسياسة الإدخال" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-bw-card border border-bw-line bg-bw-surface p-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold text-bw-ink">سياسة أهلية الإدخال (Allowlist Policy)</h2>
            <StatusLabel tone={version > 0 ? 'info' : 'neutral'}>
              الإصدار <Code>{`v${version}`}</Code>
            </StatusLabel>
            {dirty ? <StatusLabel tone="warn">تعديلات غير محفوظة</StatusLabel> : null}
          </div>
          <p className="text-bw-small text-bw-ink-soft">
            {policyApi.data?.current.reason
              ? `آخر اعتماد: ${policyApi.data.current.reason}`
              : 'السياسة الافتراضية المبدئية مفعّلة بدون قواعد مخصصة بعد.'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => setShowHistory((v) => !v)}>
            <History className="size-4" aria-hidden />
            سجل الإصدارات (<Code>{history.length}</Code>)
          </Button>
          <Button variant="ghost" aria-label="تحديث السياسة" onClick={policyApi.reload}>
            <RefreshCw className="size-4" />
          </Button>
        </div>
      </div>

      <Notice tone="warn" title="سياسة غير مدمرة للكتالوج الحالي">
        تنطبق هذه القواعد على فحص قوائم الموردين الجديدة ومطابقة الإدخال فقط. لا تحذف أو تؤرشف أو توقف نشر أي منتج موجود حاليًا.
      </Notice>

      {showHistory && history.length > 0 ? (
        <div className="rounded-bw-card border border-bw-line bg-bw-surface p-4">
          <h3 className="mb-3 text-bw-small font-semibold text-bw-ink">سجل التعديلات المعتمدة</h3>
          <ul className="divide-y divide-bw-line text-bw-small">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="flex items-center gap-2">
                  <Code className="rounded bg-bw-sunken px-1.5 py-0.5 text-[11px] font-semibold">
                    {`v${h.version ?? 0}`}
                  </Code>
                  <span className="text-bw-ink">{h.reason}</span>
                </div>
                <span className="text-[11px] text-bw-ink-subtle">
                  {h.approvedAt ? new Date(h.approvedAt).toLocaleString('ar-EG') : '—'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {notice ? (
        <div
          role="status"
          className="rounded-bw-field border border-bw-emerald/30 bg-bw-emerald-soft px-3.5 py-2.5 text-bw-small text-bw-ink"
        >
          {notice}
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="rounded-bw-field border border-bw-rose/30 bg-bw-rose-soft px-3.5 py-2.5 text-bw-small text-bw-ink"
        >
          {error}
        </div>
      ) : null}

      <div className="rounded-bw-card border border-bw-line bg-bw-surface p-4 space-y-3">
        <h3 className="text-bw-small font-semibold text-bw-ink">وضع السياسة العام</h3>
        <div className="grid gap-3 md:grid-cols-2">
          {[
            {
              value: 'OPEN' as const,
              title: 'الوضع المفتوح (استبعاد الممنوع فقط)',
              body: 'تستمر الماركات المعروفة والمنتجات غير المصنفة مع تطبيق قواعد المنع والكلمات وفئات الاستبعاد التلقائي.',
            },
            {
              value: 'ALLOWLIST_ONLY' as const,
              title: 'وضع السماح الحصري (Allowlist Only)',
              body: 'يمرر فقط الماركات والتصنيفات المسموح بها صراحةً أو المعرفات الموثقة (الباركود)؛ ويستبعد باقي القوائم مبكرًا.',
            },
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => updateDoc((prev) => ({ ...prev, mode: option.value }))}
              className={`rounded-bw-card border p-3.5 text-start transition-colors ${
                doc.mode === option.value
                  ? 'border-bw-cobalt bg-bw-cobalt-soft'
                  : 'border-bw-line bg-bw-sunken hover:border-bw-line-field'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-bw-ink">{option.title}</span>
                <StatusLabel tone={doc.mode === option.value ? 'info' : 'neutral'}>
                  {doc.mode === option.value ? 'مفعّل' : 'اختيار'}
                </StatusLabel>
              </div>
              <p className="mt-1.5 text-[11px] leading-5 text-bw-ink-soft">{option.body}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.25fr_0.95fr]">
        <div className="space-y-5">
          <div className="space-y-3 rounded-bw-card border border-bw-line bg-bw-surface p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold text-bw-ink">قواعد الماركات والأسماء البديلة</h3>
              <span className="text-[11px] text-bw-ink-subtle">
                <Code>{doc.brands.length}</Code> قاعدة
              </span>
            </div>

            <div className="grid gap-2.5 rounded-bw-field border border-bw-line bg-bw-sunken p-3 sm:grid-cols-2">
              <Select
                label="اختر ماركة معيارية"
                value={newBrandId}
                onChange={(e) => {
                  setNewBrandId(e.target.value)
                  if (e.target.value) setNewExternalBrand('')
                }}
                options={[
                  { value: '', label: '— اختر من الماركات المسجلة —' },
                  ...brands.map((b) => ({ value: b.id, label: b.name })),
                ]}
              />
              <Select
                label="الحكم"
                value={newBrandEffect}
                onChange={(e) => setNewBrandEffect(e.target.value as PolicyRuleEffect)}
                options={[
                  { value: 'ALLOW', label: 'سماح (ALLOW)' },
                  { value: 'DENY', label: 'استبعاد / منع (DENY)' },
                ]}
              />
              {!newBrandId && newBrandEffect === 'DENY' ? (
                <Field
                  label="أو اسم ماركة خارجية لمنعها دون إضافتها للكتالوج"
                  value={newExternalBrand}
                  onChange={(e) => setNewExternalBrand(e.target.value)}
                  placeholder="مثال: ماركة تجارية خارج النطاق"
                />
              ) : null}
              <Field
                label="أسماء بديلة للمطابقة (افصل بفاصلة)"
                value={newBrandAliases}
                onChange={(e) => setNewBrandAliases(e.target.value)}
                placeholder="مثال: سيرافي، سيرفي"
              />
              <div className="flex items-end sm:col-span-2">
                <Button
                  variant="secondary"
                  disabled={!newBrandId && !(newBrandEffect === 'DENY' && newExternalBrand.trim())}
                  onClick={addBrandRule}
                >
                  <Plus className="size-4" aria-hidden />
                  إضافة قاعدة ماركة
                </Button>
              </div>
            </div>

            {doc.brands.length === 0 ? (
              <p className="text-bw-small text-bw-ink-subtle">لا توجد قواعد ماركات مخصصة بعد.</p>
            ) : (
              <ul className="divide-y divide-bw-line rounded-bw-field border border-bw-line">
                {doc.brands.map((rule, idx) => (
                  <li
                    key={`${rule.id ?? rule.name}-${idx}`}
                    className="flex flex-wrap items-center justify-between gap-2 p-2.5 text-bw-small"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-bw-ink">{rule.name}</span>
                        <StatusLabel tone={rule.effect === 'ALLOW' ? 'ok' : 'danger'}>
                          {rule.effect === 'ALLOW' ? 'مسموح' : 'مستبعد'}
                        </StatusLabel>
                        {!rule.id ? (
                          <span className="text-[11px] text-bw-ink-subtle">خارج الكتالوج</span>
                        ) : null}
                      </div>
                      {rule.aliases?.length ? (
                        <p className="text-[11px] text-bw-ink-soft">
                          بدائل: {rule.aliases.join(' · ')}
                        </p>
                      ) : null}
                    </div>
                    <Button
                      variant="ghost"
                      onClick={() =>
                        updateDoc((prev) => ({
                          ...prev,
                          brands: prev.brands.filter((_, i) => i !== idx),
                        }))
                      }
                      aria-label={`إزالة قاعدة ${rule.name}`}
                    >
                      <Trash2 className="size-3.5 text-bw-rose" aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-3 rounded-bw-card border border-bw-line bg-bw-surface p-4">
            <h3 className="font-semibold text-bw-ink">قواعد التصنيفات واستثناءات (ماركة + تصنيف)</h3>
            <div className="grid gap-2.5 rounded-bw-field border border-bw-line bg-bw-sunken p-3 sm:grid-cols-[1.5fr_1fr_auto] sm:items-end">
              <Select
                label="التصنيف المعياري"
                value={newCatId}
                onChange={(e) => setNewCatId(e.target.value)}
                options={[
                  { value: '', label: '— اختر تصنيفًا —' },
                  ...flatCategories.map((c) => ({
                    value: c.id,
                    label: c.parentName ? `${c.parentName} ← ${c.name}` : c.name,
                  })),
                ]}
              />
              <Select
                label="الحكم"
                value={newCatEffect}
                onChange={(e) => setNewCatEffect(e.target.value as PolicyRuleEffect)}
                options={[
                  { value: 'ALLOW', label: 'سماح (ALLOW)' },
                  { value: 'DENY', label: 'منع (DENY)' },
                ]}
              />
              <Button variant="secondary" disabled={!newCatId} onClick={addCategoryRule}>
                إضافة
              </Button>
            </div>

            {doc.categories.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {doc.categories.map((cat) => (
                  <span
                    key={cat.id}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-bw-small ${
                      cat.effect === 'ALLOW'
                        ? 'border-bw-emerald/30 bg-bw-emerald-soft'
                        : 'border-bw-rose/30 bg-bw-rose-soft'
                    }`}
                  >
                    <span>
                      {cat.name} ({cat.effect === 'ALLOW' ? 'سماح' : 'منع'})
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        updateDoc((prev) => ({
                          ...prev,
                          categories: prev.categories.filter((c) => c.id !== cat.id),
                        }))
                      }
                      aria-label={`حذف قاعدة ${cat.name}`}
                      className="text-bw-ink-soft hover:text-bw-ink"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : null}

            <div className="border-t border-bw-line pt-3 space-y-2.5">
              <p className="text-[11px] font-semibold text-bw-ink-soft">
                استثناءات مركبة (ماركة محددة داخل تصنيف محدد):
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <Select
                  label="الماركة"
                  value={pairBrandId}
                  onChange={(e) => setPairBrandId(e.target.value)}
                  options={[
                    { value: '', label: '— اختر ماركة —' },
                    ...brands.map((b) => ({ value: b.id, label: b.name })),
                  ]}
                />
                <Select
                  label="التصنيف"
                  value={pairCatId}
                  onChange={(e) => setPairCatId(e.target.value)}
                  options={[
                    { value: '', label: '— اختر تصنيفًا —' },
                    ...flatCategories.map((c) => ({
                      value: c.id,
                      label: c.parentName ? `${c.parentName} ← ${c.name}` : c.name,
                    })),
                  ]}
                />
                <Select
                  label="التأثير"
                  value={pairEffect}
                  onChange={(e) => setPairEffect(e.target.value as PolicyRuleEffect)}
                  options={[
                    { value: 'ALLOW', label: 'استثناء بالسماح (ALLOW)' },
                    { value: 'DENY', label: 'استثناء بالمنع (DENY)' },
                  ]}
                />
                <Field
                  label="ملاحظة (اختياري)"
                  value={pairNote}
                  onChange={(e) => setPairNote(e.target.value)}
                />
              </div>
              <Button
                variant="secondary"
                disabled={!pairBrandId || !pairCatId}
                onClick={addPairRule}
              >
                <Plus className="size-4" aria-hidden />
                إضافة استثناء مركب
              </Button>

              {doc.brandCategoryRules.length > 0 ? (
                <ul className="divide-y divide-bw-line rounded-bw-field border border-bw-line">
                  {doc.brandCategoryRules.map((r, i) => (
                    <li
                      key={`${r.brandId ?? r.brandName}-${r.categoryId}-${i}`}
                      className="flex items-center justify-between gap-2 p-2.5 text-bw-small"
                    >
                      <span>
                        <strong>{r.brandName}</strong> ← {r.categoryName}{' '}
                        <StatusLabel tone={r.effect === 'ALLOW' ? 'ok' : 'danger'}>
                          {r.effect === 'ALLOW' ? 'سماح' : 'منع'}
                        </StatusLabel>
                      </span>
                      <Button
                        variant="ghost"
                        onClick={() =>
                          updateDoc((prev) => ({
                            ...prev,
                            brandCategoryRules: prev.brandCategoryRules.filter((_, idx) => idx !== i),
                          }))
                        }
                      >
                        <Trash2 className="size-3.5 text-bw-rose" aria-hidden />
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>

          <div className="space-y-3 rounded-bw-card border border-bw-line bg-bw-surface p-4">
            <h3 className="font-semibold text-bw-ink">العبارات المستبعدة وفئات الحماية الافتراضية</h3>
            <div className="flex flex-wrap items-end gap-2">
              <Field
                label="إضافة عبارة مستبعدة (عربي أو إنجليزي)"
                value={newTerm}
                onChange={(e) => setNewTerm(e.target.value)}
                placeholder="مثال: tester أو عينة مجانية"
                className="flex-1 min-w-52"
              />
              <Button variant="secondary" disabled={newTerm.trim().length < 2} onClick={addExcludedTerm}>
                إضافة عبارة
              </Button>
            </div>
            {doc.excludedTerms.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {doc.excludedTerms.map((term) => (
                  <span
                    key={term}
                    className="inline-flex items-center gap-1.5 rounded-full border border-bw-rose/30 bg-bw-rose-soft px-2.5 py-0.5 text-bw-small"
                  >
                    {term}
                    <button
                      type="button"
                      onClick={() =>
                        updateDoc((prev) => ({
                          ...prev,
                          excludedTerms: prev.excludedTerms.filter((t) => t !== term),
                        }))
                      }
                      aria-label={`حذف عبارة ${term}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : null}

            <div className="border-t border-bw-line pt-3">
              <p className="mb-2 text-[11px] font-semibold text-bw-ink-soft">
                فئات الاستبعاد المدمجة في المحرك (EXCLUDED_CLASSES):
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {systemClasses.map((klass) => {
                  const isDisabled = doc.disabledExcludedClasses.includes(klass.key)
                  return (
                    <div
                      key={klass.key}
                      className="rounded-bw-field border border-bw-line bg-bw-sunken p-2.5 text-[11px]"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-bw-ink">
                          {EXCLUDED_CLASS_LABELS[klass.key] ?? klass.key}
                        </span>
                        <input
                          type="checkbox"
                          checked={!isDisabled}
                          onChange={(e) =>
                            updateDoc((prev) => ({
                              ...prev,
                              disabledExcludedClasses: e.target.checked
                                ? prev.disabledExcludedClasses.filter((k) => k !== klass.key)
                                : [...prev.disabledExcludedClasses, klass.key],
                            }))
                          }
                          aria-label={`تفعيل استبعاد ${klass.key}`}
                          className="size-4 accent-bw-cobalt"
                        />
                      </div>
                      <p className="mt-1 truncate text-bw-ink-subtle">
                        أمثلة: {klass.samplePhrases.join('، ')}
                      </p>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-5">
          <form
            onSubmit={runSimulation}
            className="space-y-3.5 rounded-bw-card border border-bw-cobalt/30 bg-bw-surface p-4"
          >
            <div className="flex items-center gap-2">
              <FlaskConical className="size-4 text-bw-cobalt" aria-hidden />
              <h3 className="font-semibold text-bw-ink">محاكي اختبار القواعد (Dry-Run)</h3>
            </div>
            <p className="text-[11px] leading-5 text-bw-ink-soft">
              اختبر عنوان سطر مورد قبل الاعتماد لمعرفة هل سيُمرر أم يُستبعد أم يُحوّل للمراجعة بناءً على آخر إصدار محفوظ.
            </p>
            {dirty ? (
              <p className="text-[11px] font-semibold text-bw-amber">
                ملاحظة: المحاكي يختبر آخر إصدار محفوظ في الخادم؛ احفظ تعديلاتك أولًا لمحاكاتها.
              </p>
            ) : null}

            <Field
              label="عنوان المنتج أو نص سطر المورد"
              value={simTitle}
              onChange={(e) => setSimTitle(e.target.value)}
              placeholder="مثال: غسول سيرافي للبشرة الدهنية 236 مل"
              required
            />
            <Select
              label="ماركة معيارية (اختياري)"
              value={simBrandId}
              onChange={(e) => setSimBrandId(e.target.value)}
              options={[
                { value: '', label: 'اكتشاف تلقائي من النص' },
                ...brands.map((b) => ({ value: b.id, label: b.name })),
              ]}
            />
            {!simBrandId ? (
              <Field
                label="أو اسم ماركة نصي للاختبار (اختياري)"
                value={simBrandName}
                onChange={(e) => setSimBrandName(e.target.value)}
              />
            ) : null}
            <Select
              label="التصنيف (اختياري)"
              value={simCategoryId}
              onChange={(e) => setSimCategoryId(e.target.value)}
              options={[
                { value: '', label: 'بدون تصنيف محدد' },
                ...flatCategories.map((c) => ({
                  value: c.id,
                  label: c.parentName ? `${c.parentName} ← ${c.name}` : c.name,
                })),
              ]}
            />
            <Switch
              label="الصف يحتوي على باركود أو كود معرف معروف"
              checked={simHardId}
              onChange={(e) => setSimHardId(e.target.checked)}
            />

            {simError ? (
              <p role="alert" className="text-bw-small text-bw-rose">
                {simError}
              </p>
            ) : null}

            <Button type="submit" variant="secondary" loading={simulating} className="w-full">
              تشغيل اختبار القاعدة
            </Button>

            {simResult ? (
              <div
                className={`space-y-2 rounded-bw-card border p-3.5 text-bw-small ${
                  simResult.outcome === 'ALLOW'
                    ? 'border-bw-emerald/30 bg-bw-emerald-soft'
                    : simResult.outcome === 'SKIP'
                      ? 'border-bw-rose/30 bg-bw-rose-soft'
                      : 'border-bw-amber/30 bg-bw-amber-soft'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 font-semibold text-bw-ink">
                    {simResult.outcome === 'ALLOW' ? (
                      <>
                        <CheckCircle2 className="size-4 text-bw-emerald" aria-hidden />
                        يُسمح بالإدخال (ALLOW)
                      </>
                    ) : simResult.outcome === 'SKIP' ? (
                      <>
                        <XCircle className="size-4 text-bw-rose" aria-hidden />
                        يُستبعد تلقائيًا (SKIP)
                      </>
                    ) : (
                      <>
                        <ShieldAlert className="size-4 text-bw-amber" aria-hidden />
                        يُحوّل للمراجعة (REVIEW)
                      </>
                    )}
                  </span>
                  <Code className="text-[11px]">{simResult.reasonCode}</Code>
                </div>
                <p className="text-bw-ink">{policyReasonLabel(simResult.reasonCode)}</p>
                {simResult.detail ? (
                  <p className="text-[11px] text-bw-ink-soft">{simResult.detail}</p>
                ) : null}
                {simResult.matchedBrands.length ? (
                  <p className="text-[11px] text-bw-ink-soft">
                    الماركات المطابقة: {simResult.matchedBrands.map((b) => b.label).join('، ')}
                  </p>
                ) : null}
              </div>
            ) : null}
          </form>

          <form
            onSubmit={savePolicy}
            className="space-y-3 rounded-bw-card border border-bw-line bg-bw-surface p-4"
          >
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-bw-emerald" aria-hidden />
              <h3 className="font-semibold text-bw-ink">اعتماد وحفظ السياسة</h3>
            </div>
            <Field
              label="سبب تعديل السياسة (مطلوب للتوثيق)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="مثال: تفعيل السماح لماركات العناية المعتمدة واستبعاد المكياج"
              required
              minLength={3}
            />
            <Button type="submit" loading={saving} className="w-full">
              اعتماد وحفظ الإصدار الجديد
            </Button>
          </form>
        </div>
      </div>
    </section>
  )
}

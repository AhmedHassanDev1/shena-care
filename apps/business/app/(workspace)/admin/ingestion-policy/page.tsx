'use client'

import * as React from 'react'
import Link from 'next/link'
import { ArrowUpLeft, History, Plus, Search } from 'lucide-react'
import { Button, Code, Dialog, PageHeader, Skeleton, StateBlock, Switch, Toast, useDialog } from '@/components/bw/primitives'
import { CommandError } from '@/components/workspace/kit'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { api, ApiError } from '@/lib/api'
import { useApi } from '@/lib/use-api'
import { cn } from '@/lib/utils'
import { brandMatches, formatDate, sortBrands } from '@/lib/catalog-policy'
import type { CatalogPolicy, PolicyBrand, PolicyChange } from '@/lib/catalog-policy'
import { BrandDetail, Monogram } from './brand-detail'
import { AddBrandDrawer } from './add-brand'
import { HistoryView } from './policy-editors'

/*
 * Catalog Policy (قائمة السماح): which canonical Brands may enter the catalog, in which exact leaf categories, and which
 * of their products never may. Each change is saved at once as the next approved policy version; the API decides every row.
 */

export type ChangeBody = { enabled?: boolean; categoryIds?: string[]; excludeProductId?: string; reason?: string; restoreProductId?: string }
export type Commit = (brand: PolicyBrand, body: ChangeBody, key: string, success: string) => Promise<boolean>

function brandStatus(brand: PolicyBrand): { text: string; tone: 'live' | 'quiet' | 'warn' } {
  if (!brand.isActive) return { text: 'غير نشط في الكتالوج', tone: 'quiet' }
  if (brand.denied) return { text: 'ممنوع', tone: 'quiet' }
  if (!brand.enabled) return { text: 'موقوف', tone: 'quiet' }
  if (!brand.categoryIds.length) return { text: 'بدون تصنيفات بعد', tone: 'warn' }
  return { text: `${brand.categoryIds.length} ${brand.categoryIds.length === 1 ? 'تصنيف' : brand.categoryIds.length <= 10 ? 'تصنيفات' : 'تصنيف'}`, tone: 'live' }
}

function CatalogPolicyView() {
  const policy = useApi<CatalogPolicy>('/ingestion/eligibility/catalog-policy')
  const [query, setQuery] = React.useState('')
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [showDetailOnMobile, setShowDetailOnMobile] = React.useState(false)
  const [pending, setPending] = React.useState<string | null>(null)
  const [awaitVersion, setAwaitVersion] = React.useState<number | null>(null)
  const [error, setError] = React.useState<ApiError | null>(null)
  const [toast, setToast] = React.useState<{ title: string; body: string } | null>(null)
  const [confirming, setConfirming] = React.useState<PolicyBrand | null>(null)
  const [adding, setAdding] = React.useState(false)
  const [history, setHistory] = React.useState(false)
  const disableDialog = useDialog()

  React.useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), 4000)
    return () => window.clearTimeout(id)
  }, [toast])

  const data = policy.data
  // A saved change is shown only once the server's own read model has caught up with it. Never optimistic.
  const syncing = awaitVersion !== null && (data?.version ?? 0) < awaitVersion
  const busy = pending !== null || syncing

  const commit: Commit = React.useCallback(async (brand, body, key, success) => {
    if (!data) return false
    setPending(key)
    setError(null)
    try {
      const result = await api<PolicyChange>(`/ingestion/eligibility/brands/${brand.id}`, { method: 'PATCH', body: { expectedVersion: data.version, ...body } })
      if (result.changed) setAwaitVersion(result.version)
      setToast({ title: success, body: result.changed ? `اتحفظ كإصدار ${result.version}. الملفات الجديدة بتتقرا بيه فورًا.` : 'مفيش تغيير يتحفظ.' })
      policy.reload()
      return true
    } catch (err) {
      const apiError = err instanceof ApiError ? err : new ApiError(String(err), 0)
      setError(apiError.status === 409 && apiError.code === 'POLICY_CHANGED'
        ? new ApiError('في تعديل تاني اتحفظ من شوية. الصفحة اتحدثت بآخر نسخة، راجعها وجرّب تاني.', 409, apiError.code) : apiError)
      policy.reload()
      return false
    } finally {
      setPending(null)
    }
  }, [data, policy])

  if (policy.error && !data) return <LoadError message={policy.error.message} onRetry={policy.reload} />
  if (!data) return <div className="grid gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]" aria-busy>
    <p role="status" className="sr-only">تحميل قائمة السماح…</p>
    <Skeleton className="h-[28rem]" /><Skeleton className="h-[28rem]" />
  </div>

  const brands = sortBrands(data.brands)
  const visible = brands.filter(b => brandMatches(b, query))
  const selected = brands.find(b => b.id === selectedId) ?? brands.find(b => b.enabled) ?? brands[0]
  const enabledCount = brands.filter(b => b.enabled).length
  const select = (brand: PolicyBrand) => {
    setSelectedId(brand.id)
    setShowDetailOnMobile(true)
    setError(null)
  }
  const toggle = (brand: PolicyBrand) => {
    if (brand.enabled) { setConfirming(brand); disableDialog.open(); return }
    void commit(brand, { enabled: true }, `enable:${brand.id}`, `${brand.name} مفعّل`)
  }

  return <>
    <PageHeader eyebrow="مساحة الإدارة / الكتالوج" title="قائمة السماح"
      meta="البراندات والتصنيفات اللي ممكن تدخل الكتالوج من أي ملف منتجات."
      actions={<Button onClick={() => setAdding(true)} disabled={busy}><Plus className="size-4" aria-hidden />إضافة براند</Button>} />

    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-bw-small text-bw-ink-soft">
      {data.version
        ? <span>الإصدار <Code>{data.version}</Code>{data.approvedAt && <> · آخر تعديل <bdi>{formatDate(data.approvedAt)}</bdi></>}</span>
        : <span className="text-bw-warn">مفيش قائمة مفعّلة لسه — كل الصفوف هتتعلّق لحد ما تفعّل أول براند.</span>}
      {data.version > 0 && <button type="button" onClick={() => setHistory(true)} className="inline-flex min-h-bw-control items-center gap-1.5 rounded-bw-field px-1 hover:text-bw-ink"><History className="size-4" aria-hidden />سجل التعديلات</button>}
      {syncing && <span role="status">بيتحدث…</span>}
    </div>

    {error && <CommandError error={error} />}

    <div className="grid gap-6 lg:grid-cols-[22rem_minmax(0,1fr)] lg:items-start">
      <section aria-label="البراندات" className={cn('bw-panel overflow-hidden lg:sticky lg:top-6', showDetailOnMobile && 'hidden lg:block')}>
        <div className="space-y-3 border-b border-bw-line p-4">
          <label className="relative block">
            <span className="sr-only">ابحث عن براند</span>
            <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-bw-ink-subtle" aria-hidden />
            <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="ابحث بالاسم بالعربي أو الإنجليزي"
              className="h-bw-control w-full rounded-bw-field border border-bw-line-field bg-bw-sunken ps-9 pe-3 text-bw-body text-bw-ink placeholder:text-bw-ink-subtle focus:border-bw-action focus:outline-none" />
          </label>
          <p className="text-bw-small text-bw-ink-soft"><Code>{enabledCount}</Code> مفعّل من <Code>{brands.length}</Code> براند</p>
        </div>
        {visible.length ? <ul className="max-h-[calc(100dvh-16rem)] space-y-0.5 overflow-y-auto p-2">
          {visible.map(brand => {
            const status = brandStatus(brand)
            const isSelected = brand.id === selected?.id
            return <li key={brand.id} className={cn('flex items-center gap-2 rounded-bw-field pe-2 transition-colors', isSelected ? 'bg-bw-sunken ring-1 ring-bw-line-field' : 'hover:bg-bw-sunken/60')}>
              <button type="button" onClick={() => select(brand)} aria-current={isSelected ? 'true' : undefined}
                className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-bw-field px-2.5 py-2 text-start">
                <Monogram name={brand.name} muted={!brand.enabled} logoUrl={brand.logoUrl} />
                <span className="min-w-0">
                  <bdi className={cn('block truncate font-semibold', !brand.enabled && 'text-bw-ink-soft')}>{brand.name}</bdi>
                  <span className={cn('block text-bw-small', status.tone === 'warn' ? 'text-bw-warn' : 'text-bw-ink-subtle')}>{status.text}</span>
                </span>
              </button>
              <Switch label="" aria-label={`قبول منتجات ${brand.name}`} checked={brand.enabled} onChange={() => toggle(brand)}
                disabled={busy || (!brand.isActive && !brand.enabled)} className="min-h-0" />
            </li>
          })}
        </ul> : <StateBlock kind="empty" title="مفيش براند بالاسم ده" body="جرّب كتابة تانية، أو أضفه كبراند جديد."
          action={<Button variant="secondary" onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden />إضافة براند</Button>} />}
      </section>

      <div className={cn('min-w-0', !showDetailOnMobile && 'hidden lg:block')}>
        {selected
          ? <BrandDetail key={selected.id} brand={selected} categories={data.categories} busy={busy} pending={pending}
              onToggle={() => toggle(selected)} commit={commit} onBack={() => setShowDetailOnMobile(false)} />
          : <div className="bw-panel"><StateBlock kind="empty" title="لسه مفيش براندات" body="أضف أول براند عشان تبدأ تحدد إيه اللي يدخل الكتالوج."
              action={<Button onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden />إضافة براند</Button>} /></div>}
      </div>
    </div>

    <p className="border-t border-bw-line pt-5 text-bw-small text-bw-ink-soft">
      أسماء البراندات والتصنيفات زي ما الموردين بيكتبوها، والصفوف اللي اتعلّقت بسببها:{' '}
      <Link href="/admin/ingestion-policy/names" className="inline-flex items-center gap-1 font-semibold text-bw-ink underline-offset-4 hover:underline">أسماء الموردين والصفوف المعلّقة<ArrowUpLeft className="size-3.5" aria-hidden /></Link>
    </p>

    <Dialog dialogRef={disableDialog.ref} title={confirming ? `إيقاف ${confirming.name}؟` : 'إيقاف البراند؟'} onClose={() => setConfirming(null)}
      footer={<><Button variant="secondary" onClick={disableDialog.close}>إلغاء</Button>
        <Button variant="danger" loading={pending === `disable:${confirming?.id}`} onClick={async () => {
          if (!confirming) return
          const ok = await commit(confirming, { enabled: false }, `disable:${confirming.id}`, `${confirming.name} موقوف`)
          if (ok) disableDialog.close()
        }}>إيقاف البراند</Button></>}>
      <div className="space-y-3 text-bw-body">
        <p>أي منتج من <bdi className="font-semibold">{confirming?.name}</bdi> في ملفات جديدة هيتخطّى تلقائيًا من غير بحث أو صور.</p>
        <p className="text-bw-small text-bw-ink-soft">المنتجات الموجودة في الكتالوج والطلبات السابقة مش هتتأثر، والتصنيفات المختارة هتفضل محفوظة لو فعّلته تاني.</p>
      </div>
    </Dialog>

    {adding && <AddBrandDrawer policy={data} busy={busy} commit={commit} onClose={() => setAdding(false)}
      onPick={brandId => { setSelectedId(brandId); setShowDetailOnMobile(true) }}
      onCreated={(brandId, version, name) => {
        setAwaitVersion(version); setSelectedId(brandId); setShowDetailOnMobile(true)
        setToast({ title: `${name} اتضاف`, body: 'اختار التصنيفات المسموحة عشان منتجاته تبدأ تدخل.' })
        policy.reload()
      }} />}
    {history && <HistoryView onClose={() => setHistory(false)} />}
    {toast && <div className="fixed inset-x-4 bottom-20 z-40 flex justify-center lg:bottom-6 lg:start-auto lg:end-6 lg:justify-end"><Toast tone="ok" title={toast.title}>{toast.body}</Toast></div>}
  </>
}

export default function CatalogPolicyPage() {
  return <RoleShell role="admin" active="ingestion-policy">
    <main dir="rtl" className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-8 sm:py-9"><CatalogPolicyView /></main>
  </RoleShell>
}

'use client'

import * as React from 'react'
import {
  Building2,
  ExternalLink,
  Layers,
  PackageSearch,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import {
  Button,
  Code,
  Dialog,
  Field,
  Notice,
  Skeleton,
  StateBlock,
  StatusLabel,
  Switch,
  useDialog,
} from '@/components/bw/primitives'
import { LoadError } from '@/components/workspace/role-shell'
import { BrandLine, BrandSummary, CatalogThumbnail } from './catalog-utils'

export function BrandsTab({
  brands,
  loading,
  error,
  onReload,
  onViewBrandProducts,
}: {
  brands: BrandSummary[]
  loading: boolean
  error: string | null
  onReload: () => void
  onViewBrandProducts: (brandId: string) => void
}) {
  const [query, setQuery] = React.useState('')
  const [showInactive, setShowInactive] = React.useState(true)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [actionError, setActionError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  const formDialog = useDialog()
  const linesDialog = useDialog()
  const deleteDialog = useDialog()

  const [editingBrand, setEditingBrand] = React.useState<BrandSummary | null>(null)
  const [name, setName] = React.useState('')
  const [slug, setSlug] = React.useState('')
  const [aliasesInput, setAliasesInput] = React.useState('')
  const [country, setCountry] = React.useState('')
  const [websiteUrl, setWebsiteUrl] = React.useState('')
  const [logoUrl, setLogoUrl] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [isActive, setIsActive] = React.useState(true)

  const [linesBrand, setLinesBrand] = React.useState<BrandSummary | null>(null)
  const [newLineName, setNewLineName] = React.useState('')
  const [newLineDesc, setNewLineDesc] = React.useState('')
  const [editingLine, setEditingLine] = React.useState<BrandLine | null>(null)

  const [deletingBrand, setDeletingBrand] = React.useState<BrandSummary | null>(null)

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return brands.filter((b) => {
      if (!showInactive && !b.isActive) return false
      if (!q) return true
      return (
        b.name.toLowerCase().includes(q) ||
        b.slug.toLowerCase().includes(q) ||
        (b.countryOfOrigin ?? '').toLowerCase().includes(q) ||
        b.aliases.some((a) => a.toLowerCase().includes(q))
      )
    })
  }, [brands, query, showInactive])

  function openCreate() {
    setEditingBrand(null)
    setName('')
    setSlug('')
    setAliasesInput('')
    setCountry('')
    setWebsiteUrl('')
    setLogoUrl('')
    setDescription('')
    setIsActive(true)
    setActionError(null)
    formDialog.open()
  }

  function openEdit(brand: BrandSummary) {
    setEditingBrand(brand)
    setName(brand.name)
    setSlug(brand.slug)
    setAliasesInput(brand.aliases.join('، '))
    setCountry(brand.countryOfOrigin ?? '')
    setWebsiteUrl(brand.websiteUrl ?? '')
    setLogoUrl(brand.logoUrl ?? '')
    setDescription(brand.description ?? '')
    setIsActive(brand.isActive)
    setActionError(null)
    formDialog.open()
  }

  function openLines(brand: BrandSummary) {
    setLinesBrand(brand)
    setEditingLine(null)
    setNewLineName('')
    setNewLineDesc('')
    setActionError(null)
    linesDialog.open()
  }

  async function saveBrand(event: React.FormEvent) {
    event.preventDefault()
    if (name.trim().length < 2) {
      setActionError('اسم الماركة يجب أن يكون حرفين على الأقل.')
      return
    }
    const aliases = aliasesInput
      .split(/[,،\n]+/)
      .map((s) => s.trim())
      .filter(Boolean)

    const body: Record<string, unknown> = {
      name: name.trim(),
      ...(slug.trim() ? { slug: slug.trim().toLowerCase() } : {}),
      ...(description.trim() ? { description: description.trim() } : { description: '' }),
      ...(logoUrl.trim() ? { logoUrl: logoUrl.trim() } : {}),
      ...(websiteUrl.trim() ? { websiteUrl: websiteUrl.trim() } : {}),
      ...(country.trim() ? { countryOfOrigin: country.trim() } : {}),
      isActive,
      aliases,
    }

    setBusy(true)
    setActionError(null)
    try {
      if (editingBrand) {
        await api(`/brands/${editingBrand.id}`, { method: 'PATCH', body })
        setNotice(`تم تحديث بيانات «${name.trim()}».`)
      } else {
        await api('/brands', { method: 'POST', body })
        setNotice(`تمت إضافة الماركة «${name.trim()}».`)
      }
      formDialog.close()
      onReload()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'تعذر حفظ بيانات الماركة.')
    } finally {
      setBusy(false)
    }
  }

  async function saveLine(event: React.FormEvent) {
    event.preventDefault()
    if (!linesBrand || newLineName.trim().length < 2) {
      setActionError('اسم خط الإنتاج يجب أن يكون حرفين على الأقل.')
      return
    }
    setBusy(true)
    setActionError(null)
    try {
      if (editingLine) {
        await api(`/brands/product-lines/${editingLine.id}`, {
          method: 'PATCH',
          body: {
            name: newLineName.trim(),
            description: newLineDesc.trim() || undefined,
          },
        })
        setNotice(`تم تحديث خط الإنتاج «${newLineName.trim()}».`)
      } else {
        await api(`/brands/${linesBrand.id}/product-lines`, {
          method: 'POST',
          body: {
            name: newLineName.trim(),
            description: newLineDesc.trim() || undefined,
          },
        })
        setNotice(`تمت إضافة خط الإنتاج «${newLineName.trim()}».`)
      }
      setEditingLine(null)
      setNewLineName('')
      setNewLineDesc('')
      onReload()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'تعذر حفظ خط الإنتاج.')
    } finally {
      setBusy(false)
    }
  }

  async function toggleLineActive(line: BrandLine) {
    setBusy(true)
    setActionError(null)
    try {
      await api(`/brands/product-lines/${line.id}`, {
        method: 'PATCH',
        body: { isActive: !line.isActive },
      })
      onReload()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'تعذر تحديث حالة خط الإنتاج.')
    } finally {
      setBusy(false)
    }
  }

  async function removeLine(line: BrandLine) {
    setBusy(true)
    setActionError(null)
    try {
      await api(`/brands/product-lines/${line.id}`, { method: 'DELETE' })
      setNotice(`تم حذف خط الإنتاج «${line.name}».`)
      onReload()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'تعذر حذف خط الإنتاج.')
    } finally {
      setBusy(false)
    }
  }

  async function confirmDeleteBrand() {
    if (!deletingBrand) return
    setBusy(true)
    setActionError(null)
    try {
      await api(`/brands/${deletingBrand.id}`, { method: 'DELETE' })
      setNotice(`تم حذف الماركة «${deletingBrand.name}».`)
      setDeletingBrand(null)
      deleteDialog.close()
      onReload()
    } catch (err) {
      setActionError(
        err instanceof ApiError
          ? err.message
          : 'تعذر حذف الماركة لوجود منتجات أو خطوط إنتاج مرتبطة بها.',
      )
    } finally {
      setBusy(false)
    }
  }

  const activeLinesBrand = linesBrand
    ? brands.find((b) => b.id === linesBrand.id) ?? linesBrand
    : null

  return (
    <section aria-label="إدارة الماركات" className="space-y-4">
      <Notice tone="info" title="استقلالية الماركات عن قائمة السماح">
        تفعيل أو إيقاف الماركة هنا ينظم الكتالوج والمتجر فقط، بينما تُدار قواعد السماح والمنع لاستيراد الموردين من تبويب «قائمة السماح».
      </Notice>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-bw-card border border-bw-line bg-bw-surface p-3.5">
        <div className="flex flex-1 flex-wrap items-center gap-3">
          <label className="relative min-w-56 flex-1 max-w-md">
            <span className="sr-only">بحث في الماركات</span>
            <Search
              className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-bw-ink-subtle"
              aria-hidden
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ابحث بالاسم أو الاسم البديل (عربي / إنجليزي)"
              className="h-bw-control w-full rounded-bw-field border border-bw-line-field bg-bw-sunken pe-3 ps-9 text-bw-small text-bw-ink placeholder:text-bw-ink-subtle focus:border-bw-cobalt focus:outline-none"
            />
          </label>
          <Switch
            label="عرض غير النشطة"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" aria-label="تحديث الماركات" onClick={onReload}>
            <RefreshCw className="size-4" />
          </Button>
          <Button onClick={openCreate}>
            <Plus className="size-4" aria-hidden />
            إضافة ماركة
          </Button>
        </div>
      </div>

      {notice ? (
        <div
          role="status"
          className="rounded-bw-field border border-bw-emerald/30 bg-bw-emerald-soft px-3.5 py-2.5 text-bw-small text-bw-ink"
        >
          {notice}
        </div>
      ) : null}

      {error ? <LoadError message={error} onRetry={onReload} /> : null}
      {loading && brands.length === 0 ? <Skeleton className="h-64 w-full rounded-bw-card" /> : null}

      {!loading && filtered.length === 0 ? (
        <StateBlock
          kind="empty"
          title="لا توجد ماركات مطابقة"
          body={query ? 'جرّب اسمًا أو مرادفًا آخر.' : 'أضف أول ماركة للبدء في تنظيم المنتجات.'}
        />
      ) : null}

      {filtered.length > 0 ? (
        <div className="overflow-x-auto rounded-bw-card border border-bw-line bg-bw-surface">
          <table className="w-full text-start text-bw-small">
            <thead className="border-b border-bw-line bg-bw-sunken text-[11px] font-semibold text-bw-ink-soft">
              <tr>
                <th className="px-4 py-3 text-start">الماركة</th>
                <th className="px-3 py-3 text-start">المسميات البديلة (Aliases)</th>
                <th className="px-3 py-3 text-start">خطوط الإنتاج</th>
                <th className="px-3 py-3 text-start">المنتجات</th>
                <th className="px-3 py-3 text-start">الحالة</th>
                <th className="px-4 py-3 text-end">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bw-line">
              {filtered.map((brand) => (
                <tr key={brand.id} className="transition-colors hover:bg-bw-sunken">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {brand.logoUrl ? (
                        <CatalogThumbnail url={brand.logoUrl} alt={brand.name} />
                      ) : (
                        <span className="grid size-11 shrink-0 place-items-center rounded-bw-field border border-bw-line bg-bw-sunken text-bw-ink-soft">
                          <Building2 className="size-4" aria-hidden />
                        </span>
                      )}
                      <div className="min-w-0">
                        <p className="font-semibold text-bw-ink">
                          <bdi>{brand.name}</bdi>
                        </p>
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-bw-ink-subtle">
                          <Code>{brand.slug}</Code>
                          {brand.countryOfOrigin ? <span>· {brand.countryOfOrigin}</span> : null}
                          {brand.websiteUrl ? (
                            <a
                              href={brand.websiteUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-0.5 text-bw-cobalt hover:underline"
                            >
                              الموقع
                              <ExternalLink className="size-3" aria-hidden />
                            </a>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </td>

                  <td className="px-3 py-3">
                    {brand.aliases.length > 0 ? (
                      <div className="flex max-w-xs flex-wrap gap-1">
                        {brand.aliases.slice(0, 4).map((alias) => (
                          <span
                            key={alias}
                            className="rounded-full border border-bw-line bg-bw-sunken px-2 py-0.5 text-[11px] text-bw-ink-soft"
                          >
                            {alias}
                          </span>
                        ))}
                        {brand.aliases.length > 4 ? (
                          <span className="text-[11px] text-bw-ink-subtle">
                            +<Code>{brand.aliases.length - 4}</Code>
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-[11px] text-bw-ink-subtle">—</span>
                    )}
                  </td>

                  <td className="px-3 py-3">
                    <Button variant="ghost" onClick={() => openLines(brand)}>
                      <Layers className="size-3.5 text-bw-violet" aria-hidden />
                      <Code>{brand.productLines.length}</Code> خط
                    </Button>
                  </td>

                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-bw-ink">
                        <Code>{`${brand.publishedProductCount}/${brand.productCount}`}</Code>
                      </span>
                      {brand.productCount > 0 ? (
                        <Button
                          variant="ghost"
                          onClick={() => onViewBrandProducts(brand.id)}
                          title="عرض منتجات الماركة"
                        >
                          <PackageSearch className="size-3.5 text-bw-cobalt" aria-hidden />
                          عرض
                        </Button>
                      ) : null}
                    </div>
                  </td>

                  <td className="px-3 py-3">
                    <StatusLabel tone={brand.isActive ? 'ok' : 'pending'}>
                      {brand.isActive ? 'نشطة' : 'موقوفة'}
                    </StatusLabel>
                  </td>

                  <td className="px-4 py-3 text-end">
                    <div className="inline-flex items-center gap-1">
                      <Button variant="ghost" onClick={() => openEdit(brand)}>
                        <Pencil className="size-3.5" aria-hidden />
                        تعديل
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setDeletingBrand(brand)
                          setActionError(null)
                          deleteDialog.open()
                        }}
                        aria-label={`حذف ${brand.name}`}
                      >
                        <Trash2 className="size-3.5 text-bw-rose" aria-hidden />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <Dialog
        dialogRef={formDialog.ref}
        title={editingBrand ? `تعديل ماركة: ${editingBrand.name}` : 'إضافة ماركة جديدة'}
        onClose={() => formDialog.close()}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => formDialog.close()}>
              إلغاء
            </Button>
            <Button type="submit" form="brand-form" loading={busy}>
              {editingBrand ? 'حفظ التعديلات' : 'إنشاء الماركة'}
            </Button>
          </div>
        }
      >
        <form id="brand-form" dir="rtl" onSubmit={saveBrand} className="space-y-4">
          {actionError ? (
            <p
              role="alert"
              className="rounded-bw-field border border-bw-rose/30 bg-bw-rose-soft p-3 text-bw-small text-bw-ink"
            >
              {actionError}
            </p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="الاسم الرسمي للماركة"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
            />
            <Field
              label="المعرف (Slug - اختياري)"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              hint="اتركه فارغًا للتوليد التلقائي"
              ltr
            />
          </div>
          <Field
            label="المسميات البديلة والعربية (افصل بفاصلة ،)"
            value={aliasesInput}
            onChange={(e) => setAliasesInput(e.target.value)}
            placeholder="مثال: لاروش بوزيه، LRP، لاروش"
            hint="تساعد هذه المسميات محرك المطابقة في التعرف على الماركة في ملفات الموردين."
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="بلد المنشأ"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
            />
            <Field
              label="الموقع الرسمي"
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              placeholder="https://..."
              ltr
            />
          </div>
          <Field
            label="رابط الشعار (Logo URL - اختياري)"
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            ltr
          />
          <div className="space-y-1.5">
            <label
              htmlFor="brand-desc-field"
              className="block text-bw-small font-semibold text-bw-ink"
            >
              نبذة عن الماركة
            </label>
            <textarea
              id="brand-desc-field"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-bw-field border border-bw-line-field bg-bw-surface p-3 text-bw-small text-bw-ink focus:border-bw-cobalt focus:outline-none"
            />
          </div>
          <Switch
            label="الماركة نشطة ومتاحة بالكتالوج"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
        </form>
      </Dialog>

      <Dialog
        dialogRef={linesDialog.ref}
        variant="drawer"
        title={activeLinesBrand ? `خطوط إنتاج ${activeLinesBrand.name}` : 'خطوط الإنتاج'}
        onClose={() => linesDialog.close()}
      >
        {activeLinesBrand ? (
          <div dir="rtl" className="space-y-5">
            {actionError ? (
              <p
                role="alert"
                className="rounded-bw-field border border-bw-rose/30 bg-bw-rose-soft p-3 text-bw-small text-bw-ink"
              >
                {actionError}
              </p>
            ) : null}

            <form
              onSubmit={saveLine}
              className="space-y-3 rounded-bw-card border border-bw-line bg-bw-sunken p-3.5"
            >
              <h4 className="font-semibold text-bw-ink">
                {editingLine ? `تعديل الخط: ${editingLine.name}` : 'إضافة خط إنتاج جديد'}
              </h4>
              <Field
                label="اسم خط الإنتاج"
                value={newLineName}
                onChange={(e) => setNewLineName(e.target.value)}
                placeholder="مثال: Effaclar أو Anthelios"
                required
              />
              <Field
                label="وصف مختصر (اختياري)"
                value={newLineDesc}
                onChange={(e) => setNewLineDesc(e.target.value)}
              />
              <div className="flex gap-2">
                <Button type="submit" loading={busy}>
                  {editingLine ? 'حفظ الخط' : 'إضافة الخط'}
                </Button>
                {editingLine ? (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setEditingLine(null)
                      setNewLineName('')
                      setNewLineDesc('')
                    }}
                  >
                    إلغاء
                  </Button>
                ) : null}
              </div>
            </form>

            {activeLinesBrand.productLines.length === 0 ? (
              <StateBlock
                kind="empty"
                title="لا توجد خطوط إنتاج مسجلة"
                body="أضف خطوط الإنتاج لتجميع منتجات نفس السلسلة معًا."
              />
            ) : (
              <ul className="divide-y divide-bw-line rounded-bw-card border border-bw-line bg-bw-surface">
                {activeLinesBrand.productLines.map((line) => (
                  <li key={line.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-bw-ink">
                        <bdi>{line.name}</bdi>
                      </p>
                      <p className="text-[11px] text-bw-ink-subtle">
                        <Code>{line.slug}</Code>
                        {line.description ? ` · ${line.description}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <StatusLabel tone={line.isActive ? 'ok' : 'pending'}>
                        {line.isActive ? 'نشط' : 'موقوف'}
                      </StatusLabel>
                      <Button variant="ghost" onClick={() => void toggleLineActive(line)}>
                        {line.isActive ? 'إيقاف' : 'تفعيل'}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setEditingLine(line)
                          setNewLineName(line.name)
                          setNewLineDesc(line.description ?? '')
                        }}
                      >
                        <Pencil className="size-3.5" aria-hidden />
                      </Button>
                      <Button variant="ghost" onClick={() => void removeLine(line)}>
                        <Trash2 className="size-3.5 text-bw-rose" aria-hidden />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </Dialog>

      <Dialog
        dialogRef={deleteDialog.ref}
        title="حذف الماركة"
        onClose={() => deleteDialog.close()}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => deleteDialog.close()}>
              تراجع
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void confirmDeleteBrand()}>
              تأكيد الحذف
            </Button>
          </div>
        }
      >
        {deletingBrand ? (
          <div dir="rtl" className="space-y-3 text-bw-small">
            <p className="text-bw-ink">
              هل تريد حذف الماركة <strong>{deletingBrand.name}</strong>؟
            </p>
            <p className="text-bw-ink-soft">
              يرفض النظام الحذف إذا كانت الماركة مرتبطة بمنتجات ({deletingBrand.productCount}) أو خطوط إنتاج ({deletingBrand.productLines.length})؛ يمكنك إيقافها بدلًا من حذفها.
            </p>
            {actionError ? (
              <p
                role="alert"
                className="rounded-bw-field border border-bw-rose/30 bg-bw-rose-soft p-3 text-bw-ink"
              >
                {actionError}
              </p>
            ) : null}
          </div>
        ) : null}
      </Dialog>
    </section>
  )
}

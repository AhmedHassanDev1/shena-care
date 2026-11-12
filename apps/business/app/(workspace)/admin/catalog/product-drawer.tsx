'use client'

import * as React from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Pencil,
  RotateCcw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { Button, Code, Dialog, Field, Select, StateBlock, StatusLabel } from '@/components/bw/primitives'
import {
  BrandSummary,
  CatalogItem,
  CatalogSku,
  CatalogThumbnail,
  CategoryNode,
  WorkbenchReadiness,
  flattenCategories,
  readinessIssueLabel,
} from './catalog-utils'

export function ProductWorkbenchDrawer({
  dialogRef,
  product,
  brands,
  categories,
  onClose,
  onChanged,
}: {
  dialogRef: React.RefObject<HTMLDialogElement | null>
  product: CatalogItem | null
  brands: BrandSummary[]
  categories: CategoryNode[]
  onClose: () => void
  onChanged: (message: string) => void
}) {
  const [subTab, setSubTab] = React.useState<'details' | 'skus' | 'media'>('details')
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [brandId, setBrandId] = React.useState('')
  const [categoryId, setCategoryId] = React.useState('')
  const [productLineId, setProductLineId] = React.useState('')

  const [editingSkuId, setEditingSkuId] = React.useState<string | null>(null)
  const [skuVariantName, setSkuVariantName] = React.useState('')
  const [skuCode, setSkuCode] = React.useState('')
  const [skuBarcode, setSkuBarcode] = React.useState('')
  const [skuSize, setSkuSize] = React.useState('')
  const [skuSizeUnit, setSkuSizeUnit] = React.useState('ml')

  const [pricingSkuId, setPricingSkuId] = React.useState<string | null>(null)
  const [priceAmount, setPriceAmount] = React.useState('')
  const [compareAtAmount, setCompareAtAmount] = React.useState('')

  const [readinessSkuId, setReadinessSkuId] = React.useState<string | null>(null)
  const [readinessData, setReadinessData] = React.useState<WorkbenchReadiness | null>(null)
  const [readinessLoading, setReadinessLoading] = React.useState(false)
  const [publishPriceEgp, setPublishPriceEgp] = React.useState('')

  const [confirmArchive, setConfirmArchive] = React.useState(false)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [localNotice, setLocalNotice] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!product) return
    setSubTab('details')
    setName(product.name)
    setDescription(product.description ?? '')
    setBrandId(product.brandId)
    setCategoryId(product.categoryId)
    setProductLineId(product.productLineId ?? '')
    setEditingSkuId(null)
    setPricingSkuId(null)
    setReadinessSkuId(product.skus[0]?.id ?? null)
    setReadinessData(null)
    setPublishPriceEgp('')
    setConfirmArchive(false)
    setError(null)
    setLocalNotice(null)
  }, [product])

  React.useEffect(() => {
    if (!readinessSkuId || subTab !== 'skus') return
    let cancelled = false
    setReadinessLoading(true)
    api<WorkbenchReadiness>(`/catalog/workbench/skus/${readinessSkuId}/readiness`)
      .then((res) => {
        if (!cancelled) setReadinessData(res)
      })
      .catch(() => {
        if (!cancelled) setReadinessData(null)
      })
      .finally(() => {
        if (!cancelled) setReadinessLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [readinessSkuId, subTab])

  const flatCategories = React.useMemo(() => flattenCategories(categories), [categories])
  const brandLines = React.useMemo(
    () => brands.find((b) => b.id === brandId)?.productLines ?? [],
    [brands, brandId],
  )

  async function runAction(
    key: string,
    fn: () => Promise<void>,
    successMsg: string,
    closeAfter = false,
  ) {
    setBusy(key)
    setError(null)
    setLocalNotice(null)
    try {
      await fn()
      setLocalNotice(successMsg)
      onChanged(successMsg)
      if (closeAfter) onClose()
    } catch (err) {
      if (err instanceof ApiError) {
        const blockers = Array.isArray(err.details?.blockers)
          ? (err.details.blockers as string[]).map(readinessIssueLabel).join('، ')
          : ''
        setError(blockers ? `${err.message}: ${blockers}` : err.message)
      } else {
        setError('تعذر تنفيذ العملية. حاول مرة أخرى.')
      }
    } finally {
      setBusy(null)
    }
  }

  function handleSaveProduct(event: React.FormEvent) {
    event.preventDefault()
    if (!product) return
    if (name.trim().length < 2) {
      setError('اسم المنتج يجب أن يكون حرفين على الأقل.')
      return
    }
    const body: Record<string, unknown> = {
      name: name.trim(),
      description: description.trim(),
      brandId,
      ...(categoryId ? { categoryId } : {}),
      ...(productLineId ? { productLineId } : {}),
    }
    void runAction(
      'save-product',
      () => api(`/products/${product.id}`, { method: 'PATCH', body }).then(() => undefined),
      'تم حفظ بيانات المنتج.',
      true,
    )
  }

  function openSkuEdit(sku: CatalogSku) {
    setEditingSkuId(sku.id)
    setSkuVariantName(sku.variantName)
    setSkuCode(sku.code)
    setSkuBarcode(sku.barcode ?? '')
    setSkuSize(sku.size !== null ? String(sku.size) : '')
    setSkuSizeUnit(sku.sizeUnit ?? 'ml')
    setError(null)
  }

  function handleSaveSku(event: React.FormEvent) {
    event.preventDefault()
    if (!editingSkuId) return
    if (skuCode.trim().length < 2) {
      setError('كود النسخة يجب أن يكون حرفين على الأقل.')
      return
    }
    const parsedSize = skuSize.trim() ? Number(skuSize) : undefined
    if (parsedSize !== undefined && (!Number.isFinite(parsedSize) || parsedSize <= 0)) {
      setError('المقاس يجب أن يكون رقمًا موجبًا.')
      return
    }
    const body: Record<string, unknown> = {
      variantName: skuVariantName.trim(),
      code: skuCode.trim(),
      barcode: skuBarcode.trim() || null,
      ...(parsedSize !== undefined ? { size: parsedSize, sizeUnit: skuSizeUnit } : {}),
    }
    void runAction(
      `sku-${editingSkuId}`,
      () => api(`/products/skus/${editingSkuId}`, { method: 'PATCH', body }).then(() => undefined),
      'تم تحديث بيانات النسخة.',
    ).then(() => setEditingSkuId(null))
  }

  function handleSavePrice(event: React.FormEvent) {
    event.preventDefault()
    if (!pricingSkuId) return
    const amount = Number(priceAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('أدخل سعر بيع صحيح أكبر من صفر.')
      return
    }
    const compare = compareAtAmount.trim() ? Number(compareAtAmount) : undefined
    void runAction(
      `price-${pricingSkuId}`,
      () =>
        api('/commerce/prices', {
          method: 'POST',
          body: {
            skuId: pricingSkuId,
            amount,
            ...(compare && Number.isFinite(compare) && compare > 0 ? { compareAtAmount: compare } : {}),
            currency: 'EGP',
            autoClosePrevious: true,
          },
        }).then(() => undefined),
      'تم تحديث سعر البيع بنجاح.',
    ).then(() => {
      setPricingSkuId(null)
      setPriceAmount('')
      setCompareAtAmount('')
    })
  }

  async function refreshReadiness(skuId: string) {
    setReadinessSkuId(skuId)
    setReadinessLoading(true)
    try {
      const res = await api<WorkbenchReadiness>(`/catalog/workbench/skus/${skuId}/readiness`)
      setReadinessData(res)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذر قراءة تقرير الجاهزية.')
    } finally {
      setReadinessLoading(false)
    }
  }

  return (
    <Dialog
      dialogRef={dialogRef}
      variant="drawer"
      title={product ? product.name : 'إدارة المنتج'}
      onClose={onClose}
      footer={
        product ? (
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <div>
              {product.archivedAt ? (
                <Button
                  variant="secondary"
                  loading={busy === 'restore'}
                  onClick={() =>
                    void runAction(
                      'restore',
                      () =>
                        api(`/catalog/items/${product.id}/restore`, { method: 'POST' }).then(
                          () => undefined,
                        ),
                      'تمت استعادة المنتج كمسودة.',
                      true,
                    )
                  }
                >
                  <RotateCcw className="size-4" aria-hidden />
                  استعادة من الأرشيف
                </Button>
              ) : confirmArchive ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-bw-small text-bw-rose">
                    سيُوقف النشر وتُعطّل النسخ.
                  </span>
                  <Button
                    variant="danger"
                    loading={busy === 'archive'}
                    onClick={() =>
                      void runAction(
                        'archive',
                        () =>
                          api(`/catalog/items/${product.id}/archive`, { method: 'POST' }).then(
                            () => undefined,
                          ),
                        'تمت أرشفة المنتج وإيقاف نسخه.',
                        true,
                      )
                    }
                  >
                    تأكيد الأرشفة
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmArchive(false)}>
                    تراجع
                  </Button>
                </div>
              ) : (
                <Button variant="ghost" onClick={() => setConfirmArchive(true)}>
                  <Archive className="size-4" aria-hidden />
                  أرشفة المنتج
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={onClose}>
                إغلاق
              </Button>
              {subTab === 'details' && !product.archivedAt ? (
                <Button type="submit" form="workbench-product-form" loading={busy === 'save-product'}>
                  حفظ بيانات المنتج
                </Button>
              ) : null}
            </div>
          </div>
        ) : undefined
      }
    >
      {product ? (
        <div dir="rtl" className="space-y-5">
          <div className="flex items-center gap-3 rounded-bw-field border border-bw-line bg-bw-sunken p-3">
            <CatalogThumbnail
              url={product.media[0]?.url}
              alt={product.name}
              mediaStatus={product.mediaStatus}
              size="md"
            />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-bw-small text-bw-ink-soft">{product.brand.name}</span>
                {product.category ? (
                  <span className="text-bw-small text-bw-ink-subtle">· {product.category.name}</span>
                ) : null}
              </div>
              <p className="truncate font-semibold text-bw-ink">
                <bdi>{product.name}</bdi>
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusLabel
                  tone={product.archivedAt ? 'pending' : product.isPublished ? 'ok' : 'warn'}
                >
                  {product.archivedAt ? 'مؤرشف' : product.isPublished ? 'منشور' : 'مسودة'}
                </StatusLabel>
                <StatusLabel
                  tone={
                    product.readiness.status === 'READY'
                      ? 'ok'
                      : product.readiness.status === 'ARCHIVED'
                        ? 'neutral'
                        : 'warn'
                  }
                >
                  {product.readiness.status === 'READY'
                    ? 'جاهز للبيع'
                    : product.readiness.status === 'ARCHIVED'
                      ? 'مؤرشف'
                      : `${product.readiness.issues.length} ملاحظات جاهزية`}
                </StatusLabel>
              </div>
            </div>
          </div>

          <div role="group" aria-label="أقسام المنتج" className="flex gap-1 border-b border-bw-line">
            {[
              { id: 'details' as const, label: 'بيانات المنتج' },
              { id: 'skus' as const, label: `النسخ والنشر (${product.skus.length})` },
              { id: 'media' as const, label: `الصور (${product.media.length})` },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={subTab === item.id}
                onClick={() => setSubTab(item.id)}
                className={`border-b-2 px-3 py-2 text-bw-small font-semibold transition-colors ${
                  subTab === item.id
                    ? 'border-bw-cobalt text-bw-ink'
                    : 'border-transparent text-bw-ink-soft hover:text-bw-ink'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {error ? (
            <div
              role="alert"
              className="rounded-bw-field border border-bw-rose/30 bg-bw-rose-soft p-3 text-bw-small text-bw-ink"
            >
              {error}
            </div>
          ) : null}

          {localNotice ? (
            <div
              role="status"
              className="rounded-bw-field border border-bw-emerald/30 bg-bw-emerald-soft p-3 text-bw-small text-bw-ink"
            >
              {localNotice}
            </div>
          ) : null}

          {subTab === 'details' ? (
            <form id="workbench-product-form" onSubmit={handleSaveProduct} className="space-y-4">
              <Field
                label="اسم المنتج"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                minLength={2}
                disabled={Boolean(product.archivedAt)}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <Select
                  label="الماركة"
                  value={brandId}
                  onChange={(e) => {
                    setBrandId(e.target.value)
                    setProductLineId('')
                  }}
                  disabled={Boolean(product.archivedAt)}
                  options={brands.map((b) => ({ value: b.id, label: b.name }))}
                />
                <Select
                  label="خط الإنتاج (اختياري)"
                  value={productLineId}
                  onChange={(e) => setProductLineId(e.target.value)}
                  disabled={Boolean(product.archivedAt)}
                  options={[
                    { value: '', label: 'بدون خط إنتاج محدد' },
                    ...brandLines.map((line) => ({ value: line.id, label: line.name })),
                  ]}
                />
              </div>
              <Select
                label="التصنيف"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                disabled={Boolean(product.archivedAt)}
                options={flatCategories.map((c) => ({
                  value: c.id,
                  label: c.parentName ? `${c.parentName} ← ${c.name}` : c.name,
                }))}
              />
              <div className="space-y-1.5">
                <label
                  htmlFor="workbench-product-desc"
                  className="block text-bw-small font-semibold text-bw-ink"
                >
                  الوصف التحريري
                </label>
                <textarea
                  id="workbench-product-desc"
                  rows={4}
                  value={description}
                  disabled={Boolean(product.archivedAt)}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full rounded-bw-field border border-bw-line-field bg-bw-surface p-3 text-bw-body text-bw-ink focus:border-bw-cobalt focus:outline-none disabled:opacity-50"
                />
              </div>
            </form>
          ) : null}

          {subTab === 'skus' ? (
            <div className="space-y-4">
              {product.skus.length === 0 ? (
                <StateBlock
                  kind="empty"
                  title="لا توجد نسخ (SKUs)"
                  body="أضف نسخة من خلال شاشة إدخال المنتجات قبل التفعيل."
                />
              ) : (
                product.skus.map((sku) => (
                  <div
                    key={sku.id}
                    className="space-y-3 rounded-bw-card border border-bw-line bg-bw-sunken p-3.5"
                  >
                    {editingSkuId === sku.id ? (
                      <form onSubmit={handleSaveSku} className="space-y-3">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Field
                            label="اسم النسخة"
                            value={skuVariantName}
                            onChange={(e) => setSkuVariantName(e.target.value)}
                          />
                          <Field
                            label="كود النسخة (SKU)"
                            value={skuCode}
                            onChange={(e) => setSkuCode(e.target.value)}
                            required
                            ltr
                          />
                          <Field
                            label="الباركود"
                            value={skuBarcode}
                            onChange={(e) => setSkuBarcode(e.target.value)}
                            ltr
                          />
                          <div className="grid grid-cols-[1fr_92px] gap-2">
                            <Field
                              label="الحجم"
                              type="number"
                              step="any"
                              value={skuSize}
                              onChange={(e) => setSkuSize(e.target.value)}
                              ltr
                            />
                            <Select
                              label="الوحدة"
                              value={skuSizeUnit}
                              onChange={(e) => setSkuSizeUnit(e.target.value)}
                              options={[
                                { value: 'ml', label: 'ml' },
                                { value: 'g', label: 'g' },
                                { value: 'l', label: 'l' },
                                { value: 'kg', label: 'kg' },
                                { value: 'oz', label: 'oz' },
                                { value: 'piece', label: 'piece' },
                              ]}
                            />
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button type="submit" loading={busy === `sku-${sku.id}`}>
                            حفظ النسخة
                          </Button>
                          <Button variant="ghost" onClick={() => setEditingSkuId(null)}>
                            إلغاء
                          </Button>
                        </div>
                      </form>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold text-bw-ink">
                                <bdi>{sku.variantName || 'النسخة الأساسية'}</bdi>
                              </span>
                              <Code className="rounded bg-bw-surface px-1.5 py-0.5 text-[11px] text-bw-ink-soft">
                                {sku.code}
                              </Code>
                            </div>
                            <div className="flex flex-wrap items-center gap-3 text-bw-small text-bw-ink-soft">
                              {sku.barcode ? (
                                <span>
                                  الباركود: <Code>{sku.barcode}</Code>
                                </span>
                              ) : (
                                <span className="text-bw-amber">بلا باركود</span>
                              )}
                              {sku.size ? (
                                <span>
                                  الحجم: <Code>{`${sku.size} ${sku.sizeUnit ?? ''}`}</Code>
                                </span>
                              ) : null}
                              <span>
                                السعر:{' '}
                                {sku.currentPrice ? (
                                  <strong className="text-bw-emerald">
                                    <Code>{`${sku.currentPrice.amount} EGP`}</Code>
                                  </strong>
                                ) : (
                                  <span className="text-bw-rose">غير محدد</span>
                                )}
                              </span>
                            </div>
                          </div>
                          {!product.archivedAt ? (
                            <Button variant="ghost" onClick={() => openSkuEdit(sku)}>
                              <Pencil className="size-3.5" aria-hidden />
                              تعديل
                            </Button>
                          ) : null}
                        </div>

                        {sku.readinessIssues.length ? (
                          <div className="flex flex-wrap gap-1.5">
                            {sku.readinessIssues.map((issue) => (
                              <span
                                key={issue}
                                className="rounded-full border border-bw-amber/25 bg-bw-amber-soft px-2 py-0.5 text-[11px] text-bw-ink"
                              >
                                {readinessIssueLabel(issue)}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-bw-emerald">
                            <CheckCircle2 className="size-3.5" aria-hidden />
                            كل شروط المتجر مستوفاة
                          </div>
                        )}

                        {pricingSkuId === sku.id ? (
                          <form
                            onSubmit={handleSavePrice}
                            className="flex flex-wrap items-end gap-2 rounded-bw-field border border-bw-line bg-bw-surface p-3"
                          >
                            <Field
                              label="سعر البيع (EGP)"
                              type="number"
                              step="0.01"
                              value={priceAmount}
                              onChange={(e) => setPriceAmount(e.target.value)}
                              className="w-36"
                              required
                              ltr
                            />
                            <Field
                              label="سعر قبل الخصم (اختياري)"
                              type="number"
                              step="0.01"
                              value={compareAtAmount}
                              onChange={(e) => setCompareAtAmount(e.target.value)}
                              className="w-40"
                              ltr
                            />
                            <Button type="submit" loading={busy === `price-${sku.id}`}>
                              اعتماد السعر
                            </Button>
                            <Button variant="ghost" onClick={() => setPricingSkuId(null)}>
                              إلغاء
                            </Button>
                          </form>
                        ) : null}

                        {!product.archivedAt ? (
                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            <Button
                              variant="secondary"
                              disabled={
                                busy !== null ||
                                (!sku.isListed && (!sku.isActive || !product.isPublished))
                              }
                              onClick={() =>
                                void runAction(
                                  `vis-${sku.id}`,
                                  () =>
                                    api(`/catalog/items/skus/${sku.id}/visibility`, {
                                      method: 'PATCH',
                                      body: { isVisible: !sku.isListed },
                                    }).then(() => undefined),
                                  sku.isListed ? 'تم إخفاء النسخة من المتجر.' : 'تم إظهار النسخة في المتجر.',
                                )
                              }
                            >
                              {sku.isListed ? (
                                <>
                                  <EyeOff className="size-3.5" aria-hidden />
                                  إخفاء
                                </>
                              ) : (
                                <>
                                  <Eye className="size-3.5" aria-hidden />
                                  إظهار في المتجر
                                </>
                              )}
                            </Button>
                            <Button
                              variant="secondary"
                              disabled={busy !== null}
                              onClick={() =>
                                void runAction(
                                  `avail-${sku.id}`,
                                  () =>
                                    api(`/catalog/items/skus/${sku.id}/availability`, {
                                      method: 'PATCH',
                                      body: { isActive: !sku.isActive },
                                    }).then(() => undefined),
                                  sku.isActive ? 'تم إيقاف النسخة.' : 'تم تفعيل النسخة.',
                                )
                              }
                            >
                              {sku.isActive ? 'إيقاف التوافر' : 'تفعيل النسخة'}
                            </Button>
                            <Button
                              variant="ghost"
                              onClick={() => {
                                setPricingSkuId(sku.id)
                                setPriceAmount(
                                  sku.currentPrice ? String(sku.currentPrice.amount) : '',
                                )
                                setCompareAtAmount(
                                  sku.currentPrice?.compareAtAmount
                                    ? String(sku.currentPrice.compareAtAmount)
                                    : '',
                                )
                              }}
                            >
                              تحديث السعر
                            </Button>
                            <Button
                              variant="ghost"
                              onClick={() => void refreshReadiness(sku.id)}
                            >
                              <ShieldCheck className="size-3.5 text-bw-cobalt" aria-hidden />
                              فحص النشر
                            </Button>
                          </div>
                        ) : null}
                      </>
                    )}
                  </div>
                ))
              )}

              {readinessSkuId && !product.archivedAt ? (
                <div className="space-y-3 rounded-bw-card border border-bw-cobalt/30 bg-bw-surface p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Sparkles className="size-4 text-bw-cobalt" aria-hidden />
                      <h4 className="font-semibold text-bw-ink">
                        تقرير جاهزية النشر الرسمي (Publication Workbench)
                      </h4>
                    </div>
                    {readinessLoading ? (
                      <span className="text-bw-small text-bw-ink-subtle">جاري الفحص…</span>
                    ) : null}
                  </div>
                  {readinessData ? (
                    <div className="space-y-3 text-bw-small">
                      {readinessData.blockers.length ? (
                        <div className="space-y-1.5">
                          <p className="font-semibold text-bw-rose">
                            معوقات النشر ({readinessData.blockers.length}):
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {readinessData.blockers.map((b) => (
                              <span
                                key={b}
                                className="rounded-full border border-bw-rose/30 bg-bw-rose-soft px-2.5 py-0.5 text-[11px] font-semibold text-bw-ink"
                              >
                                {readinessIssueLabel(b)}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <p className="font-semibold text-bw-emerald">
                          جميع شروط النشر مكتملة لهذه النسخة.
                        </p>
                      )}

                      {readinessData.warnings.length ? (
                        <div className="flex flex-wrap items-center gap-1.5 text-bw-amber">
                          <AlertTriangle className="size-3.5" aria-hidden />
                          <span>تنبيهات اختيارية:</span>
                          {readinessData.warnings.map((w) => (
                            <span
                              key={w}
                              className="rounded-full bg-bw-amber-soft px-2 py-0.5 text-[11px] text-bw-ink"
                            >
                              {readinessIssueLabel(w)}
                            </span>
                          ))}
                        </div>
                      ) : null}

                      <div className="flex flex-wrap items-end gap-2 border-t border-bw-line pt-3">
                        {!readinessData.isPublished ? (
                          <>
                            {!readinessData.commerce.price ? (
                              <Field
                                label="سعر الإطلاق (EGP اختياري)"
                                type="number"
                                step="1"
                                value={publishPriceEgp}
                                onChange={(e) => setPublishPriceEgp(e.target.value)}
                                className="w-44"
                                ltr
                              />
                            ) : null}
                            <Button
                              loading={busy === 'publish'}
                              onClick={() =>
                                void runAction(
                                  'publish',
                                  () =>
                                    api(`/catalog/workbench/skus/${readinessData.skuId}/publish`, {
                                      method: 'POST',
                                      body: publishPriceEgp.trim()
                                        ? { priceEgp: Number(publishPriceEgp) }
                                        : {},
                                    }).then(() => undefined),
                                  'تم نشر المنتج واعتماد النسخة في المتجر.',
                                ).then(() => refreshReadiness(readinessData.skuId))
                              }
                            >
                              نشر المنتج الآن
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="secondary"
                            loading={busy === 'unpublish'}
                            onClick={() =>
                              void runAction(
                                'unpublish',
                                () =>
                                  api(`/catalog/workbench/skus/${readinessData.skuId}/unpublish`, {
                                    method: 'POST',
                                    body: {},
                                  }).then(() => undefined),
                                'تم سحب المنتج من النشر وإعادته كمسودة.',
                              ).then(() => refreshReadiness(readinessData.skuId))
                            }
                          >
                            إلغاء النشر (تحويل لمسودة)
                          </Button>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {subTab === 'media' ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-bw-field border border-bw-line bg-bw-sunken p-3 text-bw-small">
                <div>
                  <p className="font-semibold text-bw-ink">
                    حالة الصور:{' '}
                    {product.mediaStatus === 'PUBLISHED'
                      ? 'منشورة'
                      : product.mediaStatus === 'PENDING_REVIEW'
                        ? 'بانتظار المراجعة'
                        : product.mediaStatus === 'APPROVED_UNPUBLISHED'
                          ? 'معتمدة وجاهزة للنشر'
                          : 'لا توجد صورة منشورة'}
                  </p>
                  <p className="text-bw-ink-subtle">
                    معالجة الصور الرسمية ومطابقة القوالب تتم عبر استوديو القوالب.
                  </p>
                </div>
                <Link
                  href="/admin/catalog/media-templates"
                  className="inline-flex h-bw-control items-center gap-1.5 rounded-bw-field border border-bw-line bg-bw-surface px-3 text-bw-small font-semibold text-bw-ink hover:bg-bw-page"
                >
                  <ImageIcon className="size-4 text-bw-cobalt" aria-hidden />
                  قوالب الصور
                  <ExternalLink className="size-3.5" aria-hidden />
                </Link>
              </div>
              {product.media.length === 0 ? (
                <StateBlock
                  kind="empty"
                  title="لا توجد صور منشورة لهذا المنتج"
                  body="ارفع أو اعتمد صورة PRIMARY_PACKSHOT للنسخة ثم انشرها لظهورها في المتجر والإدارة."
                />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {product.media.map((m) => (
                    <div
                      key={m.id}
                      className="space-y-2 rounded-bw-card border border-bw-line bg-bw-sunken p-3"
                    >
                      <CatalogThumbnail url={m.url} alt={m.altText || product.name} size="lg" />
                      <div className="flex items-center justify-between text-bw-small">
                        <span className="truncate text-bw-ink-soft">
                          {m.altText || 'صورة منتج'}
                        </span>
                        {m.isPrimary ? <StatusLabel tone="ok">رئيسية</StatusLabel> : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </Dialog>
  )
}

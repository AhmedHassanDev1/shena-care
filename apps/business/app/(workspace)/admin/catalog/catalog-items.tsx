'use client'

import * as React from 'react'
import Link from 'next/link'
import { ImageOff, Pencil, RefreshCw } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { Button, Code, Dialog, Field, Skeleton, StateBlock, StatusLabel, useDialog } from '@/components/bw/primitives'
import { LoadError } from '@/components/workspace/role-shell'
import { useApi } from '@/lib/use-api'

type Sku = { id: string; code: string; variantName: string; isActive: boolean; isListed: boolean }
type Item = {
  id: string
  name: string
  description: string | null
  brand: { name: string }
  isPublished: boolean
  archivedAt: string | null
  media: Array<{ url: string; altText: string | null }>
  skus: Sku[]
}
type Result = { items: Item[]; total: number; page: number; limit: number }
type Filter = 'active' | 'archived'

function ProductImage({ image, name, large = false }: { image?: Item['media'][number]; name: string; large?: boolean }) {
  const [failed, setFailed] = React.useState(false)
  React.useEffect(() => setFailed(false), [image?.url])
  return <span className={`grid shrink-0 place-items-center overflow-hidden rounded-bw-field border border-bw-line bg-bw-sunken ${large ? 'h-56 w-full' : 'size-12'}`}>
    {image?.url && !failed ? <img src={image.url} alt={image.altText || name} onError={() => setFailed(true)} className="size-full object-contain" />
      : <span className="flex flex-col items-center gap-0.5 text-bw-ink-subtle"><ImageOff className="size-4" aria-hidden /><span className="text-[9px]">بلا صورة</span></span>}
  </span>
}

export { ProductImage }

export function CatalogItems({ query }: { query: string }) {
  const [filter, setFilter] = React.useState<Filter>('active')
  const [page, setPage] = React.useState(1)
  const [selected, setSelected] = React.useState<Item | null>(null)
  const [tab, setTab] = React.useState<'details' | 'skus'>('details')
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [editingSku, setEditingSku] = React.useState<string | null>(null)
  const [skuName, setSkuName] = React.useState('')
  const [skuCode, setSkuCode] = React.useState('')
  const [confirmArchive, setConfirmArchive] = React.useState(false)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)
  const editor = useDialog()
  React.useEffect(() => setPage(1), [filter, query])
  const path = `/catalog/items?state=${filter}&page=${page}&limit=20&q=${encodeURIComponent(query.trim())}`
  const itemsApi = useApi<Result>(path)

  function openEditor(product: Item) {
    setSelected(product)
    setName(product.name)
    setDescription(product.description ?? '')
    setTab('details')
    setEditingSku(null)
    setConfirmArchive(false)
    setError(null)
    editor.open()
  }

  async function change(key: string, endpoint: string, body: unknown, message: string, onSuccess?: () => void) {
    setBusy(key)
    setError(null)
    setNotice(null)
    try {
      await api(endpoint, { method: body === undefined ? 'POST' : 'PATCH', body })
      onSuccess?.()
      setNotice(message)
      itemsApi.reload()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذر حفظ التغيير. حاول مرة أخرى.')
    } finally {
      setBusy(null)
    }
  }

  function saveProduct(event: React.FormEvent) {
    event.preventDefault()
    if (!selected) return
    if (name.trim().length < 2) { setError('اسم المنتج لازم يكون حرفين على الأقل.'); return }
    void change(selected.id, `/products/${selected.id}`, { name: name.trim(), description: description.trim() }, 'تم حفظ بيانات المنتج.', () => editor.close())
  }

  function startSkuEdit(sku: Sku) {
    setEditingSku(sku.id)
    setSkuName(sku.variantName)
    setSkuCode(sku.code)
    setError(null)
  }

  function saveSku(event: React.FormEvent) {
    event.preventDefault()
    if (!selected || !editingSku) return
    if (skuCode.trim().length < 2) { setError('كود النسخة لازم يكون حرفين على الأقل.'); return }
    const id = editingSku
    const updated = { variantName: skuName.trim(), code: skuCode.trim() }
    void change(id, `/products/skus/${id}`, updated, 'تم حفظ بيانات النسخة.', () => {
      setSelected(current => current ? { ...current, skus: current.skus.map(sku => sku.id === id ? { ...sku, ...updated } : sku) } : current)
      setEditingSku(null)
    })
  }

  return <section aria-label="إدارة عناصر الكتالوج" className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-baseline gap-3"><h2 className="text-bw-heading font-semibold">المنتجات</h2>{itemsApi.data ? <span className="text-bw-small text-bw-ink-soft"><Code>{itemsApi.data.total}</Code> عنصر</span> : null}</div>
      <div className="flex items-center gap-2">
        <div role="group" aria-label="حالة العناصر" className="flex rounded-bw-field border border-bw-line bg-bw-sunken p-1">
          {(['active', 'archived'] as const).map(state => <button key={state} type="button" aria-pressed={filter === state}
            onClick={() => setFilter(state)} className={`rounded-bw-field px-3 py-1.5 text-bw-small transition-colors ${filter === state ? 'bg-bw-surface font-semibold text-bw-ink' : 'text-bw-ink-soft hover:text-bw-ink'}`}>
            {state === 'active' ? 'الحالية' : 'الأرشيف'}
          </button>)}
        </div>
        <Button variant="ghost" aria-label="تحديث العناصر" onClick={itemsApi.reload}><RefreshCw className="size-4" /></Button>
      </div>
    </div>
    {notice ? <p role="status" className="text-bw-small text-bw-ink">{notice}</p> : null}
    {error && !selected ? <p role="alert" className="text-bw-small text-bw-danger">{error}</p> : null}
    {itemsApi.error ? <LoadError message={itemsApi.error.message} onRetry={itemsApi.reload} /> : null}
    {itemsApi.loading && !itemsApi.data ? <Skeleton className="h-64 w-full rounded-bw-card" /> : null}
    {itemsApi.data && itemsApi.data.items.length === 0 ? <StateBlock kind="empty" title={query ? 'لا توجد عناصر مطابقة' : filter === 'archived' ? 'الأرشيف فارغ' : 'لا توجد عناصر'} body={query ? 'جرّب اسمًا أو كودًا آخر.' : undefined} /> : null}
    {itemsApi.data && itemsApi.data.items.length > 0 ? <div className="divide-y divide-bw-line overflow-hidden rounded-bw-card border border-bw-line bg-bw-surface">
      {itemsApi.data.items.map(product => <article key={product.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 transition-colors hover:bg-bw-sunken sm:px-4">
        <ProductImage image={product.media[0]} name={product.name} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-bw-small text-bw-ink-soft"><bdi>{product.brand.name}</bdi></p>
          <h3 className="truncate font-semibold text-bw-ink"><bdi>{product.name}</bdi></h3>
          <p className="text-bw-small text-bw-ink-subtle"><Code>{product.skus.length}</Code> نسخة</p>
        </div>
        <StatusLabel tone={product.archivedAt ? 'pending' : product.isPublished ? 'ok' : 'warn'}>{product.archivedAt ? 'مؤرشف' : product.isPublished ? 'منشور' : 'غير منشور'}</StatusLabel>
        {product.archivedAt ? <Button variant="secondary" disabled={busy !== null} loading={busy === product.id}
          onClick={() => void change(product.id, `/catalog/items/${product.id}/restore`, undefined, 'استُعيد المنتج كمسودة. راجع النشر والنسخ قبل إتاحته.')}>استعادة</Button>
          : <Button variant="secondary" onClick={() => openEditor(product)}><Pencil className="size-4" aria-hidden />تعديل</Button>}
      </article>)}
    </div> : null}
    {itemsApi.data && itemsApi.data.total > itemsApi.data.limit ? <nav aria-label="صفحات العناصر" className="flex items-center justify-between gap-3 text-bw-small">
      <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>السابق</Button>
      <span>صفحة <Code>{page}</Code> من <Code>{Math.ceil(itemsApi.data.total / itemsApi.data.limit)}</Code></span>
      <Button variant="secondary" disabled={page * itemsApi.data.limit >= itemsApi.data.total} onClick={() => setPage(page + 1)}>التالي</Button>
    </nav> : null}

    <Dialog dialogRef={editor.ref} title="إدارة المنتج" onClose={() => { setSelected(null); setError(null) }}
      footer={selected ? <div className="flex w-full flex-wrap items-center justify-between gap-2">
        <div>{confirmArchive ? <div className="flex items-center gap-2"><span className="text-bw-small text-bw-danger">سيُوقف النشر والنسخ.</span><Button variant="danger" loading={busy === selected.id} onClick={() => void change(selected.id, `/catalog/items/${selected.id}/archive`, undefined, 'أُرشف المنتج وأُوقف نشره ونسخه.', () => editor.close())}>تأكيد الأرشفة</Button><Button variant="ghost" onClick={() => setConfirmArchive(false)}>تراجع</Button></div>
          : <Button variant="ghost" onClick={() => setConfirmArchive(true)}>أرشفة المنتج</Button>}</div>
        <div className="flex gap-2"><Button variant="ghost" onClick={() => editor.close()}>إغلاق</Button>{tab === 'details' ? <Button type="submit" form="catalog-item-edit-form" loading={busy === selected.id}>حفظ التعديلات</Button> : null}</div>
      </div> : undefined}>
      {selected ? <div dir="rtl" className="space-y-4">
        <div className="flex items-center gap-3"><ProductImage image={selected.media[0]} name={selected.name} /><div className="min-w-0"><p className="text-bw-small text-bw-ink-soft">{selected.brand.name}</p><p className="truncate font-semibold"><bdi>{selected.name}</bdi></p></div></div>
        <div role="group" aria-label="تفاصيل الإدارة" className="flex gap-1 border-b border-bw-line">
          <button type="button" aria-pressed={tab === 'details'} onClick={() => setTab('details')} className={`border-b-2 px-3 py-2 text-bw-small ${tab === 'details' ? 'border-bw-action text-bw-ink' : 'border-transparent text-bw-ink-soft'}`}>بيانات المنتج</button>
          <button type="button" aria-pressed={tab === 'skus'} onClick={() => setTab('skus')} className={`border-b-2 px-3 py-2 text-bw-small ${tab === 'skus' ? 'border-bw-action text-bw-ink' : 'border-transparent text-bw-ink-soft'}`}>النسخ <Code>{selected.skus.length}</Code></button>
        </div>
        {error ? <p role="alert" className="text-bw-small text-bw-danger">{error}</p> : null}
        {tab === 'details' ? <div className="space-y-4">
          <form id="catalog-item-edit-form" onSubmit={saveProduct} className="space-y-4">
            <Field label="اسم المنتج" value={name} onChange={event => setName(event.target.value)} required minLength={2} />
            <div className="space-y-1.5"><label htmlFor="catalog-item-description" className="block text-bw-small font-semibold">الوصف</label><textarea id="catalog-item-description" value={description} onChange={event => setDescription(event.target.value)} rows={4} className="w-full rounded-bw-field border border-bw-line-field bg-bw-surface p-3 text-bw-body text-bw-ink focus:border-bw-action focus:outline-none" /></div>
          </form>
          {!selected.isPublished ? <div className="border-t border-bw-line pt-4"><p className="mb-2 text-bw-small text-bw-ink-soft">النشر يحتاج مراجعة الجاهزية والهوية والصور.</p><Link href="/admin/catalog/workbench" className="text-bw-small text-bw-action-ink underline underline-offset-4">افتح مراجعة النشر</Link></div> : null}
        </div> : <div className="divide-y divide-bw-line">
          {selected.skus.length === 0 ? <StateBlock kind="empty" title="لا توجد نسخ" body="أضف نسخة من تجهيز المنتج قبل عرضه." /> : null}
          {selected.skus.map(sku => <div key={sku.id} className="space-y-3 py-3">
            {editingSku === sku.id ? <form onSubmit={saveSku} className="space-y-3"><Field label="اسم النسخة" value={skuName} onChange={event => setSkuName(event.target.value)} /><Field label="كود النسخة" value={skuCode} onChange={event => setSkuCode(event.target.value)} required minLength={2} ltr /><div className="flex gap-2"><Button type="submit" loading={busy === sku.id}>حفظ النسخة</Button><Button variant="ghost" onClick={() => setEditingSku(null)}>إلغاء</Button></div></form>
              : <><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-semibold"><bdi>{sku.variantName || 'النسخة الأساسية'}</bdi></p><Code className="text-bw-small text-bw-ink-soft">{sku.code}</Code></div><Button variant="ghost" onClick={() => startSkuEdit(sku)}>تعديل</Button></div><p className="text-bw-small text-bw-ink-soft">{sku.isListed ? 'ظاهرة' : 'مخفية'} · {sku.isActive ? 'مفعّلة' : 'موقوفة'}</p><div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={busy !== null || (!sku.isListed && (!sku.isActive || !selected.isPublished))} onClick={() => void change(sku.id, `/catalog/items/skus/${sku.id}/visibility`, { isVisible: !sku.isListed }, sku.isListed ? 'أُخفيت النسخة.' : 'عادت النسخة للعرض.', () => setSelected(current => current ? { ...current, skus: current.skus.map(item => item.id === sku.id ? { ...item, isListed: !item.isListed } : item) } : current))}>{sku.isListed ? 'إخفاء' : 'إظهار'}</Button><Button variant="secondary" disabled={busy !== null} onClick={() => void change(sku.id, `/catalog/items/skus/${sku.id}/availability`, { isActive: !sku.isActive }, sku.isActive ? 'أُوقفت النسخة.' : 'فُعّلت النسخة؛ البيع يتطلب سعرًا ومخزونًا.', () => setSelected(current => current ? { ...current, skus: current.skus.map(item => item.id === sku.id ? { ...item, isActive: !item.isActive } : item) } : current))}>{sku.isActive ? 'إيقاف التوافر' : 'تفعيل النسخة'}</Button></div>{!sku.isListed && (!sku.isActive || !selected.isPublished) ? <p className="text-bw-small text-bw-ink-soft">لإظهار النسخة، فعّلها وأكمل مراجعة نشر المنتج أولًا.</p> : null}</>}
          </div>)}
        </div>}
      </div> : null}
    </Dialog>
  </section>
}

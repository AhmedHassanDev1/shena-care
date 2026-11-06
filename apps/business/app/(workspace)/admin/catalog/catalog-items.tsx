'use client'

import * as React from 'react'
import Link from 'next/link'
import { ImageOff, RefreshCw } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { Button, Code, Skeleton, StateBlock, StatusLabel } from '@/components/bw/primitives'
import { LoadError } from '@/components/workspace/role-shell'
import { useApi } from '@/lib/use-api'

type Item = {
  id: string
  name: string
  brand: { name: string }
  isPublished: boolean
  archivedAt: string | null
  media: Array<{ url: string; altText: string | null }>
  skus: Array<{ id: string; code: string; variantName: string; isActive: boolean; isListed: boolean }>
}
type Result = { items: Item[]; total: number; page: number; limit: number }
type Filter = 'active' | 'archived'

function ProductImage({ image, name, large = false }: { image?: Item['media'][number]; name: string; large?: boolean }) {
  const [failed, setFailed] = React.useState(false)
  React.useEffect(() => setFailed(false), [image?.url])
  return <span className={`grid shrink-0 place-items-center overflow-hidden rounded-bw-field border border-bw-line bg-bw-sunken ${large ? 'h-56 w-full' : 'size-16 sm:size-20'}`}>
    {image?.url && !failed ? <img src={image.url} alt={image.altText || name} onError={() => setFailed(true)} className="size-full object-contain" />
      : <span className="flex flex-col items-center gap-1 text-bw-ink-subtle"><ImageOff className="size-5" aria-hidden /><span className="text-[10px]">بلا صورة</span></span>}
  </span>
}

export { ProductImage }

export function CatalogItems({ query }: { query: string }) {
  const [filter, setFilter] = React.useState<Filter>('active')
  const [page, setPage] = React.useState(1)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)
  React.useEffect(() => setPage(1), [filter, query])
  const path = `/catalog/items?state=${filter}&page=${page}&limit=20&q=${encodeURIComponent(query.trim())}`
  const itemsApi = useApi<Result>(path)

  async function change(key: string, path: string, body: unknown, message: string) {
    setBusy(key)
    setError(null)
    setNotice(null)
    try {
      await api(path, { method: body === undefined ? 'POST' : 'PATCH', body })
      setNotice(message)
      itemsApi.reload()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذر حفظ التغيير. حاول مرة أخرى.')
    } finally {
      setBusy(null)
    }
  }

  return <section aria-label="إدارة عناصر الكتالوج" className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-bw-heading font-semibold">إدارة العناصر</h2><p className="text-bw-small text-bw-ink-soft">الإخفاء يوقف عرض النسخة للبيع. الإتاحة الفعلية تعتمد أيضًا على السعر والمخزون.</p></div>
      <Button variant="ghost" aria-label="تحديث العناصر" onClick={itemsApi.reload}><RefreshCw className="size-4" /></Button>
    </div>
    <div role="group" aria-label="حالة العناصر" className="flex gap-2">
      {(['active', 'archived'] as const).map((state) => <button key={state} type="button" aria-pressed={filter === state}
        onClick={() => setFilter(state)} className={`rounded-bw-field border border-bw-line px-3 py-2 text-bw-small ${filter === state ? 'bg-bw-surface font-semibold text-bw-ink' : 'text-bw-ink-soft'}`}>
        {state === 'active' ? 'العناصر الحالية' : 'الأرشيف'}
      </button>)}
    </div>
    {error ? <p role="alert" className="text-bw-small text-bw-danger">{error}</p> : null}
    {notice ? <p role="status" className="text-bw-small text-bw-ink">{notice}</p> : null}
    {itemsApi.error ? <LoadError message={itemsApi.error.message} onRetry={itemsApi.reload} /> : null}
    {itemsApi.loading && !itemsApi.data ? <Skeleton className="h-64 w-full rounded-bw-card" /> : null}
    {itemsApi.data && itemsApi.data.items.length === 0 ? <StateBlock kind="empty" title={query ? 'لا توجد عناصر مطابقة' : filter === 'archived' ? 'الأرشيف فارغ' : 'لا توجد عناصر'} body={query ? 'جرّب اسمًا أو كودًا آخر.' : undefined} /> : null}
    {itemsApi.data?.items.map((product) => <article key={product.id} className="rounded-bw-card border border-bw-line bg-bw-surface p-4">
      <div className="flex flex-wrap items-start gap-4">
        <ProductImage image={product.media[0]} name={product.name} />
        <div className="min-w-0 flex-1"><p className="text-bw-small text-bw-ink-soft">{product.brand.name}</p><h3 className="font-semibold text-bw-ink"><bdi>{product.name}</bdi></h3>
          <div className="mt-2 flex flex-wrap items-center gap-2"><StatusLabel tone={product.archivedAt ? 'pending' : product.isPublished ? 'ok' : 'warn'}>{product.archivedAt ? 'مؤرشف' : product.isPublished ? 'منشور' : 'غير منشور'}</StatusLabel>
            {!product.isPublished && !product.archivedAt ? <Link href="/admin/catalog/workbench" className="text-bw-small text-bw-action-ink underline">مراجعة النشر</Link> : null}</div>
        </div>
        {product.archivedAt ? <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => change(product.id, `/catalog/items/${product.id}/restore`, undefined, 'استُعيد العنصر كمسودة. راجع النشر والنسخ قبل إتاحته.')}>استعادة</Button>
          : <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => {
            if (window.confirm(`أرشفة ${product.name}؟ سيُوقف نشره ونسخه، ويمكن استعادته لاحقًا دون حذف سجل الطلبات.`))
              void change(product.id, `/catalog/items/${product.id}/archive`, undefined, 'أُرشف العنصر وأُوقف نشره ونسخه.')
          }}>أرشفة</Button>}
      </div>
      {!product.archivedAt ? <div className="mt-4 space-y-3 border-t border-bw-line pt-4">
        {product.skus.map((sku) => <div key={sku.id} className="flex flex-wrap items-center justify-between gap-3 rounded-bw-field bg-bw-sunken p-3">
          <div className="min-w-0"><p className="font-semibold"><bdi>{sku.variantName || 'النسخة الأساسية'}</bdi></p><Code>{sku.code}</Code>
            <p className="text-bw-small text-bw-ink-soft">{sku.isListed ? 'ظاهرة' : 'مخفية'} · {sku.isActive ? 'النسخة مفعّلة' : 'النسخة موقوفة'}</p></div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" disabled={busy !== null || (!sku.isListed && (!sku.isActive || !product.isPublished))}
              onClick={() => change(sku.id, `/catalog/items/skus/${sku.id}/visibility`, { isVisible: !sku.isListed }, sku.isListed ? 'أُخفيت النسخة من البيع.' : 'عادت النسخة إلى العرض، بحسب شروط البيع والمخزون.')}>
              {sku.isListed ? 'إخفاء' : 'إظهار'}
            </Button>
            <Button type="button" variant="secondary" disabled={busy !== null}
              onClick={() => change(sku.id, `/catalog/items/skus/${sku.id}/availability`, { isActive: !sku.isActive }, sku.isActive ? 'أُوقفت النسخة.' : 'فُعّلت النسخة؛ التوافر الفعلي يتطلب السعر والمخزون.')}>
              {sku.isActive ? 'إيقاف التوافر' : 'تفعيل النسخة'}
            </Button>
          </div>
        </div>)}
      </div> : null}
    </article>)}
    {itemsApi.data && itemsApi.data.total > itemsApi.data.limit ? <nav aria-label="صفحات العناصر" className="flex items-center justify-between gap-3 text-bw-small">
      <Button type="button" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>السابق</Button>
      <span>صفحة <Code>{page}</Code> من <Code>{Math.ceil(itemsApi.data.total / itemsApi.data.limit)}</Code> · <Code>{itemsApi.data.total}</Code> عنصر</span>
      <Button type="button" variant="secondary" disabled={page * itemsApi.data.limit >= itemsApi.data.total} onClick={() => setPage(page + 1)}>التالي</Button>
    </nav> : null}
  </section>
}

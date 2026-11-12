'use client'

import * as React from 'react'
import { ChevronDown, FolderPlus, Pencil, Plus, Power, Trash2 } from 'lucide-react'
import { Button, Code, Dialog, Field, Select, Skeleton, StateBlock, Switch, useDialog } from '@/components/bw/primitives'
import { LoadError } from '@/components/workspace/role-shell'
import { api, ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'
import { CategoryChildNode, CategoryNode, catalogErrorMessage } from './catalog-model'
import { Banner, Dot, RowMenu, SearchBox, TextBlock } from './ui'

type Editable = {
  id: string
  name: string
  slug: string
  description: string | null
  parentId: string | null
  sortOrder: number
  isActive: boolean
  hasChildren: boolean
  productCount: number
}

const fold = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')

const asEditable = (node: CategoryNode | CategoryChildNode, parentId: string | null): Editable => ({
  id: node.id,
  name: node.name,
  slug: node.slug,
  description: node.description,
  parentId,
  sortOrder: node.sortOrder,
  isActive: node.isActive,
  hasChildren: 'children' in node ? node.children.length > 0 : false,
  productCount: node.directProductCount,
})

export function CategoriesTab({ categories, loading, error, onReload, onViewProducts }: {
  categories: CategoryNode[]
  loading: boolean
  error: string | null
  onReload: () => void
  onViewProducts: (categoryId: string) => void
}) {
  const [query, setQuery] = React.useState('')
  const [open, setOpen] = React.useState<Record<string, boolean>>({})
  const [notice, setNotice] = React.useState<string | null>(null)
  const [failure, setFailure] = React.useState<string | null>(null)
  const [editing, setEditing] = React.useState<{ node: Editable | null; parentId: string } | null>(null)
  const [deleting, setDeleting] = React.useState<Editable | null>(null)
  const formDialog = useDialog()
  const deleteDialog = useDialog()
  const later = (fn: () => void) => window.setTimeout(fn, 0)

  const q = fold(query.trim())
  const roots = categories
    .map((root) => {
      const rootHit = !q || fold(root.name).includes(q)
      const children = root.children.filter((c) => !q || rootHit || fold(c.name).includes(q))
      return { root, children, show: rootHit || children.length > 0 }
    })
    .filter((entry) => entry.show)

  const toggleActive = async (node: Editable) => {
    setFailure(null)
    try {
      await api(`/categories/${node.id}`, { method: 'PATCH', body: { isActive: !node.isActive } })
      setNotice(node.isActive ? `تم إيقاف «${node.name}»` : `تم تفعيل «${node.name}»`)
      onReload()
    } catch (err) {
      setFailure(catalogErrorMessage(err as ApiError, 'تعذر تغيير الحالة'))
    }
  }

  const rowActions = (node: Editable, isRoot: boolean) => [
    { label: 'تعديل', icon: Pencil, onSelect: () => { setEditing({ node, parentId: node.parentId ?? '' }); later(() => formDialog.open()) } },
    ...(isRoot ? [{ label: 'إضافة تصنيف فرعي', icon: FolderPlus, onSelect: () => { setEditing({ node: null, parentId: node.id }); later(() => formDialog.open()) } }] : []),
    { label: node.isActive ? 'إيقاف' : 'تفعيل', icon: Power, onSelect: () => void toggleActive(node) },
    { label: 'حذف', icon: Trash2, tone: 'danger' as const, onSelect: () => { setDeleting(node); later(() => deleteDialog.open()) } },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={query} onChange={setQuery} label="بحث في التصنيفات" placeholder="تصنيف رئيسي أو فرعي" />
        <Button className="ms-auto" onClick={() => { setEditing({ node: null, parentId: '' }); later(() => formDialog.open()) }}><Plus className="size-4" aria-hidden />تصنيف جديد</Button>
      </div>

      {notice ? <Banner tone="ok" onClose={() => setNotice(null)}>{notice}</Banner> : null}
      {failure ? <Banner tone="danger" onClose={() => setFailure(null)}>{failure}</Banner> : null}
      {error ? <LoadError message={error} onRetry={onReload} /> : null}
      {loading && categories.length === 0 ? <Skeleton className="h-56 w-full" /> : null}
      {!loading && !error && categories.length === 0 ? <StateBlock kind="empty" title="لا توجد تصنيفات بعد" body="أضف تصنيفًا رئيسيًا ثم تصنيفات فرعية تحته." /> : null}
      {categories.length > 0 && roots.length === 0 ? <StateBlock kind="empty" title="لا يوجد تصنيف بهذا الاسم" /> : null}

      {roots.length > 0 ? (
        <ul className="divide-y divide-bw-line rounded-bw-card border border-bw-line bg-bw-surface">
          {roots.map(({ root, children }) => {
            const expanded = Boolean(q) || open[root.id]
            return (
              <li key={root.id}>
                <div className="flex items-center gap-2 px-2 py-1.5 md:px-3">
                  <button
                    type="button"
                    aria-expanded={root.children.length ? expanded : undefined}
                    aria-label={root.children.length ? `${expanded ? 'طيّ' : 'عرض'} فروع ${root.name}` : undefined}
                    disabled={root.children.length === 0}
                    onClick={() => setOpen({ ...open, [root.id]: !expanded })}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-bw-field px-2 py-2 text-start transition-colors enabled:hover:bg-bw-sunken"
                  >
                    <ChevronDown className={cn('size-4 shrink-0 text-bw-ink-subtle transition-transform', root.children.length === 0 ? 'opacity-0' : expanded ? 'rotate-180' : 'rtl:rotate-90 ltr:-rotate-90')} aria-hidden />
                    <span className="min-w-0 truncate font-semibold text-bw-ink"><bdi>{root.name}</bdi></span>
                    {root.children.length ? <span className="text-[12px] text-bw-ink-subtle"><Code>{root.children.length}</Code> فرعي</span> : null}
                  </button>
                  {!root.isActive ? <span className="hidden sm:block"><Dot tone="muted">موقوف</Dot></span> : null}
                  <CountButton count={root.totalProductCount} onClick={() => onViewProducts(root.id)} />
                  <RowMenu label={`إجراءات ${root.name}`} actions={rowActions(asEditable(root, null), true)} />
                </div>
                {expanded && children.length ? (
                  <ul className="border-t border-bw-line bg-bw-page/40">
                    {children.map((child) => (
                      <li key={child.id} className="flex items-center gap-2 py-1.5 ps-10 pe-2 md:ps-12 md:pe-3">
                        <span className="min-w-0 flex-1 truncate px-2 text-bw-small text-bw-ink"><bdi>{child.name}</bdi></span>
                        {!child.isActive ? <span className="hidden sm:block"><Dot tone="muted">موقوف</Dot></span> : null}
                        <CountButton count={child.directProductCount} onClick={() => onViewProducts(child.id)} />
                        <RowMenu label={`إجراءات ${child.name}`} actions={rowActions(asEditable(child, root.id), false)} />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : null}

      <CategoryModal
        key={`${editing?.node?.id ?? 'new'}-${editing?.parentId ?? ''}`}
        dialogRef={formDialog.ref}
        target={editing}
        roots={categories}
        onClose={() => formDialog.close()}
        onSaved={(m) => { formDialog.close(); setNotice(m); onReload() }}
      />
      <DeleteDialog dialogRef={deleteDialog.ref} node={deleting} onClose={() => deleteDialog.close()} onDeleted={(m) => { deleteDialog.close(); setNotice(m); onReload() }} />
    </div>
  )
}

function CountButton({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button type="button" disabled={count === 0} onClick={onClick} className="min-h-9 rounded-bw-field px-2.5 text-bw-small text-bw-cobalt transition-colors hover:bg-bw-sunken disabled:text-bw-ink-subtle disabled:hover:bg-transparent">
      <Code>{count}</Code> منتج
    </button>
  )
}

function CategoryModal({ dialogRef, target, roots, onClose, onSaved }: {
  dialogRef: React.RefObject<HTMLDialogElement | null>
  target: { node: Editable | null; parentId: string } | null
  roots: CategoryNode[]
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const node = target?.node ?? null
  const [name, setName] = React.useState(node?.name ?? '')
  const [parentId, setParentId] = React.useState(target?.parentId ?? '')
  const [slug, setSlug] = React.useState(node?.slug ?? '')
  const [description, setDescription] = React.useState(node?.description ?? '')
  const [sortOrder, setSortOrder] = React.useState(String(node?.sortOrder ?? 0))
  const [active, setActive] = React.useState(node?.isActive ?? true)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  // A root that already has children cannot be nested (the API refuses it), so the choice is not offered.
  const parentLocked = Boolean(node?.hasChildren)

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (name.trim().length < 2) { setError('اسم التصنيف حرفان على الأقل'); return }
    const order = Number(sortOrder)
    if (!Number.isInteger(order) || order < 0) { setError('الترتيب رقم صحيح غير سالب'); return }
    const body: Record<string, unknown> = {
      name: name.trim(),
      ...(slug.trim() ? { slug: slug.trim().toLowerCase() } : {}),
      description: description.trim(),
      sortOrder: order,
      isActive: active,
      ...(node ? { parentId: parentId || null } : parentId ? { parentId } : {}),
    }
    setBusy(true)
    setError(null)
    try {
      if (node) await api(`/categories/${node.id}`, { method: 'PATCH', body })
      else await api('/categories', { method: 'POST', body })
      onSaved(node ? `تم حفظ «${name.trim()}»` : `تمت إضافة «${name.trim()}»`)
    } catch (err) {
      setError(catalogErrorMessage(err as ApiError, 'تعذر حفظ التصنيف'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      dialogRef={dialogRef}
      title={node ? 'تعديل التصنيف' : parentId ? 'تصنيف فرعي جديد' : 'تصنيف جديد'}
      onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>إلغاء</Button><Button type="submit" form="category-form" loading={busy}>{node ? 'حفظ' : 'إضافة'}</Button></>}
    >
      <form id="category-form" dir="rtl" onSubmit={save} className="space-y-4">
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <Field label="اسم التصنيف" value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
        <Select
          label="يتبع"
          value={parentId}
          disabled={parentLocked}
          onChange={(e) => setParentId(e.target.value)}
          options={[{ value: '', label: 'تصنيف رئيسي' }, ...roots.filter((r) => r.id !== node?.id).map((r) => ({ value: r.id, label: r.name }))]}
        />
        {parentLocked ? <p className="text-bw-small text-bw-ink-soft">هذا التصنيف يحتوي على فروع، فلا يمكن جعله فرعًا لتصنيف آخر.</p> : null}
        <details className="group rounded-bw-field border border-bw-line">
          <summary className="flex min-h-bw-control cursor-pointer list-none items-center justify-between px-3 text-bw-small font-semibold text-bw-ink-soft">
            خيارات إضافية <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <div className="space-y-3 border-t border-bw-line p-3">
            <Field label="المعرّف (slug)" ltr value={slug} onChange={(e) => setSlug(e.target.value)} hint="فارغ = يُولَّد تلقائيًا" />
            <Field label="ترتيب العرض" type="number" ltr min={0} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
            <TextBlock label="وصف" value={description} onChange={setDescription} rows={2} />
            <Switch label="التصنيف نشط" checked={active} onChange={(e) => setActive(e.target.checked)} />
          </div>
        </details>
      </form>
    </Dialog>
  )
}

function DeleteDialog({ dialogRef, node, onClose, onDeleted }: {
  dialogRef: React.RefObject<HTMLDialogElement | null>
  node: Editable | null
  onClose: () => void
  onDeleted: (message: string) => void
}) {
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  React.useEffect(() => setError(null), [node?.id])
  const blocked = node ? node.productCount > 0 || node.hasChildren : false
  return (
    <Dialog
      dialogRef={dialogRef}
      title="حذف التصنيف"
      onClose={onClose}
      footer={node ? (
        <>
          <Button variant="ghost" onClick={onClose}>تراجع</Button>
          {!blocked ? (
            <Button variant="danger" loading={busy} onClick={async () => {
              setBusy(true)
              setError(null)
              try { await api(`/categories/${node.id}`, { method: 'DELETE' }); onDeleted(`تم حذف «${node.name}»`) }
              catch (err) { setError(catalogErrorMessage(err as ApiError, 'تعذر حذف التصنيف')) }
              finally { setBusy(false) }
            }}>حذف نهائي</Button>
          ) : null}
        </>
      ) : undefined}
    >
      {node ? (
        <div dir="rtl" className="space-y-3 text-bw-small">
          {error ? <Banner tone="danger">{error}</Banner> : null}
          {blocked ? (
            <p className="text-bw-ink-soft">لا يمكن حذف «{node.name}» لأنه يحتوي على {node.productCount > 0 ? <><Code>{node.productCount}</Code> منتج</> : null}{node.productCount > 0 && node.hasChildren ? ' و' : ''}{node.hasChildren ? 'تصنيفات فرعية' : null}. انقل المنتجات أو الفروع أولًا، أو أوقف التصنيف بدلًا من حذفه.</p>
          ) : (
            <p className="text-bw-ink-soft">سيُحذف «{node.name}» نهائيًا ولا يمكن التراجع. إن كانت له قاعدة في قائمة السماح سيرفض النظام الحذف.</p>
          )}
        </div>
      ) : null}
    </Dialog>
  )
}

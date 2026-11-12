'use client'

import * as React from 'react'
import {
  ChevronDown,
  ChevronLeft,
  FolderTree,
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
  Select,
  Skeleton,
  StateBlock,
  StatusLabel,
  Switch,
  useDialog,
} from '@/components/bw/primitives'
import { LoadError } from '@/components/workspace/role-shell'
import { CategoryChildNode, CategoryNode } from './catalog-utils'

type EditableCategory = {
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

export function CategoriesTab({
  categories,
  loading,
  error,
  onReload,
  onViewCategoryProducts,
}: {
  categories: CategoryNode[]
  loading: boolean
  error: string | null
  onReload: () => void
  onViewCategoryProducts: (categoryId: string) => void
}) {
  const [query, setQuery] = React.useState('')
  const [showInactive, setShowInactive] = React.useState(true)
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({})
  const [notice, setNotice] = React.useState<string | null>(null)
  const [actionError, setActionError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  const formDialog = useDialog()
  const deleteDialog = useDialog()

  const [editing, setEditing] = React.useState<EditableCategory | null>(null)
  const [name, setName] = React.useState('')
  const [slug, setSlug] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [parentId, setParentId] = React.useState('')
  const [sortOrder, setSortOrder] = React.useState('0')
  const [isActive, setIsActive] = React.useState(true)

  const [deleting, setDeleting] = React.useState<EditableCategory | null>(null)

  const filteredRoots = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return categories
      .filter((root) => {
        if (!showInactive && !root.isActive) return false
        if (!q) return true
        const matchRoot = root.name.toLowerCase().includes(q) || root.slug.toLowerCase().includes(q)
        const matchChild = root.children.some(
          (c) => c.name.toLowerCase().includes(q) || c.slug.toLowerCase().includes(q),
        )
        return matchRoot || matchChild
      })
      .map((root) => ({
        ...root,
        children: root.children.filter((c) => {
          if (!showInactive && !c.isActive) return false
          if (!q) return true
          return (
            c.name.toLowerCase().includes(q) ||
            c.slug.toLowerCase().includes(q) ||
            root.name.toLowerCase().includes(q)
          )
        }),
      }))
  }, [categories, query, showInactive])

  function openCreate(defaultParentId = '') {
    setEditing(null)
    setName('')
    setSlug('')
    setDescription('')
    setParentId(defaultParentId)
    setSortOrder('0')
    setIsActive(true)
    setActionError(null)
    formDialog.open()
  }

  function openEditRoot(root: CategoryNode) {
    setEditing({
      id: root.id,
      name: root.name,
      slug: root.slug,
      description: root.description,
      parentId: null,
      sortOrder: root.sortOrder,
      isActive: root.isActive,
      hasChildren: root.children.length > 0,
      productCount: root.directProductCount,
    })
    setName(root.name)
    setSlug(root.slug)
    setDescription(root.description ?? '')
    setParentId('')
    setSortOrder(String(root.sortOrder))
    setIsActive(root.isActive)
    setActionError(null)
    formDialog.open()
  }

  function openEditChild(child: CategoryChildNode, rootId: string) {
    setEditing({
      id: child.id,
      name: child.name,
      slug: child.slug,
      description: child.description,
      parentId: rootId,
      sortOrder: child.sortOrder,
      isActive: child.isActive,
      hasChildren: false,
      productCount: child.directProductCount,
    })
    setName(child.name)
    setSlug(child.slug)
    setDescription(child.description ?? '')
    setParentId(rootId)
    setSortOrder(String(child.sortOrder))
    setIsActive(child.isActive)
    setActionError(null)
    formDialog.open()
  }

  async function saveCategory(event: React.FormEvent) {
    event.preventDefault()
    if (name.trim().length < 2) {
      setActionError('اسم التصنيف يجب أن يكون حرفين على الأقل.')
      return
    }
    const orderNum = Number(sortOrder)
    if (!Number.isInteger(orderNum) || orderNum < 0) {
      setActionError('ترتيب العرض يجب أن يكون رقمًا صحيحًا غير سالب.')
      return
    }

    const body: Record<string, unknown> = {
      name: name.trim(),
      ...(slug.trim() ? { slug: slug.trim().toLowerCase() } : {}),
      description: description.trim(),
      sortOrder: orderNum,
      isActive,
      ...(editing
        ? { parentId: parentId || null }
        : parentId
          ? { parentId }
          : {}),
    }

    setBusy(true)
    setActionError(null)
    try {
      if (editing) {
        await api(`/categories/${editing.id}`, { method: 'PATCH', body })
        setNotice(`تم تحديث التصنيف «${name.trim()}».`)
      } else {
        await api('/categories', { method: 'POST', body })
        setNotice(`تمت إضافة التصنيف «${name.trim()}».`)
      }
      formDialog.close()
      onReload()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'تعذر حفظ التصنيف.')
    } finally {
      setBusy(false)
    }
  }

  async function confirmDelete() {
    if (!deleting) return
    setBusy(true)
    setActionError(null)
    try {
      await api(`/categories/${deleting.id}`, { method: 'DELETE' })
      setNotice(`تم حذف التصنيف «${deleting.name}».`)
      setDeleting(null)
      deleteDialog.close()
      onReload()
    } catch (err) {
      setActionError(
        err instanceof ApiError
          ? err.message
          : 'تعذر حذف التصنيف لوجود منتجات أو تصنيفات فرعية مرتبطة به.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="إدارة التصنيفات" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-bw-card border border-bw-line bg-bw-surface p-3.5">
        <div className="flex flex-1 flex-wrap items-center gap-3">
          <label className="relative min-w-56 flex-1 max-w-md">
            <span className="sr-only">بحث في التصنيفات</span>
            <Search
              className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-bw-ink-subtle"
              aria-hidden
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ابحث عن تصنيف رئيسي أو فرعي"
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
          <Button variant="ghost" aria-label="تحديث التصنيفات" onClick={onReload}>
            <RefreshCw className="size-4" />
          </Button>
          <Button onClick={() => openCreate('')}>
            <Plus className="size-4" aria-hidden />
            تصنيف جديد
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
      {loading && categories.length === 0 ? <Skeleton className="h-64 w-full rounded-bw-card" /> : null}

      {!loading && filteredRoots.length === 0 ? (
        <StateBlock
          kind="empty"
          title="لا توجد تصنيفات مطابقة"
          body={query ? 'جرّب اسم تصنيف آخر.' : 'أنشئ التصنيفات الرئيسية لتنظيم المتجر.'}
        />
      ) : null}

      {filteredRoots.length > 0 ? (
        <div className="overflow-x-auto rounded-bw-card border border-bw-line bg-bw-surface">
          <table className="w-full text-start text-bw-small">
            <thead className="border-b border-bw-line bg-bw-sunken text-[11px] font-semibold text-bw-ink-soft">
              <tr>
                <th className="px-4 py-3 text-start">التصنيف (هيكل ثنائي المستوى)</th>
                <th className="px-3 py-3 text-start">الترتيب</th>
                <th className="px-3 py-3 text-start">المنتجات</th>
                <th className="px-3 py-3 text-start">الحالة</th>
                <th className="px-4 py-3 text-end">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bw-line">
              {filteredRoots.map((root) => {
                const isOpen = expanded[root.id] ?? true
                return (
                  <React.Fragment key={root.id}>
                    <tr className="bg-bw-surface transition-colors hover:bg-bw-sunken">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setExpanded((prev) => ({ ...prev, [root.id]: !isOpen }))
                            }
                            disabled={root.children.length === 0}
                            className="grid size-7 shrink-0 place-items-center rounded-bw-field border border-bw-line bg-bw-sunken text-bw-ink-soft disabled:opacity-30"
                            aria-label={isOpen ? 'طي الفروع' : 'توسيع الفروع'}
                          >
                            {root.children.length === 0 ? (
                              <FolderTree className="size-3.5" aria-hidden />
                            ) : isOpen ? (
                              <ChevronDown className="size-3.5" aria-hidden />
                            ) : (
                              <ChevronLeft className="size-3.5" aria-hidden />
                            )}
                          </button>
                          <div className="min-w-0">
                            <p className="font-semibold text-bw-ink">
                              <bdi>{root.name}</bdi>
                            </p>
                            <p className="text-[11px] text-bw-ink-subtle">
                              <Code>{root.slug}</Code> · <Code>{root.children.length}</Code> فرعي
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-bw-ink-soft">
                        <Code>{root.sortOrder}</Code>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <span>
                            <Code>{root.totalProductCount}</Code>
                          </span>
                          {root.totalProductCount > 0 ? (
                            <Button
                              variant="ghost"
                              onClick={() => onViewCategoryProducts(root.id)}
                            >
                              <PackageSearch className="size-3.5 text-bw-cobalt" aria-hidden />
                              عرض
                            </Button>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <StatusLabel tone={root.isActive ? 'ok' : 'pending'}>
                          {root.isActive ? 'نشط' : 'موقوف'}
                        </StatusLabel>
                      </td>
                      <td className="px-4 py-3 text-end">
                        <div className="inline-flex items-center gap-1">
                          <Button variant="ghost" onClick={() => openCreate(root.id)}>
                            <Plus className="size-3.5 text-bw-cobalt" aria-hidden />
                            فرعي
                          </Button>
                          <Button variant="ghost" onClick={() => openEditRoot(root)}>
                            <Pencil className="size-3.5" aria-hidden />
                            تعديل
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => {
                              setDeleting({
                                id: root.id,
                                name: root.name,
                                slug: root.slug,
                                description: root.description,
                                parentId: null,
                                sortOrder: root.sortOrder,
                                isActive: root.isActive,
                                hasChildren: root.children.length > 0,
                                productCount: root.totalProductCount,
                              })
                              setActionError(null)
                              deleteDialog.open()
                            }}
                            aria-label={`حذف ${root.name}`}
                          >
                            <Trash2 className="size-3.5 text-bw-rose" aria-hidden />
                          </Button>
                        </div>
                      </td>
                    </tr>

                    {isOpen
                      ? root.children.map((child) => (
                          <tr
                            key={child.id}
                            className="bg-bw-sunken/50 transition-colors hover:bg-bw-sunken"
                          >
                            <td className="py-2.5 pe-4 ps-12">
                              <div className="flex items-center gap-2 border-s-2 border-bw-line ps-3">
                                <div className="min-w-0">
                                  <p className="font-medium text-bw-ink">
                                    <bdi>{child.name}</bdi>
                                  </p>
                                  <p className="text-[11px] text-bw-ink-subtle">
                                    <Code>{child.slug}</Code>
                                  </p>
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-bw-ink-soft">
                              <Code>{child.sortOrder}</Code>
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-2">
                                <span>
                                  <Code>{child.directProductCount}</Code>
                                </span>
                                {child.directProductCount > 0 ? (
                                  <Button
                                    variant="ghost"
                                    onClick={() => onViewCategoryProducts(child.id)}
                                  >
                                    <PackageSearch className="size-3.5 text-bw-cobalt" aria-hidden />
                                    عرض
                                  </Button>
                                ) : null}
                              </div>
                            </td>
                            <td className="px-3 py-2.5">
                              <StatusLabel tone={child.isActive ? 'ok' : 'pending'}>
                                {child.isActive ? 'نشط' : 'موقوف'}
                              </StatusLabel>
                            </td>
                            <td className="px-4 py-2.5 text-end">
                              <div className="inline-flex items-center gap-1">
                                <Button
                                  variant="ghost"
                                  onClick={() => openEditChild(child, root.id)}
                                >
                                  <Pencil className="size-3.5" aria-hidden />
                                  تعديل
                                </Button>
                                <Button
                                  variant="ghost"
                                  onClick={() => {
                                    setDeleting({
                                      id: child.id,
                                      name: child.name,
                                      slug: child.slug,
                                      description: child.description,
                                      parentId: root.id,
                                      sortOrder: child.sortOrder,
                                      isActive: child.isActive,
                                      hasChildren: false,
                                      productCount: child.directProductCount,
                                    })
                                    setActionError(null)
                                    deleteDialog.open()
                                  }}
                                  aria-label={`حذف ${child.name}`}
                                >
                                  <Trash2 className="size-3.5 text-bw-rose" aria-hidden />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))
                      : null}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      <Dialog
        dialogRef={formDialog.ref}
        title={editing ? `تعديل تصنيف: ${editing.name}` : 'إنشاء تصنيف جديد'}
        onClose={() => formDialog.close()}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => formDialog.close()}>
              إلغاء
            </Button>
            <Button type="submit" form="category-form" loading={busy}>
              {editing ? 'حفظ التعديلات' : 'إنشاء التصنيف'}
            </Button>
          </div>
        }
      >
        <form id="category-form" dir="rtl" onSubmit={saveCategory} className="space-y-4">
          {actionError ? (
            <p
              role="alert"
              className="rounded-bw-field border border-bw-rose/30 bg-bw-rose-soft p-3 text-bw-small text-bw-ink"
            >
              {actionError}
            </p>
          ) : null}
          <Field
            label="اسم التصنيف"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            minLength={2}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="المعرف (Slug - اختياري)"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              ltr
            />
            <Field
              label="ترتيب العرض"
              type="number"
              min={0}
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              ltr
            />
          </div>
          <Select
            label="التصنيف الأب (اختياري — مستوى فرعي)"
            value={parentId}
            disabled={Boolean(editing?.hasChildren)}
            onChange={(e) => setParentId(e.target.value)}
            options={[
              { value: '', label: 'تصنيف رئيسي (Root)' },
              ...categories
                .filter((root) => root.id !== editing?.id)
                .map((root) => ({ value: root.id, label: root.name })),
            ]}
          />
          {editing?.hasChildren ? (
            <p className="text-[11px] text-bw-ink-subtle">
              لا يمكن نقل تصنيف يحتوي على فروع أخرى داخل تصنيف آخر (الحد الأقصى مستويان).
            </p>
          ) : null}
          <div className="space-y-1.5">
            <label
              htmlFor="category-desc-field"
              className="block text-bw-small font-semibold text-bw-ink"
            >
              وصف التصنيف
            </label>
            <textarea
              id="category-desc-field"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-bw-field border border-bw-line-field bg-bw-surface p-3 text-bw-small text-bw-ink focus:border-bw-cobalt focus:outline-none"
            />
          </div>
          <Switch
            label="التصنيف نشط بالمتجر"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
        </form>
      </Dialog>

      <Dialog
        dialogRef={deleteDialog.ref}
        title="حذف التصنيف"
        onClose={() => deleteDialog.close()}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => deleteDialog.close()}>
              تراجع
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void confirmDelete()}>
              تأكيد الحذف
            </Button>
          </div>
        }
      >
        {deleting ? (
          <div dir="rtl" className="space-y-3 text-bw-small">
            <p className="text-bw-ink">
              هل تريد حذف التصنيف <strong>{deleting.name}</strong>؟
            </p>
            <p className="text-bw-ink-soft">
              يرفض الخادم حذف أي تصنيف مرتبط بمنتجات أو تصنيفات فرعية لحماية بيانات الكتالوج.
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

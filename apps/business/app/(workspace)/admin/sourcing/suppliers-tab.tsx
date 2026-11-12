'use client'

import * as React from 'react'
import { ChevronDown, History, Pencil, Plus, Power, Radio, Search } from 'lucide-react'
import { Button, Code, Dialog, Field, Skeleton, StateBlock, useDialog } from '@/components/bw/primitives'
import { CommandError } from '@/components/workspace/kit'
import { LoadError } from '@/components/workspace/role-shell'
import { api } from '@/lib/api'
import { formatDateTime } from '@/lib/labels'
import { useApi, useCommand } from '@/lib/use-api'
import { cn } from '@/lib/utils'
import {
  AUDIT_ACTION_TEXT,
  AuditEvent,
  BLOCKER_TEXT,
  SLUG_PATTERN,
  SupplierRow,
  WEEKDAYS,
  slugFromName,
  supplierHeadline,
  supplierState,
  workingDaysText,
} from './sourcing-model'
import { Dot, RowMenu } from './sourcing-ui'

const STATE_TEXT = {
  receiving: { text: 'يستقبل الطلبات', tone: 'ok' },
  not_ready: { text: 'غير جاهز', tone: 'warn' },
  inactive: { text: 'متوقف', tone: 'muted' },
} as const

export function SuppliersTab() {
  const { data, error, loading, reload } = useApi<SupplierRow[]>('/procurement/enrollment')
  const [query, setQuery] = React.useState('')
  const [openId, setOpenId] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [editing, setEditing] = React.useState<SupplierRow | null>(null)
  const [toggle, setToggle] = React.useState<{ supplier: SupplierRow; kind: 'enroll' | 'active' } | null>(null)
  const modal = useDialog()
  const reasonDialog = useDialog()

  const search = query.normalize('NFKC').trim().toLocaleLowerCase()
  const visible = (data ?? []).filter((s) => `${s.name} ${s.slug}`.normalize('NFKC').toLocaleLowerCase().includes(search))

  const openModal = (supplier: SupplierRow | null) => {
    setEditing(supplier)
    window.setTimeout(() => modal.open(), 0)
  }
  const done = (message: string) => {
    setNotice(message)
    reload()
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative min-w-40 flex-1 sm:max-w-sm">
          <span className="sr-only">بحث عن مورد</span>
          <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-bw-ink-subtle" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث باسم المورد"
            className="h-bw-control w-full rounded-bw-field border border-bw-line-field bg-bw-surface pe-3 ps-9 text-bw-small text-bw-ink placeholder:text-bw-ink-subtle focus:border-bw-cobalt focus:outline-none"
          />
        </label>
        <Button className="ms-auto" onClick={() => openModal(null)}>
          <Plus className="size-4" aria-hidden />
          إضافة مورد
        </Button>
      </div>

      {notice ? (
        <p role="status" className="flex items-center justify-between gap-3 rounded-bw-field border border-bw-emerald/30 bg-bw-emerald-soft px-3.5 py-2 text-bw-small text-bw-ink">
          {notice}
          <button type="button" className="text-bw-ink-soft underline" onClick={() => setNotice(null)}>إخفاء</button>
        </p>
      ) : null}

      {error ? <LoadError message={error.message} onRetry={reload} /> : null}
      {!data && loading ? <Skeleton className="h-48 w-full" /> : null}
      {data && data.length === 0 ? (
        <StateBlock kind="empty" title="لا يوجد موردون بعد" body="أضف أول مورد ليبدأ استقبال طلبات التوريد." action={<Button onClick={() => openModal(null)}><Plus className="size-4" aria-hidden />إضافة مورد</Button>} />
      ) : null}
      {data && data.length > 0 && visible.length === 0 ? <StateBlock kind="empty" title="لا يوجد مورد بهذا الاسم" body="جرّب جزءًا آخر من الاسم." /> : null}

      {visible.length > 0 ? (
        <ul className="divide-y divide-bw-line rounded-bw-card border border-bw-line bg-bw-surface">
          {visible.map((supplier) => (
            <SupplierItem
              key={supplier.id}
              supplier={supplier}
              open={openId === supplier.id}
              onToggleOpen={() => setOpenId(openId === supplier.id ? null : supplier.id)}
              onEdit={() => openModal(supplier)}
              onToggle={(kind) => {
                setToggle({ supplier, kind })
                window.setTimeout(() => reasonDialog.open(), 0)
              }}
            />
          ))}
        </ul>
      ) : null}

      <SupplierModal key={editing?.id ?? 'new'} dialogRef={modal.ref} supplier={editing} onClose={() => modal.close()} onSaved={(m) => { modal.close(); done(m) }} />
      <ReasonDialog dialogRef={reasonDialog.ref} target={toggle} onClose={() => reasonDialog.close()} onSaved={(m) => { reasonDialog.close(); done(m) }} />
    </div>
  )
}

function SupplierItem({ supplier, open, onToggleOpen, onEdit, onToggle }: {
  supplier: SupplierRow
  open: boolean
  onToggleOpen: () => void
  onEdit: () => void
  onToggle: (kind: 'enroll' | 'active') => void
}) {
  const state = STATE_TEXT[supplierState(supplier)]
  const headline = supplierHeadline(supplier)
  const panelId = `supplier-${supplier.id}`
  return (
    <li>
      <div className="flex items-center gap-2 px-2 py-1.5 sm:gap-3 sm:px-3">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggleOpen}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-bw-field px-2 py-2 text-start transition-colors hover:bg-bw-sunken"
        >
          <ChevronDown className={cn('size-4 shrink-0 text-bw-ink-subtle transition-transform', open ? 'rotate-180' : 'rtl:rotate-90 ltr:-rotate-90')} aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold text-bw-ink"><bdi>{supplier.name}</bdi></span>
            <span className="block text-[11px] text-bw-ink-subtle sm:hidden">{headline.text}</span>
          </span>
          <span className="hidden w-44 shrink-0 text-bw-small sm:block">
            <Dot tone={state.tone}>{state.text}</Dot>
          </span>
          <span className={cn('hidden w-64 shrink-0 truncate text-bw-small md:block', headline.tone === 'warn' ? 'text-bw-amber' : 'text-bw-ink-soft')}>
            {headline.text}
          </span>
          <span className="hidden w-28 shrink-0 text-bw-small text-bw-ink-soft lg:block">
            {supplier.openRequestCount + supplier.openCommitmentCount > 0 ? (
              <>مفتوح <Code>{supplier.openRequestCount + supplier.openCommitmentCount}</Code></>
            ) : '—'}
          </span>
        </button>
        <RowMenu
          label={`إجراءات ${supplier.name}`}
          actions={[
            { label: 'تعديل البيانات', icon: Pencil, onSelect: onEdit },
            { label: supplier.rfqEnrolledAt ? 'إيقاف الاشتراك في الطلبات' : 'الاشتراك في الطلبات', icon: Radio, onSelect: () => onToggle('enroll') },
            { label: supplier.isActive ? 'إيقاف المورد' : 'تفعيل المورد', icon: Power, tone: supplier.isActive ? 'danger' : 'default', onSelect: () => onToggle('active') },
          ]}
        />
      </div>
      {open ? <SupplierDetails id={panelId} supplier={supplier} /> : null}
    </li>
  )
}

function SupplierDetails({ id, supplier }: { id: string; supplier: SupplierRow }) {
  const [audit, setAudit] = React.useState<AuditEvent[] | null>(null)
  const loadAudit = useCommand(async () => setAudit(await api<AuditEvent[]>(`/procurement/enrollment/${supplier.id}/audit`)))
  const hours = supplier.opensAt && supplier.closesAt ? `${supplier.opensAt}–${supplier.closesAt}` : 'حسب الإعداد الافتراضي'
  return (
    <div id={id} className="space-y-3 border-t border-bw-line bg-bw-page/40 px-4 py-4 text-bw-small sm:ps-12">
      {supplier.readiness.blockers.length ? (
        <p className="text-bw-amber">
          ينقصه ليستقبل الطلبات: {supplier.readiness.blockers.map((code) => BLOCKER_TEXT[code] ?? code).join('، ')}
        </p>
      ) : null}
      <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
        <Detail label="معرّف المورد"><Code>{supplier.slug}</Code></Detail>
        <Detail label="حسابات الدخول"><Code>{supplier.accountCount}</Code></Detail>
        <Detail label="أيام العمل">{workingDaysText(supplier.closedWeekdays)}</Detail>
        <Detail label="ساعات العمل"><Code>{hours}</Code></Detail>
        <Detail label="مدة التجهيز والنقل">{supplier.pickupLeadMinutes === null ? 'تقدير تشغيلي' : <><Code>{supplier.pickupLeadMinutes}</Code> دقيقة</>}</Detail>
        <Detail label="نطاق المنتجات">{supplier.scope.length === 0 ? 'كل المنتجات' : <><Code>{supplier.scope.length}</Code> منتج محدد</>}</Detail>
        <Detail label="طلبات مفتوحة"><Code>{supplier.openRequestCount}</Code></Detail>
        <Detail label="أوامر شراء قائمة"><Code>{supplier.openCommitmentCount}</Code></Detail>
        {supplier.closedDates.length ? <Detail label="إجازات استثنائية"><Code>{supplier.closedDates.join('، ')}</Code></Detail> : null}
      </dl>
      <div>
        <Button variant="ghost" loading={loadAudit.pending} onClick={() => loadAudit.execute()}>
          <History className="size-4" aria-hidden />
          سجل التغييرات
        </Button>
        <CommandError error={loadAudit.error} />
        {audit ? (
          audit.length === 0 ? <p className="mt-2 text-bw-ink-soft">لا توجد تغييرات مسجلة.</p> : (
            <ul className="mt-2 space-y-1.5">
              {audit.slice(0, 8).map((event) => (
                <li key={event.id} className="text-bw-ink-soft">
                  <strong className="font-semibold text-bw-ink">{AUDIT_ACTION_TEXT[event.action] ?? event.action}</strong> · {formatDateTime(event.createdAt)}{event.reason ? ` · ${event.reason}` : ''}
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>
    </div>
  )
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="shrink-0 text-bw-ink-subtle">{label}</dt>
      <dd className="text-bw-ink">{children}</dd>
    </div>
  )
}

/* ── One compact modal for add and edit ───────────────────────────────────────────────────────── */

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

function SupplierModal({ dialogRef, supplier, onClose, onSaved }: {
  dialogRef: React.RefObject<HTMLDialogElement | null>
  supplier: SupplierRow | null
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const isEdit = supplier !== null
  const initial = React.useMemo(() => ({
    name: supplier?.name ?? '',
    slug: supplier?.slug ?? '',
    working: WEEKDAYS.map(([d]) => d).filter((d) => !(supplier?.closedWeekdays ?? [5]).includes(d)),
    opensAt: supplier?.opensAt ?? '',
    closesAt: supplier?.closesAt ?? '',
    pickup: supplier?.pickupLeadMinutes == null ? '' : String(supplier.pickupLeadMinutes),
    dates: (supplier?.closedDates ?? []).join('\n'),
    scope: (supplier?.scope ?? []).map((row) => row.label?.skuCode ?? '').filter(Boolean).join('\n'),
  }), [supplier])

  const [name, setName] = React.useState(initial.name)
  const [slug, setSlug] = React.useState(initial.slug)
  const [slugTouched, setSlugTouched] = React.useState(false)
  const [working, setWorking] = React.useState<number[]>(initial.working)
  const [opensAt, setOpensAt] = React.useState(initial.opensAt)
  const [closesAt, setClosesAt] = React.useState(initial.closesAt)
  const [pickup, setPickup] = React.useState(initial.pickup)
  const [dates, setDates] = React.useState(initial.dates)
  const [scope, setScope] = React.useState(initial.scope)
  const [reason, setReason] = React.useState(isEdit ? '' : 'تسجيل مورد جديد')

  const closedWeekdays = WEEKDAYS.map(([d]) => d).filter((d) => !working.includes(d))
  const dateList = dates.split(/\s+/).map((v) => v.trim()).filter(Boolean)
  const scopeList = scope.split(/\s+/).map((v) => v.trim()).filter(Boolean)
  const hoursOk = (opensAt === '') === (closesAt === '') && (opensAt === '' || (HHMM.test(opensAt) && HHMM.test(closesAt) && opensAt !== closesAt))
  const datesOk = dateList.every((v) => /^\d{4}-\d{2}-\d{2}$/.test(v))
  const pickupOk = pickup === '' || (Number.isInteger(Number(pickup)) && Number(pickup) >= 0 && Number(pickup) <= 10080)
  const slugOk = isEdit || SLUG_PATTERN.test(slug)

  const scheduleChanged =
    JSON.stringify([...closedWeekdays].sort()) !== JSON.stringify([...(supplier?.closedWeekdays ?? [5])].sort()) ||
    opensAt !== initial.opensAt || closesAt !== initial.closesAt || pickup !== initial.pickup ||
    dateList.join(' ') !== initial.dates.split(/\s+/).filter(Boolean).join(' ') ||
    scopeList.join(' ') !== initial.scope.split(/\s+/).filter(Boolean).join(' ')
  const nameChanged = isEdit && name.trim() !== initial.name
  const needsReason = !isEdit || scheduleChanged
  const reasonOk = !needsReason || reason.trim().length >= 5
  const canSave = name.trim().length > 0 && slugOk && hoursOk && datesOk && pickupOk && reasonOk && (!isEdit || nameChanged || scheduleChanged)

  const calendarBody = () => ({
    closedWeekdays,
    closedDates: dateList,
    ...(opensAt && closesAt ? { opensAt, closesAt, crossesMidnight: opensAt > closesAt } : {}),
    ...(pickup !== '' ? { pickupLeadMinutes: Number(pickup) } : {}),
    scopeSkuCodes: scopeList,
  })

  const save = useCommand(async () => {
    if (!supplier) {
      await api('/procurement/enrollment', { body: { name: name.trim(), slug, reason: reason.trim(), ...calendarBody() } })
      return `تمت إضافة المورد «${name.trim()}»`
    }
    // The enrollment endpoint does not rename; renaming goes through the supplier endpoint.
    if (nameChanged) await api(`/sourcing/suppliers/${supplier.id}`, { method: 'PATCH', body: { name: name.trim() } })
    if (scheduleChanged) await api(`/procurement/enrollment/${supplier.id}`, { method: 'PATCH', body: { ...calendarBody(), reason: reason.trim() } })
    return `تم حفظ بيانات «${name.trim()}»`
  })

  return (
    <Dialog
      dialogRef={dialogRef}
      title={isEdit ? 'تعديل المورد' : 'إضافة مورد'}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>إلغاء</Button>
          <Button type="submit" form="supplier-form" loading={save.pending} disabled={!canSave}>{isEdit ? 'حفظ' : 'إضافة المورد'}</Button>
        </>
      }
    >
      <form
        id="supplier-form"
        dir="rtl"
        className="space-y-4"
        onSubmit={async (event) => {
          event.preventDefault()
          if (!canSave) return
          const message = await save.execute()
          if (message) onSaved(message)
        }}
      >
        <Field
          label="اسم المورد"
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            if (!isEdit && !slugTouched) setSlug(slugFromName(e.target.value))
          }}
          autoFocus
          required
        />
        {!isEdit ? (
          <Field
            label="المعرّف (إنجليزي)"
            ltr
            value={slug}
            onChange={(e) => { setSlug(e.target.value); setSlugTouched(true) }}
            hint="حروف إنجليزية صغيرة وأرقام وشرطة، مثل al-nour"
            error={slug && !slugOk ? 'حروف إنجليزية صغيرة وأرقام وشرطة فقط' : undefined}
          />
        ) : null}

        <fieldset>
          <legend className="mb-1.5 text-bw-small font-semibold text-bw-ink">أيام العمل</legend>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAYS.map(([day, text]) => {
              const on = working.includes(day)
              return (
                <button
                  key={day}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setWorking(on ? working.filter((d) => d !== day) : [...working, day])}
                  className={cn(
                    'min-h-9 rounded-full border px-3 text-bw-small transition-colors',
                    on ? 'border-bw-cobalt bg-bw-cobalt-soft font-semibold text-bw-ink' : 'border-bw-line text-bw-ink-soft hover:bg-bw-sunken',
                  )}
                >
                  {text}
                </button>
              )
            })}
          </div>
        </fieldset>

        <div className="grid grid-cols-2 gap-3">
          <Field label="يفتح الساعة" type="time" ltr value={opensAt} onChange={(e) => setOpensAt(e.target.value)} />
          <Field label="يقفل الساعة" type="time" ltr value={closesAt} onChange={(e) => setClosesAt(e.target.value)} error={!hoursOk ? 'اكتب الميعادين معًا وبقيمتين مختلفتين' : undefined} />
        </div>

        <details className="group rounded-bw-field border border-bw-line">
          <summary className="flex min-h-bw-control cursor-pointer list-none items-center justify-between px-3 text-bw-small font-semibold text-bw-ink-soft">
            خيارات إضافية
            <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <div className="space-y-3 border-t border-bw-line p-3">
            <Field label="مدة التجهيز والنقل (دقيقة)" type="number" ltr min={0} max={10080} value={pickup} onChange={(e) => setPickup(e.target.value)} hint="اتركها فارغة لاستخدام التقدير التشغيلي" error={!pickupOk ? 'رقم صحيح من 0 إلى 10080' : undefined} />
            <TextBlock label="إجازات استثنائية (تاريخ في كل سطر، YYYY-MM-DD)" value={dates} onChange={setDates} error={!datesOk ? 'استخدم الصيغة YYYY-MM-DD' : undefined} />
            <TextBlock label="نطاق المنتجات (كود SKU أو باركود في كل سطر، فارغ = كل المنتجات)" value={scope} onChange={setScope} />
          </div>
        </details>

        {needsReason ? (
          <Field label="سبب التغيير (يُسجَّل)" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثال: تعديل مواعيد العمل" error={reason.length > 0 && !reasonOk ? '5 أحرف على الأقل' : undefined} />
        ) : null}
        <CommandError error={save.error} />
      </form>
    </Dialog>
  )
}

function TextBlock({ label, value, onChange, error }: { label: string; value: string; onChange: (value: string) => void; error?: string }) {
  const id = React.useId()
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-bw-small font-semibold text-bw-ink">{label}</label>
      <textarea
        id={id}
        rows={3}
        dir="ltr"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-bw-field border border-bw-line-field bg-bw-surface p-3 text-bw-small text-bw-ink focus:border-bw-action focus:outline-none"
      />
      {error ? <p className="text-bw-small text-bw-danger">{error}</p> : null}
    </div>
  )
}

/* ── Participation changes: one field (the audited reason) and the consequence in words ───────── */

function ReasonDialog({ dialogRef, target, onClose, onSaved }: {
  dialogRef: React.RefObject<HTMLDialogElement | null>
  target: { supplier: SupplierRow; kind: 'enroll' | 'active' } | null
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const [reason, setReason] = React.useState('')
  React.useEffect(() => setReason(''), [target])
  const supplier = target?.supplier
  const enrollNext = supplier ? !supplier.rfqEnrolledAt : false
  const activeNext = supplier ? !supplier.isActive : false
  const copy = !target || !supplier ? null : target.kind === 'enroll'
    ? {
        title: enrollNext ? 'الاشتراك في طلبات التوريد' : 'إيقاف الاشتراك في الطلبات',
        body: enrollNext
          ? `«${supplier.name}» سيستقبل طلبات التوريد القادمة.`
          : `«${supplier.name}» لن يستقبل طلبات جديدة، وتنتقل طلباته المفتوحة إلى موردين آخرين. أوامر الشراء المؤكدة لا تتغير.`,
        done: enrollNext ? 'تم اشتراك المورد في الطلبات' : 'تم إيقاف اشتراك المورد وانتقلت طلباته المفتوحة',
        body_: { rfqEnrolled: enrollNext },
        danger: !enrollNext,
      }
    : {
        title: activeNext ? 'تفعيل المورد' : 'إيقاف المورد',
        body: activeNext ? `«${supplier.name}» سيعود نشطًا.` : `«${supplier.name}» سيتوقف، وتنتقل طلباته المفتوحة إلى موردين آخرين. أوامر الشراء المؤكدة لا تتغير.`,
        done: activeNext ? 'تم تفعيل المورد' : 'تم إيقاف المورد',
        body_: { isActive: activeNext },
        danger: !activeNext,
      }
  const run = useCommand(async () => {
    if (!supplier || !copy) return null
    await api(`/procurement/enrollment/${supplier.id}`, { method: 'PATCH', body: { ...copy.body_, reason: reason.trim() } })
    return copy.done
  })
  return (
    <Dialog
      dialogRef={dialogRef}
      title={copy?.title ?? ''}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>إلغاء</Button>
          <Button type="submit" form="reason-form" variant={copy?.danger ? 'danger' : 'primary'} loading={run.pending} disabled={reason.trim().length < 5}>تأكيد</Button>
        </>
      }
    >
      <form
        id="reason-form"
        dir="rtl"
        className="space-y-4"
        onSubmit={async (event) => {
          event.preventDefault()
          const message = await run.execute()
          if (message) onSaved(message)
        }}
      >
        <p className="text-bw-small text-bw-ink-soft">{copy?.body}</p>
        <Field label="السبب (يُسجَّل)" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        <CommandError error={run.error} />
      </form>
    </Dialog>
  )
}

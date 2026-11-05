'use client'

import * as React from 'react'
import { Button, Code, Field, Notice, PageHeader, Section, Skeleton, StateBlock, StatusLabel } from '@/components/bw/primitives'
import { CommandError, Page, TextArea } from '@/components/workspace/kit'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { api } from '@/lib/api'
import { formatDateTime } from '@/lib/labels'
import { useApi, useCommand } from '@/lib/use-api'

interface EnrolledSupplier {
  id: string; name: string; slug: string; isActive: boolean; rfqEnrolledAt: string | null
  closedWeekdays: number[]; closedDates: string[]; opensAt: string | null; closesAt: string | null; pickupLeadMinutes: number | null
  scope: Array<{ skuId: string; label: { productName: string; variantName: string; skuCode: string } | null }>
  accountCount: number; openRequestCount: number; openCommitmentCount: number
  readiness: { ready: boolean; blockers: string[] }
}
interface AuditEvent { id: string; action: string; actorId: string; reason: string | null; createdAt: string; before: unknown; after: unknown }

const WEEKDAYS: Array<[number, string]> = [[6, 'السبت'], [0, 'الأحد'], [1, 'الإثنين'], [2, 'الثلاثاء'], [3, 'الأربعاء'], [4, 'الخميس'], [5, 'الجمعة']]
const BLOCKERS: Record<string, string> = {
  INACTIVE: 'المورد متوقف', NOT_ENROLLED: 'مش مشترك في طلبات التوريد', NO_SUPPLIER_ACCOUNT: 'مفيش حساب دخول مربوط بالمورد', NO_WORKING_DAYS: 'كل أيام الأسبوع إجازة',
}
const ACTIONS: Record<string, string> = {
  REGISTERED: 'تسجيل المورد', ENROLLED: 'اشتراك في الطلبات', WITHDRAWN: 'إيقاف الاشتراك', ACTIVATED: 'تفعيل', DEACTIVATED: 'إيقاف',
  SCOPE_CHANGED: 'تغيير نطاق المنتجات', CALENDAR_CHANGED: 'تغيير المواعيد', DETAILS_CHANGED: 'تغيير البيانات',
}

/** Who receives supplier requests. Every change needs a reason and applies to future requests; awarded purchase orders never change. */
export default function SupplierEnrollmentPage() {
  const { data, error, loading, reload } = useApi<EnrolledSupplier[]>('/procurement/enrollment')
  return (
    <RoleShell role="admin" active="enrollment" mode="desktop">
      <Page>
        <PageHeader title="مشاركة الموردين في طلبات التوريد" meta="التغيير بيأثر على الطلبات الجاية. أوامر الشراء اللي اتأكدت بتفضل ملزمة زي ما هي." />
        <RegisterSupplier onDone={reload} />
        {error ? <LoadError message={error.message} onRetry={reload} /> : null}
        {!data && loading ? <Skeleton className="h-40 w-full" /> : null}
        {data && data.length === 0 ? <StateBlock kind="empty" title="مفيش موردين مسجلين" body="سجّل أول مورد من النموذج اللي فوق." /> : null}
        {(data ?? []).map((supplier) => <SupplierRow key={`${supplier.id}-${supplier.rfqEnrolledAt}-${supplier.isActive}`} supplier={supplier} onSaved={reload} />)}
      </Page>
    </RoleShell>
  )
}

function RegisterSupplier({ onDone }: { onDone: () => void }) {
  const [name, setName] = React.useState('')
  const [slug, setSlug] = React.useState('')
  const [reason, setReason] = React.useState('')
  const slugOk = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)
  const register = useCommand(() => api('/procurement/enrollment', { body: { name: name.trim(), slug, reason: reason.trim() } }))
  return (
    <Section title="تسجيل مورد جديد">
      <form className="grid gap-3 md:grid-cols-4 md:items-end" onSubmit={async (e) => {
        e.preventDefault()
        if (await register.execute()) { setName(''); setSlug(''); setReason(''); onDone() }
      }}>
        <Field label="اسم المورد" value={name} onChange={(e) => setName(e.target.value)} />
        <Field label="المعرّف (حروف إنجليزية صغيرة)" ltr value={slug} onChange={(e) => setSlug(e.target.value)} error={slug && !slugOk ? 'حروف إنجليزية صغيرة وأرقام وشرطة فقط' : undefined} />
        <Field label="سبب التسجيل" value={reason} onChange={(e) => setReason(e.target.value)} />
        <Button type="submit" loading={register.pending} disabled={!name.trim() || !slugOk || reason.trim().length < 5}>تسجيل</Button>
      </form>
      <CommandError error={register.error} />
    </Section>
  )
}

function SupplierRow({ supplier, onSaved }: { supplier: EnrolledSupplier; onSaved: () => void }) {
  const [closed, setClosed] = React.useState<number[]>(supplier.closedWeekdays)
  const [closedDates, setClosedDates] = React.useState(supplier.closedDates.join('\n'))
  const [opensAt, setOpensAt] = React.useState(supplier.opensAt ?? '')
  const [closesAt, setClosesAt] = React.useState(supplier.closesAt ?? '')
  const [scope, setScope] = React.useState(supplier.scope.map((row) => row.label?.skuCode ?? '').filter(Boolean).join('\n'))
  const [reason, setReason] = React.useState('')
  const [audit, setAudit] = React.useState<AuditEvent[] | null>(null)
  const [saved, setSaved] = React.useState<string | null>(null)
  const reasonOk = reason.trim().length >= 5
  const dates = closedDates.split(/\s+/).map((v) => v.trim()).filter(Boolean)
  const datesOk = dates.every((v) => /^\d{4}-\d{2}-\d{2}$/.test(v))
  const hoursOk = (opensAt === '') === (closesAt === '') && (opensAt === '' || opensAt !== closesAt)

  const participation = useCommand((body: Record<string, unknown>) => api(`/procurement/enrollment/${supplier.id}`, { method: 'PATCH', body: { ...body, reason: reason.trim() } }))
  const saveDetails = useCommand(() => api(`/procurement/enrollment/${supplier.id}`, { method: 'PATCH', body: {
    closedWeekdays: [...closed].sort((a, b) => a - b), closedDates: dates,
    ...(opensAt && closesAt ? { opensAt, closesAt, crossesMidnight: opensAt > closesAt } : {}),
    scopeSkuCodes: scope.split(/\s+/).map((v) => v.trim()).filter(Boolean), reason: reason.trim(),
  } }))
  const loadAudit = useCommand(async () => setAudit(await api<AuditEvent[]>(`/procurement/enrollment/${supplier.id}/audit`)))

  const afterChange = (message: string) => { setSaved(message); setReason(''); onSaved() }

  return (
    <Section title={<span className="flex flex-wrap items-center gap-2">{supplier.name}
      {supplier.readiness.ready ? <StatusLabel tone="ok">جاهز يستقبل طلبات</StatusLabel> : <StatusLabel tone="warn">مش جاهز</StatusLabel>}</span>}
      aside={<span className="text-bw-small text-bw-ink-soft">طلبات مفتوحة <Code>{supplier.openRequestCount}</Code> · أوامر شراء قائمة <Code>{supplier.openCommitmentCount}</Code> · حسابات <Code>{supplier.accountCount}</Code></span>}>
      <div className="space-y-4">
        {supplier.readiness.blockers.length ? (
          <Notice tone="warn" title="اللي ناقص عشان يستقبل طلبات">
            <ul className="list-disc ps-5">{supplier.readiness.blockers.map((code) => <li key={code}>{BLOCKERS[code] ?? code}</li>)}</ul>
          </Notice>
        ) : null}
        {saved ? <Notice tone="ok" title={saved} /> : null}
        <form className="grid gap-3 md:grid-cols-2" onSubmit={async (e) => { e.preventDefault(); if (reasonOk && datesOk && hoursOk && await saveDetails.execute()) afterChange('اتحفظ نطاق المنتجات والمواعيد') }}>
          <fieldset className="flex flex-wrap gap-3 text-bw-small md:col-span-2">
            <legend className="mb-1 font-semibold">أيام الإجازة</legend>
            {WEEKDAYS.map(([day, text]) => (
              <label key={day} className="flex items-center gap-1">
                <input type="checkbox" checked={closed.includes(day)} onChange={(e) => setClosed(e.target.checked ? [...closed, day] : closed.filter((d) => d !== day))} />
                {text}
              </label>
            ))}
          </fieldset>
          <Field label="بيفتح الساعة" type="time" ltr value={opensAt} onChange={(e) => setOpensAt(e.target.value)} />
          <Field label="بيقفل الساعة" type="time" ltr value={closesAt} onChange={(e) => setClosesAt(e.target.value)} error={!hoursOk ? 'اكتب الميعادين مع بعض، وميكنوش زي بعض' : undefined} />
          <TextArea label="إجازات استثنائية (تاريخ في كل سطر YYYY-MM-DD)" value={closedDates} onChange={setClosedDates} rows={3} />
          <TextArea label="نطاق المنتجات: كود SKU أو باركود في كل سطر. فاضي يعني كل المنتجات" value={scope} onChange={setScope} rows={3} />
          <Field className="md:col-span-2" label="سبب التغيير (بيتسجل في السجل)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex flex-wrap items-center gap-2 md:col-span-2">
            <Button type="submit" loading={saveDetails.pending} disabled={!reasonOk || !datesOk || !hoursOk}>حفظ النطاق والمواعيد</Button>
            <Button type="button" variant="secondary" loading={participation.pending} disabled={!reasonOk}
              onClick={async () => { const enroll = !supplier.rfqEnrolledAt; if (await participation.execute({ rfqEnrolled: enroll })) afterChange(enroll ? 'المورد اشترك في طلبات التوريد' : 'اتوقف اشتراك المورد. طلباته المفتوحة راحت لموردين تانيين') }}>
              {supplier.rfqEnrolledAt ? 'إيقاف الاشتراك في الطلبات' : 'اشتراك في الطلبات'}
            </Button>
            <Button type="button" variant="secondary" loading={participation.pending} disabled={!reasonOk}
              onClick={async () => { const activate = !supplier.isActive; if (await participation.execute({ isActive: activate })) afterChange(activate ? 'المورد اتفعّل' : 'المورد اتوقف') }}>
              {supplier.isActive ? 'إيقاف المورد' : 'تفعيل المورد'}
            </Button>
            <Button type="button" variant="ghost" loading={loadAudit.pending} onClick={() => loadAudit.execute()}>سجل التغييرات</Button>
          </div>
        </form>
        <CommandError error={saveDetails.error ?? participation.error ?? loadAudit.error} />
        {audit ? (
          audit.length === 0 ? <p className="text-bw-small text-bw-ink-soft">لسه مفيش تغييرات مسجلة.</p> : (
            <ul className="space-y-2 border-t border-bw-line pt-3 text-bw-small">
              {audit.map((event) => (
                <li key={event.id}><strong>{ACTIONS[event.action] ?? event.action}</strong> · {formatDateTime(event.createdAt)}{event.reason ? ` · ${event.reason}` : ''} · <Code>{event.actorId.slice(0, 8)}</Code></li>
              ))}
            </ul>
          )
        ) : null}
      </div>
    </Section>
  )
}

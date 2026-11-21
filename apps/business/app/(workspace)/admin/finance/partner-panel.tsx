'use client'

import * as React from 'react'
import { Ban, HandCoins, UserPlus } from 'lucide-react'
import { Button, Field, Skeleton, StateBlock, StatusLabel } from '@/components/bw/primitives'
import { PanelHead } from '@/components/bw/ops'
import { CommandError, Egp, Select } from '@/components/workspace/kit'
import { LoadError } from '@/components/workspace/role-shell'
import { api } from '@/lib/api'
import { useApi, useCommand } from '@/lib/use-api'
import { cn } from '@/lib/utils'

type Settlement = 'PENDING' | 'NO_PROFIT' | 'UNSETTLED' | 'DUE' | 'PARTIAL' | 'PAID'
interface Profile {
  partner: { id: string; displayName: string; accountEmail: string | null; accountActive: boolean; since: string } | null
  balances?: { funded: number; returned: number; outstanding: number; truncated: boolean; since: string | null }
  months?: Array<{ period: string; status: 'COMPLETE' | 'INCOMPLETE'; settlement: Settlement; partnerShare: number | null; paid: number; payableNow: number | null }>
}
interface Entry { id: string; kind: 'CAPITAL_RETURN' | 'PROFIT_PAYOUT'; amount: number; paidOn: string; period: string | null; reference: string; note: string | null; voided: boolean; voidReason: string | null }
interface Staff { id: string; name: string; email: string; roles: string[]; isActive: boolean }

const settlementText: Record<Settlement, string> = { PENDING: 'معلق', NO_PROFIT: 'لا ربح', UNSETTLED: 'غير مسوّى', DUE: 'مستحق', PARTIAL: 'مدفوع جزئيًا', PAID: 'مدفوع' }
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' })
const kindText = { CAPITAL_RETURN: 'استرداد رأس مال', PROFIT_PAYOUT: 'صرف أرباح' } as const

function useModal() {
  const ref = React.useRef<HTMLDialogElement>(null)
  React.useEffect(() => { const node = ref.current; if (node && !node.open) node.showModal(); return () => { if (node?.open) node.close() } }, [])
  return ref
}

function DesignateDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const ref = useModal()
  const staff = useApi<Staff[]>('/operations/staff?role=CAPITAL_PARTNER&isActive=true')
  const [accountId, setAccountId] = React.useState('')
  const [displayName, setDisplayName] = React.useState('')
  const save = useCommand(() => api('/operations/finance/capital-partner', { method: 'PUT', body: { accountId, displayName: displayName.trim() } }))
  const options: Array<[string, string]> = [['', 'اختر الحساب'], ...(staff.data ?? []).filter((person) => !person.roles.includes('ADMIN')).map((person): [string, string] => [person.id, `${person.name} · ${person.email}`])]
  return (
    <dialog ref={ref} onCancel={(e) => { e.preventDefault(); onClose() }} aria-labelledby="designate-title" className="bw-glass-raised fixed inset-0 z-50 m-auto max-h-[90dvh] w-[min(30rem,calc(100vw-2rem))] overflow-y-auto rounded-bw-card p-0 text-bw-ink backdrop:bg-bw-kohl/60">
      <form className="space-y-4 p-5" onSubmit={async (e) => { e.preventDefault(); if (await save.execute()) onSaved() }}>
        <h2 id="designate-title" className="text-bw-heading font-semibold">تعيين شريك رأس المال</h2>
        {staff.error ? <LoadError message={staff.error.message} onRetry={staff.reload} /> : null}
        {staff.data && staff.data.length === 0 ? <p className="text-bw-small text-bw-ink-soft">مفيش حساب بدور «شريك رأس المال». أنشئه من صفحة الفريق الأول.</p> : null}
        <Select label="الحساب" value={accountId} onChange={(value) => { setAccountId(value); const person = staff.data?.find((p) => p.id === value); if (person && !displayName) setDisplayName(person.name) }} options={options} />
        <Field label="الاسم الظاهر للشريك" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        <p className="text-[12px] text-bw-ink-subtle">في النسخة الأولى فيه شريك رأس مال واحد. الشريك بيقرأ بياناته بس ومابيقدرش يعدّل أي رقم.</p>
        <CommandError error={save.error} />
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>إلغاء</Button><Button type="submit" loading={save.pending} disabled={!accountId || displayName.trim().length < 2}>تعيين</Button></div>
      </form>
    </dialog>
  )
}

function PaymentDialog({ profile, onClose, onSaved }: { profile: Profile; onClose: () => void; onSaved: () => void }) {
  const ref = useModal()
  const [kind, setKind] = React.useState<'PROFIT_PAYOUT' | 'CAPITAL_RETURN'>('PROFIT_PAYOUT')
  const payable = (profile.months ?? []).filter((month) => month.status === 'COMPLETE' && (month.payableNow ?? 0) > 0)
  const [period, setPeriod] = React.useState(payable[0]?.period ?? '')
  const [amount, setAmount] = React.useState('')
  const [paidOn, setPaidOn] = React.useState(today())
  const [reference, setReference] = React.useState('')
  const [note, setNote] = React.useState('')
  // One key per dialog: a double click or a retry after a timeout can never pay twice.
  const [key] = React.useState(() => crypto.randomUUID())
  const month = (profile.months ?? []).find((item) => item.period === period)
  const room = kind === 'PROFIT_PAYOUT' ? month?.payableNow ?? 0 : profile.balances?.outstanding ?? 0
  const save = useCommand(() => api('/operations/finance/capital-partner/entries', { body: { kind, amount: Number(amount), paidOn, reference: reference.trim(), ...(note.trim() ? { note: note.trim() } : {}), ...(kind === 'PROFIT_PAYOUT' ? { period } : {}), idempotencyKey: key } }))
  const invalid = !(Number(amount) > 0) || Number(amount) > room || reference.trim().length < 2 || (kind === 'PROFIT_PAYOUT' && !period)
  return (
    <dialog ref={ref} onCancel={(e) => { e.preventDefault(); onClose() }} aria-labelledby="payment-title" className="bw-glass-raised fixed inset-0 z-50 m-auto max-h-[90dvh] w-[min(30rem,calc(100vw-2rem))] overflow-y-auto rounded-bw-card p-0 text-bw-ink backdrop:bg-bw-kohl/60">
      <form className="space-y-4 p-5" onSubmit={async (e) => { e.preventDefault(); if (await save.execute()) onSaved() }}>
        <h2 id="payment-title" className="text-bw-heading font-semibold">تسجيل دفعة للشريك</h2>
        <Select label="نوع الدفعة" value={kind} onChange={(value) => { setKind(value as typeof kind); setAmount('') }} options={[['PROFIT_PAYOUT', 'صرف أرباح (حصة شهر)'], ['CAPITAL_RETURN', 'استرداد رأس مال (مش ربح)']]} />
        {kind === 'PROFIT_PAYOUT' ? (
          payable.length ? <Select label="الشهر" value={period} onChange={setPeriod} options={payable.map((item): [string, string] => [item.period, `${item.period} · المتاح ${item.payableNow?.toLocaleString('en-US')} ج.م`])} />
            : <p className="text-bw-small text-bw-ink-soft">مفيش شهر فيه حصة جاهزة للصرف دلوقتي (محتاج تكاليف مكتملة وكاش اتعدّ).</p>
        ) : null}
        <p className="text-[12px] text-bw-ink-subtle">{kind === 'PROFIT_PAYOUT' ? 'الحد الأقصى: حصة الشريك من كاش اتعدّ ناقص اللي اتدفع.' : 'الحد الأقصى: رأس المال اللي لسه ماترجعش.'} المتاح: <bdi className="bw-code font-semibold">{room.toLocaleString('en-US')}</bdi> ج.م</p>
        <Field label="المبلغ بالجنيه" type="number" min="0.01" step="0.01" max={room || undefined} value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Field label="تاريخ الدفع" type="date" max={today()} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
        <Field label="المرجع (رقم التحويل أو الإيصال)" value={reference} onChange={(e) => setReference(e.target.value)} />
        <Field label="ملاحظة (اختياري)" value={note} onChange={(e) => setNote(e.target.value)} />
        <p className="text-[12px] text-bw-ink-subtle">التسجيل بيثبّت إن الدفع حصل فعلًا. مفيش تحويل بيتم من النظام، والتصحيح بيكون بالإلغاء مع السبب.</p>
        <CommandError error={save.error} />
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>إلغاء</Button><Button type="submit" loading={save.pending} disabled={invalid}>تسجيل الدفعة</Button></div>
      </form>
    </dialog>
  )
}

function VoidButton({ entry, onDone }: { entry: Entry; onDone: () => void }) {
  const [open, setOpen] = React.useState(false)
  const [reason, setReason] = React.useState('')
  const run = useCommand(() => api(`/operations/finance/capital-partner/entries/${entry.id}/void`, { body: { reason: reason.trim() } }))
  if (!open) return <Button size="sm" variant="secondary" onClick={() => setOpen(true)}><Ban className="size-4" aria-hidden />إلغاء</Button>
  return (
    <span className="flex flex-wrap items-end gap-2">
      <Field label="سبب الإلغاء" value={reason} onChange={(e) => setReason(e.target.value)} />
      <Button size="sm" loading={run.pending} disabled={reason.trim().length < 3} onClick={async () => { if (await run.execute()) onDone() }}>تأكيد الإلغاء</Button>
      <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>رجوع</Button>
      <CommandError error={run.error} />
    </span>
  )
}

/** Admin: who the capital partner is, what was paid to them, and the one place a payment is recorded. */
export function PartnerPanel() {
  const profile = useApi<Profile>('/operations/finance/capital-partner')
  const entries = useApi<Entry[]>('/operations/finance/capital-partner/entries?limit=30')
  const [dialog, setDialog] = React.useState<'designate' | 'payment' | null>(null)
  const reload = () => { profile.reload(); entries.reload() }
  const p = profile.data

  return (
    <section aria-label="شريك رأس المال" className="bw-panel">
      <PanelHead
        title="شريك رأس المال"
        aside={p?.partner
          ? <Button size="sm" variant="secondary" onClick={() => setDialog('payment')}><HandCoins className="size-4" aria-hidden />تسجيل دفعة</Button>
          : <Button size="sm" variant="secondary" onClick={() => setDialog('designate')}><UserPlus className="size-4" aria-hidden />تعيين الشريك</Button>}
      />
      {profile.error ? <LoadError message={profile.error.message} onRetry={profile.reload} /> : null}
      {!p && profile.loading ? <div className="p-4"><Skeleton className="h-20 w-full" /></div> : null}
      {p && !p.partner ? <StateBlock kind="empty" title="لسه مفيش شريك رأس مال" body="أنشئ حساب بدور «شريك رأس المال» من صفحة الفريق، وبعدين عيّنه هنا. الشريك بيشوف بياناته المالية بس." /> : null}
      {p?.partner ? <>
        <dl className="grid divide-y divide-bw-line text-bw-small sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4">
          <div className="px-4 py-2.5"><dt className="text-bw-ink-soft">الشريك</dt><dd className="font-semibold text-bw-ink">{p.partner.displayName}</dd><dd className="text-[11px] text-bw-ink-subtle" dir="ltr">{p.partner.accountEmail}</dd></div>
          <div className="px-4 py-2.5"><dt className="text-bw-ink-soft">رأس المال الممول (الإجمالي)</dt><dd><Egp value={p.balances?.funded} className="font-semibold text-bw-ink" /></dd></div>
          <div className="px-4 py-2.5"><dt className="text-bw-ink-soft">استرداد رأس مال مدفوع</dt><dd><Egp value={p.balances?.returned} className="font-semibold text-bw-ink" /></dd></div>
          <div className="px-4 py-2.5"><dt className="text-bw-ink-soft">لسه ماترجعش</dt><dd><Egp value={p.balances?.outstanding} className="font-semibold text-bw-ink" /></dd></div>
        </dl>
        {p.balances?.truncated ? <p className="border-t border-bw-line px-4 py-2 text-[12px] text-bw-ink-subtle">الإجمالي محسوب لآخر 36 شهر بس.</p> : null}
        <div className="overflow-x-auto border-t border-bw-line">
          <table className="w-full min-w-[34rem] border-collapse text-start text-bw-small">
            <caption className="sr-only">حصة الشريك لكل شهر</caption>
            <thead className="bg-bw-sunken/40 text-[11px] text-bw-ink-subtle"><tr>{['الشهر', 'حصة الشريك', 'مدفوع', 'جاهز للصرف', 'الحالة'].map((h) => <th key={h} scope="col" className="px-4 py-2 text-start font-semibold">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-bw-line [&_td]:px-4 [&_td]:py-2.5">
              {(p.months ?? []).map((month) => (
                <tr key={month.period}><td className="font-semibold"><bdi className="bw-code">{month.period}</bdi></td><td><Egp value={month.partnerShare} /></td><td><Egp value={month.paid} /></td><td><Egp value={month.payableNow} /></td>
                  <td><StatusLabel tone={month.settlement === 'PAID' ? 'ok' : month.settlement === 'PENDING' ? 'pending' : month.settlement === 'UNSETTLED' ? 'warn' : 'info'}>{settlementText[month.settlement]}</StatusLabel></td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-bw-line">
          <h3 className="px-4 pt-3 text-bw-small font-semibold">آخر المدفوعات</h3>
          {entries.error ? <LoadError message={entries.error.message} onRetry={entries.reload} /> : null}
          {entries.data?.length === 0 ? <p className="px-4 py-3 text-bw-small text-bw-ink-soft">مفيش مدفوعات مسجّلة لسه.</p> : null}
          <ul className="divide-y divide-bw-line">
            {(entries.data ?? []).map((entry) => (
              <li key={entry.id} className={cn('flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-bw-small', entry.voided && 'text-bw-ink-subtle')}>
                <span className="min-w-0"><span className={cn('font-semibold', !entry.voided && 'text-bw-ink')}>{kindText[entry.kind]}{entry.period ? ` · ${entry.period}` : ''}</span><span className="ms-2 text-[12px]">{entry.paidOn} · <bdi className="bw-code">{entry.reference}</bdi>{entry.voided ? ` · ملغي: ${entry.voidReason}` : ''}</span></span>
                <span className="flex items-center gap-3"><Egp value={entry.amount} className={cn('font-semibold', entry.voided && 'line-through')} />{!entry.voided ? <VoidButton entry={entry} onDone={reload} /> : null}</span>
              </li>
            ))}
          </ul>
        </div>
      </> : null}
      {dialog === 'designate' ? <DesignateDialog onClose={() => setDialog(null)} onSaved={() => { setDialog(null); reload() }} /> : null}
      {dialog === 'payment' && p ? <PaymentDialog profile={p} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); reload() }} /> : null}
    </section>
  )
}

'use client'

import * as React from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronLeft, ChevronRight, Lock, Plus, RefreshCw, TriangleAlert, X } from 'lucide-react'
import { Button, Code, Field, PageHeader, Skeleton, StateBlock } from '@/components/bw/primitives'
import { PanelHead, Stat, StatStrip } from '@/components/bw/ops'
import { MonthlyBars } from '@/components/bw/monthly-bars'
import { CommandError, Egp, Page, Select } from '@/components/workspace/kit'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { api } from '@/lib/api'
import { useApi, useCommand } from '@/lib/use-api'
import { PartnerPanel } from './partner-panel'
import { cn } from '@/lib/utils'

type MissingCode = 'PURCHASE_COST' | 'COURIER_COST' | 'PACKAGING_COST' | 'DIRECT_COST_APPROVAL'
type Amount = { amount: number; orders: number }
type Profit = {
  period: string; status: 'COMPLETE' | 'INCOMPLETE'; eligibleOrders: number
  missing: Array<{ code: MissingCode; orders: number }>
  revenue: { grossSales: number; discounts: number; netSales: number; productRefunds: number; netSalesAfterRefunds: number; shippingRevenue: number; deliveryFeeRefunds: number; shippingRevenueNet: number; total: number }
  costs: { products: number; delivery: number; packaging: number; damages: number; directCosts: number; total: number }
  delivery: { revenue: number; cost: number; margin: number; estimatedOrders: number; estimatedAmount: number }
  grossProfit: number | null; distributableProfit: number | null; realisedProfit: number | null
  pendingCollection: { orders: number; profit: number | null }
  split: { platformPercent: number; platformShare: number | null; partnerShare: number | null; platformShareNow: number | null; partnerShareNow: number | null }
  capital: { recovered: number; tiedUpInUnsettledOrders: number; tiedUpInRecoverableGoods: number; recoverableUnknownOrders?: number }
  platformExpenses: number
  closed: { at: string; by: string } | null; monthEnded?: boolean
  needsCost: Array<{ orderId: string; orderNumber: string; missing: string[] }>
  cash: { expectedOnRoad: Amount; inCourierCustody: Amount; disputed: Amount; settlements: { count: number; counted: number; declared: number; variance: number; fees: number } }
}
type Trend = { points: Array<{ period: string; status: 'COMPLETE' | 'INCOMPLETE'; closed: boolean; revenue: number; costs: number; distributableProfit: number | null; platformShare: number | null }> }
type Expense = { id: string; category: string; description: string; amount: number; incurredOn: string; recurrence: string; endsOn: string | null; kind: 'DIRECT' | 'PLATFORM'; approved: boolean; voided: boolean }

const cairoToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' })
const today = cairoToday()
const thisMonth = today.slice(0, 7)
const categoryName: Record<string, string> = { RENT: 'إيجار', UTILITIES: 'مرافق', MARKETING: 'تسويق', PACKAGING: 'تغليف', DELIVERY: 'توصيل', SOFTWARE: 'برمجيات', SUPPLIES: 'مستلزمات', OTHER: 'أخرى' }
const money = (n: number | null | undefined) => n == null ? '—' : `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} ج.م`
const shiftMonth = (period: string, delta: number) => {
  const [y, m] = period.split('-').map(Number)
  const index = y * 12 + (m - 1) + delta
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`
}
const monthName = (period: string, style: 'long' | 'short' = 'long') => new Date(`${period}-15T12:00:00Z`).toLocaleDateString('ar-EG-u-nu-latn', { month: style, year: style === 'long' ? 'numeric' : undefined, timeZone: 'UTC' })

const MISSING_TEXT: Record<MissingCode, string> = {
  PURCHASE_COST: 'طلب بلا تكلفة شراء مسجّلة',
  COURIER_COST: 'طلب بلا تكلفة توصيل (لا فعلية ولا تقديرية من عرض السعر)',
  PACKAGING_COST: 'طلب بلا نوع تغليف',
  DIRECT_COST_APPROVAL: 'تكلفة مباشرة مسجّلة وتنتظر اعتماد الأدمن',
}

export default function FinancePage() {
  const [month, setMonth] = React.useState(thisMonth)
  const profit = useApi<Profit>(`/operations/finance/profit?month=${month}`)
  const trend = useApi<Trend>('/operations/finance/profit/trend?months=6')
  const expenses = useApi<Expense[]>('/operations/finance/expenses')
  const [showExpense, setShowExpense] = React.useState(false)
  const close = useCommand(() => api(`/operations/finance/profit/${month}/close`, { method: 'POST' }))
  const reloadAll = () => { profit.reload(); trend.reload(); expenses.reload() }
  const p = profit.data
  const loadingFirst = !p && profit.loading
  const canClose = !!p && !p.closed && p.status === 'COMPLETE' && p.monthEnded === true && p.pendingCollection.orders === 0
  const refresh = profit.loading || trend.loading

  return <RoleShell role="admin" active="finance" mode="desktop"><Page>
    <PageHeader
      title="المالية"
      meta="الربح القابل للتوزيع من التكلفة الفعلية المسجّلة. تكلفة التوصيل التقديرية بتتعلّم وبتتبدّل بالفعلية."
      actions={<>
        <div role="group" aria-label="الشهر" className="inline-flex h-9 items-center rounded-bw-field border border-bw-line bg-bw-surface">
          <button type="button" aria-label="الشهر السابق" onClick={() => setMonth(shiftMonth(month, -1))} className="grid size-9 place-items-center text-bw-ink-soft transition-colors hover:text-bw-ink"><ChevronRight className="size-4" aria-hidden /></button>
          <span className="min-w-28 px-1 text-center text-bw-small font-semibold text-bw-ink">{monthName(month)}</span>
          <button type="button" aria-label="الشهر التالي" disabled={month >= thisMonth} onClick={() => setMonth(shiftMonth(month, 1))} className="grid size-9 place-items-center text-bw-ink-soft transition-colors hover:text-bw-ink disabled:opacity-40"><ChevronLeft className="size-4" aria-hidden /></button>
        </div>
        <Button variant="secondary" size="sm" onClick={reloadAll} loading={refresh && !!p} aria-label="تحديث">{!(refresh && !!p) ? <RefreshCw className="size-4" aria-hidden /> : null}تحديث</Button>
        <Button variant="secondary" size="sm" onClick={() => setShowExpense(true)}><Plus className="size-4" aria-hidden />مصروف</Button>
        {canClose ? <Button size="sm" loading={close.pending} onClick={async () => { if (await close.execute()) reloadAll() }}><Lock className="size-4" aria-hidden />إغلاق الشهر</Button> : null}
      </>}
    />
    {profit.error ? <LoadError message={profit.error.message} onRetry={profit.reload} /> : null}
    <CommandError error={close.error} />
    {loadingFirst ? <Skeleton className="h-28 w-full" /> : null}

    {p ? <>
      {p.closed ? (
        <p role="status" className="flex items-center gap-2 text-bw-small text-bw-ink-soft">
          <Lock className="size-3.5 text-bw-emerald" aria-hidden />
          الشهر مُغلق. الأرقام ثابتة بنسبة <bdi className="bw-code font-semibold text-bw-ink">{p.split.platformPercent}%</bdi> وقت الإغلاق، وأي تغيير بعد كده مابيغيّرهاش.
        </p>
      ) : null}

      {!p.closed && p.status === 'COMPLETE' && p.monthEnded === true && p.pendingCollection.orders > 0 ? (
        <p role="status" className="text-bw-small text-bw-ink-soft">فيه <bdi className="bw-code font-semibold text-bw-ink">{p.pendingCollection.orders}</bdi> طلب كاشه لسه مع المندوب أو ماتسوّاش. سوّيه الأول عشان إغلاق الشهر يتبع كاش اتعدّ فعلًا.</p>
      ) : null}

      <StatStrip>
        <Stat label="الإيراد" value={p.revenue.total.toLocaleString('en-US')} unit="ج.م" tone="cobalt" hint={`${p.eligibleOrders} طلب مسلَّم`} />
        <Stat label="التكاليف الفعلية" value={p.costs.total.toLocaleString('en-US')} unit="ج.م" hint="شراء وتوصيل وتغليف وتلفيات" />
        <Stat label="الربح القابل للتوزيع" value={p.distributableProfit === null ? '—' : p.distributableProfit.toLocaleString('en-US')} unit={p.distributableProfit === null ? undefined : 'ج.م'} tone={p.distributableProfit !== null && p.distributableProfit < 0 ? 'rose' : 'emerald'} hint={p.status === 'INCOMPLETE' ? 'غير مكتمل: تكاليف فعلية ناقصة' : 'الإيراد − التكاليف الفعلية'} />
        <Stat label={<>حصة المنصة (<bdi className="bw-code">{p.split.platformPercent}%</bdi>)</>} value={p.split.platformShare === null ? '—' : p.split.platformShare.toLocaleString('en-US')} unit={p.split.platformShare === null ? undefined : 'ج.م'} tone="violet" hint={p.split.partnerShare === null ? 'تُحسب بعد اكتمال التكاليف' : `حصة الشريك ${money(p.split.partnerShare)} · مفيش تحويل تلقائي`} />
        <Stat label="كاش مع المناديب" value={p.cash.inCourierCustody.amount.toLocaleString('en-US')} unit="ج.م" tone="amber" href="/admin/cash" hint={`${p.cash.inCourierCustody.orders} طلب · أعلنه المندوب ولم يُعدّ`} />
      </StatStrip>

      {p.status === 'INCOMPLETE' ? (
        <div role="status" className="bw-arrive flex items-start gap-3 rounded-bw-card border border-bw-amber/30 bg-bw-amber-soft px-4 py-3 text-bw-small text-bw-ink">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-bw-amber" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">الربح غير مكتمل لحد ما تتسجّل التكاليف الفعلية دي:</p>
            <ul className="mt-1 list-disc space-y-0.5 ps-5 text-bw-ink-soft">
              {p.missing.map((m) => <li key={m.code}><Code>{m.orders}</Code> {MISSING_TEXT[m.code]}</li>)}
            </ul>
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] font-semibold">
              <Link href="/hub/order-costs" className="text-bw-cobalt underline-offset-4 hover:underline">سجّل تكلفة التوصيل والتغليف</Link>
              <Link href="/hub/buy-list" className="text-bw-cobalt underline-offset-4 hover:underline">سجّل تكلفة المشتريات</Link>
            </p>
          </div>
        </div>
      ) : null}

      <section aria-label="القابل للصرف الآن" className="bw-panel">
        <PanelHead title="القابل للصرف الآن" aside={<span className="text-bw-small text-bw-ink-soft">من كاش اتعدّ وسُوّي فقط</span>} />
        <dl className="grid divide-y divide-bw-line text-bw-small sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-3">
          {([
            ['ربح محقّق (كاشه اتعدّ)', p.realisedProfit],
            ['حصة المنصة الآن', p.split.platformShareNow],
            ['حصة الشريك الآن', p.split.partnerShareNow],
            ['رأس مال رجع من طلبات اتسوّت', p.capital.recovered],
            ['رأس مال محبوس في طلبات لسه ماتسوّتش', p.capital.tiedUpInUnsettledOrders],
            ['بضاعة قابلة للبيع من طلبات ملغية أو مرتجعة', p.capital.tiedUpInRecoverableGoods],
          ] as Array<[string, number | null]>).map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-4 px-4 py-2.5"><dt className="text-bw-ink-soft">{label}</dt><dd className="tabular-nums text-bw-ink">{money(value)}</dd></div>
          ))}
        </dl>
        <p className="border-t border-bw-line px-4 py-3 text-[12px] text-bw-ink-subtle">
          رأس المال بيرجع للشريك الأول من تكلفة الشراء، وبعدها بيتوزّع الربح بنسبة <bdi className="bw-code">{p.split.platformPercent}%</bdi> للمنصة والباقي للشريك. نقص عدّ المندوب بيتسجّل على التسوية ({money(p.cash.settlements.variance)} هذا الشهر) ومابيتحمّلش على طلب معيّن.
        </p>
      </section>

      <section aria-label="الاتجاه الشهري" className="bw-panel">
        <PanelHead title="الاتجاه الشهري" aside={<span className="text-bw-small text-bw-ink-soft">آخر 6 شهور</span>} />
        <div className="p-4">
          {trend.error ? <LoadError message={trend.error.message} onRetry={trend.reload} /> : null}
          {!trend.data && trend.loading ? <Skeleton className="h-44 w-full" /> : null}
          {trend.data ? (
            <MonthlyBars
              months={trend.data.points.map((point) => ({ key: point.period, label: monthName(point.period, 'short'), revenue: point.revenue, net: point.distributableProfit, closed: point.closed }))}
              formatValue={money}
              ariaLabel="الإيراد والربح القابل للتوزيع لكل شهر"
              emptyLabel="مفيش طلبات مسلَّمة في آخر 6 شهور"
              incompleteLabel="غير مكتمل"
            />
          ) : null}
        </div>
      </section>

      <details className="group bw-panel">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 text-bw-small font-semibold text-bw-ink-soft hover:text-bw-ink [&::-webkit-details-marker]:hidden">
          تفاصيل الحساب
          <ChevronDown className="size-4 transition-transform duration-200 group-open:rotate-180" aria-hidden />
        </summary>
        <dl className="divide-y divide-bw-line border-t border-bw-line text-bw-small">
          {([
            ['مبيعات المنتجات (بعد كل الخصومات والكوبونات)', p.revenue.netSales],
            ['مرتجعات منتجات مدفوعة للعملاء', -p.revenue.productRefunds],
            ['رسوم توصيل دفعها العملاء (إيراد)', p.revenue.shippingRevenueNet],
            ['تكلفة شراء البضاعة المباعة', -p.costs.products],
            [p.delivery.estimatedOrders > 0 ? `تكلفة التوصيل (منها ${money(p.delivery.estimatedAmount)} تقديرية لـ ${p.delivery.estimatedOrders} طلب)` : 'تكلفة التوصيل الفعلية', -p.costs.delivery],
            ['التغليف (شنطة / كرتونة)', -p.costs.packaging],
            ['تلفيات مؤكدة من الأدمن', -p.costs.damages],
            ['تكاليف مباشرة معتمدة', -p.costs.directCosts],
          ] as Array<[string, number]>).map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-4 px-4 py-2.5"><dt className="text-bw-ink-soft">{label}</dt><dd className={cn('tabular-nums', value < 0 ? 'text-bw-ink-soft' : 'text-bw-ink')}>{money(value)}</dd></div>
          ))}
          <div className="flex items-center justify-between gap-4 px-4 py-2.5 font-semibold"><dt>الربح القابل للتوزيع</dt><dd className="tabular-nums">{money(p.distributableProfit)}</dd></div>
          <div className="px-4 py-3 text-[12px] text-bw-ink-subtle">
            رسوم التوصيل إيراد، وتكلفة المندوب مصروف، وكل واحد منهم بيظهر لوحده (هامش التوصيل {money(p.delivery.margin)}). مصروفات المنصة ({money(p.platformExpenses)}) مابتتخصمش من الربح المشترك. التكلفة التقديرية من عرض السعر بتتبدّل بالفعلية أول ما تتسجّل. رأس المال بيرجع من تكلفة الشراء ومابيتخصمش مرتين.
          </div>
        </dl>
      </details>

      <section aria-label="المصروفات المسجلة" className="bw-panel">
        <PanelHead title="المصروفات المسجلة" aside={<Button variant="secondary" size="sm" onClick={() => setShowExpense(true)}><Plus className="size-4" aria-hidden />إضافة</Button>} />
        {expenses.error ? <LoadError message={expenses.error.message} onRetry={expenses.reload} /> : null}
        {!expenses.data && expenses.loading ? <div className="p-4"><Skeleton className="h-20 w-full" /></div> : null}
        {expenses.data?.length === 0 ? <StateBlock kind="empty" title="مفيش مصروفات مسجلة" body="سجّل المصروفات الفعلية عشان تدخل في حساب الربح." /> : null}
        {expenses.data?.length ? <ul className="divide-y divide-bw-line">{expenses.data.slice(0, 8).map(expense => <li key={expense.id} className="bw-row flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-bw-small">
          <div className="min-w-0"><span className="font-semibold text-bw-ink">{categoryName[expense.category] ?? expense.category}</span><span className="text-bw-ink-soft"> · {expense.description}</span><span className="ms-2 text-[12px] text-bw-ink-subtle">{expense.incurredOn}{expense.recurrence !== 'NONE' ? ` · ${expense.recurrence === 'WEEKLY' ? 'أسبوعي' : 'شهري'}` : ''}</span>
            <span className={cn('ms-2 rounded px-1.5 py-0.5 text-[11px] font-semibold', expense.kind === 'DIRECT' ? 'bg-bw-cobalt-soft text-bw-cobalt' : 'bg-bw-veil-3 text-bw-ink-subtle')}>{expense.kind === 'DIRECT' ? (expense.approved ? 'مباشرة · معتمدة' : 'مباشرة · تنتظر الاعتماد') : 'مصروف المنصة · لا يُخصم'}</span></div>
          <span className="flex items-center gap-3"><Egp value={expense.amount} className="font-semibold text-bw-ink" />{expense.kind === 'DIRECT' && !expense.approved ? <ApproveButton id={expense.id} onDone={reloadAll} /> : null}</span>
        </li>)}</ul> : null}
      </section>
      <PartnerPanel />
    </> : null}
    {showExpense ? <ExpenseDialog onClose={() => setShowExpense(false)} onSaved={() => { setShowExpense(false); reloadAll() }} /> : null}
  </Page></RoleShell>
}

function ApproveButton({ id, onDone }: { id: string; onDone: () => void }) {
  const approve = useCommand(() => api(`/operations/finance/expenses/${id}/approve`, { method: 'POST' }))
  return <><Button size="sm" variant="secondary" loading={approve.pending} onClick={async () => { if (await approve.execute()) onDone() }}>اعتماد</Button><CommandError error={approve.error} /></>
}

function ExpenseDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const dialogRef = React.useRef<HTMLDialogElement>(null)
  React.useEffect(() => { const node = dialogRef.current; if (!node) return; if (!node.open) node.showModal(); return () => { if (node.open) node.close() } }, [])
  const [category, setCategory] = React.useState('OTHER')
  const [kind, setKind] = React.useState('PLATFORM')
  const [description, setDescription] = React.useState('')
  const [amount, setAmount] = React.useState('')
  const [incurredOn, setIncurredOn] = React.useState(today)
  const [recurrence, setRecurrence] = React.useState('NONE')
  const [endsOn, setEndsOn] = React.useState('')
  const create = useCommand(() => api('/operations/finance/expenses', { body: { category, kind, description: description.trim(), amount: Number(amount), incurredOn, recurrence, ...(endsOn ? { endsOn } : {}) } }))
  return <dialog ref={dialogRef} onCancel={e=>{e.preventDefault();onClose()}} aria-labelledby="expense-title" className="bw-glass-raised fixed inset-0 z-50 m-auto max-h-[90dvh] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto rounded-bw-card p-0 text-bw-ink backdrop:bg-bw-kohl/60"><form className="space-y-4 p-5" onSubmit={async e => { e.preventDefault(); if (await create.execute()) onSaved() }}><div className="flex items-center justify-between"><h2 id="expense-title" className="text-bw-heading font-semibold">مصروف جديد</h2><button type="button" onClick={onClose} className="grid size-9 place-items-center rounded-full text-bw-ink-soft transition-colors hover:bg-bw-veil-4 hover:text-bw-ink" aria-label="إغلاق"><X className="size-4" aria-hidden /></button></div><Select label="التصنيف" value={category} onChange={setCategory} options={Object.entries(categoryName).filter(([v]) => v !== 'PACKAGING' && v !== 'DELIVERY').map(([v, label]) => [v, label])} /><Select label="نوع المصروف" value={kind} onChange={setKind} options={[['PLATFORM', 'مصروف المنصة (لا يُخصم من الربح المشترك)'], ['DIRECT', 'تكلفة مباشرة (تُخصم بعد اعتماد الأدمن)']]} /><Field label="البيان" value={description} onChange={e => setDescription(e.target.value)} /><Field label="المبلغ بالجنيه" type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /><Field label="تاريخ المصروف" type="date" value={incurredOn} onChange={e => setIncurredOn(e.target.value)} /><Select label="التكرار" value={recurrence} onChange={setRecurrence} options={ [['NONE','مرة واحدة'],['WEEKLY','أسبوعي'],['MONTHLY','شهري']] } />{recurrence !== 'NONE' ? <Field label="آخر تاريخ (اختياري)" type="date" value={endsOn} onChange={e => setEndsOn(e.target.value)} /> : null}<CommandError error={create.error} /><div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>إلغاء</Button><Button type="submit" loading={create.pending} disabled={!description.trim() || Number(amount) <= 0}>حفظ المصروف</Button></div></form></dialog>
}

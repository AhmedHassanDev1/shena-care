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
import { cn } from '@/lib/utils'

type MissingCode = 'PURCHASE_COST' | 'COURIER_COST' | 'PACKAGING_COST' | 'LOSS_PURCHASE_COST'
type Profit = {
  period: string; status: 'COMPLETE' | 'INCOMPLETE'; eligibleOrders: number
  missing: Array<{ code: MissingCode; orders: number }>
  revenue: { productSales: number; refunds: number; net: number }
  costs: { purchase: number; companyFundedDelivery: number; packaging: number; losses: number; operatingExpenses: number; total: number }
  delivery: { customerFees: number; courierCost: number; companyFunded: number; customerSurplus: number }
  netProfit: number | null; profitSharePercent: number; profitShare: number | null
  closed: { at: string; by: string } | null; monthEnded?: boolean
  needsCost: Array<{ orderId: string; orderNumber: string; missing: string[] }>
  cod: { expected: number; notYetCollected: number; collectedByDrivers: number; disputed: number; outstanding: number; settled: number }
}
type Trend = { points: Array<{ period: string; status: 'COMPLETE' | 'INCOMPLETE'; closed: boolean; revenue: number; costs: number; netProfit: number | null; profitShare: number | null }> }
type Expense = { id: string; category: string; description: string; amount: number; incurredOn: string; recurrence: string; endsOn: string | null; voided: boolean }

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
  COURIER_COST: 'طلب بلا تكلفة توصيل فعلية',
  PACKAGING_COST: 'طلب بلا نوع تغليف',
  LOSS_PURCHASE_COST: 'طلب ملغي اشتُريت له بضاعة بلا تكلفة',
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
  const canClose = !!p && !p.closed && p.status === 'COMPLETE' && p.monthEnded === true
  const refresh = profit.loading || trend.loading

  return <RoleShell role="admin" active="finance" mode="desktop"><Page>
    <PageHeader
      title="المالية"
      meta="الربح من التكلفة الفعلية المسجّلة فقط. مفيش أرقام تقديرية."
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
          الشهر مُغلق. الأرقام ثابتة بنسبة <bdi className="bw-code font-semibold text-bw-ink">{p.profitSharePercent}%</bdi> وقت الإغلاق، وأي تغيير بعد كده مابيغيّرهاش.
        </p>
      ) : null}

      <StatStrip>
        <Stat label="الإيراد" value={p.revenue.net.toLocaleString('en-US')} unit="ج.م" tone="cobalt" hint={`${p.eligibleOrders} طلب مسلَّم`} />
        <Stat label="التكاليف الفعلية" value={p.costs.total.toLocaleString('en-US')} unit="ج.م" hint="شراء وتوصيل وتغليف وخسائر ومصروفات" />
        <Stat label="صافي الربح" value={p.netProfit === null ? '—' : p.netProfit.toLocaleString('en-US')} unit={p.netProfit === null ? undefined : 'ج.م'} tone={p.netProfit !== null && p.netProfit < 0 ? 'rose' : 'emerald'} hint={p.status === 'INCOMPLETE' ? 'غير مكتمل: تكاليف فعلية ناقصة' : 'الإيراد − التكاليف الفعلية'} />
        <Stat label={<>حصة الأرباح (<bdi className="bw-code">{p.profitSharePercent}%</bdi>)</>} value={p.profitShare === null ? '—' : p.profitShare.toLocaleString('en-US')} unit={p.profitShare === null ? undefined : 'ج.م'} tone="violet" hint={p.profitShare === null ? 'تُحسب بعد اكتمال التكاليف' : 'من صافي الربح، مفيش تحويل تلقائي'} />
        <Stat label="تحصيل لم يُسوَّ" value={p.cod.outstanding.toLocaleString('en-US')} unit="ج.م" tone="amber" href="/admin/cash" hint={`مع المناديب ${money(p.cod.collectedByDrivers)} · مُسوّى ${money(p.cod.settled)}`} />
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

      <section aria-label="الاتجاه الشهري" className="bw-panel">
        <PanelHead title="الاتجاه الشهري" aside={<span className="text-bw-small text-bw-ink-soft">آخر 6 شهور</span>} />
        <div className="p-4">
          {trend.error ? <LoadError message={trend.error.message} onRetry={trend.reload} /> : null}
          {!trend.data && trend.loading ? <Skeleton className="h-44 w-full" /> : null}
          {trend.data ? (
            <MonthlyBars
              months={trend.data.points.map((point) => ({ key: point.period, label: monthName(point.period, 'short'), revenue: point.revenue, net: point.netProfit, closed: point.closed }))}
              formatValue={money}
              ariaLabel="الإيراد وصافي الربح لكل شهر"
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
            ['مبيعات المنتجات (بعد الخصومات)', p.revenue.productSales, false],
            ['مرتجعات مدفوعة للعملاء', -p.revenue.refunds, false],
            ['تكلفة شراء البضاعة المباعة', -p.costs.purchase, false],
            ['توصيل تتحمله الشركة (تكلفة المندوب فوق رسوم العميل)', -p.costs.companyFundedDelivery, false],
            ['التغليف (شنطة / كرتونة)', -p.costs.packaging, false],
            ['خسائر طلبات ملغية أو مرتجعة', -p.costs.losses, false],
            ['مصروفات التشغيل المسجّلة', -p.costs.operatingExpenses, false],
          ] as Array<[string, number, boolean]>).map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-4 px-4 py-2.5"><dt className="text-bw-ink-soft">{label}</dt><dd className={cn('tabular-nums', value < 0 ? 'text-bw-ink-soft' : 'text-bw-ink')}>{money(value)}</dd></div>
          ))}
          <div className="flex items-center justify-between gap-4 px-4 py-2.5 font-semibold"><dt>صافي الربح</dt><dd className="tabular-nums">{money(p.netProfit)}</dd></div>
          <div className="px-4 py-3 text-[12px] text-bw-ink-subtle">
            رسوم التوصيل اللي دفعها العملاء ({money(p.delivery.customerFees)}) مش إيراد منتجات؛ بتتقابل بس مع تكلفة المندوب الفعلية ({money(p.delivery.courierCost)}). رأس المال بيرجع من تكلفة الشراء المسجّلة ومابيتخصمش مرتين.
          </div>
        </dl>
      </details>

      <section aria-label="المصروفات المسجلة" className="bw-panel">
        <PanelHead title="المصروفات المسجلة" aside={<Button variant="secondary" size="sm" onClick={() => setShowExpense(true)}><Plus className="size-4" aria-hidden />إضافة</Button>} />
        {expenses.error ? <LoadError message={expenses.error.message} onRetry={expenses.reload} /> : null}
        {!expenses.data && expenses.loading ? <div className="p-4"><Skeleton className="h-20 w-full" /></div> : null}
        {expenses.data?.length === 0 ? <StateBlock kind="empty" title="مفيش مصروفات مسجلة" body="سجّل المصروفات الفعلية عشان تدخل في حساب الربح." /> : null}
        {expenses.data?.length ? <ul className="divide-y divide-bw-line">{expenses.data.slice(0, 8).map(expense => <li key={expense.id} className="bw-row flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-bw-small">
          <div className="min-w-0"><span className="font-semibold text-bw-ink">{categoryName[expense.category] ?? expense.category}</span><span className="text-bw-ink-soft"> · {expense.description}</span><span className="ms-2 text-[12px] text-bw-ink-subtle">{expense.incurredOn}{expense.recurrence !== 'NONE' ? ` · ${expense.recurrence === 'WEEKLY' ? 'أسبوعي' : 'شهري'}` : ''}</span></div>
          <Egp value={expense.amount} className="font-semibold text-bw-ink" />
        </li>)}</ul> : null}
      </section>
    </> : null}
    {showExpense ? <ExpenseDialog onClose={() => setShowExpense(false)} onSaved={() => { setShowExpense(false); reloadAll() }} /> : null}
  </Page></RoleShell>
}

function ExpenseDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const dialogRef = React.useRef<HTMLDialogElement>(null)
  React.useEffect(() => { const node = dialogRef.current; if (!node) return; if (!node.open) node.showModal(); return () => { if (node.open) node.close() } }, [])
  const [category, setCategory] = React.useState('PACKAGING')
  const [description, setDescription] = React.useState('')
  const [amount, setAmount] = React.useState('')
  const [incurredOn, setIncurredOn] = React.useState(today)
  const [recurrence, setRecurrence] = React.useState('NONE')
  const [endsOn, setEndsOn] = React.useState('')
  const create = useCommand(() => api('/operations/finance/expenses', { body: { category, description: description.trim(), amount: Number(amount), incurredOn, recurrence, ...(endsOn ? { endsOn } : {}) } }))
  return <dialog ref={dialogRef} onCancel={e=>{e.preventDefault();onClose()}} aria-labelledby="expense-title" className="bw-glass-raised fixed inset-0 z-50 m-auto max-h-[90dvh] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto rounded-bw-card p-0 text-bw-ink backdrop:bg-bw-kohl/60"><form className="space-y-4 p-5" onSubmit={async e => { e.preventDefault(); if (await create.execute()) onSaved() }}><div className="flex items-center justify-between"><h2 id="expense-title" className="text-bw-heading font-semibold">مصروف جديد</h2><button type="button" onClick={onClose} className="grid size-9 place-items-center rounded-full text-bw-ink-soft transition-colors hover:bg-bw-veil-4 hover:text-bw-ink" aria-label="إغلاق"><X className="size-4" aria-hidden /></button></div><Select label="التصنيف" value={category} onChange={setCategory} options={Object.entries(categoryName).map(([v, label]) => [v, label])} /><Field label="البيان" value={description} onChange={e => setDescription(e.target.value)} /><Field label="المبلغ بالجنيه" type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /><Field label="تاريخ المصروف" type="date" value={incurredOn} onChange={e => setIncurredOn(e.target.value)} /><Select label="التكرار" value={recurrence} onChange={setRecurrence} options={ [['NONE','مرة واحدة'],['WEEKLY','أسبوعي'],['MONTHLY','شهري']] } />{recurrence !== 'NONE' ? <Field label="آخر تاريخ (اختياري)" type="date" value={endsOn} onChange={e => setEndsOn(e.target.value)} /> : null}<CommandError error={create.error} /><div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>إلغاء</Button><Button type="submit" loading={create.pending} disabled={!description.trim() || Number(amount) <= 0}>حفظ المصروف</Button></div></form></dialog>
}

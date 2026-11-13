'use client'

import * as React from 'react'
import { Plus, RefreshCw, TriangleAlert, X } from 'lucide-react'
import { Button, Code, DataTable, Field, PageHeader, Skeleton, StateBlock, StatusLabel } from '@/components/bw/primitives'
import { BarList, PanelHead, Segmented, Stat, StatStrip } from '@/components/bw/ops'
import { TrendChart } from '@/components/bw/trend-chart'
import { CommandError, Egp, Page, Select, Status } from '@/components/workspace/kit'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { api } from '@/lib/api'
import { COLLECTION_STATUS } from '@/lib/labels'
import { useApi, useCommand } from '@/lib/use-api'

type FinanceSummary = {
  range: { from: string; to: string; days: number }
  sales: { deliveredOrders: number; goodsRevenue: number; deliveryFeeRevenue: number; billedTotal: number; discountsGiven: number; averageOrderValue: number | null }
  cod: { expected: number; outstanding: number; disputed: number; reconciled: number; variance: number; settlementBatches: number }
  supplierCosts: { invoicedInPeriod: number; payablesOutstanding: number; payablesPaidInPeriod: number }
  profitability: { ordersWithCost: number; ordersCostPending: number; ordersNotReceived: number; costCoveragePercent: number | null; grossProfitRecorded: number | null; grossMarginPercent: number | null }
  costs: { refunds: number; courierSettlementFees: number; operatingExpenses: number; expensesByCategory: Array<{ category: string; total: number }> }
  operatingResult: { value: number | null; status: string; missing: string[] }
  estimates: { deliveryCost: number | null; packagingCost: number | null }
}
type Series = { points: Array<{ date: string; revenue: number; orders: number; grossProfit: number; costedOrders: number; expenses: number; refunds: number; codSettled: number }> }
type FinanceOrder = { orderId: string; orderNumber: string; deliveredAt: string; paymentMethod: string; goods: number; discounts: number; deliveryFee: number; total: number; cod: { status: string; expected: number; collected: number | null } | null; cost: { status: string; supplierCost: number | null; contribution: number | null; marginPercent: number | null } }
type Expense = { id: string; category: string; description: string; amount: number; incurredOn: string; recurrence: string; endsOn: string | null; voided: boolean }

const cairoDay = (offsetDays = 0) => new Date(Date.now() - offsetDays * 86400000).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' })
const today = cairoDay()
const monthStart = `${today.slice(0, 8)}01`
const categoryName: Record<string, string> = { RENT: 'إيجار', UTILITIES: 'مرافق', MARKETING: 'تسويق', PACKAGING: 'تغليف', DELIVERY: 'توصيل', SOFTWARE: 'برمجيات', SUPPLIES: 'مستلزمات', OTHER: 'أخرى' }
const money = (n: number | null | undefined) => n == null ? '—' : `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} ج.م`
const compact = (n: number) => (n >= 1000 ? `${Number.isInteger(n / 1000) ? n / 1000 : (n / 1000).toFixed(1)}k` : String(Math.round(n)))
const ymd = (value: string) => value.slice(0, 10)
const dayLabel = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`

type Preset = 'month' | '7' | '30' | 'custom'
const PRESETS: Array<{ value: Preset; label: string }> = [{ value: 'month', label: 'الشهر' }, { value: '7', label: '7 أيام' }, { value: '30', label: '30 يوم' }]

export default function FinancePage() {
  const [from, setFrom] = React.useState(monthStart)
  const [to, setTo] = React.useState(today)
  const preset: Preset = to === today && from === monthStart ? 'month' : to === today && from === cairoDay(6) ? '7' : to === today && from === cairoDay(29) ? '30' : 'custom'
  const pick = (value: Preset) => {
    setTo(today)
    setFrom(value === 'month' ? monthStart : value === '7' ? cairoDay(6) : cairoDay(29))
  }
  const query = `?from=${from}&to=${to}`
  const summary = useApi<FinanceSummary>(`/operations/finance/summary${query}`)
  const series = useApi<Series>(`/operations/finance/series${query}`)
  const orders = useApi<{ total: number; items: FinanceOrder[] }>(`/operations/finance/orders${query}&limit=25`)
  const expenses = useApi<Expense[]>('/operations/finance/expenses')
  const [showExpense, setShowExpense] = React.useState(false)
  const refresh = () => { summary.reload(); series.reload(); orders.reload(); expenses.reload() }
  const busy = summary.loading || series.loading || orders.loading

  const s = summary.data
  const recordedCosts = s ? s.supplierCosts.invoicedInPeriod + s.costs.refunds + s.costs.courierSettlementFees + s.costs.operatingExpenses : 0
  const costItems = s ? [
    { key: 'invoices', label: 'فواتير الموردين', value: s.supplierCosts.invoicedInPeriod, tone: 'cobalt' as const },
    { key: 'ops', label: 'مصاريف تشغيل', value: s.costs.operatingExpenses, tone: 'amber' as const },
    { key: 'courier', label: 'رسوم تسوية المندوبين', value: s.costs.courierSettlementFees, tone: 'violet' as const },
    { key: 'refunds', label: 'استردادات العملاء', value: s.costs.refunds, tone: 'rose' as const },
  ] : []
  const pending = s ? s.profitability.ordersCostPending + s.profitability.ordersNotReceived : 0

  return <RoleShell role="admin" active="finance" mode="desktop"><Page>
    <PageHeader
      title="المالية"
      meta="المبيعات المسلّمة والتكاليف المسجلة فقط، من غير تقديرات."
      actions={<>
        <Segmented label="الفترة" items={PRESETS} value={preset === 'custom' ? ('' as Preset) : preset} onChange={pick} className="rounded-bw-field border border-bw-line bg-bw-surface p-0.5" />
        <div className="flex items-center gap-1.5">
          <input aria-label="من تاريخ" type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} dir="ltr" className="bw-control h-9 rounded-bw-field border border-bw-line bg-bw-surface px-2 text-bw-small text-bw-ink" />
          <span aria-hidden className="text-bw-ink-subtle">–</span>
          <input aria-label="إلى تاريخ" type="date" value={to} min={from} max={today} onChange={(e) => e.target.value && setTo(e.target.value)} dir="ltr" className="bw-control h-9 rounded-bw-field border border-bw-line bg-bw-surface px-2 text-bw-small text-bw-ink" />
        </div>
        <Button variant="secondary" size="sm" onClick={refresh} loading={busy && !!s} aria-label="تحديث">{!(busy && !!s) ? <RefreshCw className="size-4" aria-hidden /> : null}تحديث</Button>
        <Button size="sm" onClick={() => setShowExpense(true)}><Plus className="size-4" aria-hidden />مصروف</Button>
      </>}
    />
    {summary.error ? <LoadError message={summary.error.message} onRetry={summary.reload} /> : null}
    {!s && summary.loading ? <Skeleton className="h-28 w-full" /> : null}

    {s ? <>
      <StatStrip>
        <Stat label="إيراد مسلّم" value={s.sales.billedTotal.toLocaleString('en-US')} unit="ج.م" tone="emerald" hint={<><bdi className="bw-code">{s.sales.deliveredOrders}</bdi> طلب · بضاعة {money(s.sales.goodsRevenue)}</>} />
        <Stat label="تكاليف مسجلة" value={recordedCosts.toLocaleString('en-US')} unit="ج.م" tone="neutral" hint={`تكلفة مؤكدة لـ ${s.profitability.ordersWithCost} طلب`} />
        <Stat
          label="هامش تقديري"
          value={s.profitability.grossMarginPercent == null ? '—' : `${s.profitability.grossMarginPercent}%`}
          tone="cobalt"
          hint={s.profitability.grossProfitRecorded == null ? 'بانتظار تكلفة الفواتير' : `ربح ${money(s.profitability.grossProfitRecorded)} · تغطية ${s.profitability.costCoveragePercent ?? 0}%`}
        />
        <Stat label="تحصيل مُسوَّى" value={s.cod.reconciled.toLocaleString('en-US')} unit="ج.م" tone="emerald" hint={`دفعات التسوية: ${s.cod.settlementBatches}`} />
        <Stat label="تحصيل لم يُسوَّ" value={s.cod.outstanding.toLocaleString('en-US')} unit="ج.م" tone="amber" href="/admin/cash" hint={s.cod.variance ? `فرق التسوية ${money(s.cod.variance)}` : `متوقع ${money(s.cod.expected)}`} />
      </StatStrip>

      {pending > 0 || s.operatingResult.value === null ? (
        <p role="status" className="bw-arrive flex items-start gap-2.5 rounded-bw-card border border-bw-amber/30 bg-bw-amber-soft px-4 py-3 text-bw-small text-bw-ink">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-bw-amber" aria-hidden />
          <span>
            <strong className="font-semibold">الربح غير مكتمل.</strong>{' '}
            {s.profitability.ordersCostPending > 0 ? <><Code>{s.profitability.ordersCostPending}</Code> طلب مستني تسجيل تكلفته</> : null}
            {s.profitability.ordersCostPending > 0 && s.profitability.ordersNotReceived > 0 ? '، و' : null}
            {s.profitability.ordersNotReceived > 0 ? <><Code>{s.profitability.ordersNotReceived}</Code> طلب لسه ماوصلش المخزن</> : null}
            {pending === 0 ? 'مفيش تكاليف كفاية لحساب نتيجة التشغيل.' : '.'} الأرقام فوق مبنية على المسجّل بس.
          </span>
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <section aria-label="الإيراد اليومي" className="bw-panel">
          <PanelHead title="الإيراد اليومي" aside={<span className="text-bw-small text-bw-ink-soft">الطلبات المسلّمة فقط</span>} />
          <div className="p-4 pb-3">
            {series.error ? <LoadError message={series.error.message} onRetry={series.reload} /> : null}
            {!series.data && series.loading ? <Skeleton className="h-[290px] w-full" /> : null}
            {series.data ? (
              <TrendChart
                points={series.data.points.map((p) => ({ key: p.date, label: ymd(p.date), short: dayLabel(p.date), value: p.revenue }))}
                tone="emerald"
                formatValue={money}
                formatAxis={compact}
                height={290}
                ariaLabel="الإيراد المسلّم حسب اليوم"
                emptyLabel="مفيش مبيعات مسلّمة في الفترة دي"
              />
            ) : null}
          </div>
        </section>

        <section aria-label="التكاليف المسجلة" className="bw-panel">
          <PanelHead title="التكاليف المسجلة" aside={<span className="text-bw-small tabular-nums text-bw-ink-soft">{money(recordedCosts)}</span>} />
          <div className="space-y-4 p-4">
            <BarList items={costItems} formatValue={(v) => money(v)} emptyLabel="مفيش تكاليف مسجلة في الفترة دي" />
            {s.costs.expensesByCategory.length > 0 ? (
              <div className="border-t border-bw-line pt-3">
                <p className="mb-1 text-[11px] font-semibold text-bw-ink-subtle">المصروفات حسب النوع</p>
                <BarList items={s.costs.expensesByCategory.map((c) => ({ key: c.category, label: categoryName[c.category] ?? c.category, value: c.total, tone: 'amber' as const }))} formatValue={(v) => money(v)} />
              </div>
            ) : null}
            {s.supplierCosts.payablesOutstanding > 0 || s.supplierCosts.payablesPaidInPeriod > 0 ? <p className="border-t border-bw-line pt-3 text-[12px] text-bw-ink-subtle">مستحقات الموردين {money(s.supplierCosts.payablesOutstanding)} · مدفوع بالفترة {money(s.supplierCosts.payablesPaidInPeriod)}</p> : null}
          </div>
        </section>
      </div>

      <section aria-label="الطلبات المسلّمة" className="bw-panel overflow-hidden">
        <PanelHead title="الطلبات المسلّمة" aside={<span className="text-bw-small text-bw-ink-soft"><Code>{orders.data?.total ?? '—'}</Code> سجل</span>} />
        {orders.error ? <LoadError message={orders.error.message} onRetry={orders.reload} /> : null}
        {!orders.data && orders.loading ? <div className="p-4"><Skeleton className="h-40 w-full" /></div> : null}
        {orders.data?.items.length === 0 ? <StateBlock kind="empty" title="مفيش طلبات مسلّمة في الفترة دي" /> : null}
        {orders.data?.items.length ? <DataTable caption="تفاصيل الطلبات المالية" head={['الطلب', 'الإجمالي', 'تكلفة البضاعة', 'المساهمة', 'الهامش', 'التحصيل']}>
          {orders.data.items.map(order => <tr key={order.orderId}>
            <td><Code className="font-semibold">{order.orderNumber.replace(/^ORD-/, '#')}</Code><span className="block text-[11px] text-bw-ink-subtle">{ymd(order.deliveredAt)}</span></td>
            <td className="tabular-nums">{money(order.total)}</td>
            <td>{order.cost.supplierCost === null ? <StatusLabel tone="pending">{order.cost.status === 'PENDING' ? 'التكلفة معلقة' : 'لم تسجل بعد'}</StatusLabel> : <span className="tabular-nums">{money(order.cost.supplierCost)}</span>}</td>
            <td className="tabular-nums">{money(order.cost.contribution)}</td>
            <td className="tabular-nums">{order.cost.marginPercent === null ? '—' : <span dir="ltr">{order.cost.marginPercent}%</span>}</td>
            <td>{order.cod ? <span className="flex flex-wrap items-center gap-2"><span className="tabular-nums">{money(order.cod.collected)}</span><Status map={COLLECTION_STATUS} value={order.cod.status.toLowerCase()} /></span> : <span className="text-bw-ink-subtle">غير نقدي</span>}</td>
          </tr>)}
        </DataTable> : null}
      </section>

      <section aria-label="المصروفات المسجلة" className="bw-panel">
        <PanelHead title="المصروفات المسجلة" aside={<Button variant="secondary" size="sm" onClick={() => setShowExpense(true)}><Plus className="size-4" aria-hidden />إضافة</Button>} />
        {expenses.error ? <LoadError message={expenses.error.message} onRetry={expenses.reload} /> : null}
        {!expenses.data && expenses.loading ? <div className="p-4"><Skeleton className="h-20 w-full" /></div> : null}
        {expenses.data?.length === 0 ? <StateBlock kind="empty" title="مفيش مصروفات مسجلة" body="سجّل المصروفات الفعلية عشان تدخل في تقرير التشغيل." /> : null}
        {expenses.data?.length ? <ul className="divide-y divide-bw-line">{expenses.data.slice(0, 8).map(expense => <li key={expense.id} className="bw-row flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-bw-small">
          <div className="min-w-0"><span className="font-semibold text-bw-ink">{categoryName[expense.category] ?? expense.category}</span><span className="text-bw-ink-soft"> · {expense.description}</span><span className="ms-2 text-[12px] text-bw-ink-subtle">{expense.incurredOn}{expense.recurrence !== 'NONE' ? ` · ${expense.recurrence === 'WEEKLY' ? 'أسبوعي' : 'شهري'}` : ''}</span></div>
          <Egp value={expense.amount} className="font-semibold text-bw-ink" />
        </li>)}</ul> : null}
      </section>
    </> : null}
    {showExpense ? <ExpenseDialog onClose={() => setShowExpense(false)} onSaved={() => { setShowExpense(false); refresh() }} /> : null}
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

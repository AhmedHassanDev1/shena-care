'use client'

import * as React from 'react'
import { Plus, RefreshCw } from 'lucide-react'
import { Button, Code, DataTable, Field, Notice, PageHeader, Section, Skeleton, StateBlock, StatusLabel } from '@/components/bw/primitives'
import { CommandError, Egp, Page, Select } from '@/components/workspace/kit'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { api } from '@/lib/api'
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

const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' })
const start = `${today.slice(0, 8)}01`
const categoryName: Record<string, string> = { RENT: 'إيجار', UTILITIES: 'مرافق', MARKETING: 'تسويق', PACKAGING: 'تغليف', DELIVERY: 'توصيل', SOFTWARE: 'برمجيات', SUPPLIES: 'مستلزمات', OTHER: 'أخرى' }
const money = (n: number | null | undefined) => n == null ? '—' : `${new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(n)} ج.م`
const ymd = (value: string) => value.slice(0, 10)

export default function FinancePage() {
  const [from, setFrom] = React.useState(start)
  const [to, setTo] = React.useState(today)
  const query = `?from=${from}&to=${to}`
  const summary = useApi<FinanceSummary>(`/operations/finance/summary${query}`)
  const series = useApi<Series>(`/operations/finance/series${query}`)
  const orders = useApi<{ total: number; items: FinanceOrder[] }>(`/operations/finance/orders${query}&limit=25`)
  const expenses = useApi<Expense[]>('/operations/finance/expenses')
  const [showExpense, setShowExpense] = React.useState(false)
  const refresh = () => { summary.reload(); series.reload(); orders.reload(); expenses.reload() }
  return <RoleShell role="admin" active="finance" mode="desktop"><Page>
    <PageHeader title="المالية" meta="المبيعات المسلّمة والتكاليف المسجلة للفترة المحددة" actions={<><Field aria-label="من تاريخ" label="من" type="date" value={from} onChange={e => setFrom(e.target.value)} /><Field aria-label="إلى تاريخ" label="إلى" type="date" value={to} onChange={e => setTo(e.target.value)} /><Button variant="secondary" onClick={refresh} aria-label="تحديث"><RefreshCw className="size-4" /> تحديث</Button><Button onClick={() => setShowExpense(true)}><Plus className="size-4" /> مصروف</Button></>} />
    {summary.error ? <LoadError message={summary.error.message} onRetry={summary.reload} /> : null}
    {!summary.data && summary.loading ? <Skeleton className="h-32 w-full" /> : null}
    {summary.data ? <>
      <Section title="ملخص الفترة"><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="ملخص المالية">
        <Metric label="مبيعات مسلّمة" value={money(summary.data.sales.billedTotal)} detail={`${summary.data.sales.deliveredOrders} طلب · بضاعة ${money(summary.data.sales.goodsRevenue)}`} />
        <Metric label="ربح إجمالي مسجل" value={money(summary.data.profitability.grossProfitRecorded)} detail={`تكلفة مؤكدة لـ ${summary.data.profitability.ordersWithCost} طلب · تغطية ${summary.data.profitability.costCoveragePercent ?? 0}%`} />
        <Metric label="نتيجة التشغيل" value={money(summary.data.operatingResult.value)} detail={summary.data.operatingResult.status === 'RECORDED' ? 'مبني على تكاليف مسجلة' : 'بانتظار اكتمال التكلفة المسجلة'} />
        <Metric label="تحصيل COD غير مسوّى" value={money(summary.data.cod.outstanding)} detail={`معلّق ${money(summary.data.cod.expected)} · فرق التسوية ${money(summary.data.cod.variance)}`} />
      </div></Section>
      {summary.data.operatingResult.value === null ? <Notice tone="warn" title="الربح التشغيلي غير مكتمل">
        {summary.data.profitability.ordersCostPending} طلب ينتظر تسجيل تكلفة الفاتورة، و{summary.data.profitability.ordersNotReceived} طلب لم يصل للمخزن بعد. لا تُعرض تقديرات التكلفة كأرباح فعلية.
      </Notice> : null}
      <section className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <Section title="المبيعات اليومية" aside={<span className="text-bw-small text-bw-ink-soft">إيراد من الطلبات المسلّمة فقط</span>}>
          {series.error ? <LoadError message={series.error.message} onRetry={series.reload} /> : null}
          {!series.data && series.loading ? <Skeleton className="h-48 w-full" /> : null}
          {series.data && series.data.points.length === 0 ? <StateBlock kind="empty" title="لا توجد مبيعات مسلّمة في الفترة" /> : null}
          {series.data?.points.length ? <div className="space-y-3" role="img" aria-label="مخطط الإيراد حسب اليوم">
            {series.data.points.filter((_, i) => series.data!.points.length <= 14 || i % Math.ceil(series.data!.points.length / 14) === 0).map(point => {
              const max = Math.max(...series.data!.points.map(p => p.revenue), 1)
              return <div key={point.date} className="grid grid-cols-[5rem_1fr_auto] items-center gap-2 text-bw-small"><Code>{point.date.slice(5)}</Code><div className="h-2 overflow-hidden rounded-full bg-bw-sunken"><div className="h-full rounded-full bg-bw-action" style={{ width: `${Math.max(2, point.revenue / max * 100)}%` }} /></div><span>{money(point.revenue)} <span className="text-bw-ink-subtle">· {point.orders}</span></span></div>
            })}
            <p className="pt-1 text-[11px] text-bw-ink-subtle">هامش الربح التفصيلي متاح عندما تكون فاتورة المورد مسجلة للطلب.</p>
          </div> : null}
        </Section>
        <Section title="التكاليف المباشرة" aside={<span className="text-bw-small text-bw-ink-soft">مسجلة خلال الفترة</span>}>
          <CostBar label="فواتير الموردين" value={summary.data.supplierCosts.invoicedInPeriod} total={summary.data.supplierCosts.invoicedInPeriod + summary.data.costs.refunds + summary.data.costs.courierSettlementFees + summary.data.costs.operatingExpenses} />
          <CostBar label="استردادات العملاء" value={summary.data.costs.refunds} total={summary.data.supplierCosts.invoicedInPeriod + summary.data.costs.refunds + summary.data.costs.courierSettlementFees + summary.data.costs.operatingExpenses} />
          <CostBar label="رسوم تسوية المندوبين" value={summary.data.costs.courierSettlementFees} total={summary.data.supplierCosts.invoicedInPeriod + summary.data.costs.refunds + summary.data.costs.courierSettlementFees + summary.data.costs.operatingExpenses} />
          <CostBar label="مصاريف تشغيل" value={summary.data.costs.operatingExpenses} total={summary.data.supplierCosts.invoicedInPeriod + summary.data.costs.refunds + summary.data.costs.courierSettlementFees + summary.data.costs.operatingExpenses} />
          <p className="mt-4 border-t border-bw-line pt-3 text-bw-small text-bw-ink-soft">مستحقات الموردين {money(summary.data.supplierCosts.payablesOutstanding)} · مدفوع بالفترة {money(summary.data.supplierCosts.payablesPaidInPeriod)}</p>
          <p className="mt-1 text-[11px] text-bw-ink-subtle">تقديرات التوصيل والتغليف: {money(summary.data.estimates.deliveryCost)} و{money(summary.data.estimates.packagingCost)}. لا تدخل في الإجماليات المسجلة.</p>
        </Section>
      </section>
      <Section title="الطلبات المسلّمة" aside={<span className="text-bw-small text-bw-ink-soft">{orders.data?.total ?? '—'} سجل</span>}>
        {orders.error ? <LoadError message={orders.error.message} onRetry={orders.reload} /> : null}
        {!orders.data && orders.loading ? <Skeleton className="h-40 w-full" /> : null}
        {orders.data?.items.length === 0 ? <StateBlock kind="empty" title="لا توجد طلبات للفترة" /> : null}
        {orders.data?.items.length ? <div className="overflow-x-auto"><DataTable caption="تفاصيل الطلبات المالية" head={['الطلب والتاريخ', 'الإجمالي', 'تكلفة بضاعة', 'المساهمة', 'الهامش', 'COD']}>
          {orders.data.items.map(order => <tr key={order.orderId}><td><Code>{order.orderNumber}</Code><span className="block text-[11px] text-bw-ink-soft">{ymd(order.deliveredAt)}</span></td><td>{money(order.total)}</td><td>{order.cost.supplierCost === null ? <StatusLabel tone="pending">{order.cost.status === 'PENDING' ? 'التكلفة معلقة' : 'لم تسجل بعد'}</StatusLabel> : money(order.cost.supplierCost)}</td><td>{money(order.cost.contribution)}</td><td>{order.cost.marginPercent === null ? '—' : `${order.cost.marginPercent}%`}</td><td>{order.cod ? `${money(order.cod.collected)} · ${order.cod.status}` : 'غير نقدي'}</td></tr>)}
        </DataTable></div> : null}
      </Section>
      <Section title="المصروفات المسجلة" aside={<Button variant="secondary" onClick={() => setShowExpense(true)}><Plus className="size-4" /> إضافة</Button>}>
        {expenses.error ? <LoadError message={expenses.error.message} onRetry={expenses.reload} /> : null}
        {!expenses.data && expenses.loading ? <Skeleton className="h-20 w-full" /> : null}
        {expenses.data?.length === 0 ? <StateBlock kind="empty" title="لا توجد مصروفات مسجلة" body="أضف المصروفات الفعلية لتدخل في تقرير التشغيل." /> : null}
        {expenses.data?.length ? <div className="space-y-2">{expenses.data.slice(0, 8).map(expense => <div key={expense.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-bw-line py-2 text-bw-small"><div><span className="font-semibold">{categoryName[expense.category] ?? expense.category}</span> · {expense.description}<span className="ms-2 text-bw-ink-subtle">{expense.incurredOn}{expense.recurrence !== 'NONE' ? ` · ${expense.recurrence === 'WEEKLY' ? 'أسبوعي' : 'شهري'}` : ''}</span></div><Egp value={expense.amount} /></div>)}</div> : null}
      </Section>
    </> : null}
    {showExpense ? <ExpenseDialog onClose={() => setShowExpense(false)} onSaved={() => { setShowExpense(false); refresh() }} /> : null}
  </Page></RoleShell>
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="border-s border-bw-line ps-3 first:border-0 first:ps-0"><p className="text-bw-small text-bw-ink-soft">{label}</p><p className="mt-1 font-bw-display text-xl font-bold tabular-nums text-bw-ink">{value}</p><p className="mt-1 text-[11px] text-bw-ink-subtle">{detail}</p></div>
}
function CostBar({ label, value, total }: { label: string; value: number; total: number }) {
  return <div className="mb-4"><div className="mb-1 flex justify-between gap-2 text-bw-small"><span>{label}</span><span className="font-semibold">{money(value)}</span></div><div className="h-2 overflow-hidden rounded-full bg-bw-sunken"><div className="h-full rounded-full bg-bw-action" style={{ width: `${total ? Math.max(0, value / total * 100) : 0}%` }} /></div></div>
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
  return <dialog ref={dialogRef} onCancel={e=>{e.preventDefault();onClose()}} aria-labelledby="expense-title" className="fixed inset-0 z-50 m-auto max-h-[90dvh] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto rounded-bw-card border border-bw-line bg-bw-surface p-0 text-bw-ink shadow-bw-overlay backdrop:bg-bw-kohl/70"><form className="space-y-4 p-5" onSubmit={async e => { e.preventDefault(); if (await create.execute()) onSaved() }}><div className="flex items-center justify-between"><h2 id="expense-title" className="text-bw-heading font-bold">مصروف جديد</h2><button type="button" onClick={onClose} className="min-h-bw-control px-3" aria-label="إغلاق">×</button></div><Select label="التصنيف" value={category} onChange={setCategory} options={Object.entries(categoryName).map(([v, label]) => [v, label])} /><Field label="البيان" value={description} onChange={e => setDescription(e.target.value)} /><Field label="المبلغ بالجنيه" type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /><Field label="تاريخ المصروف" type="date" value={incurredOn} onChange={e => setIncurredOn(e.target.value)} /><Select label="التكرار" value={recurrence} onChange={setRecurrence} options={ [['NONE','مرة واحدة'],['WEEKLY','أسبوعي'],['MONTHLY','شهري']] } />{recurrence !== 'NONE' ? <Field label="آخر تاريخ (اختياري)" type="date" value={endsOn} onChange={e => setEndsOn(e.target.value)} /> : null}<CommandError error={create.error} /><div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>إلغاء</Button><Button type="submit" loading={create.pending} disabled={!description.trim() || Number(amount) <= 0}>حفظ المصروف</Button></div></form></dialog>
}

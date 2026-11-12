'use client'

import * as React from 'react'
import { Upload } from 'lucide-react'
import { Button, Code, DataTable, Notice, StatusLabel } from '@/components/bw/primitives'
import { flagLabel, type IntakeOutcome, type IntakeRow, type IntakeTotals, outcomeLabel, reasonOf } from '@/lib/intake'
import { cn } from '@/lib/utils'

/* Shared Catalog Intake views. The API decides every outcome; these only show it, with words. */

export function TotalsBar({ totals, order, active, onSelect }: {
  totals: IntakeTotals | null | undefined
  order: IntakeOutcome[]
  active?: IntakeOutcome | null
  onSelect?: (outcome: IntakeOutcome | null) => void
}) {
  if (!totals) return null
  return <div className="flex flex-wrap gap-2" role="group" aria-label="نتائج الأسطر">
    <button type="button" aria-pressed={!active} onClick={() => onSelect?.(null)}
      className={cn('rounded-bw-field border px-3 py-1.5 text-bw-small', !active ? 'border-bw-action bg-bw-action-soft font-semibold' : 'border-bw-line hover:bg-bw-sunken')}>
      الكل <Code>{totals.total}</Code>
    </button>
    {order.filter((outcome) => totals[outcome]).map((outcome) => (
      <button key={outcome} type="button" aria-pressed={active === outcome} onClick={() => onSelect?.(outcome)}
        className={cn('inline-flex items-center gap-2 rounded-bw-field border px-3 py-1.5 text-bw-small', active === outcome ? 'border-bw-action bg-bw-action-soft font-semibold' : 'border-bw-line hover:bg-bw-sunken')}>
        <StatusLabel tone={outcomeLabel[outcome].tone}>{outcomeLabel[outcome].text}</StatusLabel>
        <Code>{totals[outcome]}</Code>
      </button>
    ))}
  </div>
}

function Flags({ row }: { row: IntakeRow }) {
  if (!row.readiness) return <span className="text-bw-ink-subtle">—</span>
  return <ul className="flex flex-wrap gap-1.5" aria-label="الجاهزية">
    {(['pdp', 'chatbot', 'routine', 'selling'] as const).map((key) => {
      const flag = row.readiness![key]
      return <li key={key} title={flag.missing.join('، ') || 'جاهز'}>
        <StatusLabel tone={flag.ready ? 'ok' : key === 'selling' ? 'pending' : 'warn'}>{flagLabel[key]}{flag.ready ? '' : ' — ناقص'}</StatusLabel>
      </li>
    })}
  </ul>
}

const price = (value: string | number | null) => (value === null || value === undefined ? '—' : Number(value).toLocaleString('en-US'))

/** Rows of one job. Admin view adds readiness and cost; the supplier view shows prices and the reason, never catalog candidates. */
export function RowsTable({ rows, view, action }: { rows: IntakeRow[]; view: 'admin' | 'supplier-file' | 'supplier'; action?: (row: IntakeRow) => React.ReactNode }) {
  const head = view === 'admin' ? ['#', 'الاسم', 'النتيجة', 'السبب', 'الجاهزية', 'التكلفة', ''] : ['#', 'الصنف', 'سعر الشراء', 'سعر المستهلك', 'النتيجة', 'السبب', ...(action ? [''] : [])]
  return <DataTable caption="أسطر الإدخال" head={head}>
    {rows.map((row) => <tr key={row.id}>
      <td><Code>{row.rowNumber}</Code></td>
      <td className="max-w-80"><bdi className="line-clamp-2 font-semibold text-bw-ink">{row.rawName || '—'}</bdi></td>
      {view === 'admin' ? <>
        <td><StatusLabel tone={outcomeLabel[row.outcome].tone}>{outcomeLabel[row.outcome].text}</StatusLabel></td>
        <td className="max-w-72 text-bw-ink-soft">{reasonOf(row)}</td>
        <td><Flags row={row} /></td>
        <td className="whitespace-nowrap text-bw-ink-soft">{row.cost ? <><Code>{row.cost.searches ?? 0}</Code> بحث · <Code>{row.cost.pageFetches ?? 0}</Code> صفحة</> : '—'}</td>
        <td>{action?.(row)}</td>
      </> : <>
        <td dir="ltr" className="text-end"><Code>{price(row.purchasePrice)}</Code></td>
        <td dir="ltr" className="text-end"><Code>{price(row.consumerPrice)}</Code></td>
        <td><StatusLabel tone={outcomeLabel[row.outcome].tone}>{outcomeLabel[row.outcome].text}</StatusLabel></td>
        <td className="max-w-72 text-bw-ink-soft">{reasonOf(row)}</td>
        {action ? <td>{action(row)}</td> : null}
      </>}
    </tr>)}
  </DataTable>
}

/** One spreadsheet picker with the accepted formats in words. */
export function FilePicker({ file, onFile, disabled }: { file: File | null; onFile: (file: File | null) => void; disabled?: boolean }) {
  const id = React.useId()
  return <div className="space-y-1.5">
    <label htmlFor={id} className="block text-bw-small font-semibold text-bw-ink">ملف الأسعار أو الأسماء</label>
    <label htmlFor={id} className={cn('flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-bw-card border border-dashed border-bw-line-field bg-bw-sunken/40 p-4 text-center hover:border-bw-action', disabled && 'pointer-events-none opacity-60')}>
      <Upload className="size-5 text-bw-ink-soft" aria-hidden />
      <span className="text-bw-small text-bw-ink">{file ? <bdi>{file.name}</bdi> : 'اختار ملف Excel أو CSV'}</span>
      <span className="text-[11px] text-bw-ink-subtle">.xlsx · .xls · .csv — حتى 10 ميجا</span>
    </label>
    <input id={id} type="file" accept=".xlsx,.xls,.csv,.tsv,.txt" className="sr-only" disabled={disabled} onChange={(event) => onFile(event.target.files?.[0] ?? null)} />
  </div>
}

/** Column problems the API reports (e.g. one ambiguous "price" column), with a way to name the column. */
export function ColumnProblem({ error, onMap }: { error: { message: string; code?: string; headers?: string[] } | null; onMap: (mapping: Record<string, number>) => void }) {
  const [column, setColumn] = React.useState<number>(-1)
  const [field, setField] = React.useState<'purchasePrice' | 'consumerPrice'>('purchasePrice')
  if (!error) return null
  const headers = error.headers ?? []
  return <Notice tone="danger" title="الملف محتاج توضيح">
    <p>{error.message}</p>
    {headers.length && (error.code === 'PRICE_TYPE_AMBIGUOUS' || error.code === 'PURCHASE_PRICE_COLUMN_MISSING') ? <div className="mt-3 flex flex-wrap items-end gap-2">
      <label className="space-y-1 text-bw-small">العمود
        <select className="block h-bw-control rounded-bw-field border border-bw-line-field bg-bw-surface px-2" value={column} onChange={(event) => setColumn(Number(event.target.value))}>
          <option value={-1}>اختار</option>
          {headers.map((header, index) => <option key={index} value={index}>{header || `عمود ${index + 1}`}</option>)}
        </select>
      </label>
      <label className="space-y-1 text-bw-small">هو
        <select className="block h-bw-control rounded-bw-field border border-bw-line-field bg-bw-surface px-2" value={field} onChange={(event) => setField(event.target.value as typeof field)}>
          <option value="purchasePrice">سعر الشراء</option>
          <option value="consumerPrice">سعر المستهلك</option>
        </select>
      </label>
      <Button variant="secondary" disabled={column < 0} onClick={() => onMap({ [field]: column })}>ارفع تاني بالتحديد ده</Button>
    </div> : null}
  </Notice>
}

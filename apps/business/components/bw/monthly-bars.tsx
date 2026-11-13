import { cn } from '@/lib/utils'

export type MonthBar = {
  key: string
  label: string
  revenue: number
  /** Null while the month is INCOMPLETE: drawn as an open outline, never as zero. */
  net: number | null
  closed?: boolean
}

const HEIGHT = 150

/**
 * Compact monthly trend: revenue (quiet bar) beside net profit (strong bar, or an open outline while incomplete).
 * Mirrored for RTL by the document direction: the oldest month is on the inline-start side.
 */
export function MonthlyBars({ months, formatValue, ariaLabel, emptyLabel, incompleteLabel }: {
  months: MonthBar[]
  formatValue: (value: number) => string
  ariaLabel: string
  emptyLabel: string
  incompleteLabel: string
}) {
  const hasAny = months.some((month) => month.revenue !== 0 || (month.net ?? 0) !== 0)
  if (!hasAny) return <p className="grid h-32 place-items-center text-center text-bw-small text-bw-ink-subtle">{emptyLabel}</p>

  const top = Math.max(...months.flatMap((month) => [month.revenue, month.net ?? 0]), 1)
  const bottom = Math.max(...months.map((month) => Math.max(-(month.net ?? 0), 0)), 0)
  const span = top + bottom
  const baseline = (bottom / span) * HEIGHT // distance from the bottom edge to the zero line
  const h = (value: number) => Math.max(2, (Math.abs(value) / span) * HEIGHT)

  return (
    <div>
      <div role="img" aria-label={ariaLabel} className="relative flex items-stretch gap-3" style={{ height: HEIGHT + 28 }}>
        <div aria-hidden className="pointer-events-none absolute inset-x-0 border-t border-bw-line" style={{ bottom: baseline + 22 }} />
        {months.map((month) => (
          <div key={month.key} className="group relative flex min-w-0 flex-1 flex-col items-center" title={`${month.label} · ${formatValue(month.revenue)}${month.net === null ? ` · ${incompleteLabel}` : ` · ${formatValue(month.net)}`}`}>
            <div className="relative flex w-full flex-1 items-end justify-center gap-1">
              <span className="relative block w-1/3 max-w-5" style={{ height: HEIGHT, bottom: 0 }}>
                <span className="bw-meter-fill absolute inset-x-0 rounded-t-sm bg-bw-cobalt/35" style={{ bottom: baseline, height: h(month.revenue) }} />
              </span>
              <span className="relative block w-1/3 max-w-5" style={{ height: HEIGHT }}>
                {month.net === null ? (
                  <span className="absolute inset-x-0 rounded-t-sm border border-dashed border-bw-amber/70" style={{ bottom: baseline, height: 28 }} />
                ) : (
                  <span
                    className={cn('bw-meter-fill absolute inset-x-0', month.net >= 0 ? 'rounded-t-sm bg-bw-emerald' : 'rounded-b-sm bg-bw-rose')}
                    style={month.net >= 0 ? { bottom: baseline, height: h(month.net) } : { bottom: baseline - h(month.net), height: h(month.net) }}
                  />
                )}
              </span>
            </div>
            <span className={cn('mt-2 h-5 truncate text-[11px]', month.closed ? 'text-bw-ink-soft' : 'text-bw-ink-subtle')}>{month.label}</span>
          </div>
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-bw-ink-subtle">
        <li className="flex items-center gap-1.5"><span aria-hidden className="size-2 rounded-sm bg-bw-cobalt/35" />الإيراد</li>
        <li className="flex items-center gap-1.5"><span aria-hidden className="size-2 rounded-sm bg-bw-emerald" />صافي الربح</li>
        <li className="flex items-center gap-1.5"><span aria-hidden className="size-2 rounded-sm border border-dashed border-bw-amber/70" />{incompleteLabel}</li>
      </ul>
      <table className="sr-only">
        <caption>{ariaLabel}</caption>
        <tbody>
          {months.map((month) => <tr key={month.key}><th scope="row">{month.label}</th><td>{formatValue(month.revenue)}</td><td>{month.net === null ? incompleteLabel : formatValue(month.net)}</td></tr>)}
        </tbody>
      </table>
    </div>
  )
}

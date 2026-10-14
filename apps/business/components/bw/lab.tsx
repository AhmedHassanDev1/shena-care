import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { StateSwitcher, SyntheticBanner } from './primitives'

/* Design-lab chrome only (GLO-230): never part of a production screen. */
export function LabBar({ base, states, current }: { base: string; states: Array<{ id: string; label: string }>; current: string }) {
  return (
    <div className="border-b border-bw-line bg-bw-surface">
      <SyntheticBanner />
      <div className="flex flex-wrap items-center gap-3 px-4 py-2">
        <Link href="/design" className="inline-flex min-h-6 items-center gap-1 text-bw-small font-semibold text-bw-action">
          <ArrowRight className="size-4" aria-hidden />
          الأساسيات
        </Link>
        <StateSwitcher base={base} states={states} current={current} />
      </div>
    </div>
  )
}

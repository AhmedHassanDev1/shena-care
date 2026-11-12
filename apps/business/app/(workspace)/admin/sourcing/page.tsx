'use client'

import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Activity, Truck } from 'lucide-react'
import { PageHeader } from '@/components/bw/primitives'
import { Page } from '@/components/workspace/kit'
import { RoleShell } from '@/components/workspace/role-shell'
import { cn } from '@/lib/utils'
import { MonitorTab } from './monitor-tab'
import { SuppliersTab } from './suppliers-tab'

const TABS = [
  { key: 'suppliers', label: 'الموردون', icon: Truck },
  { key: 'monitor', label: 'متابعة التوريد', icon: Activity },
] as const

type TabKey = (typeof TABS)[number]['key']

/** Suppliers & Sourcing: one page, two tabs. The tab lives in the URL so a refresh or a shared link lands on the same one. */
export default function AdminSourcing() {
  return (
    <React.Suspense fallback={null}>
      <SourcingPage />
    </React.Suspense>
  )
}

function SourcingPage() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const tab: TabKey = params.get('tab') === 'monitor' ? 'monitor' : 'suppliers'

  const select = (next: TabKey) => router.replace(next === 'suppliers' ? pathname : `${pathname}?tab=${next}`, { scroll: false })

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    select(tab === 'suppliers' ? 'monitor' : 'suppliers')
  }

  return (
    <RoleShell role="admin" active="sourcing" mode="desktop">
      <Page>
        <PageHeader title="الموردون والتوريد" />
        <div role="tablist" aria-label="أقسام الموردين والتوريد" onKeyDown={onKeyDown} className="flex gap-6 border-b border-bw-line">
          {TABS.map(({ key, label, icon: Icon }) => {
            const selected = tab === key
            return (
              <button
                key={key}
                type="button"
                role="tab"
                id={`sourcing-tab-${key}`}
                aria-selected={selected}
                aria-controls="sourcing-panel"
                tabIndex={selected ? 0 : -1}
                onClick={() => select(key)}
                className={cn(
                  '-mb-px flex min-h-11 items-center gap-2 border-b-2 px-1 text-bw-body font-semibold transition-colors',
                  selected ? 'border-bw-cobalt text-bw-ink' : 'border-transparent text-bw-ink-soft hover:text-bw-ink',
                )}
              >
                <Icon className={cn('size-4', selected ? 'text-bw-cobalt' : 'text-bw-ink-subtle')} aria-hidden />
                {label}
              </button>
            )
          })}
        </div>
        <div role="tabpanel" id="sourcing-panel" aria-labelledby={`sourcing-tab-${tab}`}>
          {tab === 'suppliers' ? <SuppliersTab /> : <MonitorTab />}
        </div>
      </Page>
    </RoleShell>
  )
}

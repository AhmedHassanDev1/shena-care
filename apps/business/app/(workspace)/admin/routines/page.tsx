'use client'

import Link from 'next/link'
import { FileUp, Plus, RefreshCw } from 'lucide-react'
import { Button, Code, PageHeader, Section, Skeleton, StateBlock } from '@/components/bw/primitives'
import { Page, Status } from '@/components/workspace/kit'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { formatDateTime } from '@/lib/labels'
import { ROUTINE_STATUS, type RoutineListItem } from '@/lib/routines'
import { useApi } from '@/lib/use-api'

/** Routine Studio: Ready Routine templates. Drafts are private until an Admin publishes them. */
export default function RoutinesPage() {
  const { data, error, loading, reload } = useApi<RoutineListItem[]>('/care/admin/studio/routines')
  return (
    <RoleShell role="admin" active="routines" mode="desktop">
      <Page>
        <PageHeader title="الروتينات الجاهزة" meta="مسودة ← معاينة ← نشر. الروتين المنشور يظهر للعملاء، والمسودة لا تظهر لأحد."
          actions={<div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={reload}><RefreshCw className="size-4" aria-hidden />تحديث</Button>
            <Link href="/admin/routines/import" className="inline-flex"><Button variant="secondary" type="button"><FileUp className="size-4" aria-hidden />استيراد JSON</Button></Link>
            <Link href="/admin/routines/new" className="inline-flex"><Button type="button"><Plus className="size-4" aria-hidden />روتين جديد</Button></Link>
          </div>} />
        {error ? <LoadError message={error.message} onRetry={reload} /> : null}
        {!data && loading ? <Skeleton className="h-40 w-full" /> : null}
        {data && data.length === 0 ? <StateBlock kind="empty" title="مفيش روتينات لسه" body="ابدأ بروتين جديد أو استورد ملف JSON." /> : null}
        {data?.length ? (
          <Section>
            <ul className="divide-y divide-bw-line">
              {data.map((routine) => (
                <li key={routine.id}>
                  <Link href={`/admin/routines/${routine.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 hover:bg-bw-sunken">
                    <span className="min-w-0 flex-1 font-semibold"><bdi>{routine.title}</bdi></span>
                    <Status map={ROUTINE_STATUS} value={routine.status} />
                    <span className="text-bw-small text-bw-ink-soft">{routine.concernSlug ? <Code>{routine.concernSlug}</Code> : '—'} · {routine.steps} خطوات · إصدار <Code>{routine.version}</Code></span>
                    <span className="text-bw-small text-bw-ink-soft">{formatDateTime(routine.updatedAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
      </Page>
    </RoleShell>
  )
}

'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Skeleton, StateBlock } from '@/components/bw/primitives'
import { type Role, type WorkspaceMode, WorkspaceFrame } from '@/components/bw/workspace-frame'
import { type StaffRole, type WorkspaceMe, homeFor, useSession } from '@/lib/session'

const MeContext = React.createContext<WorkspaceMe | null>(null)

export function useMe(): WorkspaceMe {
  const me = React.useContext(MeContext)
  if (!me) throw new Error('useMe outside RoleShell')
  return me
}

const REQUIRED: Record<Role, StaffRole[]> = {
  admin: ['ADMIN'],
  hub: ['HUB_OPERATOR', 'ADMIN'],
  supplier: ['SUPPLIER'],
  driver: ['DRIVER'],
  partner: ['CAPITAL_PARTNER'],
}

/**
 * Session + role gate around a role workspace. Hiding pages is convenience only: every call is still
 * authorised by the API, so a forbidden view here is a courtesy, not the control.
 */
export function RoleShell({
  role,
  active,
  mode = 'responsive',
  counts,
  task,
  exitHref,
  children,
}: {
  role: Role
  active: string
  mode?: WorkspaceMode
  counts?: Record<string, number | undefined>
  /** Task mode (scanner station): the task name and where "exit task" returns. */
  task?: string
  exitHref?: string
  children: React.ReactNode
}) {
  const { state, logout } = useSession()
  const router = useRouter()

  React.useEffect(() => {
    if (state.status === 'anonymous') router.replace('/login')
  }, [state, router])

  if (state.status !== 'ready') {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }
  const me = state.me
  if (!me.roles.some((r) => REQUIRED[role].includes(r))) {
    return (
      <StateBlock
        kind="forbidden"
        title="مالكش صلاحية على الصفحة دي"
        body="الصفحة دي لدور تاني. ارجع لمساحة شغلك."
        action={<a className="font-semibold text-bw-action-ink underline" href={homeFor(me)}>مساحة شغلي</a>}
      />
    )
  }
  const operator = me.supplierName ? `${me.name} · ${me.supplierName}` : me.name
  // One person, two separate roles: a plain link to the other workspace. Each workspace still authorises its own calls.
  const extraNav = role === 'partner'
    ? (me.roles.includes('HUB_OPERATOR') ? [{ id: 'hub-link', label: 'مساحة المخزن', href: '/hub' }] : [])
    : role === 'hub' && me.roles.includes('CAPITAL_PARTNER') ? [{ id: 'partner-link', label: 'بوابة الشريك', href: '/partner' }] : []
  return (
    <MeContext.Provider value={me}>
      <WorkspaceFrame
        role={role}
        active={active}
        mode={mode}
        operator={operator}
        counts={counts}
        task={task}
        exitHref={exitHref}
        extraNav={extraNav}
        onLogout={async () => {
          await logout()
          router.replace('/login')
        }}
      >
        {children}
      </WorkspaceFrame>
    </MeContext.Provider>
  )
}

/** Inline API error with retry, used by every list/detail. */
export function LoadError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <StateBlock
      kind="error"
      title="مقدرناش نجيب البيانات"
      body={message}
      action={onRetry ? <button type="button" onClick={onRetry} className="font-semibold text-bw-action-ink underline">حاول تاني</button> : undefined}
    />
  )
}

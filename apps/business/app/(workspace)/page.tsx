'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Skeleton } from '@/components/bw/primitives'
import { homeFor, useSession } from '@/lib/session'

/** Sends each account to its own workspace; anonymous visitors to login. */
export default function WorkspaceHome() {
  const { state } = useSession()
  const router = useRouter()
  React.useEffect(() => {
    if (state.status === 'anonymous') router.replace('/login')
    if (state.status === 'ready') router.replace(homeFor(state.me))
  }, [state, router])
  return <div className="p-6"><Skeleton className="h-10 w-48" /></div>
}

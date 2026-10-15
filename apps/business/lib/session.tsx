'use client'

import * as React from 'react'
import { api, ApiError, getToken, onUnauthorized, setToken } from '@/lib/api'
import { NotAuthorizedError } from '@/lib/auth/errors'
import { MOCK_OVERVIEW } from '@/lib/overview-source'

export type StaffRole = 'ADMIN' | 'HUB_OPERATOR' | 'SUPPLIER' | 'DRIVER' | 'CUSTOMER'

export interface WorkspaceMe {
  id: string
  name: string
  email: string
  roles: StaffRole[]
  supplierId: string | null
  supplierName: string | null
  hubLocations: Array<{ id: string; name: string; address: string }>
}

type SessionState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'ready'; me: WorkspaceMe }

/** Why the last session ended; lets the sign-in screen say so (expired) or stay quiet (chosen). */
export type SessionEnd = 'expired' | 'logout' | null

interface SessionApi {
  state: SessionState
  endedBy: SessionEnd
  /** Email + password. */
  login: (email: string, password: string) => Promise<WorkspaceMe>
  /** Adopts a session token the API just issued (staff phone code) and loads who it belongs to. */
  adopt: (token: string) => Promise<WorkspaceMe>
  logout: () => Promise<void>
}

const SessionContext = React.createContext<SessionApi | null>(null)

/** Role home: the first workspace an account may use. */
export function homeFor(me: WorkspaceMe): string {
  if (me.roles.includes('ADMIN')) return '/admin'
  if (me.roles.includes('HUB_OPERATOR')) return '/hub'
  if (me.roles.includes('SUPPLIER')) return '/supplier'
  if (me.roles.includes('DRIVER')) return '/driver'
  return '/login'
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<SessionState>({ status: 'loading' })
  const [endedBy, setEndedBy] = React.useState<SessionEnd>(null)

  const load = React.useCallback(async () => {
    if (MOCK_OVERVIEW) {
      // Explicit development-only demo mode (see overview-source.ts): a labelled local identity so the
      // Admin Overview renders without a backend. No token exists, so every real API call still 401s.
      return setState({
        status: 'ready',
        me: { id: 'demo-admin', name: 'مدير تجريبي', email: 'demo@shinacare.invalid', roles: ['ADMIN'], supplierId: null, supplierName: null, hubLocations: [] },
      })
    }
    if (!getToken()) return setState({ status: 'anonymous' })
    try {
      setState({ status: 'ready', me: await api<WorkspaceMe>('/workspace/me') })
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) setToken(null)
      setState({ status: 'anonymous' })
    }
  }, [])

  React.useEffect(() => {
    load()
    return onUnauthorized(() => {
      setToken(null)
      setEndedBy('expired')
      setState({ status: 'anonymous' })
    })
  }, [load])

  const adopt = React.useCallback(async (token: string) => {
    setToken(token)
    let me: WorkspaceMe
    try {
      me = await api<WorkspaceMe>('/workspace/me')
    } catch (error) {
      setToken(null)
      throw error
    }
    if (homeFor(me) === '/login') {
      // A valid account without a workspace role (e.g. a shopper) must not keep a live session here.
      try {
        await api('/accounts/logout', { method: 'POST' })
      } catch {
        /* the token is dropped locally either way */
      }
      setToken(null)
      throw new NotAuthorizedError()
    }
    setEndedBy(null)
    setState({ status: 'ready', me })
    return me
  }, [])

  const value = React.useMemo<SessionApi>(() => ({
    state,
    endedBy,
    adopt,
    login: async (email, password) => {
      const { token } = await api<{ token: string }>('/accounts/login', { body: { email, password }, public: true })
      return adopt(token)
    },
    logout: async () => {
      try {
        await api('/accounts/logout', { method: 'POST' })
      } catch {
        /* the token is dropped locally either way */
      }
      setToken(null)
      setEndedBy('logout')
      setState({ status: 'anonymous' })
    },
  }), [state, endedBy, adopt])

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionApi {
  const context = React.useContext(SessionContext)
  if (!context) throw new Error('useSession outside SessionProvider')
  return context
}

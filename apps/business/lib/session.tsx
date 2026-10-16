'use client'

import * as React from 'react'
import { api, ApiError, getToken, onUnauthorized, setToken } from '@/lib/api'

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

interface SessionApi {
  state: SessionState
  login: (email: string, password: string) => Promise<WorkspaceMe>
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

const DEV_DEFAULT_ME: WorkspaceMe = {
  id: 'dev-admin-id',
  name: 'مدير النظام (تطوير)',
  email: 'admin@shenacare.dev',
  roles: ['ADMIN', 'HUB_OPERATOR'],
  supplierId: null,
  supplierName: null,
  hubLocations: [
    { id: 'dev-hub-1', name: 'المخزن الرئيسي', address: 'المعادي، القاهرة' },
  ],
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<SessionState>({ status: 'loading' })

  const load = React.useCallback(async () => {
    const token = getToken()
    if (!token) {
      if (process.env.NODE_ENV === 'development') {
        return setState({ status: 'ready', me: DEV_DEFAULT_ME })
      }
      return setState({ status: 'anonymous' })
    }
    try {
      setState({ status: 'ready', me: await api<WorkspaceMe>('/workspace/me') })
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setToken(null)
        if (process.env.NODE_ENV === 'development') {
          return setState({ status: 'ready', me: DEV_DEFAULT_ME })
        }
      }
      if (process.env.NODE_ENV === 'development') {
        return setState({ status: 'ready', me: DEV_DEFAULT_ME })
      }
      setState({ status: 'anonymous' })
    }
  }, [])

  React.useEffect(() => {
    load()
    return onUnauthorized(() => {
      setToken(null)
      if (process.env.NODE_ENV === 'development') {
        setState({ status: 'ready', me: DEV_DEFAULT_ME })
      } else {
        setState({ status: 'anonymous' })
      }
    })
  }, [load])

  const value = React.useMemo<SessionApi>(() => ({
    state,
    login: async (email, password) => {
      const { token } = await api<{ token: string }>('/accounts/login', { body: { email, password } })
      setToken(token)
      const me = await api<WorkspaceMe>('/workspace/me')
      setState({ status: 'ready', me })
      return me
    },
    logout: async () => {
      try {
        await api('/accounts/logout', { method: 'POST' })
      } catch {
        /* the token is dropped locally either way */
      }
      setToken(null)
      setState({ status: 'anonymous' })
    },
  }), [state])

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionApi {
  const context = React.useContext(SessionContext)
  if (!context) throw new Error('useSession outside SessionProvider')
  return context
}

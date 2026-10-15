'use client'

import * as React from 'react'
import { StateBlock } from '@/components/bw/primitives'
import { RoleShell, useMe } from '@/components/workspace/role-shell'

const HUB_KEY = 'bw.hub.v1'
const HubContext = React.createContext<{ id: string; name: string } | null>(null)

export function useHub() {
  const hub = React.useContext(HubContext)
  if (!hub) throw new Error('useHub outside HubShell')
  return hub
}

/** Hub desk shell: the operator works at one of their assigned hubs; the API enforces the assignment. */
export function HubShell({ active, children }: { active: string; children: React.ReactNode }) {
  return (
    <RoleShell role="hub" active={active} mode="desktop">
      <HubPicker>{children}</HubPicker>
    </RoleShell>
  )
}

function HubPicker({ children }: { children: React.ReactNode }) {
  const me = useMe()
  const [hubId, setHubId] = React.useState<string | null>(null)
  React.useEffect(() => {
    let saved: string | null = null
    try { saved = window.localStorage.getItem(HUB_KEY) } catch { /* ignore */ }
    setHubId(me.hubLocations.find((h) => h.id === saved)?.id ?? me.hubLocations[0]?.id ?? null)
  }, [me.hubLocations])
  if (me.hubLocations.length === 0) {
    return <StateBlock kind="forbidden" title="مش متعيّن على أي مخزن" body="اطلب من الإدارة تعيينك على مخزن." />
  }
  const hub = me.hubLocations.find((h) => h.id === hubId)
  if (!hub) return null
  return (
    <HubContext.Provider value={hub}>
      {me.hubLocations.length > 1 ? (
        <div className="flex items-center gap-2 border-b border-bw-line bg-bw-surface px-4 py-2 text-bw-small">
          <label htmlFor="hub-picker" className="font-semibold">المخزن</label>
          <select id="hub-picker" value={hub.id} className="h-bw-control rounded-bw-field border-[1.5px] border-bw-line-field px-2"
            onChange={(e) => { setHubId(e.target.value); try { window.localStorage.setItem(HUB_KEY, e.target.value) } catch { /* ignore */ } }}>
            {me.hubLocations.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        </div>
      ) : null}
      {children}
    </HubContext.Provider>
  )
}

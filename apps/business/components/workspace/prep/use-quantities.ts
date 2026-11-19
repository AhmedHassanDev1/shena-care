'use client'

import * as React from 'react'
import { clampQuantity } from './quantity'

type Line = { orderItemId: string; required: number }
export interface Quantities { get: (line: Line) => number; set: (line: Line, value: number) => void }

/**
 * Declared quantity per line of one order, default = the full required quantity. Kept on this device (the API has no shortage record), per order,
 * and never touches scan progress or any server state.
 */
export function useQuantities(orderId: string) {
  const key = `bw.prep.qty.v1.${orderId}`
  const [changed, setChanged] = React.useState<Record<string, number>>({})
  React.useEffect(() => {
    try { setChanged(JSON.parse(window.localStorage.getItem(key) ?? '{}')) } catch { setChanged({}) }
  }, [key])

  const get = React.useCallback((line: Line) => clampQuantity(changed[line.orderItemId] ?? line.required, line.required), [changed])
  const set = React.useCallback((line: Line, value: number) => {
    const next = { ...changed }
    const quantity = clampQuantity(value, line.required)
    if (quantity === line.required) delete next[line.orderItemId]
    else next[line.orderItemId] = quantity
    setChanged(next)
    try { window.localStorage.setItem(key, JSON.stringify(next)) } catch { /* private mode: the change lasts for this screen only */ }
  }, [changed, key])
  return { get, set }
}

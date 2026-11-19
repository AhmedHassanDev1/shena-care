'use client'

import * as React from 'react'
import { clampQuantity } from './quantity'

type Line = { orderItemId: string; required: number; received: number }
export interface Quantities { get: (line: Line) => number; set: (line: Line, value: number) => void }

/**
 * The quantity available per line of one order while the operator works (default: the full required quantity). It is only a draft on this
 * screen: nothing is stored from here. It becomes real when the operator confirms (units received, shortage reported to the server).
 */
export function useQuantities(orderId: string): Quantities {
  const [draft, setDraft] = React.useState<Record<string, number>>({})
  React.useEffect(() => { setDraft({}) }, [orderId])
  const get = React.useCallback((line: Line) => clampQuantity(draft[line.orderItemId] ?? line.required, line.received, line.required), [draft])
  const set = React.useCallback((line: Line, value: number) => {
    setDraft((all) => ({ ...all, [line.orderItemId]: clampQuantity(value, line.received, line.required) }))
  }, [])
  return { get, set }
}

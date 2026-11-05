'use client'

/*
 * Supplier RFQ live channel. The server snapshot is the only source of truth; this module just keeps it fresh:
 * it opens the authenticated SSE stream (fetch, so the Bearer header works), resumes from the last event it saw,
 * reconnects with backoff, and tells the page to re-read the snapshot on every (re)connect and every change.
 */

import * as React from 'react'
import { getToken } from '@/lib/api'

const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '')
const STALL_MS = 60_000

export interface RfqStreamMessage {
  id?: string
  event: string
  data: Record<string, unknown> & { rfqId?: string }
}

export type LiveStatus = 'connecting' | 'live' | 'reconnecting'

/** Parses `id:`/`event:`/`data:` blocks separated by a blank line. */
export function parseSseBlock(block: string): RfqStreamMessage | null {
  const message: RfqStreamMessage = { event: 'message', data: {} }
  let hasData = false
  for (const line of block.split('\n')) {
    if (line.startsWith('id:')) message.id = line.slice(3).trim()
    else if (line.startsWith('event:')) message.event = line.slice(6).trim()
    else if (line.startsWith('data:')) {
      try {
        message.data = JSON.parse(line.slice(5).trim())
        hasData = true
      } catch {
        return null
      }
    }
  }
  return hasData ? message : null
}

/**
 * Keeps one stream open while mounted. `onConnected` fires after every successful (re)connect so the page re-reads the
 * authoritative snapshot (events that were missed while offline are reconciled from it, never assumed).
 */
export function useRfqStream(handlers: { onMessage: (message: RfqStreamMessage) => void; onConnected: () => void }): LiveStatus {
  const [status, setStatus] = React.useState<LiveStatus>('connecting')
  const ref = React.useRef(handlers)
  ref.current = handlers

  React.useEffect(() => {
    let stopped = false
    let controller: AbortController | null = null
    let cursor: string | null = null
    let attempt = 0
    let timer: number | undefined

    const run = async () => {
      while (!stopped) {
        controller = new AbortController()
        let stall: number | undefined
        const armStall = () => {
          window.clearTimeout(stall)
          stall = window.setTimeout(() => controller?.abort(), STALL_MS)
        }
        try {
          const token = getToken()
          const response = await fetch(`${API_URL}/rfq/stream${cursor ? `?after=${cursor}` : ''}`, {
            headers: { Accept: 'text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cursor ? { 'Last-Event-ID': cursor } : {}) },
            cache: 'no-store',
            signal: controller.signal,
          })
          if (!response.ok || !response.body) throw new Error(`stream ${response.status}`)
          attempt = 0
          setStatus('live')
          armStall()
          ref.current.onConnected()
          const reader = response.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ''
          while (!stopped) {
            const { value, done } = await reader.read()
            if (done) break
            armStall()
            buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
            let index
            while ((index = buffer.indexOf('\n\n')) >= 0) {
              const message = parseSseBlock(buffer.slice(0, index))
              buffer = buffer.slice(index + 2)
              if (!message) continue
              if (message.id) cursor = message.id
              else if (message.event === 'ready' && typeof message.data.cursor === 'string' && !cursor) cursor = message.data.cursor
              if (message.event !== 'ping' && message.event !== 'ready') ref.current.onMessage(message)
            }
          }
        } catch {
          /* dropped or refused: fall through to the backoff below */
        } finally {
          window.clearTimeout(stall)
        }
        if (stopped) return
        setStatus('reconnecting')
        attempt += 1
        await new Promise<void>((resolve) => {
          timer = window.setTimeout(resolve, Math.min(1000 * 2 ** (attempt - 1), 10_000))
        })
      }
    }
    void run()
    return () => {
      stopped = true
      controller?.abort()
      window.clearTimeout(timer)
    }
  }, [])

  return status
}

export interface RfqLineView {
  demandLineId: string
  skuId: string
  sku: {
    productName: string
    brandName: string | null
    variantName: string
    skuCode: string
    barcode: string | null
    size?: number | null
    sizeUnit?: string | null
    imageUrl?: string | null
  } | null
  originalQuantity: number
  requestedQuantity: number
  version: number
  state: 'actionable' | 'answered' | 'fulfilled_elsewhere' | 'withdrawn' | 'closed'
  myAnswer: { answer: 'FULL' | 'PARTIAL' | 'UNAVAILABLE'; offeredQuantity: number; awardedQuantity: number } | null
}

export interface RfqSnapshot {
  rfq: { id: string; batchRef: string; status: string; expedited: boolean; createdAt: string }
  recipient: { status: string; deadlineAt: string }
  cursor: string
  lines: RfqLineView[]
  purchaseOrders: Array<{ id: string; status: string; issuedAt: string | null; expedited: boolean }>
}

export interface RfqListItem {
  rfqId: string
  batchRef: string
  status: string
  expedited: boolean
  recipientStatus: string
  deadlineAt: string
  createdAt: string
  lineCount: number
  actionableLineCount: number
}

'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

/*
 * Capital partner portal: shared types and presentation. Every number comes from the API (the finance model's own figures);
 * nothing is calculated here except sums of rows the API already returned for display. Status always carries words.
 */

export type SettlementState = 'PENDING' | 'NO_PROFIT' | 'UNSETTLED' | 'DUE' | 'PARTIAL' | 'PAID'
export type MovementEffect = 'FUNDED' | 'RETURNED' | 'INFO'

export interface Movement {
  id: string
  date: string
  type: string
  effect: MovementEffect
  amount: number | null
  status: string
  reference: string
  orderNumber: string | null
  source: string
  details: Record<string, unknown>
}

export interface MonthSummary {
  period: string
  status: 'COMPLETE' | 'INCOMPLETE'
  settlement: SettlementState
  closed: boolean
  monthEnded: boolean
  distributableProfit: number | null
  partnerShare: number | null
  paid: number
  remaining: number | null
}

export interface Overview {
  currency: string
  range: { from: string; to: string; months: number }
  split: { platformPercent: number; partnerPercent: number }
  capital: {
    funded: { total: number; products: number; directCosts: { total: number; delivery: number; packaging: number; approvedExpenses: number } }
    returned: number
    notReturnedYet: number
    recoveredFromSettledOrders: number
    pendingApprovalDirectCosts: { amount: number; count: number }
    lifetime: { since: string | null; truncated: boolean; funded: number; returned: number; outstanding: number }
    unresolvedGoods: { status: 'AVAILABLE' | 'INCOMPLETE' | 'NO_DATA'; amount: number | null; note: string }
  }
  profit: {
    status: 'COMPLETE' | 'INCOMPLETE'
    incompleteMonths: string[]
    distributableProfit: number | null
    platformShare: number | null
    partnerShare: number | null
    paid: number
    remaining: number | null
    payableNow: number
  }
  cash: {
    expectedOnRoad: { amount: number; orders: number }
    inCourierCustody: { amount: number; orders: number }
    disputed: { amount: number; orders: number }
    settlements: { count: number; counted: number; declared: number; variance: number; fees: number } | null
  }
  months: MonthSummary[]
  recent: Movement[]
}

export interface Statement {
  period: string
  status: 'COMPLETE' | 'INCOMPLETE'
  settlement: SettlementState
  closed: { at: string } | null
  monthEnded: boolean
  legacyShape: boolean
  missing: Array<{ code: string; orders: number }>
  deliveredOrders: number
  sales: { grossSales: number; discounts: number; netSales: number; productRefunds: number; netSalesAfterRefunds: number; deliveryRevenue: number }
  costs: { products: number; delivery: number; packaging: number; confirmedDamages: number; directCosts: number; total: number }
  distributableProfit: number | null
  split: { platformPercent: number; platformShare: number | null; partnerPercent: number; partnerShare: number | null; partnerShareNow: number | null }
  profitPayout: { paid: number; remaining: number | null; payableNow: number | null }
  capital: { recoveredFromSettledOrders: number; tiedUpInUnsettledOrders: number; tiedUpInRecoverableGoods: number; returnedToPartnerInMonth: number }
  pendingCollection: { orders: number }
}

export interface StatementDetail extends Statement {
  range: { from: string; to: string }
  detailBasis: string
  orders: Array<{
    orderNumber: string; deliveredAt: string; grossGoods: number; discounts: number; netGoods: number; deliveryRevenue: number
    productCost: number | null; deliveryCost: number | null; deliveryCostEstimated: boolean; packaging: number | null; profit: number | null; cash: 'SETTLED' | 'PENDING'
  }>
  endedOrders: Array<{ orderNumber: string; endedAt: string; deliveryCost: number; packaging: number; recoverableGoods: number | null }>
  payouts: Array<{ id: string; paidOn: string; amount: number; reference: string; voided: boolean }>
}

// ───────────────────────────────────────────────────────────────────────────── formatting

export const money = (value: number | null | undefined) => (value === null || value === undefined ? '—' : `${value.toLocaleString('en-US', { maximumFractionDigits: 2 })} ج.م`)

export const cairoToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' })
export const thisMonth = () => cairoToday().slice(0, 7)

export const shiftMonth = (period: string, delta: number) => {
  const [y, m] = period.split('-').map(Number)
  const index = y * 12 + (m - 1) + delta
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`
}

export const monthName = (period: string, style: 'long' | 'short' = 'long') =>
  new Date(`${period}-15T12:00:00Z`).toLocaleDateString('ar-EG-u-nu-latn', { month: style, year: 'numeric', timeZone: 'UTC' })

export const dayLabel = (iso: string) => new Date(iso).toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Cairo' })

/** Amount that can be unknown: shows the reason in words instead of a number. */
export function Amount({ value, unknown = 'غير مسجّلة', className }: { value: number | null | undefined; unknown?: string; className?: string }) {
  if (value === null || value === undefined) return <span className={cn('text-bw-ink-subtle', className)}>{unknown}</span>
  return <span className={cn('whitespace-nowrap tabular-nums', className)}><bdi className="bw-code">{value.toLocaleString('en-US', { maximumFractionDigits: 2 })}</bdi> ج.م</span>
}


/** The month range a "last N months" choice stands for. */
export const presetRange = (preset: '1' | '3' | '6' | '12') => ({ from: shiftMonth(thisMonth(), -(Number(preset) - 1)), to: thisMonth() })

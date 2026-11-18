import type { PrintState } from '@/components/workspace/pack-card'

/** The Hub desk payload (`GET /fulfillment/locations/:id/desk`) as the preparation screen reads it. */
export type Stage = 'waiting_purchase' | 'receiving' | 'verifying' | 'packing'

export interface DeskLine {
  orderItemId: string; skuId: string; productName: string | null; brandName: string | null; variantName: string | null
  skuCode: string | null; barcode: string | null; imageUrl: string | null; size: string | null
  required: number; purchased: number; received: number; verified: number
  productSlug: string | null
  /** The purchase behind this line (the next unit's, else the latest): the supplier's list price, the discount obtained off it and its percentage. */
  cost: DeskLineCost | null
}
export interface DeskLineCost {
  acquireKey: string; recorded: boolean; units: number; version: number | null
  listUnitPrice: string | null; discountPerUnit: string | null; discountPercent: string | null; finalUnitCost: string | null
}
export interface DeskUnit { receiptId: string; skuId: string; quantity: number; lotNumber: string | null; expiryDate: string | null; receivedAt: string; correctable: boolean }
export interface DeskCorrection { receiptId: string; reversesReceiptId: string; skuId: string; reason: string | null; note: string | null; at: string }
export interface DeskOrder {
  orderId: string; orderNumber: string; orderStatus: string; placedAt: string; governorate: string | null; area: string | null
  shipment: { id: string; status: string } | null; stage: Stage; lines: DeskLine[]; printEvents: string[]; print: PrintState
  units: DeskUnit[]; corrections: DeskCorrection[]; rejectedScans: number
}
export interface Desk {
  orders: DeskOrder[]; lastLots: Record<string, { lotNumber: string | null; expiryDate: string; recordedAt: string }>
  lastCosts: Record<string, { listUnitPrice: string; discountPerUnit: string; recordedAt: string }>
}
export interface ScanResult { outcome: 'received' | 'verified' | 'rejected'; code?: string; skuId?: string; order: DeskOrder | null }
export type Packaging = { packagingType: 'BAG' | 'BOX' | null; packagingCost: string | null }

/** What the person at the desk reads when a scan is refused: the problem and what to do, never a code. */
export const REJECT: Record<string, string> = {
  WRONG_ITEM: 'المنتج ده مش في الطلب ده. رجّعه مكانه.',
  PRODUCT_IDENTITY_REVIEW_REQUIRED: 'الباركود ده مش متسجّل لأي منتج. لو القطعة من الطلب وصنفها من غير باركود، افتح ⋯ على المنتج واختار «إضافة باركود».',
  PRODUCT_IDENTITY_AMBIGUOUS: 'الباركود ده متسجّل لأكتر من منتج. سجّل القطعة بـ «تسجيل بدون باركود» من ⋯ أو اطلب مراجعة الكتالوج.',
  ALREADY_COMPLETE: 'الصنف ده كمل في الطلب. المسح ده اتكرر ومااتحسبش.',
  NOT_PURCHASED_YET: 'القطعة دي لسه ماتسجّلتش «اتشترت» في المشتريات. سجّلها هناك الأول.',
  ORDER_NOT_OPEN: 'الطلب ده اتلغى أو اتقفل. ماتجهزوش.',
  COST_MISMATCH: 'المشتريات دي ليها تكلفة مسجّلة بقيمة مختلفة. صحّح التكلفة المسجّلة بسبب موثّق، مش من هنا.',
  PACKING_STARTED: 'الطلب اتأكد خلاص. كمّل التغليف والطباعة.',
}

export const STAGE_LABEL: Record<Stage, { label: string; tone: 'info' | 'warn' | 'ok' | 'neutral' }> = {
  receiving: { label: 'امسح البضاعة', tone: 'info' },
  verifying: { label: 'أكّد التجهيز', tone: 'warn' },
  packing: { label: 'تغليف وطباعة', tone: 'ok' },
  waiting_purchase: { label: 'مستني شراء', tone: 'neutral' },
}

const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '')
/** Product photos come from the catalog; a path served by the API gets its origin, anything absolute is used as is. */
export const imageSrc = (url: string | null) => {
  if (!url) return null
  // Media rows saved on a developer machine carry that machine's API origin; the same file is served by whichever API is configured here.
  const stored = url.match(/^https?:\/\/(?:localhost|127\.0\.0\.1):\d+(\/storage\/.*)$/)
  if (stored) return `${API_URL}${stored[1]}`
  return url.startsWith('/') ? `${API_URL}${url}` : url
}

export const shortNumber = (orderNumber: string) => orderNumber.replace(/^ORD-/, '#').slice(0, 9)
export const unitsOf = (order: DeskOrder) => order.lines.reduce((sum, line) => sum + line.required, 0)
export const receivedOf = (order: DeskOrder) => order.lines.reduce((sum, line) => sum + Math.min(line.received, line.required), 0)
export const productTitle = (line: DeskLine) => line.productName ?? 'منتج'
export const productMeta = (line: DeskLine) => [line.brandName, line.size, line.variantName === line.size ? null : line.variantName].filter(Boolean).join(' · ')

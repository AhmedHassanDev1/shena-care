/**
 * Development-only shipment barcode generator.
 * Strictly disabled in production. Matches apps/api signShipmentBarcode in dev/test mode.
 */
const DEV_ONLY_LABEL_SECRET = 'shena-care-dev-only-shipment-label-secret'

export async function getDevShipmentBarcode(shipmentId: string): Promise<string | null> {
  if (process.env.NODE_ENV === 'production') return null
  if (!shipmentId) return null
  try {
    const enc = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(DEV_ONLY_LABEL_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(shipmentId))
    const hex = Array.from(new Uint8Array(sigBuf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .substring(0, 16)
    return `SHP-${shipmentId.substring(0, 8).toUpperCase()}-${hex.toUpperCase()}`
  } catch {
    return null
  }
}

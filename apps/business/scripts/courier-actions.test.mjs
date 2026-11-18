import test from 'node:test'
import assert from 'node:assert/strict'
import {
  sanitizeEgyptianPhone,
  formatWhatsAppUrl,
  formatPhoneUrl,
  formatNavigationUrl,
} from '../lib/courier-actions.ts'

test('sanitizeEgyptianPhone formats Egyptian mobile numbers correctly', () => {
  assert.equal(sanitizeEgyptianPhone('01098765432'), '201098765432')
  assert.equal(sanitizeEgyptianPhone('+201098765432'), '201098765432')
  assert.equal(sanitizeEgyptianPhone('011-1234-5678'), '201112345678')
  assert.equal(sanitizeEgyptianPhone('012 345 67890'), '201234567890')
  assert.equal(sanitizeEgyptianPhone('01511122233'), '201511122233')
  assert.equal(sanitizeEgyptianPhone('invalid'), null)
  assert.equal(sanitizeEgyptianPhone(''), null)
  assert.equal(sanitizeEgyptianPhone(null), null)
})

test('formatWhatsAppUrl generates wa.me link or returns null', () => {
  assert.equal(formatWhatsAppUrl('01098765432'), 'https://wa.me/201098765432')
  assert.equal(formatWhatsAppUrl('+201112345678'), 'https://wa.me/201112345678')
  assert.equal(formatWhatsAppUrl('123'), null)
  assert.equal(formatWhatsAppUrl(null), null)
})

test('formatPhoneUrl generates tel link or returns null', () => {
  assert.equal(formatPhoneUrl('01098765432'), 'tel:01098765432')
  assert.equal(formatPhoneUrl('12'), null)
  assert.equal(formatPhoneUrl(null), null)
})

test('formatNavigationUrl handles coordinates and fallback address', () => {
  // Navigation URL given directly
  const withNav = formatNavigationUrl({ navigationUrl: 'https://maps.google.com/test' })
  assert.equal(withNav.url, 'https://maps.google.com/test')
  assert.equal(withNav.isCoordinates, true)

  // Coordinates given
  const withCoords = formatNavigationUrl({ latitude: 30.0444, longitude: 31.2357 })
  assert.equal(withCoords.url, 'https://www.google.com/maps/dir/?api=1&destination=30.0444,31.2357')
  assert.equal(withCoords.isCoordinates, true)

  // Fallback address
  const fallback = formatNavigationUrl(null, 'شارع مصدق، الدقي، الجيزة')
  assert.equal(fallback.isCoordinates, false)
  assert.ok(fallback.url.includes('google.com/maps/search'))

  // No coordinates and no address
  const empty = formatNavigationUrl(null, null)
  assert.equal(empty.url, null)
})

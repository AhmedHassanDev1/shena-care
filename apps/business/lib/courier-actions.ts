/**
 * Helper actions for driver communication and navigation.
 * Formats tel:, WhatsApp deep links, and Google Maps navigation safely.
 */

export function sanitizeEgyptianPhone(phone: string | null | undefined): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (!digits) return null

  // 01xxxxxxxxx (11 digits Egyptian mobile) -> 201xxxxxxxxx
  if (digits.length === 11 && digits.startsWith('01')) {
    return `20${digits.slice(1)}`
  }
  // 201xxxxxxxxx (12 digits with Egyptian country code)
  if (digits.length === 12 && digits.startsWith('201')) {
    return digits
  }
  // 1xxxxxxxxx (10 digits Egyptian mobile without leading zero)
  if (digits.length === 10 && digits.startsWith('1')) {
    return `20${digits}`
  }
  // Fallback for valid international numbers (at least 8 digits)
  if (digits.length >= 8) {
    return digits
  }
  return null
}

export function formatWhatsAppUrl(phone: string | null | undefined): string | null {
  const sanitized = sanitizeEgyptianPhone(phone)
  if (!sanitized) return null
  return `https://wa.me/${sanitized}`
}

export function formatPhoneUrl(phone: string | null | undefined): string | null {
  if (!phone) return null
  const trimmed = phone.trim()
  if (!trimmed || trimmed.replace(/\D/g, '').length < 6) return null
  return `tel:${trimmed}`
}

export function formatNavigationUrl(
  location: { latitude?: number | null; longitude?: number | null; navigationUrl?: string | null } | null | undefined,
  fallbackAddress?: string | null,
): { url: string | null; isCoordinates: boolean } {
  if (location?.navigationUrl) {
    return { url: location.navigationUrl, isCoordinates: true }
  }
  if (
    location?.latitude != null &&
    location?.longitude != null &&
    Number.isFinite(location.latitude) &&
    Number.isFinite(location.longitude) &&
    location.latitude !== 0 &&
    location.longitude !== 0
  ) {
    return {
      url: `https://www.google.com/maps/dir/?api=1&destination=${location.latitude},${location.longitude}`,
      isCoordinates: true,
    }
  }
  if (fallbackAddress && fallbackAddress.trim()) {
    return {
      url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fallbackAddress.trim())}`,
      isCoordinates: false,
    }
  }
  return { url: null, isCoordinates: false }
}

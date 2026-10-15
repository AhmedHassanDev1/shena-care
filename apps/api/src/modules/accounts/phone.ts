/**
 * Egyptian mobile normalisation for staff phone sign-in. Unlike the storefront helper it never falls
 * back to the raw input: anything that is not a real Egyptian mobile number (010/011/012/015) is rejected.
 */
const ARABIC_INDIC_ZERO = 0x0660
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0

function toWesternDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, ch => {
    const code = ch.charCodeAt(0)
    return String(code >= EXTENDED_ARABIC_INDIC_ZERO ? code - EXTENDED_ARABIC_INDIC_ZERO : code - ARABIC_INDIC_ZERO)
  })
}

/** Returns the canonical `+20 1X XXXXXXXX` form without spaces (`+201XXXXXXXXX`), or null when invalid. */
export function normalizeEgyptianMobile(input: string): string | null {
  if (typeof input !== 'string' || input.length > 32) return null
  let digits = toWesternDigits(input).replace(/[\s\-().]/g, '')
  if (/[^\d+]/.test(digits) || digits.indexOf('+') > 0 || (digits.match(/\+/g) ?? []).length > 1) return null
  digits = digits.replace('+', '')
  if (digits.startsWith('0020')) digits = digits.slice(4)
  else if (digits.startsWith('20') && digits.length === 12) digits = digits.slice(2)
  else if (digits.startsWith('0') && digits.length === 11) digits = digits.slice(1)
  return /^1[0125]\d{8}$/.test(digits) ? `+20${digits}` : null
}

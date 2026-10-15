/*
 * Light, UX-only handling of an Egyptian mobile number. The API owns the real rule (normalisation,
 * which numbers may sign in); this only formats what the person types and blocks obviously incomplete input.
 */

const ARABIC_INDIC = /[\u0660-\u0669\u06f0-\u06f9]/g

/** Digits only, Western numerals, without country code or trunk zero: `1012345678` max. */
export function nationalDigits(input: string): string {
  let digits = input
    .replace(ARABIC_INDIC, (ch) => String(ch.charCodeAt(0) >= 0x06f0 ? ch.charCodeAt(0) - 0x06f0 : ch.charCodeAt(0) - 0x0660))
    .replace(/\D/g, '')
  if (digits.startsWith('0020')) digits = digits.slice(4)
  else if (digits.startsWith('20') && digits.length > 10) digits = digits.slice(2)
  else if (digits.startsWith('0')) digits = digits.slice(1)
  return digits.slice(0, 10)
}

export function isCompleteEgyptianMobile(input: string): boolean {
  return /^1[0125]\d{8}$/.test(nationalDigits(input))
}

/** `010 1234 5678`, shown while typing (the +20 prefix is a fixed adornment). */
export function formatNational(input: string): string {
  const d = nationalDigits(input)
  const local = d ? `0${d}` : ''
  return [local.slice(0, 3), local.slice(3, 7), local.slice(7, 11)].filter(Boolean).join(' ')
}

/** What the API receives. */
export function toInternational(input: string): string {
  return `+20${nationalDigits(input)}`
}

/** `+20 10 1234 5678`: how an Egyptian mobile reads internationally (no trunk zero). */
export function displayInternational(input: string): string {
  const d = nationalDigits(input)
  return `+20 ${[d.slice(0, 2), d.slice(2, 6), d.slice(6)].filter(Boolean).join(' ')}`
}

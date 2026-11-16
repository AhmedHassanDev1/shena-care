/** Keep this in sync with catalog.search_normalize in the search migration. */
export function normalizeSearchText(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\p{Cf}/gu, '')
    .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 1776))
    .replace(/[\u064b-\u065f\u0670\u0640]/g, '')
    .replace(/[إأآٱ]/g, 'ا').replace(/[ىئ]/g, 'ي').replace(/ؤ/g, 'و').replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ').trim();
}

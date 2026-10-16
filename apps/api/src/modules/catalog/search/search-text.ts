/** Keep this in sync with catalog.search_normalize in the search migration. */
export function normalizeSearchText(value: string): string {
  return value.toLowerCase()
    .replace(/[\u064b-\u065f\u0670\u0640]/g, '')
    .replace(/[إأآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ').trim();
}

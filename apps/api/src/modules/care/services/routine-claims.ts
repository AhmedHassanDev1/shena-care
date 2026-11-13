/**
 * Conservative text guard for routine copy (template descriptions, step notes, AI reasons). A match is not a verdict that the text is
 * false — it means ShinaCare must not publish or store it without a person reviewing it: no cure/prevention/guarantee promises.
 */
const CLAIM_PATTERNS: RegExp[] = [
  /\b(cure[sd]?|heal(s|ed)?|guarantee[sd]?|permanent(ly)?|miracle|100\s*%\s*(safe|effective))\b/i,
  /\b(treat(s|ed)?|prevent(s|ed)?)\s+(acne|eczema|psoriasis|rosacea|melasma|stretch\s*marks?|hair\s*loss|alopecia)/i,
  /\b(safe|approved)\s+(in|during|for)\s+pregnan/i,
  /(يعالج|علاج\s*نهائي|شفاء|يشفي|مضمون|ضمان\s*النتيجة|يمنع\s*(ظهور\s*)?(التشققات|الحبوب|تساقط)|آمن\s*(للحامل|أثناء\s*الحمل)|سحري)/,
];

export function findUnsupportedClaim(text: string | null | undefined): string | null {
  if (!text) return null;
  for (const pattern of CLAIM_PATTERNS) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  return null;
}

/** Plain, single-line-ish text for stored notes: no markup, no control characters, bounded length. */
export function cleanNote(text: string | null | undefined, max: number): string | null {
  if (!text) return null;
  // eslint-disable-next-line no-control-regex
  const cleaned = text.replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

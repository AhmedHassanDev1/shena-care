/** Literal manufacturer identity oracle, independent of the production matcher. */
export interface ExpectedEvaluationIdentity {
  name: string;
  brand: string;
  sourceBrand: string;
  size: number;
  sizeUnit: string;
  packCount: number | null;
}

export interface ActualEvaluationIdentity {
  name: string;
  brand: string;
  size: number | null;
  sizeUnit: string | null;
  packCount: number | null;
}

const fold = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}%]+/gu, ' ').trim();

export function compareEvaluationIdentity(expected: ExpectedEvaluationIdentity, actual: ActualEvaluationIdentity) {
  let title = expected.name;
  for (const brand of [expected.brand, expected.sourceBrand].sort((a, b) => b.length - a.length)) {
    const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    title = title.replace(new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, 'gi'), ' ');
  }
  title = title.replace(/\b\d+(?:[.,]\d+)?\s*(?:ml|gm|g|liters?|litres?|l)\b/gi, ' ');
  if ((expected.packCount ?? 1) > 1) title = title.replace(new RegExp(`\\b${expected.packCount}\\s*(?:ampoules?|vials?|pcs|pieces)\\b`, 'gi'), ' ');
  const dimensions = { brand: fold(actual.brand) === fold(expected.brand), name: fold(actual.name) === fold(title),
    size: actual.size === expected.size && actual.sizeUnit === expected.sizeUnit,
    pack: (actual.packCount ?? 1) === (expected.packCount ?? 1) };
  return { ...dimensions, correct: Object.values(dimensions).every(Boolean) };
}

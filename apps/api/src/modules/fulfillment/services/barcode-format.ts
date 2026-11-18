/**
 * Retail barcode sanity check for a code a person typed or scanned to register against a product. Digit-only codes of GTIN length
 * (8, 12, 13, 14) must carry a correct GS1 check digit, which catches nearly every mistyped or half-read code before it can identify the wrong
 * product. Anything else is refused: a manufacturer retail code is always one of those lengths.
 */
export function isValidGtin(code: string): boolean {
  if (!/^\d+$/.test(code) || ![8, 12, 13, 14].includes(code.length)) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

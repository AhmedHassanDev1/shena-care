/** Appends the GS1 check digit, so a synthetic barcode passes the same validation a real one does. */
export function gtin(payload: string): string {
  const sum = [...payload].reverse().reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 3 : 1), 0);
  return payload + ((10 - (sum % 10)) % 10);
}

let counter = 0;

/** A valid GTIN-13 in the GS1 restricted-circulation range 29, unique within a run: never a real product's barcode. */
export function uniqueGtin(): string {
  counter = (counter + 1) % 1000;
  return gtin(`29${(Date.now() % 10_000_000).toString().padStart(7, '0')}${counter.toString().padStart(3, '0')}`);
}

/** GS1 check digit. Valid syntax alone does not prove that a code belongs to a SKU. */
export function isValidGtin(value: unknown): value is string {
  if (typeof value !== 'string' || !/^(?:\d{8}|\d{12,14})$/.test(value) || /^0+$/.test(value)) return false;
  let sum = 0;
  for (let i = value.length - 2, weight = 3; i >= 0; i--, weight = weight === 3 ? 1 : 3) sum += Number(value[i]) * weight;
  return (10 - sum % 10) % 10 === Number(value.at(-1));
}

/**
 * Sanitizes strings for CSV/Excel export to prevent formula injection.
 * Escapes fields starting with =, +, -, @ by prepending a single quote.
 */
export function sanitizeCsvField(value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }
  
  const str = String(value);
  if (/^[=+\-@]/.test(str)) {
    return `'${str}`;
  }
  
  return str;
}

export function sanitizeCsvRow(row: Record<string, any>): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [key, val] of Object.entries(row)) {
    sanitized[key] = sanitizeCsvField(val);
  }
  return sanitized;
}

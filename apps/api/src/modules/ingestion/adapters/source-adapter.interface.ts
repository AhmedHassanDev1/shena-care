import {
  CanonicalSupplierEnvelope,
  CanonicalSupplierRecord,
  SupplierSourceKind,
  SupplierDocumentKind,
  QuantityPresence,
  CanonicalPriceType,
  CanonicalPricing,
  CanonicalInventory,
} from '../contracts/canonical-supplier-record.contract';

export interface CanonicalValidationIssue {
  rowNumber: number;
  field: string;
  issue: string;
  severity: 'ERROR' | 'WARNING';
}

export interface CanonicalValidationResult {
  isValid: boolean;
  issues: CanonicalValidationIssue[];
  validRecordCount: number;
  invalidRecordCount: number;
}

export interface SupplierSourceAdapter<TInput = unknown, TOptions = Record<string, unknown>> {
  readonly sourceKind: SupplierSourceKind;

  parseAndNormalize(input: TInput, options: TOptions): Promise<CanonicalSupplierEnvelope>;

  validateEnvelope(envelope: CanonicalSupplierEnvelope): CanonicalValidationResult;
}

/**
 * Standard pure normalization utilities ensuring identical semantics across FILE, API, and MANUAL intake.
 */
export class CanonicalNormalizationUtils {
  static normalizeString(val: unknown): string {
    if (val === null || val === undefined) return '';
    return String(val).trim().replace(/\s+/g, ' ');
  }

  static normalizeBarcode(val: unknown): string | null {
    if (val === null || val === undefined) return null;
    const clean = String(val).trim().replace(/[^0-9]/g, '');
    return clean.length >= 8 && clean.length <= 14 ? clean : null;
  }

  static parseQuantity(raw: unknown): CanonicalInventory {
    if (raw === undefined) {
      return { presence: QuantityPresence.MISSING, quantity: null, rawInput: undefined };
    }
    if (raw === null || raw === '' || typeof raw === 'string' && /^(na|n\/a|unknown|null|none|غير محدد)$/i.test(raw.trim())) {
      return { presence: QuantityPresence.UNKNOWN, quantity: null, rawInput: raw === null ? null : String(raw) };
    }

    const num = Number(raw);
    if (isNaN(num) || num < 0) {
      return { presence: QuantityPresence.UNKNOWN, quantity: null, rawInput: String(raw) };
    }
    if (num === 0) {
      return { presence: QuantityPresence.ZERO, quantity: 0, rawInput: String(raw) };
    }
    return { presence: QuantityPresence.EXPLICIT, quantity: Math.floor(num), rawInput: String(raw) };
  }

  static parsePricing(
    rawAmount: unknown,
    rawCurrency: unknown,
    priceType: CanonicalPriceType = CanonicalPriceType.PURCHASE_COST,
    isTaxInclusive: boolean = false,
  ): CanonicalPricing {
    const rawStr = rawAmount !== null && rawAmount !== undefined ? String(rawAmount).trim() : '';
    // Strip currency symbols or thousand separators like commas
    const cleaned = rawStr.replace(/[^0-9.-]+/g, '');
    const amount = Number(cleaned);

    const currency = typeof rawCurrency === 'string' && rawCurrency.trim().length === 3
      ? rawCurrency.trim().toUpperCase()
      : 'EGP';

    return {
      amount: isNaN(amount) ? 0 : Number(amount.toFixed(2)),
      currency,
      priceType,
      isTaxInclusive,
      rawInput: rawStr,
    };
  }
}

import { Injectable } from '@nestjs/common';
import {
  NormalizedProductRow,
  NormalizedRowStatus,
  ProductScopeClassification,
  DiscountType,
  TypedDiscount,
} from '../contracts/row-normalization.contract';
import { QuantityPresence, CanonicalPriceType } from '../contracts/canonical-supplier-record.contract';

const SUPPORTED_CURRENCIES = new Set(['SAR', 'EGP', 'AED', 'USD', 'EUR', 'KWD', 'BHD', 'OMR', 'QAR']);

// Curated skincare keywords (EN + normalized AR)
const SKINCARE_KEYWORDS = [
  'cleanser',
  'cleansing',
  'moisturizer',
  'moisturising',
  'cream',
  'serum',
  'sunscreen',
  'spf',
  'sunblock',
  'toner',
  'exfoliant',
  'peeling',
  'scrub',
  'lotion',
  'eye cream',
  'eye gel',
  'face mask',
  'micellar',
  'acne',
  'anti aging',
  'retinol',
  'hyaluronic',
  'vitamin c',
  'niacinamide',
  'salicylic',
  'glycolic',
  'ceramide',
  'cica',
  'balm',
  // Everyday cleanser/treatment forms that name no other keyword (GLO-281: "Perfume Free Face Wash" was skipped).
  'wash',
  'facial',
  'foam',
  'mist',
  'essence',
  'patch',
  'makeup remover',
  'make up remover',
  'مزيل مكياج',
  'غسول',
  'منظف',
  'مرطب',
  'كريم',
  'سيروم',
  'واقي شمس',
  'واقي',
  'صن بلوك',
  'تونر',
  'مقشر',
  'لوشن',
  'كريم عين',
  'ماسك للوجه',
  'ميسيلار',
  'حب الشباب',
  'ريتينول',
  'هيالورونيك',
  'فيتامين سي',
  'نياسيناميد',
  'سيراميد',
  'بلسم وجه',
];

// Curated haircare keywords (EN + normalized AR)
const HAIRCARE_KEYWORDS = [
  'shampoo',
  'conditioner',
  'hair oil',
  'hair mask',
  'hair serum',
  'scalp',
  'hair treatment',
  'leave in',
  'dandruff',
  'hair loss',
  'keratin',
  'argan',
  'biotin',
  'hair ampoule',
  'شامبو',
  'بلسم',
  'زيت شعر',
  'ماسك شعر',
  'سيروم شعر',
  'فروه الراس',
  'تساقط الشعر',
  'قشره الشعر',
  'كيراتين',
  'ارجان',
  'بيوتين',
  'امبولات شعر',
];

// Curated known pilot brands
const KNOWN_PILOT_BRANDS = [
  'cerave',
  'bioderma',
  'la roche posay',
  'eucerin',
  'the ordinary',
  'ordinary',
  'vichy',
  'starville',
  'avene',
  'isdin',
  'cosrx',
  'cetaphil',
  'neutrogena',
  'panoxyl',
  'سيرافي',
  'بيوديرما',
  'لاروش بوزيه',
  'يوسيرين',
  'اورجيناري',
  'فيشي',
  'ستارفيل',
  'افين',
  'سيتافيل',
];

// Product types that are confidently outside the skincare/haircare pilot: goods, electronics, clothing, and the
// owner-excluded makeup, fragrance and tool categories (GLO-275). Matched as whole words/tokens only.
const EXCLUDED_PRODUCT_TYPES = [
  'pasta', 'chips', 'biscuit', 'drink', 'snack', 'sauce', 'cereal', 'basmati',
  'charger', 'cable', 'smartphone', 'phone', 'television', 'laptop', 'headphone', 'speaker', 'battery', 'blender', 'kettle',
  'shirt', 'pants', 'trousers', 'shoes', 'jacket', 'socks', 'bag',
  'lipstick', 'lip gloss', 'mascara', 'eyeliner', 'eye liner', 'eyeshadow', 'eye shadow', 'blusher', 'concealer',
  'foundation', 'nail polish', 'perfume', 'parfum', 'eau de parfum', 'eau de toilette', 'cologne', 'makeup brush',
  'razor', 'hair dryer', 'hair straightener',
  'مكرونه', 'شيبس', 'بسكويت', 'مشروب', 'صلصه', 'بسمتي',
  'شاحن', 'كابل', 'هاتف', 'موبايل', 'تلفزيون', 'لابتوب', 'سماعه', 'بطاريه', 'خلاط', 'غلايه',
  'قميص', 'بنطلون', 'فستان', 'حذاء', 'شنطه',
  'روج', 'احمر شفاه', 'ماسكارا', 'كحل', 'ايلاينر', 'ظلال عيون', 'بلاشر', 'كونسيلر', 'كريم اساس',
  'طلاء اظافر', 'مناكير', 'عطر', 'برفان', 'بارفان', 'كولونيا', 'فرشاه مكياج', 'ماكينه حلاقه', 'سشوار', 'مكواه شعر',
];

// Food/ingredient words that also name common skincare actives (green tea, rice water, sugar scrub, coffee scrub).
// Alone they never prove a row is out of scope.
const INGREDIENT_LIKE_WORDS = ['rice', 'tea', 'coffee', 'sugar', 'chocolate', 'juice', 'ارز', 'شاي', 'قهوه', 'سكر', 'شوكولاته', 'عصير'];

export interface RawRowInput {
  eligibilityApproved?: boolean;
  sourceRowNumber: number;
  supplierSku: string;
  name: string;
  brand?: string;
  barcode?: string;
  price: any;
  priceType?: CanonicalPriceType | string;
  retailPrice?: any;
  quantity?: any;
  hasQuantityColumn?: boolean;
  isInvoiceLine?: boolean;
  discount?: any;
  /** Reviewed meaning of the discount column from the approved mapping profile. */
  discountBasis?: 'PERCENT' | 'AMOUNT_PER_UNIT';
  currency?: string;
  units?: string;
  /** Raw "last updated / effective" cell from the approved mapping's sourceTimestamp column. */
  sourceTimestamp?: unknown;
  extraAttributes?: Record<string, any>;
  observedAt?: Date;
}

/** Arabic-Indic / Extended Arabic-Indic digits and Arabic separators → ASCII, so numbers parse identically. */
function toAsciiDigits(text: string): string {
  return text
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, '.')
    .replace(/٬/g, ',');
}

const NEUTRAL_BEFORE_EN = 'free of|free from|without|remover for|for|against|eye|under eye';
const NEUTRAL_AFTER_EN = 'free|remover|removing|burn|bumps?|rash|irritation';
const NEUTRAL_BEFORE_AR = 'خالي من|بدون|مزيل|ضد|عين';

/**
 * An excluded-goods word that only qualifies a skincare/haircare product does not name the product: "perfume free",
 * "without perfume", "lipstick remover", "razor burn", "eye bag(s)", "heat protectant for hair dryer". Such a word is
 * ignored so the row is held for review instead of being skipped (GLO-281).
 */
function inNeutralContext(normalizedText: string, normalizedTerm: string): boolean {
  const term = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const edge = '[^\\p{L}\\p{N}]';
  const pattern = /[؀-ۿ]/.test(normalizedTerm)
    ? `(?:^| )(?:${NEUTRAL_BEFORE_AR}) (?:\\S+ )?${term}(?: |$)`
    : `(?:^|${edge})(?:${NEUTRAL_BEFORE_EN}) (?:\\p{L}+ )?${term}(?:s|es)?(?:$|${edge})|(?:^|${edge})${term}(?:s|es)? (?:${NEUTRAL_AFTER_EN})(?:$|${edge})`;
  return new RegExp(pattern, 'u').test(normalizedText);
}

/** Whole-word (English, optional plural) or whole-token (Arabic) match on normalized text; never a bare substring. */
function hasTerm(normalizedText: string, normalizedTerm: string): boolean {
  if (!normalizedTerm) return false;
  if (/[؀-ۿ]/.test(normalizedTerm)) return ` ${normalizedText} `.includes(` ${normalizedTerm} `);
  const escaped = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(s|es)?($|[^\\p{L}\\p{N}])`, 'u').test(normalizedText);
}

export type QuantityProblem = 'NEGATIVE' | 'NON_INTEGER' | 'UNPARSEABLE';

@Injectable()
export class RowNormalizationService {
  private parseMonetaryAmount(raw: unknown): number | null {
    if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : null;
    if (typeof raw !== 'string') return null;
    const text = toAsciiDigits(raw).trim().replace(/^(SAR|EGP|AED|USD|EUR|KWD|BHD|OMR|QAR)\s*/i, '')
      .replace(/\s*(SAR|EGP|AED|USD|EUR|KWD|BHD|OMR|QAR)$/i, '').trim();
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(text)) return null;
    const value = Number(text.replace(/,/g, ''));
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  /**
   * Normalizes Arabic and English text deterministically.
   * Cleans punctuation, normalizes Alef/Yaa/Taa Marbuta, strips Tashkeel, converts Eastern numerals.
   */
  normalizeText(str: string): string {
    if (!str) return '';

    return String(str)
      .toLowerCase()
      .trim()
      // Convert Eastern Arabic numerals (٠-٩) to Western (0-9)
      .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632))
      // Normalize Arabic letter variants
      .replace(/[أإآ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/[ىي]/g, 'ي')
      // Strip Tashkeel & Tatweel (ـ)
      .replace(/[\u064B-\u065F\u0640]/g, '')
      // Protect decimal dots between digits (e.g. 1.5L)
      .replace(/(\d)\.(\d)/g, '$1\uFFF0$2')
      // Replace noise, dots, and punctuation with space
      .replace(/[\r\n\t_\\/\-.]+/g, ' ')
      // Restore decimal dots
      .replace(/\uFFF0/g, '.')
      .replace(/[^\p{L}\p{N} .]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Normalizes supplier SKU codes: trims, uppercases, removes internal whitespace.
   */
  normalizeSku(sku: string): string {
    if (!sku) return '';
    return String(sku)
      .trim()
      .toUpperCase()
      .replace(/[\r\n\t\s]+/g, '-');
  }

  /**
   * Normalizes and validates barcodes (EAN-8, UPC-A, EAN-13, ITF-14).
   */
  normalizeBarcode(rawBarcode?: any): { barcode: string | null; isValid: boolean } {
    if (rawBarcode === undefined || rawBarcode === null || rawBarcode === '') {
      return { barcode: null, isValid: true };
    }

    const digitsOnly = String(rawBarcode).replace(/\D/g, '');
    if (!digitsOnly) {
      return { barcode: null, isValid: false };
    }

    // Standard valid barcode lengths
    if ([8, 12, 13, 14].includes(digitsOnly.length)) {
      return { barcode: digitsOnly, isValid: true };
    }

    return { barcode: digitsOnly, isValid: false };
  }

  /**
   * Extracts volume (ml/l), weight (g/kg), or pack count from a product title or packaging string.
   */
  extractSizeAndPack(title: string, units?: string): {
    size: number | null;
    unit: string | null;
    packCount: number | null;
    cleanTitle: string;
  } {
    let size: number | null = null;
    let unit: string | null = null;
    let packCount: number | null = null;

    let cleanTitle = this.normalizeText(title);
    const textToScan = `${cleanTitle} ${units ? this.normalizeText(units) : ''}`;

    // 1. Pack count (e.g. "Pack of 3", "علبه من 2 حبه", "2 pcs", "2 حبه")
    const packRegex = /(?:^|\s)(?:pack\s*of|علبه\s*من|عبوه\s*من)\s*(\d+)(?:\s*حبه)?(?:\s|$)/i;
    const packMatch = textToScan.match(packRegex);
    if (packMatch) {
      packCount = parseInt(packMatch[1], 10);
      cleanTitle = cleanTitle.replace(packMatch[0].trim(), ' ').trim();
    } else {
      const pcsRegex = /(?:^|\s)(\d+)\s*(?:pack|pcs|pieces?|حبه|حبات|قطع|قطعه)(?:\s|$)/i;
      const pcsMatch = textToScan.match(pcsRegex);
      if (pcsMatch) {
        packCount = parseInt(pcsMatch[1], 10);
        cleanTitle = cleanTitle.replace(pcsMatch[0].trim(), ' ').trim();
      }
    }

    // 2. Volume in ml or l
    const mlRegex = /(?:^|\s)(\d+(?:\.\d+)?)\s*(?:ml|milli?liters?|مل|ملي|ملل)(?:\s|$)/i;
    const mlMatch = cleanTitle.match(mlRegex);
    if (mlMatch) {
      size = parseFloat(mlMatch[1]);
      unit = 'ml';
      cleanTitle = cleanTitle.replace(mlMatch[0].trim(), ' ').trim();
    } else {
      const lRegex = /(?:^|\s)(\d+(?:\.\d+)?)\s*(?:l|liters?|litres?|لتر)(?:\s|$)/i;
      const lMatch = cleanTitle.match(lRegex);
      if (lMatch) {
        size = parseFloat(lMatch[1]) * 1000;
        unit = 'ml';
        cleanTitle = cleanTitle.replace(lMatch[0].trim(), ' ').trim();
      }
    }

    // 3. Weight in g or kg
    if (!size) {
      const gRegex = /(?:^|\s)(\d+(?:\.\d+)?)\s*(?:g|gm|grams?|جم|جرام)(?:\s|$)/i;
      const gMatch = cleanTitle.match(gRegex);
      if (gMatch) {
        size = parseFloat(gMatch[1]);
        unit = 'g';
        cleanTitle = cleanTitle.replace(gMatch[0].trim(), ' ').trim();
      } else {
        const kgRegex = /(?:^|\s)(\d+(?:\.\d+)?)\s*(?:kg|kilos?|كيلو|كجم)(?:\s|$)/i;
        const kgMatch = cleanTitle.match(kgRegex);
        if (kgMatch) {
          size = parseFloat(kgMatch[1]) * 1000;
          unit = 'g';
          cleanTitle = cleanTitle.replace(kgMatch[0].trim(), ' ').trim();
        }
      }
    }

    cleanTitle = cleanTitle.replace(/\s+/g, ' ').replace(/(^-|-$)+/g, '').trim();

    return { size, unit, packCount, cleanTitle };
  }

  /**
   * Classifies category scope eligibility for the Skincare & Haircare pilot.
   */
  classifyScope(name: string, brand?: string): ProductScopeClassification {
    const normName = this.normalizeText(name);
    const normBrand = this.normalizeText(brand || '');
    const excludedTypes = EXCLUDED_PRODUCT_TYPES.filter(cue => {
      const term = this.normalizeText(cue);
      return hasTerm(normName, term) && !inNeutralContext(normName, term);
    });
    const matchedSkincare = SKINCARE_KEYWORDS.filter(cue => normName.includes(this.normalizeText(cue)));
    const matchedHaircare = HAIRCARE_KEYWORDS.filter(cue => normName.includes(this.normalizeText(cue)));

    // 1. An excluded product type is a confident skip only when nothing in the name says skincare/haircare.
    if (excludedTypes.length && (matchedSkincare.length || matchedHaircare.length)) {
      return {
        isEligible: false,
        category: 'unknown',
        confidence: 0.3,
        matchedRules: [...excludedTypes.map(c => `excluded_type:${c}`), ...[...matchedSkincare, ...matchedHaircare].map(c => `eligible_type:${c}`)],
        reason: 'Conflicting product-type signals (excluded and skincare/haircare); review required',
      };
    }
    if (excludedTypes.length) {
      return {
        isEligible: false,
        category: 'excluded',
        confidence: 1.0,
        matchedRules: excludedTypes.map(cue => `excluded_type:${cue}`),
        reason: `Goods belong to excluded category (${excludedTypes[0]})`,
      };
    }

    // 2. Check Skincare rules
    if (matchedSkincare.length > 0) {
      return {
        isEligible: true,
        category: 'skincare',
        confidence: Math.min(1.0, 0.7 + matchedSkincare.length * 0.1),
        matchedRules: matchedSkincare.map((c) => `skincare:${c}`),
      };
    }

    // 3. Check Haircare rules
    if (matchedHaircare.length > 0) {
      return {
        isEligible: true,
        category: 'haircare',
        confidence: Math.min(1.0, 0.7 + matchedHaircare.length * 0.1),
        matchedRules: matchedHaircare.map((c) => `haircare:${c}`),
      };
    }

    // 4. Check Known Pilot Brand match
    for (const pb of KNOWN_PILOT_BRANDS) {
      const normPb = this.normalizeText(pb);
      if (normBrand.includes(normPb) || normName.includes(normPb)) {
        // Known brand but ambiguous product line -> Hold for REVIEW, DO NOT false skip!
        return {
          isEligible: true,
          category: 'unknown',
          confidence: 0.6,
          matchedRules: [`known_brand:${pb}`],
          reason: 'Credible known pilot brand with unclassified product line (review required)',
        };
      }
    }

    // Unrecognized category: held for review, never skipped (a food/ingredient word alone proves nothing).
    const ingredientWords = INGREDIENT_LIKE_WORDS.filter(cue => hasTerm(normName, this.normalizeText(cue)));
    return {
      isEligible: false,
      category: 'unknown',
      confidence: 0.0,
      matchedRules: ingredientWords.map(cue => `ingredient_like:${cue}`),
      reason: 'Product does not match approved skincare or haircare categories',
    };
  }

  /**
   * Reads a supplier "last updated / effective" cell. Accepts an Excel date serial, ISO date(-time), or a day/month/year
   * whose order is unambiguous (one part > 12). Times without a zone are read as stated (one supplier's clock is
   * consistent with itself). Ambiguous (03/04/2026), unparseable or future (> 24 h ahead) values are flagged, never guessed.
   */
  parseSourceTimestamp(raw: unknown, now = new Date()): { iso: string | null; problem?: 'UNPARSEABLE' | 'AMBIGUOUS' | 'FUTURE' } {
    if (raw === undefined || raw === null || raw === '') return { iso: null };
    let date: Date | null = null;
    if (raw instanceof Date) date = raw;
    else if (typeof raw === 'number') {
      // Excel serials for 1970..2118; anything else is not a date cell.
      if (raw > 25569 && raw < 80000) date = new Date(Math.round((raw - 25569) * 86400000));
    } else {
      const text = toAsciiDigits(String(raw)).trim();
      const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?(Z|[+-]\d{2}:?\d{2})?$/);
      const dmy = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/);
      const build = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0) => {
        const value = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
        return value.getUTCMonth() === mo - 1 && value.getUTCDate() === d && h < 24 && mi < 60 && s < 60 ? value : null;
      };
      if (iso) {
        date = iso[7]
          ? new Date(text.replace(' ', 'T'))
          : build(+iso[1], +iso[2], +iso[3], +(iso[4] ?? 0), +(iso[5] ?? 0), +(iso[6] ?? 0));
      } else if (dmy) {
        const [a, b] = [+dmy[1], +dmy[2]];
        if (a <= 12 && b <= 12 && a !== b) return { iso: null, problem: 'AMBIGUOUS' };
        const [day, month] = a > 12 || a === b ? [a, b] : [b, a];
        date = build(+dmy[3], month, day, +(dmy[4] ?? 0), +(dmy[5] ?? 0));
      }
    }
    if (!date || isNaN(date.getTime())) return { iso: null, problem: 'UNPARSEABLE' };
    if (date.getTime() > now.getTime() + 24 * 3600 * 1000) return { iso: date.toISOString(), problem: 'FUTURE' };
    return { iso: date.toISOString() };
  }

  /**
   * Types a discount cell. The unit comes from the approved profile (`basis`) or an explicit "%" in the cell;
   * a bare number with no stated unit is AMBIGUOUS and a signed/out-of-range/garbled value is INVALID — never guessed.
   */
  classifyDiscount(rawDiscount: any, basis?: 'PERCENT' | 'AMOUNT_PER_UNIT'):
    { discount: TypedDiscount | null; problem?: 'INVALID' | 'AMBIGUOUS' } {
    if (rawDiscount === undefined || rawDiscount === null || rawDiscount === '') return { discount: null };

    let str = toAsciiDigits(String(rawDiscount)).trim();
    // A currency code in the cell ("12.50 SAR", "EGP 5") states the unit: a per-unit amount.
    const withoutCurrency = str.replace(/^(SAR|EGP|AED|USD|EUR|KWD|BHD|OMR|QAR)\s*|\s*(SAR|EGP|AED|USD|EUR|KWD|BHD|OMR|QAR)$/gi, '');
    if (withoutCurrency !== str) {
      if (basis === 'PERCENT' || !/^\d+(\.\d+)?$/.test(withoutCurrency.trim())) return { discount: null, problem: 'INVALID' };
      basis = 'AMOUNT_PER_UNIT';
      str = withoutCurrency.trim();
    }
    if (!/^\d+(\.\d+)?\s*%?$/.test(str)) return { discount: null, problem: 'INVALID' };
    const value = parseFloat(str);
    const isPercent = basis === 'PERCENT' || (!basis && str.endsWith('%'));
    if (isPercent) {
      return value >= 0 && value <= 100 ? { discount: { type: DiscountType.PERCENTAGE, value, rawInput: str } } : { discount: null, problem: 'INVALID' };
    }
    if (basis === 'AMOUNT_PER_UNIT') {
      return value > 0 && !str.endsWith('%') ? { discount: { type: DiscountType.FIXED_AMOUNT, value, rawInput: str } } : { discount: null, problem: 'INVALID' };
    }
    return { discount: null, problem: value === 0 ? undefined : 'AMBIGUOUS' };
  }

  /** Typed discount or null; see classifyDiscount for why a value was not accepted. */
  parseDiscount(rawDiscount: any, basis?: 'PERCENT' | 'AMOUNT_PER_UNIT'): TypedDiscount | null {
    return this.classifyDiscount(rawDiscount, basis).discount;
  }

  /**
   * Parses inventory quantity and availability semantics strictly.
   */
  parseInventorySemantics(
    rawQty: any,
    hasQuantityColumn: boolean,
    isInvoiceLine?: boolean,
  ): { presence: QuantityPresence; reportedQuantity: number | null; isInStock: boolean | null; problem?: QuantityProblem } {
    if (!hasQuantityColumn) {
      return { presence: QuantityPresence.MISSING, reportedQuantity: null, isInStock: null };
    }

    if (rawQty === undefined || rawQty === null || rawQty === '') {
      return { presence: QuantityPresence.UNKNOWN, reportedQuantity: null, isInStock: null };
    }

    // Boolean string checks
    if (typeof rawQty === 'boolean') {
      return {
        presence: rawQty ? QuantityPresence.EXPLICIT : QuantityPresence.ZERO,
        reportedQuantity: null,
        isInStock: rawQty,
      };
    }

    const unknown = (problem: QuantityProblem) =>
      ({ presence: QuantityPresence.UNKNOWN, reportedQuantity: null, isInStock: null, problem });
    const counted = (value: number) => value === 0
      ? { presence: QuantityPresence.ZERO, reportedQuantity: 0, isInStock: false }
      : { presence: QuantityPresence.EXPLICIT, reportedQuantity: value, isInStock: true };

    // A number cell is taken exactly: never strip its sign or decimal point.
    if (typeof rawQty === 'number') {
      if (!Number.isFinite(rawQty)) return unknown('UNPARSEABLE');
      if (rawQty < 0) return unknown('NEGATIVE');
      return Number.isInteger(rawQty) ? counted(rawQty) : unknown('NON_INTEGER');
    }

    const str = toAsciiDigits(String(rawQty)).trim().toLowerCase();
    if (['true', 'yes', 'in stock', 'instock', 'available', 'متاح', 'متوفر'].includes(str)) {
      return { presence: QuantityPresence.EXPLICIT, reportedQuantity: null, isInStock: true };
    }
    if (['false', 'no', 'out of stock', 'outofstock', 'unavailable', 'غير متاح', 'نفذ'].includes(str)) {
      return { presence: QuantityPresence.ZERO, reportedQuantity: 0, isInStock: false };
    }
    // An explicit "don't know" is a legitimate UNKNOWN, not a parsing problem.
    if (['unknown', 'n/a', 'na', '-', '?', 'غير معروف', 'غير محدد'].includes(str)) {
      return { presence: QuantityPresence.UNKNOWN, reportedQuantity: null, isInStock: null };
    }
    if (/^-\s*\d/.test(str)) return unknown('NEGATIVE');

    // Only a plain count is stock; ranges, fractions and unit words ("5 boxes", "كرتونة 6") need a human.
    const plain = str.replace(/^(\d{1,3}(?:,\d{3})+)(\.0+)?$/, (_, digits: string, zeros = '') => digits.replace(/,/g, '') + zeros);
    if (/^\d+$/.test(plain)) return counted(parseInt(plain, 10));
    if (/^\d+\.0+$/.test(plain)) return counted(parseInt(plain, 10));
    if (/^\d+\.\d+$/.test(plain)) return unknown('NON_INTEGER');
    return unknown('UNPARSEABLE');
  }

  /**
   * Normalizes a full supplier catalog row into a safe, typed NormalizedProductRow.
   */
  normalizeRow(input: RawRowInput): NormalizedProductRow {
    const rawEvidence: Record<string, any> = {
      ...input.extraAttributes,
      rawSku: input.supplierSku,
      rawName: input.name,
      rawBrand: input.brand,
      rawPrice: input.price,
      rawRetailPrice: input.retailPrice,
      rawQuantity: input.quantity,
      rawDiscount: input.discount,
      rawBarcode: input.barcode,
    };

    const normalizedSku = this.normalizeSku(input.supplierSku);
    const normalizedName = this.normalizeText(input.name);
    const normalizedBrand = this.normalizeText(input.brand || 'General');

    // 1. Validate mandatory identifiers
    if (!normalizedSku || !normalizedName) {
      return this.createInvalidRow(input.sourceRowNumber, 'Missing mandatory supplier SKU or product title', rawEvidence);
    }

    // 2. Barcode normalization & check
    const barcodeResult = this.normalizeBarcode(input.barcode);
    if (input.barcode && !barcodeResult.isValid) {
      return this.createInvalidRow(input.sourceRowNumber, `Malformed barcode value: ${input.barcode}`, rawEvidence);
    }

    // 3. Size / Volume extraction
    const sizePack = this.extractSizeAndPack(input.name, input.units);

    // 4. Currency normalization & validation
    const currencyStr = typeof input.currency === 'string' ? input.currency.trim().toUpperCase() : '';
    if (!SUPPORTED_CURRENCIES.has(currencyStr)) {
      return this.createInvalidRow(
        input.sourceRowNumber,
        `Unsupported or malformed currency (${input.currency})`,
        rawEvidence,
      );
    }

    // 5. Price & Cost validation
    let purchaseCost: number | null = null;
    let retailPrice: number | null = null;

    if (input.retailPrice !== undefined && input.retailPrice !== null && input.retailPrice !== '') {
      retailPrice = this.parseMonetaryAmount(input.retailPrice);
      if (retailPrice === null) return this.createInvalidRow(input.sourceRowNumber, 'Invalid retail reference price', rawEvidence);
    }

    const { discount, problem: discountProblem } = this.classifyDiscount(input.discount, input.discountBasis);
    if (discountProblem === 'INVALID') {
      return this.createInvalidRow(input.sourceRowNumber, `Invalid discount value (${input.discount})`, rawEvidence);
    }
    const reviewReasons: string[] = [];
    const hasExplicitCost = input.price !== undefined && input.price !== null && input.price !== '';
    if (discountProblem === 'AMBIGUOUS') {
      // A bare number could be a percent or a currency amount; deriving cost from it would be a guess.
      if (!hasExplicitCost) {
        return this.createInvalidRow(input.sourceRowNumber,
          `Discount unit is ambiguous (${input.discount}); confirm PERCENT or AMOUNT_PER_UNIT in the mapping`, rawEvidence);
      }
      reviewReasons.push(`Discount unit is ambiguous (${input.discount})`);
    }

    if (hasExplicitCost) {
      const num = this.parseMonetaryAmount(input.price);
      if (num === null) {
        return this.createInvalidRow(
          input.sourceRowNumber,
          `Invalid non-positive purchase cost value (${input.price})`,
          rawEvidence,
        );
      }
      purchaseCost = num;
    } else if (retailPrice && discount) {
      const pctValue = discount.type === DiscountType.PERCENTAGE ? discount.value : null;
      if (pctValue !== null) {
        const calculated = Math.round(retailPrice * (1 - pctValue / 100) * 100) / 100;
        if (calculated > 0) {
          purchaseCost = calculated;
          rawEvidence.derivedFromRetailAndDiscount = true;
        } else {
          return this.createInvalidRow(input.sourceRowNumber, 'Missing purchase cost', rawEvidence);
        }
      } else {
        const calculated = Math.round((retailPrice - discount.value) * 100) / 100;
        if (calculated > 0) {
          purchaseCost = calculated;
          rawEvidence.derivedFromRetailAndDiscount = true;
        } else {
          return this.createInvalidRow(input.sourceRowNumber, 'Missing purchase cost', rawEvidence);
        }
      }
    } else {
      return this.createInvalidRow(input.sourceRowNumber, 'Missing purchase cost', rawEvidence);
    }

    // Check for obvious price inversion (wholesale buy cost > customer retail price by large margin)
    let priceAnomalyDetected = false;
    if (purchaseCost && retailPrice && purchaseCost > retailPrice) {
      priceAnomalyDetected = true;
    }
    // An explicit cost that contradicts retail-minus-discount means one of the three columns is not what it seems.
    if (hasExplicitCost && purchaseCost && retailPrice && discount) {
      const expected = discount.type === DiscountType.PERCENTAGE
        ? Math.round(retailPrice * (1 - discount.value / 100) * 100) / 100
        : Math.round((retailPrice - discount.value) * 100) / 100;
      if (Math.abs(expected - purchaseCost) > 0.01) {
        reviewReasons.push(`Purchase cost ${purchaseCost} differs from retail ${retailPrice} minus discount (${expected})`);
      }
    }

    // 6. Inventory Semantics
    const hasQuantityCol = input.hasQuantityColumn ?? (input.quantity !== undefined && input.quantity !== null);
    const inventory = this.parseInventorySemantics(input.quantity, hasQuantityCol, input.isInvoiceLine);
    if (inventory.problem === 'NEGATIVE') {
      return this.createInvalidRow(input.sourceRowNumber, 'Negative reported quantity', rawEvidence);
    }
    if (inventory.problem) {
      reviewReasons.push(`Quantity is not a plain unit count (${input.quantity}); stock left unknown`);
    }
    const sourceTime = this.parseSourceTimestamp(input.sourceTimestamp);
    if (sourceTime.problem) {
      reviewReasons.push(`Source timestamp is ${sourceTime.problem.toLowerCase()} (${String(input.sourceTimestamp)}); freshness unproven`);
    }

    // 7. Category & Brand Scope Classification
    const scope: ProductScopeClassification = input.eligibilityApproved
      ? { isEligible: true, category: 'approved', confidence: 1, matchedRules: ['approved_dynamic_policy'] }
      : this.classifyScope(input.name, input.brand);

    // 8. Determine final row status
    let status: NormalizedRowStatus = NormalizedRowStatus.UPDATED_CANDIDATE;
    let statusReason: string | undefined;

    if (!scope.isEligible) {
      if (scope.category === 'excluded') {
        status = NormalizedRowStatus.OUT_OF_SCOPE;
        statusReason = scope.reason;
      } else {
        // Unrecognized category held for operator review
        status = NormalizedRowStatus.REVIEW;
        statusReason = scope.reason || 'Unrecognized category held for human review';
      }
    } else if (scope.category === 'unknown') {
      status = NormalizedRowStatus.REVIEW;
      statusReason = scope.reason || 'Credible brand with ambiguous category (review required)';
    }
    const scopeHold = status === NormalizedRowStatus.REVIEW;
    if (priceAnomalyDetected) {
      reviewReasons.unshift(`Price anomaly: purchase cost (${purchaseCost}) exceeds retail reference price (${retailPrice})`);
    }
    // Field-level doubts never upgrade an excluded row, but always hold an otherwise eligible one.
    if (reviewReasons.length && status !== NormalizedRowStatus.OUT_OF_SCOPE) {
      status = NormalizedRowStatus.REVIEW;
      statusReason = [statusReason, ...reviewReasons].filter(Boolean).join('; ');
    }
    const holds = status === NormalizedRowStatus.REVIEW
      ? { scope: scopeHold, fields: reviewReasons.length > 0 } : undefined;

    return {
      sourceRowNumber: input.sourceRowNumber,
      status,
      statusReason,
      holds,
      normalizedSku,
      normalizedBrand,
      normalizedTitle: normalizedName,
      cleanBaseTitle: sizePack.cleanTitle,
      normalizedBarcode: barcodeResult.barcode,
      extractedSize: sizePack.size,
      extractedUnit: sizePack.unit,
      extractedPackCount: sizePack.packCount,
      pricing: {
        purchaseCost,
        retailReferencePrice: retailPrice,
        currency: currencyStr,
        discount,
        isVerifiedCost: true,
      },
      inventory: {
        presence: inventory.presence,
        reportedQuantity: inventory.reportedQuantity,
        isInStock: inventory.isInStock,
        isInvoiceLineQuantity: input.isInvoiceLine,
      },
      scope,
      rawEvidence,
      observedAt: input.observedAt || new Date(),
      sourceObservedAt: sourceTime.problem ? null : sourceTime.iso,
    };
  }

  private createInvalidRow(
    sourceRowNumber: number,
    reason: string,
    rawEvidence: Record<string, any>,
  ): NormalizedProductRow {
    return {
      sourceRowNumber,
      status: NormalizedRowStatus.INVALID,
      statusReason: reason,
      normalizedSku: '',
      normalizedBrand: '',
      normalizedTitle: '',
      cleanBaseTitle: '',
      normalizedBarcode: null,
      pricing: {
        purchaseCost: null,
        retailReferencePrice: null,
        currency: '',
        isVerifiedCost: false,
      },
      inventory: {
        presence: QuantityPresence.MISSING,
        reportedQuantity: null,
        isInStock: null,
      },
      scope: {
        isEligible: false,
        category: 'unknown',
        confidence: 0,
        matchedRules: [],
        reason,
      },
      rawEvidence,
      observedAt: new Date(),
    };
  }
}

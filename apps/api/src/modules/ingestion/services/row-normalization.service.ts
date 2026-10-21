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

// Excluded product keywords (food, electronics, clothing, etc.)
const EXCLUDED_GOODS_KEYWORDS = [
  'rice',
  'pasta',
  'chocolate',
  'chips',
  'biscuit',
  'coffee',
  'tea',
  'juice',
  'drink',
  'snack',
  'sauce',
  'sugar',
  'cereal',
  'charger',
  'cable',
  'smartphone',
  'phone',
  'television',
  'laptop',
  'headphone',
  'speaker',
  'battery',
  'blender',
  'kettle',
  'shirt',
  'pants',
  'trousers',
  'shoes',
  'jacket',
  'socks',
  'bag',
  'ارز',
  'مكرونه',
  'شوكولاته',
  'شيبس',
  'بسكويت',
  'قهوه',
  'شاي',
  'عصير',
  'مشروب',
  'صلصه',
  'سكر',
  'شاحن',
  'كابل',
  'هاتف',
  'موبايل',
  'تلفزيون',
  'لابتوب',
  'سماعه',
  'بطاريه',
  'خلاط',
  'غلايه',
  'قميص',
  'بنطلون',
  'فستان',
  'حذاء',
  'شنطه',
];

export interface RawRowInput {
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
  currency?: string;
  units?: string;
  extraAttributes?: Record<string, any>;
  observedAt?: Date;
}

@Injectable()
export class RowNormalizationService {
  private parseMonetaryAmount(raw: unknown): number | null {
    if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : null;
    if (typeof raw !== 'string') return null;
    const text = raw.trim().replace(/^(SAR|EGP|AED|USD|EUR|KWD|BHD|OMR|QAR)\s*/i, '')
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
    const combined = `${normBrand} ${normName}`;

    // 1. Check explicitly excluded goods
    for (const cue of EXCLUDED_GOODS_KEYWORDS) {
      const normCue = this.normalizeText(cue);
      if (combined.includes(normCue) || normName.includes(normCue)) {
        return {
          isEligible: false,
          category: 'excluded',
          confidence: 1.0,
          matchedRules: [`excluded_keyword:${cue}`],
          reason: `Goods belong to excluded category (${cue})`,
        };
      }
    }

    // 2. Check Skincare rules
    const matchedSkincare: string[] = [];
    for (const cue of SKINCARE_KEYWORDS) {
      const normCue = this.normalizeText(cue);
      if (normName.includes(normCue)) {
        matchedSkincare.push(cue);
      }
    }
    if (matchedSkincare.length > 0) {
      return {
        isEligible: true,
        category: 'skincare',
        confidence: Math.min(1.0, 0.7 + matchedSkincare.length * 0.1),
        matchedRules: matchedSkincare.map((c) => `skincare:${c}`),
      };
    }

    // 3. Check Haircare rules
    const matchedHaircare: string[] = [];
    for (const cue of HAIRCARE_KEYWORDS) {
      const normCue = this.normalizeText(cue);
      if (normName.includes(normCue)) {
        matchedHaircare.push(cue);
      }
    }
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

    // Unrecognized category
    return {
      isEligible: false,
      category: 'unknown',
      confidence: 0.0,
      matchedRules: [],
      reason: 'Product does not match approved skincare or haircare categories',
    };
  }

  /**
   * Parses and normalizes discount representations (percentage or fixed amount).
   */
  parseDiscount(rawDiscount: any): TypedDiscount | null {
    if (rawDiscount === undefined || rawDiscount === null || rawDiscount === '') {
      return null;
    }

    const str = String(rawDiscount).trim();
    if (str.includes('%')) {
      const val = parseFloat(str.replace(/[^0-9.]/g, ''));
      if (!isNaN(val) && val >= 0 && val <= 100) {
        return { type: DiscountType.PERCENTAGE, value: val, rawInput: str };
      }
    }

    const num = parseFloat(str.replace(/[^0-9.]/g, ''));
    if (!isNaN(num) && num > 0) {
      // If <= 1.0 (e.g. 0.15), treat as percentage
      if (num <= 1.0) {
        return { type: DiscountType.PERCENTAGE, value: num * 100, rawInput: str };
      }
      return { type: DiscountType.FIXED_AMOUNT, value: num, rawInput: str };
    }

    return null;
  }

  /**
   * Parses inventory quantity and availability semantics strictly.
   */
  parseInventorySemantics(
    rawQty: any,
    hasQuantityColumn: boolean,
    isInvoiceLine?: boolean,
  ): { presence: QuantityPresence; reportedQuantity: number | null; isInStock: boolean | null } {
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

    const str = String(rawQty).trim().toLowerCase();
    if (['true', 'yes', 'in stock', 'instock', 'available', 'متاح', 'متوفر'].includes(str)) {
      return { presence: QuantityPresence.EXPLICIT, reportedQuantity: null, isInStock: true };
    }
    if (['false', 'no', 'out of stock', 'outofstock', 'unavailable', 'غير متاح', 'نفذ'].includes(str)) {
      return { presence: QuantityPresence.ZERO, reportedQuantity: 0, isInStock: false };
    }

    const parsedNum = parseInt(str.replace(/[^0-9]/g, ''), 10);
    if (!isNaN(parsedNum)) {
      if (parsedNum === 0) {
        return { presence: QuantityPresence.ZERO, reportedQuantity: 0, isInStock: false };
      }
      return { presence: QuantityPresence.EXPLICIT, reportedQuantity: parsedNum, isInStock: true };
    }

    return { presence: QuantityPresence.UNKNOWN, reportedQuantity: null, isInStock: null };
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

    const discount = this.parseDiscount(input.discount);

    if (input.price !== undefined && input.price !== null && input.price !== '') {
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

    // 6. Inventory Semantics
    const hasQuantityCol = input.hasQuantityColumn ?? (input.quantity !== undefined && input.quantity !== null);
    if (hasQuantityCol && typeof input.quantity === 'string' && /^\s*-/.test(input.quantity)) {
      return this.createInvalidRow(input.sourceRowNumber, 'Negative reported quantity', rawEvidence);
    }
    const inventory = this.parseInventorySemantics(input.quantity, hasQuantityCol, input.isInvoiceLine);

    // 7. Category & Brand Scope Classification
    const scope = this.classifyScope(input.name, input.brand);

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
    } else if (priceAnomalyDetected) {
      status = NormalizedRowStatus.REVIEW;
      statusReason = `Price anomaly: purchase cost (${purchaseCost}) exceeds retail reference price (${retailPrice})`;
    }

    return {
      sourceRowNumber: input.sourceRowNumber,
      status,
      statusReason,
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

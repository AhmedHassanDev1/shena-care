import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import { FormatFingerprintService } from './format-fingerprint.service';

export interface ColumnMappingConfig {
  supplierSku: string;
  name: string;
  price: string;
  barcode?: string;
  brand?: string;
  category?: string;
  quantity?: string;
  retailPrice?: string;
  availability?: string;
  discount?: string;
  units?: string;
  sourceTimestamp?: string;
  currency?: string;
  currencyColumn?: string;
  /** Reviewed meaning of the mapped columns; a layout match alone never implies these. */
  semantics?: MappingSemantics;
  /** Who proposed this mapping when it awaits independent review. */
  proposal?: { proposedBy: string; proposedAt: string };
}

export const DOCUMENT_KINDS = ['PRICE_LIST', 'STOCK_FEED', 'SALES_INVOICE'] as const;
export const PRICE_BASES = ['UNIT_PURCHASE_COST', 'PACK_PURCHASE_COST', 'RETAIL_PRICE', 'UNKNOWN'] as const;
export const QUANTITY_BASES = ['ON_HAND', 'AVAILABLE_TO_SELL', 'INVOICE_QUANTITY', 'UNKNOWN'] as const;
export const DISCOUNT_BASES = ['PERCENT', 'AMOUNT_PER_UNIT'] as const;

export interface MappingSemantics {
  documentKind?: (typeof DOCUMENT_KINDS)[number];
  priceBasis?: (typeof PRICE_BASES)[number];
  quantityBasis?: (typeof QUANTITY_BASES)[number];
  discountBasis?: (typeof DISCOUNT_BASES)[number];
}

/** Quantity bases that describe stock a supplier can ship (invoice quantities are sales, not stock). */
export const STOCK_QUANTITY_BASES: ReadonlyArray<string> = ['ON_HAND', 'AVAILABLE_TO_SELL'];

/**
 * Reasons a mapping cannot be approved to write supplier cost/stock; empty when it is safe.
 * Only an explicit per-unit purchase cost may become a SupplierOffer cost.
 */
export function mappingApprovalProblems(mapping: Partial<ColumnMappingConfig>): string[] {
  const s = mapping.semantics ?? {};
  const problems: string[] = [];
  if (!s.documentKind) problems.push('documentKind must be confirmed');
  if (s.priceBasis !== 'UNIT_PURCHASE_COST') {
    problems.push('price column must be confirmed as UNIT_PURCHASE_COST (pack, retail or unknown prices cannot become supplier cost)');
  }
  if (mapping.quantity && !s.quantityBasis) problems.push('quantityBasis must be confirmed for the mapped quantity column');
  if (s.documentKind === 'SALES_INVOICE' && s.quantityBasis && STOCK_QUANTITY_BASES.includes(s.quantityBasis)) {
    problems.push('a sales invoice quantity cannot be approved as stock');
  }
  if (mapping.discount && !s.discountBasis) problems.push('discountBasis must be confirmed for the mapped discount column');
  return problems;
}

export function currencyFromPriceHeader(header: string): string | null {
  const match = header.match(/\b(EGP|SAR|AED|USD|EUR|KWD|BHD|OMR|QAR)\b/i);
  return match ? match[1].toUpperCase() : null;
}

export interface MappingProposal {
  mapping: Partial<ColumnMappingConfig>;
  confidence: Record<string, number>;
  unmappedHeaders: string[];
  isComplete: boolean; // true if minimum required (supplierSku, name, price) are mapped
}

interface KeywordRule {
  target: keyof ColumnMappingConfig;
  keywords: string[];
}

const MAPPING_RULES: KeywordRule[] = [
  {
    target: 'supplierSku',
    keywords: [
      'sku',
      'item code',
      'itemcode',
      'product code',
      'productcode',
      'code',
      'supplier sku',
      'suppliersku',
      'كود المورد',
      'كود الصنف',
      'كود المنتج',
      'رقم الصنف',
      'كود',
      'رمز',
      'الرمز',
    ],
  },
  {
    target: 'name',
    keywords: [
      'product name',
      'productname',
      'item name',
      'itemname',
      'title',
      'description',
      'اسم الصنف كما في ملف المورد',
      'اسم الصنف',
      'اسم المنتج',
      'الصنف',
      'المنتج',
      'الوصف',
      'اسم',
      'name',
    ],
  },
  {
    target: 'retailPrice',
    keywords: [
      'سعر الجمهور',
      'سعر البيع',
      'سعر القطاعي',
      'retail price',
      'retailprice',
      'sale price',
      'saleprice',
      'selling price',
      'جمهور',
      'الجمهور',
      'قطاعي',
      'retail',
      'msrp',
    ],
  },
  {
    target: 'price',
    keywords: [
      'سعر الشراء الصافي',
      'سعر الشراء',
      'سعر التكلفة',
      'سعر الجملة',
      'buy price',
      'buyprice',
      'purchase cost',
      'purchasecost',
      'wholesale price',
      'wholesaleprice',
      'unit price',
      'unitprice',
      'التكلفة',
      'تكلفة',
      'جملة',
      'صافي',
      'cost',
      'price',
      'سعر',
    ],
  },
  {
    target: 'barcode',
    keywords: ['barcode', 'upc', 'ean', 'gtin', 'باركود', 'الباركود'],
  },
  {
    target: 'brand',
    keywords: ['brand', 'manufacturer', 'vendor', 'ماركة', 'الماركة', 'براند', 'الشركة', 'المصنع'],
  },
  {
    target: 'quantity',
    keywords: [
      'stock qty',
      'available',
      'balance',
      'on hand',
      'الرصيد المتاح',
      'المخزون المتاح',
      'qty',
      'quantity',
      'stock',
      'كمية',
      'الكمية',
      'المخزون',
      'الرصيد',
      'المتاح',
    ],
  },
  {
    target: 'availability',
    keywords: ['availability', 'status', 'in stock', 'instock', 'active', 'الحالة', 'حالة الصنف', 'التوفر'],
  },
  { target: 'category', keywords: ['category', 'product category', 'التصنيف', 'الفئة', 'القسم'] },
  {
    target: 'discount',
    keywords: ['discount', 'rebate', 'خصم التوريد', 'نسبة الخصم', 'خصم'],
  },
  {
    target: 'currencyColumn',
    keywords: ['currency', 'curr', 'عملة', 'العملة'],
  },
  {
    target: 'units',
    keywords: ['unit', 'units', 'uom', 'pack', 'package', 'size', 'العبوة', 'الحجم', 'وحدة', 'عبوة'],
  },
  {
    target: 'sourceTimestamp',
    keywords: [
      'date',
      'updated',
      'timestamp',
      'time',
      'تاريخ السعر',
      'تاريخ التحديث',
      'وقت التحديث',
      'آخر تحديث',
      'اخر تحديث',
      'تحديث',
      'تاريخ',
    ],
  },
];

@Injectable()
export class ExportProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fingerprintService: FormatFingerprintService,
  ) {}

  /**
   * Discovers and proposes a column mapping from headers and sample rows.
   */
  proposeMapping(headers: string[]): MappingProposal {
    const mapping: Partial<ColumnMappingConfig> = {};
    const confidence: Record<string, number> = {};
    const mappedHeaders = new Set<string>();

    // Pass 1: exact normalized match (prefer longer keywords)
    for (const rule of MAPPING_RULES) {
      const sortedKw = [...rule.keywords].sort((a, b) => b.length - a.length);
      for (const header of headers) {
        if (mappedHeaders.has(header)) continue;
        const normHeader = this.fingerprintService.normalizeHeader(header);
        const match = sortedKw.find((k) => this.fingerprintService.normalizeHeader(k) === normHeader);
        if (match) {
          (mapping as any)[rule.target] = header;
          confidence[rule.target] = 1.0;
          mappedHeaders.add(header);
          break;
        }
      }
    }

    // Pass 2: partial normalized match (prefer longer keywords)
    for (const rule of MAPPING_RULES) {
      if (mapping[rule.target]) continue;
      const sortedKw = [...rule.keywords].sort((a, b) => b.length - a.length);
      for (const header of headers) {
        if (mappedHeaders.has(header)) continue;
        const normHeader = this.fingerprintService.normalizeHeader(header);
        const match = sortedKw.find((k) => {
          const normK = this.fingerprintService.normalizeHeader(k);
          return normHeader.includes(normK) || normK.includes(normHeader);
        });
        if (match) {
          (mapping as any)[rule.target] = header;
          confidence[rule.target] = 0.85;
          mappedHeaders.add(header);
          break;
        }
      }
    }

    const unmappedHeaders = headers.filter((h) => !mappedHeaders.has(h));
    if (mapping.price && !mapping.currency && !mapping.currencyColumn) {
      const embeddedCurrency = currencyFromPriceHeader(mapping.price);
      if (embeddedCurrency) {
        mapping.currency = embeddedCurrency;
        confidence.currency = 1;
      }
    }
    const isComplete = Boolean(mapping.supplierSku && mapping.name && mapping.price &&
      (mapping.currency || mapping.currencyColumn));

    return {
      mapping,
      confidence,
      unmappedHeaders,
      isComplete,
    };
  }

  /**
   * Finds the latest approved ExportProfile strictly scoped to the specified supplierId.
   */
  async findApprovedProfile(
    supplierId: string,
    formatFingerprint: string,
    tx?: import('@prisma/client').Prisma.TransactionClient,
    declaredDocumentKind?: string | null,
  ) {
    if (!supplierId || !formatFingerprint) return null;
    const client = tx || this.prisma;
    const profile = await client.exportProfile.findFirst({
      where: {
        supplierId,
        formatFingerprint,
        isApproved: true,
      },
      orderBy: { version: 'desc' },
    });
    if (!profile) return null;
    // Legacy approvals without reviewed semantics, or a different declared document kind, go back to review.
    const mapping = profile.mapping as unknown as ColumnMappingConfig;
    if (mappingApprovalProblems(mapping).length) return null;
    if (declaredDocumentKind && mapping.semantics?.documentKind !== declaredDocumentKind) return null;
    return profile;
  }

  /**
   * Saves or updates an ExportProfile for a supplier.
   */
  async saveProfile(params: {
    supplierId: string;
    formatFingerprint: string;
    mapping: ColumnMappingConfig;
    name?: string;
    sampleHeaders: string[];
    isApproved?: boolean;
    approvedBy?: string;
  }) {
    const { supplierId, formatFingerprint, mapping, name, sampleHeaders, isApproved, approvedBy } = params;

    // Validate minimum required fields
    if (!mapping.supplierSku || !mapping.name || !mapping.price) {
      throw new BadRequestException('Mapping requires at least supplierSku, name, and price columns');
    }
    if (!mapping.currency && !mapping.currencyColumn && !currencyFromPriceHeader(mapping.price)) {
      throw new BadRequestException('Mapping requires an explicit currency, currency column, or ISO currency in price header');
    }
    const problems = isApproved ? mappingApprovalProblems(mapping) : [];
    if (problems.length) throw new BadRequestException(`Mapping semantics not approvable: ${problems.join('; ')}`);

    const existing = await this.prisma.exportProfile.findFirst({
      where: { supplierId, formatFingerprint },
      orderBy: { version: 'desc' },
    });

    if (existing && !existing.isApproved) {
      // Update unapproved existing profile
      return this.prisma.exportProfile.update({
        where: { id: existing.id },
        data: {
          mapping: mapping as any,
          name: name || existing.name,
          sampleHeaders,
          isApproved: isApproved ?? false,
          approvedBy: isApproved ? approvedBy ?? null : null,
          approvedAt: isApproved ? new Date() : null,
        },
      });
    }

    const newVersion = existing ? existing.version + 1 : 1;
    const profileName = name || `Export Profile v${newVersion} (${formatFingerprint.slice(0, 8)})`;

    return this.prisma.exportProfile.create({
      data: {
        supplierId,
        formatFingerprint,
        version: newVersion,
        name: profileName,
        mapping: mapping as any,
        sampleHeaders,
        isApproved: isApproved ?? false,
        approvedBy: isApproved ? approvedBy ?? null : null,
        approvedAt: isApproved ? new Date() : null,
      },
    });
  }

  /**
   * Approves an ExportProfile, strictly verifying supplier ownership.
   */
  async approveProfile(supplierId: string, profileId: string, approvedBy: string, semantics?: MappingSemantics) {
    const profile = await this.prisma.exportProfile.findUnique({
      where: { id: profileId },
    });

    if (!profile) {
      throw new NotFoundException('Export profile not found');
    }

    if (profile.supplierId !== supplierId) {
      throw new ForbiddenException('Cannot approve an export profile belonging to another supplier');
    }

    const current = profile.mapping as unknown as ColumnMappingConfig;
    const mapping: ColumnMappingConfig = { ...current, semantics: { ...current.semantics, ...semantics } };
    if (current.proposal?.proposedBy === approvedBy) {
      throw new ForbiddenException('A mapping cannot be approved by the account that proposed it');
    }
    const problems = mappingApprovalProblems(mapping);
    if (problems.length) throw new BadRequestException(`Mapping semantics not approvable: ${problems.join('; ')}`);

    return this.prisma.exportProfile.update({
      where: { id: profileId },
      data: {
        mapping: mapping as unknown as Prisma.InputJsonValue,
        isApproved: true,
        approvedBy,
        approvedAt: new Date(),
      },
    });
  }

  /**
   * Retrieves an export profile by ID with strict supplier scoping if provided.
   */
  async getProfile(profileId: string, supplierId?: string) {
    const profile = await this.prisma.exportProfile.findUnique({
      where: { id: profileId },
    });

    if (!profile) {
      throw new NotFoundException('Export profile not found');
    }

    if (supplierId && profile.supplierId !== supplierId) {
      throw new ForbiddenException('Cannot access an export profile belonging to another supplier');
    }

    return profile;
  }

  /**
   * Lists export profiles for a supplier.
   */
  async listProfiles(supplierId?: string) {
    return this.prisma.exportProfile.findMany({
      where: supplierId ? { supplierId } : {},
      orderBy: { updatedAt: 'desc' },
    });
  }
}

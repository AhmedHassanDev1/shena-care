import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { FormatFingerprintService } from './format-fingerprint.service';

export interface ColumnMappingConfig {
  supplierSku: string;
  name: string;
  price: string;
  barcode?: string;
  brand?: string;
  quantity?: string;
  retailPrice?: string;
  availability?: string;
  discount?: string;
  units?: string;
  sourceTimestamp?: string;
  currency?: string;
  currencyColumn?: string;
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
  ) {
    if (!supplierId || !formatFingerprint) return null;
    const client = tx || this.prisma;
    return client.exportProfile.findFirst({
      where: {
        supplierId,
        formatFingerprint,
        isApproved: true,
      },
      orderBy: { version: 'desc' },
    });
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
  async approveProfile(supplierId: string, profileId: string, approvedBy: string) {
    const profile = await this.prisma.exportProfile.findUnique({
      where: { id: profileId },
    });

    if (!profile) {
      throw new NotFoundException('Export profile not found');
    }

    if (profile.supplierId !== supplierId) {
      throw new ForbiddenException('Cannot approve an export profile belonging to another supplier');
    }

    return this.prisma.exportProfile.update({
      where: { id: profileId },
      data: {
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

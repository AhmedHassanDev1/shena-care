import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { CatalogService, BrandService } from '../../catalog/public';
import { RowNormalizationService } from './row-normalization.service';
import { IngestionStatus } from '@prisma/client';

export enum MatchClassification {
  EXACT_MATCH = 'EXACT_MATCH',
  LIKELY_MATCH = 'LIKELY_MATCH',
  CONFLICT = 'CONFLICT',
  NO_MATCH = 'NO_MATCH',
  OUT_OF_SCOPE = 'OUT_OF_SCOPE',
  INVALID = 'INVALID',
}

export interface CandidateItemIdentityInput {
  supplierId: string;
  supplierSkuCode: string;
  name: string;
  brand: string;
  barcode?: string | null;
  size?: number | null;
  sizeUnit?: string | null;
  variantName?: string | null;
  packageCount?: number | null;
  category?: string | null;
  rawBrand?: string | null;
  rawName?: string | null;
}

export interface CanonicalSkuSnapshot {
  id: string;
  code: string;
  productId: string;
  productName: string;
  brandName: string;
  size?: number | null;
  sizeUnit?: string | null;
  variantName?: string | null;
  barcode?: string | null;
}

export interface ProductIdentityMatchResult {
  classification: MatchClassification;
  matchedSkuId: string | null;
  reason: string;
  fingerprint: string;
  conflicts: string[];
  canonicalSku?: CanonicalSkuSnapshot | null;
  existingCandidateId?: string | null;
}

// Curated brand alias dictionary (AR & EN mapping to canonical keys)
const BRAND_ALIASES: Record<string, string> = {
  'سيرافي': 'cerave',
  'cerave': 'cerave',
  'بيوديرما': 'bioderma',
  'bioderma': 'bioderma',
  'لاروش بوزيه': 'la-roche-posay',
  'لاروش-بوزيه': 'la-roche-posay',
  'la roche posay': 'la-roche-posay',
  'la-roche-posay': 'la-roche-posay',
  'يوسيرين': 'eucerin',
  'eucerin': 'eucerin',
  'اورجيناري': 'the-ordinary',
  'the ordinary': 'the-ordinary',
  'the-ordinary': 'the-ordinary',
  'ordinary': 'the-ordinary',
  'فيشي': 'vichy',
  'vichy': 'vichy',
  'سيتافيل': 'cetaphil',
  'cetaphil': 'cetaphil',
  'ستارفيل': 'starville',
  'starville': 'starville',
  'افين': 'avene',
  'avene': 'avene',
  'نيتروجينا': 'neutrogena',
  'neutrogena': 'neutrogena',
  'بانوكسيل': 'panoxyl',
  'panoxyl': 'panoxyl',
  'كوسركس': 'cosrx',
  'cosrx': 'cosrx',
  'ايزدين': 'isdin',
  'isdin': 'isdin',
};

@Injectable()
export class ProductIdentityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogService: CatalogService,
    private readonly brandService: BrandService,
    @Optional() private readonly rowNormalizationService?: RowNormalizationService,
  ) {}

  normalizeString(str: string): string {
    if (!str) return '';
    return str
      .toLowerCase()
      .trim()
      .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632))
      .replace(/[أإآ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/[ىي]/g, 'ي')
      .replace(/[\u064B-\u065F\u0640]/g, '')
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/(^-|-$)+/g, '');
  }

  canonicalizeBrand(brand: string): string {
    if (!brand) return '';
    const norm = this.normalizeString(brand);
    return BRAND_ALIASES[norm] || BRAND_ALIASES[brand.toLowerCase().trim()] || norm;
  }

  isInvalidBrand(brand: string): boolean {
    if (!brand || !brand.trim()) return true;
    const trimmed = brand.trim().toLowerCase();
    if (/^\d+$/.test(trimmed) || trimmed.length < 2) return true;
    const invalidKeywords = ['unknown', 'general', 'fake', 'fakebrand', 'scam', 'n/a', 'none', 'غير معروف', 'عام', 'invalid', 'prohibited'];
    if (invalidKeywords.some((k) => trimmed.includes(k))) {
      return true;
    }
    return false;
  }

  /**
   * Generates a deterministic, versioned product identity fingerprint.
   * Format: v1:<brand_norm>:<name_norm>:<variant_norm>:<size><unit>
   */
  generateFingerprint(input: {
    brand: string;
    name: string;
    variantName?: string | null;
    size?: number | null;
    sizeUnit?: string | null;
  }): string {
    const brandNorm = this.canonicalizeBrand(input.brand);
    let nameNorm = this.normalizeString(input.name);
    let size = input.size;
    let unit = input.sizeUnit;

    if (this.rowNormalizationService) {
      const extracted = this.rowNormalizationService.extractSizeAndPack(input.name, input.sizeUnit ?? undefined);
      if (extracted.cleanTitle) {
        const cleanNorm = this.normalizeString(extracted.cleanTitle);
        if (cleanNorm && cleanNorm !== nameNorm && (extracted.size !== null || extracted.packCount !== null)) {
          nameNorm = cleanNorm;
        }
      }
      if ((size === undefined || size === null) && extracted.size !== null) {
        size = extracted.size;
        unit = extracted.unit;
      }
    }

    const variantNorm = input.variantName ? this.normalizeString(input.variantName) : 'default';
    const sizeNorm = size !== undefined && size !== null ? `${size}` : 'nosize';
    const unitNorm = unit ? this.normalizeString(unit) : 'nounit';

    return `v1:${brandNorm}:${nameNorm}:${variantNorm}:${sizeNorm}${unitNorm}`;
  }

  /**
   * Classifies candidate match into EXACT_MATCH, LIKELY_MATCH, NO_MATCH, CONFLICT, OUT_OF_SCOPE, or INVALID.
   */
  async classifyCandidateMatch(input: CandidateItemIdentityInput): Promise<ProductIdentityMatchResult> {
    let effectiveSize = input.size !== undefined && input.size !== null ? input.size : null;
    let effectiveUnit = input.sizeUnit || null;

    if (effectiveSize === null && this.rowNormalizationService) {
      const extracted = this.rowNormalizationService.extractSizeAndPack(input.name, input.sizeUnit ?? undefined);
      if (extracted.size !== null) {
        effectiveSize = extracted.size;
        effectiveUnit = extracted.unit;
      }
    }

    const fingerprint = this.generateFingerprint({
      brand: input.brand,
      name: input.name,
      variantName: input.variantName,
      size: effectiveSize,
      sizeUnit: effectiveUnit,
    });

    // 0. Mandatory identifier validation
    if (!input.name || !input.brand || !input.name.trim() || !input.brand.trim()) {
      return {
        classification: MatchClassification.INVALID,
        matchedSkuId: null,
        reason: 'missing_required_product_fields',
        fingerprint,
        conflicts: ['missing_name_or_brand'],
        canonicalSku: null,
      };
    }

    // 0b. Brand validity check
    if (this.isInvalidBrand(input.brand)) {
      return {
        classification: MatchClassification.INVALID,
        matchedSkuId: null,
        reason: 'invalid_or_unvetted_brand',
        fingerprint,
        conflicts: ['unrecognized_or_invalid_brand'],
        canonicalSku: null,
      };
    }

    // 0c. Category & scope evaluation via RowNormalizationService
    if (this.rowNormalizationService) {
      const scope = this.rowNormalizationService.classifyScope(input.name, input.brand);
      if (!scope.isEligible && scope.category === 'excluded') {
        return {
          classification: MatchClassification.OUT_OF_SCOPE,
          matchedSkuId: null,
          reason: scope.reason || 'excluded_category_goods',
          fingerprint,
          conflicts: [scope.reason || 'excluded_category_goods'],
          canonicalSku: null,
        };
      }
    }

    // 1. Check Supplier SKU Alias mapping first (Deterministic cache)
    const alias = await this.prisma.supplierSkuAlias.findUnique({
      where: {
        supplierId_supplierSkuCode: {
          supplierId: input.supplierId,
          supplierSkuCode: input.supplierSkuCode,
        },
      },
      include: {
        sku: {
          include: {
            product: {
              include: { brand: true },
            },
          },
        },
      },
    });

    if (alias && alias.sku && alias.sku.isActive) {
      return {
        classification: MatchClassification.EXACT_MATCH,
        matchedSkuId: alias.skuId,
        reason: 'matched_supplier_sku_alias',
        fingerprint,
        conflicts: [],
        canonicalSku: {
          id: alias.sku.id,
          code: alias.sku.code,
          productId: alias.sku.productId,
          productName: alias.sku.product.name,
          brandName: alias.sku.product.brand.name,
          size: alias.sku.size ? alias.sku.size.toNumber() : null,
          sizeUnit: alias.sku.sizeUnit,
          variantName: alias.sku.variantName,
          barcode: alias.sku.barcode,
        },
      };
    }

    // 2. Check Barcode matching (Primary Barcode + SkuBarcodeAlias GLO-242)
    if (input.barcode) {
      const rawBarcode = input.barcode.trim();
      const skusWithBarcode = await this.prisma.sku.findMany({
        where: { barcode: rawBarcode, isActive: true },
        include: { product: { include: { brand: true } } },
      });

      const barcodeAliases = await this.prisma.skuBarcodeAlias.findMany({
        where: { barcode: rawBarcode, status: 'approved' },
        include: { sku: { include: { product: { include: { brand: true } } } } },
      });

      const matchedSkusMap = new Map<string, any>();
      for (const s of skusWithBarcode) {
        matchedSkusMap.set(s.id, s);
      }
      for (const a of barcodeAliases) {
        if (a.sku && a.sku.isActive && !matchedSkusMap.has(a.sku.id)) {
          matchedSkusMap.set(a.sku.id, a.sku);
        }
      }
      const matchedSkus = Array.from(matchedSkusMap.values());

      // 2a. Barcode collision: multiple canonical SKUs mapped to same barcode
      if (matchedSkus.length > 1) {
        return {
          classification: MatchClassification.CONFLICT,
          matchedSkuId: null,
          reason: 'barcode_collision_multiple_skus',
          fingerprint,
          conflicts: [`barcode ${rawBarcode} resolves to multiple canonical SKUs: ${matchedSkus.map((s) => s.code).join(', ')}`],
          canonicalSku: null,
        };
      }

      // 2b. Exactly one canonical SKU mapped
      if (matchedSkus.length === 1) {
        const canonicalSku = matchedSkus[0];
        const conflicts: string[] = [];

        // Check size conflict
        const canonicalSize = canonicalSku.size ? canonicalSku.size.toNumber() : null;
        if (effectiveSize !== null && canonicalSize !== null && effectiveSize !== canonicalSize) {
          conflicts.push(`barcode_size_mismatch: candidate size (${effectiveSize}) differs from canonical size (${canonicalSize})`);
        }

        // Check brand conflict
        const canonicalBrandNorm = this.canonicalizeBrand(canonicalSku.product.brand.name);
        const candidateBrandNorm = this.canonicalizeBrand(input.brand);
        if (
          canonicalBrandNorm !== candidateBrandNorm &&
          !canonicalBrandNorm.includes(candidateBrandNorm) &&
          !candidateBrandNorm.includes(canonicalBrandNorm)
        ) {
          conflicts.push(
            `barcode_brand_mismatch: candidate brand (${input.brand}) differs from canonical brand (${canonicalSku.product.brand.name})`,
          );
        }

        if (conflicts.length > 0) {
          return {
            classification: MatchClassification.CONFLICT,
            matchedSkuId: null,
            reason: 'barcode_matched_with_conflicting_facts',
            fingerprint,
            conflicts,
            canonicalSku: null,
          };
        }

        const isAlias = skusWithBarcode.length === 0 && barcodeAliases.length > 0;
        return {
          classification: MatchClassification.EXACT_MATCH,
          matchedSkuId: canonicalSku.id,
          reason: isAlias ? 'barcode_alias_exact_match' : 'barcode_exact_match',
          fingerprint,
          conflicts: [],
          canonicalSku: {
            id: canonicalSku.id,
            code: canonicalSku.code,
            productId: canonicalSku.productId,
            productName: canonicalSku.product.name,
            brandName: canonicalSku.product.brand.name,
            size: canonicalSize,
            sizeUnit: canonicalSku.sizeUnit,
            variantName: canonicalSku.variantName,
            barcode: canonicalSku.barcode,
          },
        };
      }
    }

    // 3. Search Catalog by Brand & Normalized Product Name
    const brandNameLookup = this.canonicalizeBrand(input.brand);
    let brand: { id: string; name: string } | null = await this.brandService.getBrand(input.brand);
    if (!brand) {
      brand = await this.prisma.brand.findFirst({
        where: {
          OR: [
            { slug: brandNameLookup },
            { name: { mode: 'insensitive', equals: input.brand } },
            { slug: this.normalizeString(input.brand) },
          ],
        },
      });
    }

    if (brand) {
      const canonicalProducts = await this.prisma.product.findMany({
        where: { brandId: brand.id },
        include: { skus: { where: { isActive: true } } },
      });

      const candidateNameNorm = this.normalizeString(input.name);

      for (const product of canonicalProducts) {
        const canonicalNameNorm = this.normalizeString(product.name);
        if (
          canonicalNameNorm === candidateNameNorm ||
          canonicalNameNorm.includes(candidateNameNorm) ||
          candidateNameNorm.includes(canonicalNameNorm)
        ) {
          // Compare SKUs under product for exact size/variant match
          for (const sku of product.skus) {
            const canonicalSize = sku.size ? sku.size.toNumber() : null;

            if (effectiveSize !== null && canonicalSize !== null && effectiveSize === canonicalSize) {
              return {
                classification: MatchClassification.EXACT_MATCH,
                matchedSkuId: sku.id,
                reason: 'brand_name_size_exact_match',
                fingerprint,
                conflicts: [],
                canonicalSku: {
                  id: sku.id,
                  code: sku.code,
                  productId: product.id,
                  productName: product.name,
                  brandName: brand.name,
                  size: canonicalSize,
                  sizeUnit: sku.sizeUnit,
                  variantName: sku.variantName,
                  barcode: sku.barcode,
                },
              };
            }
          }

          // Same product name/brand but different size -> LIKELY_MATCH requiring review
          return {
            classification: MatchClassification.LIKELY_MATCH,
            matchedSkuId: null,
            reason: 'brand_and_product_name_match_different_size_or_variant',
            fingerprint,
            conflicts: ['different_size_or_variant_requires_review'],
            canonicalSku: null,
          };
        }
      }
    }

    // 4. Multi-supplier candidate deduplication: check if another supplier has already submitted this candidate
    let existingCandidateItem: any = null;

    if (input.barcode) {
      existingCandidateItem = await this.prisma.ingestionItem.findFirst({
        where: {
          barcode: input.barcode,
          status: { in: [IngestionStatus.pending, IngestionStatus.review_required, IngestionStatus.approved] },
        },
        orderBy: { createdAt: 'asc' },
      });
    }

    if (!existingCandidateItem) {
      const candBrand = this.canonicalizeBrand(input.brand);
      const candidates = await this.prisma.ingestionItem.findMany({
        where: {
          status: { in: [IngestionStatus.pending, IngestionStatus.review_required, IngestionStatus.approved] },
        },
        orderBy: { createdAt: 'asc' },
        take: 100,
      });

      for (const c of candidates) {
        if (this.canonicalizeBrand(c.brand) === candBrand) {
          const cFp = (c.enrichment as any)?.identity?.fingerprint ||
            this.generateFingerprint({ brand: c.brand, name: c.name });
          if (cFp === fingerprint) {
            existingCandidateItem = c;
            break;
          }
        }
      }
    }

    if (existingCandidateItem) {
      return {
        classification: MatchClassification.NO_MATCH,
        matchedSkuId: null,
        reason: 'no_canonical_match_found_existing_candidate_reused',
        fingerprint,
        conflicts: input.barcode ? [] : ['missing_barcode'],
        canonicalSku: null,
        existingCandidateId: existingCandidateItem.id,
      };
    }

    return {
      classification: MatchClassification.NO_MATCH,
      matchedSkuId: null,
      reason: 'no_canonical_match_found',
      fingerprint,
      conflicts: input.barcode ? [] : ['missing_barcode'],
      canonicalSku: null,
      existingCandidateId: null,
    };
  }

  /**
   * Registers an approved Supplier SKU Alias for automatic matching on future imports.
   */
  async createSupplierSkuAlias(supplierId: string, supplierSkuCode: string, skuId: string): Promise<void> {
    await this.prisma.supplierSkuAlias.upsert({
      where: {
        supplierId_supplierSkuCode: {
          supplierId,
          supplierSkuCode,
        },
      },
      create: {
        supplierId,
        supplierSkuCode,
        skuId,
      },
      update: {
        skuId,
      },
    });
  }
}


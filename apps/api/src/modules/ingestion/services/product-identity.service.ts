import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { CatalogService, BrandService } from '../../catalog/public';

export enum MatchClassification {
  EXACT_MATCH = 'EXACT_MATCH',
  LIKELY_MATCH = 'LIKELY_MATCH',
  CONFLICT = 'CONFLICT',
  NO_MATCH = 'NO_MATCH',
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
}

export interface ProductIdentityMatchResult {
  classification: MatchClassification;
  matchedSkuId: string | null;
  reason: string;
  fingerprint: string;
  conflicts: string[];
}

@Injectable()
export class ProductIdentityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogService: CatalogService,
    private readonly brandService: BrandService,
  ) {}

  /**
   * Normalizes strings by lowercasing, trimming, removing extra spaces, and removing non-alphanumeric noise.
   */
  normalizeString(str: string): string {
    return str
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '');
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
    const brandNorm = this.normalizeString(input.brand);
    const nameNorm = this.normalizeString(input.name);
    const variantNorm = input.variantName ? this.normalizeString(input.variantName) : 'default';
    const sizeNorm = input.size !== undefined && input.size !== null ? `${input.size}` : 'nosize';
    const unitNorm = input.sizeUnit ? this.normalizeString(input.sizeUnit) : 'nounit';

    return `v1:${brandNorm}:${nameNorm}:${variantNorm}:${sizeNorm}${unitNorm}`;
  }

  /**
   * Classifies candidate match into EXACT_MATCH, LIKELY_MATCH, CONFLICT, or NO_MATCH.
   */
  async classifyCandidateMatch(input: CandidateItemIdentityInput): Promise<ProductIdentityMatchResult> {
    const fingerprint = this.generateFingerprint(input);
    const conflicts: string[] = [];

    // 1. Check Supplier SKU Alias mapping first
    const alias = await this.prisma.supplierSkuAlias.findUnique({
      where: {
        supplierId_supplierSkuCode: {
          supplierId: input.supplierId,
          supplierSkuCode: input.supplierSkuCode,
        },
      },
    });

    if (alias) {
      return {
        classification: MatchClassification.EXACT_MATCH,
        matchedSkuId: alias.skuId,
        reason: 'matched_supplier_sku_alias',
        fingerprint,
        conflicts: [],
      };
    }

    // 2. Check Barcode matching
    if (input.barcode) {
      const canonicalSku = await this.prisma.sku.findFirst({
        where: { barcode: input.barcode, isActive: true },
        include: { product: { include: { brand: true } } },
      });

      if (canonicalSku) {
        // Check for conflicts:
        // A) Size conflict
        const canonicalSize = canonicalSku.size ? canonicalSku.size.toNumber() : null;
        const candidateSize = input.size !== undefined && input.size !== null ? input.size : null;
        if (candidateSize !== null && canonicalSize !== null && candidateSize !== canonicalSize) {
          conflicts.push(`barcode_size_mismatch: candidate size (${candidateSize}) differs from canonical size (${canonicalSize})`);
        }

        // B) Brand conflict
        const canonicalBrandNorm = this.normalizeString(canonicalSku.product.brand.name);
        const candidateBrandNorm = this.normalizeString(input.brand);
        if (canonicalBrandNorm !== candidateBrandNorm && !canonicalBrandNorm.includes(candidateBrandNorm) && !candidateBrandNorm.includes(canonicalBrandNorm)) {
          conflicts.push(`barcode_brand_mismatch: candidate brand (${input.brand}) differs from canonical brand (${canonicalSku.product.brand.name})`);
        }

        if (conflicts.length > 0) {
          return {
            classification: MatchClassification.CONFLICT,
            matchedSkuId: null,
            reason: 'barcode_matched_with_conflicting_facts',
            fingerprint,
            conflicts,
          };
        }

        return {
          classification: MatchClassification.EXACT_MATCH,
          matchedSkuId: canonicalSku.id,
          reason: 'barcode_exact_match',
          fingerprint,
          conflicts: [],
        };
      }
    }

    // 3. Search Catalog by Brand & Normalized Product Name
    const brand = await this.brandService.getBrand(input.brand);
    if (brand) {
      const canonicalProducts = await this.prisma.product.findMany({
        where: { brandId: brand.id },
        include: { skus: true },
      });

      const candidateNameNorm = this.normalizeString(input.name);

      for (const product of canonicalProducts) {
        const canonicalNameNorm = this.normalizeString(product.name);
        if (canonicalNameNorm === candidateNameNorm || canonicalNameNorm.includes(candidateNameNorm) || candidateNameNorm.includes(canonicalNameNorm)) {
          // Compare SKUs under product for exact size/variant match
          for (const sku of product.skus) {
            const canonicalSize = sku.size ? sku.size.toNumber() : null;
            const candidateSize = input.size !== undefined && input.size !== null ? input.size : null;

            if (candidateSize !== null && canonicalSize !== null && candidateSize === canonicalSize) {
              return {
                classification: MatchClassification.EXACT_MATCH,
                matchedSkuId: sku.id,
                reason: 'brand_name_size_exact_match',
                fingerprint,
                conflicts: [],
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
          };
        }
      }
    }

    return {
      classification: MatchClassification.NO_MATCH,
      matchedSkuId: null,
      reason: 'no_canonical_match_found',
      fingerprint,
      conflicts: input.barcode ? [] : ['missing_barcode'],
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

import { Injectable, Logger } from '@nestjs/common';
import { CatalogService, PublishedProduct } from '../../catalog/public';
import { CommerceService } from '../../commerce/public';
import { RoutineProposal, RoutineStepProposal } from '../../../platform/ai';

export interface ProductResolutionResult {
  productQuery: string;
  resolved: boolean;
  productId?: string;
  skuId?: string;
  reason?: string;
}

export interface ResolvedCatalogProduct {
  productId: string;
  slug: string;
  name: string;
  brandName: string;
  categoryName?: string | null;
  skuId: string;
  variantName: string;
  imageUrl?: string | null;
  price?: {
    amount: number;
    currency: string;
    compareAtAmount?: number | null;
  } | null;
  isSellable: boolean;
}

export interface StepValidationResult {
  stepIndex: number;
  stepTitle: string;
  isValid: boolean;
  productResolution?: ProductResolutionResult;
  availabilityCheck?: {
    skuId: string;
    isSellable: boolean;
    reason: string;
    terms?: any;
  };
  resolvedProduct?: ResolvedCatalogProduct;
  errors: string[];
}

export interface ProposalValidationResult {
  isValid: boolean;
  errors: string[];
  stepResults: StepValidationResult[];
}

/**
 * Validates AI-generated routine proposals against trusted backend state.
 *
 * The AI is NOT the source of truth for:
 * - Product existence (Catalog owns this)
 * - Product availability (Commerce owns this)
 * - Pricing (Commerce owns this)
 *
 * This validator ensures AI recommendations reference real, sellable products.
 */
@Injectable()
export class RecommendationValidatorService {
  private readonly logger = new Logger(RecommendationValidatorService.name);

  constructor(
    private readonly catalogService: CatalogService,
    private readonly commerceService: CommerceService,
  ) {}

  /**
   * Validate a routine proposal against trusted backend state.
   *
   * Checks:
   * 1. Product references resolve to real catalog products
   * 2. Referenced products are sellable (availability + pricing)
   * 3. Basic structural validity (done by AI service)
   */
  async validateProposal(proposal: RoutineProposal, options?: { budgetLimit?: number }): Promise<ProposalValidationResult> {
    const errors: string[] = [];
    const stepResults: StepValidationResult[] = [];

    if (!proposal.steps || proposal.steps.length === 0) {
      errors.push('Proposal contains no steps');
      return { isValid: false, errors, stepResults };
    }

    let totalPrice = 0;
    const products = await this.safeGetPublishedProducts();

    for (let i = 0; i < proposal.steps.length; i++) {
      const step = proposal.steps[i];
      const stepResult = await this.validateStep(step, i, products);
      stepResults.push(stepResult);

      if (!stepResult.isValid) {
        errors.push(...stepResult.errors.map(e => `Step ${i} (${step.title}): ${e}`));
      } else if (stepResult.availabilityCheck?.terms?.price) {
        totalPrice += stepResult.availabilityCheck.terms.price.amount;
      }
    }

    if (options?.budgetLimit && totalPrice > options.budgetLimit) {
      errors.push(`Proposal total price (${totalPrice}) exceeds budget limit (${options.budgetLimit})`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      stepResults,
    };
  }

  /**
   * Lists live published product identifiers so the AI provider stays grounded in real catalog items.
   */
  async listCatalogProductNames(): Promise<string[]> {
    const products = await this.safeGetPublishedProducts();
    return products.map(p => `${p.brand.name} ${p.name}`);
  }

  /**
   * Resolves sellable catalog products referenced by a persisted proposal or mentioned in assistant copy.
   */
  async resolveProductsForGuidance(
    proposal?: RoutineProposal | null,
    messageText?: string,
  ): Promise<ResolvedCatalogProduct[]> {
    const products = await this.safeGetPublishedProducts();
    if (!products.length) return [];

    const byId = new Map<string, ResolvedCatalogProduct>();
    const queries = (proposal?.steps ?? [])
      .map(step => step.productQuery?.trim())
      .filter((q): q is string => Boolean(q));

    for (const query of queries) {
      const match = this.findMatchingProduct(query, products);
      if (match) {
        const resolved = await this.toSellableResolvedProduct(match);
        if (resolved) byId.set(resolved.productId, resolved);
      }
    }

    if (messageText) {
      const lowerMsg = messageText.toLowerCase();
      for (const product of products) {
        if (byId.size >= 6) break;
        const pName = product.name.toLowerCase();
        const full = `${product.brand.name} ${product.name}`.toLowerCase();
        if (pName.length >= 6 && (lowerMsg.includes(pName) || lowerMsg.includes(full))) {
          if (!byId.has(product.id)) {
            const resolved = await this.toSellableResolvedProduct(product);
            if (resolved) byId.set(resolved.productId, resolved);
          }
        }
      }
    }

    return [...byId.values()].slice(0, 6);
  }

  private async safeGetPublishedProducts(): Promise<PublishedProduct[]> {
    try {
      return await this.catalogService.getPublishedProducts({ limit: 50 });
    } catch (error) {
      this.logger.warn(`Failed to fetch published products: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  private async validateStep(
    step: RoutineStepProposal,
    index: number,
    products?: PublishedProduct[],
  ): Promise<StepValidationResult> {
    const result: StepValidationResult = {
      stepIndex: index,
      stepTitle: step.title,
      isValid: true,
      errors: [],
    };

    // If step has no product query, it's valid (user can choose product themselves)
    if (!step.productQuery) {
      return result;
    }

    // Resolve product query to actual catalog product
    const catalog = products ?? (await this.safeGetPublishedProducts());
    const matchedProduct = this.findMatchingProduct(step.productQuery, catalog);
    const productResolution = await this.resolveProductQuery(step.productQuery, matchedProduct);
    result.productResolution = productResolution;

    if (!productResolution.resolved) {
      result.isValid = false;
      result.errors.push(productResolution.reason || 'Product query did not resolve to a catalog product');
      return result;
    }

    // Check if resolved SKU is sellable
    if (productResolution.skuId) {
      const availabilityCheck = await this.checkAvailability(productResolution.skuId);
      result.availabilityCheck = availabilityCheck;

      if (!availabilityCheck.isSellable) {
        result.isValid = false;
        result.errors.push(`Product not sellable: ${availabilityCheck.reason}`);
      } else if (matchedProduct) {
        const sku = matchedProduct.skus.find(s => s.id === productResolution.skuId) ?? matchedProduct.skus[0];
        const image = matchedProduct.media.find(m => m.skuId === sku?.id && m.isPrimary)
          ?? matchedProduct.media.find(m => m.isPrimary)
          ?? matchedProduct.media[0];
        result.resolvedProduct = {
          productId: matchedProduct.id,
          slug: matchedProduct.slug,
          name: matchedProduct.name,
          brandName: matchedProduct.brand.name,
          categoryName: matchedProduct.category?.name ?? null,
          skuId: productResolution.skuId,
          variantName: sku?.variantName ?? '',
          imageUrl: image?.url ?? null,
          price: availabilityCheck.terms?.price ?? null,
          isSellable: true,
        };
      }
    }

    return result;
  }

  private findMatchingProduct(query: string, products: PublishedProduct[]): PublishedProduct | undefined {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return undefined;
    const queryParts = normalizedQuery.split(/\s+/).filter(Boolean);

    return products.find(p => {
      const pName = p.name.toLowerCase();
      const brandAndName = `${p.brand.name} ${p.name}`.toLowerCase();
      return queryParts.every(part => brandAndName.includes(part)) ||
        normalizedQuery.includes(pName) ||
        normalizedQuery.includes(brandAndName);
    });
  }

  private async toSellableResolvedProduct(product: PublishedProduct): Promise<ResolvedCatalogProduct | null> {
    const activeSkus = product.skus.filter(sku => sku.isActive);
    for (const sku of activeSkus) {
      const availability = await this.checkAvailability(sku.id);
      if (availability.isSellable && availability.terms?.price) {
        const image = product.media.find(m => m.skuId === sku.id && m.isPrimary)
          ?? product.media.find(m => m.isPrimary)
          ?? product.media[0];
        return {
          productId: product.id,
          slug: product.slug,
          name: product.name,
          brandName: product.brand.name,
          categoryName: product.category?.name ?? null,
          skuId: sku.id,
          variantName: sku.variantName,
          imageUrl: image?.url ?? null,
          price: availability.terms.price,
          isSellable: true,
        };
      }
    }
    return null;
  }

  /**
   * Attempt to resolve a product query string to a real catalog product and SKU.
   */
  private async resolveProductQuery(
    query: string,
    prematched?: PublishedProduct,
  ): Promise<ProductResolutionResult> {
    try {
      const matchedProduct = prematched ?? this.findMatchingProduct(query, await this.catalogService.getPublishedProducts({ limit: 50 }));

      if (!matchedProduct) {
        return {
          productQuery: query,
          resolved: false,
          reason: `No catalog product found matching "${query}"`,
        };
      }

      // Use the first active SKU from the matched product
      const activeSku = matchedProduct.skus.find(sku => sku.isActive);

      if (!activeSku) {
        return {
          productQuery: query,
          resolved: false,
          productId: matchedProduct.id,
          reason: `Product "${matchedProduct.name}" has no active SKUs`,
        };
      }

      return {
        productQuery: query,
        resolved: true,
        productId: matchedProduct.id,
        skuId: activeSku.id,
      };
    } catch (error) {
      this.logger.error(`Product resolution failed for query "${query}": ${error instanceof Error ? error.message : String(error)}`);
      return {
        productQuery: query,
        resolved: false,
        reason: 'Product resolution failed due to internal error',
      };
    }
  }

  /**
   * Check if a SKU is currently sellable (availability + pricing).
   */
  private async checkAvailability(skuId: string): Promise<{
    skuId: string;
    isSellable: boolean;
    reason: string;
    terms?: any;
  }> {
    try {
      const evaluation = await this.commerceService.evaluateSellability(skuId);

      return {
        skuId,
        isSellable: evaluation.isSellable,
        reason: evaluation.message,
        terms: evaluation.terms,
      };
    } catch (error) {
      this.logger.error(`Sellability check failed for SKU ${skuId}: ${error instanceof Error ? error.message : String(error)}`);
      return {
        skuId,
        isSellable: false,
        reason: 'Sellability check failed due to internal error',
      };
    }
  }
}

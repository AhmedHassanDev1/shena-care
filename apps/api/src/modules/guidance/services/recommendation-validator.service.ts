import { Injectable, Logger } from '@nestjs/common';
import { CatalogService } from '../../catalog/public';
import { CommerceService } from '../../commerce/public';
import { RoutineProposal, RoutineStepProposal } from '../../../platform/ai';

export interface ProductResolutionResult {
  productQuery: string;
  resolved: boolean;
  productId?: string;
  skuId?: string;
  reason?: string;
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

    for (let i = 0; i < proposal.steps.length; i++) {
      const step = proposal.steps[i];
      const stepResult = await this.validateStep(step, i);
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

  private async validateStep(step: RoutineStepProposal, index: number): Promise<StepValidationResult> {
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
    const productResolution = await this.resolveProductQuery(step.productQuery);
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
      }
    }

    return result;
  }

  /**
   * Attempt to resolve a product query string to a real catalog product and SKU.
   *
   * This is a best-effort search. For MVP, we search by product name.
   * Future: Could use semantic search, fuzzy matching, or category filters.
   */
  private async resolveProductQuery(query: string): Promise<ProductResolutionResult> {
    const normalizedQuery = query.trim().toLowerCase();

    try {
      // Search published products
      const products = await this.catalogService.getPublishedProducts({ limit: 50 });

      // Simple name matching for MVP
      const matchedProduct = products.find(p => {
        const pName = p.name.toLowerCase();
        const queryParts = normalizedQuery.split(' ');
        return queryParts.every(part => pName.includes(part)) ||
               normalizedQuery.includes(pName);
      });

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

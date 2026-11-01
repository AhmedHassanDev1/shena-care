import { Injectable, Logger } from '@nestjs/common';

export type UsageFrequency = 'AM' | 'PM' | 'BOTH' | 'AS_NEEDED';
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface ProductUsageData {
  productId: string;
  startedAt: Date;
  frequency: UsageFrequency;
  baselineDaysOfUse?: number; 
}

export interface ReplenishmentEstimate {
  productId: string;
  isDue: boolean;
  confidence: Confidence;
  estimatedDepletionDate: Date;
  daysRemaining: number;
}

export interface ReorderSuggestion {
  productId: string;
  isAvailable: boolean;
  currentPrice: number;
  currency: string;
  alternativeFlowNeeded: boolean;
}

@Injectable()
export class ReplenishmentEstimatorService {
  private readonly logger = new Logger(ReplenishmentEstimatorService.name);

  /**
   * Calculates the replenishment window based on baseline days of use and user frequency.
   */
  estimateDepletion(data: ProductUsageData): ReplenishmentEstimate {
    // Default baseline if not provided in catalog metadata (e.g. 60 days)
    const baseDays = data.baselineDaysOfUse || 60;
    let modifier = 1.0;

    switch (data.frequency) {
      case 'BOTH':
        modifier = 0.5; // used twice as fast
        break;
      case 'AM':
      case 'PM':
        modifier = 1.0; // standard use
        break;
      case 'AS_NEEDED':
        modifier = 1.5; // lasts longer
        break;
    }

    const estimatedTotalDays = Math.floor(baseDays * modifier);
    const estimatedDepletionDate = new Date(data.startedAt.getTime() + estimatedTotalDays * 24 * 60 * 60 * 1000);
    const now = new Date();
    
    const daysRemaining = Math.ceil((estimatedDepletionDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    
    // Confidence is HIGH if we know the baseline, LOW if it's a fallback or as-needed
    let confidence: Confidence = 'MEDIUM';
    if (!data.baselineDaysOfUse || data.frequency === 'AS_NEEDED') {
      confidence = 'LOW';
    } else if (data.baselineDaysOfUse && (data.frequency === 'AM' || data.frequency === 'PM' || data.frequency === 'BOTH')) {
      confidence = 'HIGH';
    }

    // Due when remaining days is less than or equal to 7 (buffer for shipping)
    const isDue = daysRemaining <= 7;

    return {
      productId: data.productId,
      isDue,
      confidence,
      estimatedDepletionDate,
      daysRemaining
    };
  }

  /**
   * Generates a safe reorder suggestion resolving current price and availability.
   * Does NOT silently modify a cart or auto-renew.
   */
  async generateReorderSuggestion(productId: string): Promise<ReorderSuggestion> {
    // In reality, fetch from Catalog/Commerce modules here
    // Mocking resolution as required for MVP architecture definition
    
    const mockCatalogQuery = {
      productId,
      available: true, 
      price: 150.00,
      currency: 'EGP'
    };

    if (!mockCatalogQuery.available) {
      return {
        productId,
        isAvailable: false,
        currentPrice: 0,
        currency: mockCatalogQuery.currency,
        alternativeFlowNeeded: true // No silent substitution allowed
      };
    }

    return {
      productId,
      isAvailable: true,
      currentPrice: mockCatalogQuery.price,
      currency: mockCatalogQuery.currency,
      alternativeFlowNeeded: false
    };
  }

  handleUserAction(productId: string, action: 'reorder' | 'not_yet' | 'snooze' | 'stopped') {
    this.logger.log(`User took action '${action}' on replenishment for product ${productId}. Updating lifecycle state.`);
    // Here we would dispatch to Lifecycle state to record the outcome.
  }
}

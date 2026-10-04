import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { BenefitType, DiscountType, Prisma, Promotion } from '@prisma/client';

export interface PromotionDto {
  campaignName: string;
  code?: string;
  benefitType: BenefitType;
  discountType?: DiscountType;
  discountValue?: number;
  minBasketValue?: number;
  isStackable?: boolean;
  isActive?: boolean;
  validFrom: Date;
  validUntil?: Date;
}

export interface PromotionEvaluationContext {
  subtotal: number;
  items: { skuId: string; price: number; quantity: number }[];
  customerContext?: any; // For future geography/context logic
}

export interface PromotionEvaluationResult {
  appliedPromotions: {
    promotionId: string;
    campaignName: string;
    benefitType: BenefitType;
    valueApplied: number;
    description: string;
  }[];
  itemDiscounts: { skuId: string; discountAmount: number }[];
  orderDiscountAmount: number;
  freeShippingQualified: boolean;
  shippingThresholdGap: number;
}

@Injectable()
export class PromotionService {
  private readonly logger = new Logger(PromotionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createPromotion(dto: PromotionDto) {
    if (dto.code) {
      const existing = await this.prisma.promotion.findUnique({ where: { code: dto.code } });
      if (existing) {
        throw new BadRequestException('Promotion code already exists');
      }
    }
    return this.prisma.promotion.create({
      data: {
        campaignName: dto.campaignName,
        code: dto.code,
        benefitType: dto.benefitType,
        discountType: dto.discountType,
        discountValue: dto.discountValue,
        minBasketValue: dto.minBasketValue,
        isStackable: dto.isStackable ?? false,
        isActive: dto.isActive ?? true,
        validFrom: dto.validFrom,
        validUntil: dto.validUntil,
      },
    });
  }

  async getActivePromotions(codesToApply: string[] = []): Promise<Promotion[]> {
    const now = new Date();
    
    const baseWhere = {
      isActive: true,
      validFrom: { lte: now },
      OR: [
        { validUntil: null },
        { validUntil: { gt: now } }
      ]
    };

    // Get auto promos (no code)
    const autoPromos = await this.prisma.promotion.findMany({
      where: {
        ...baseWhere,
        code: null,
      },
    });

    const promos = [...autoPromos];

    // Evaluate requested codes
    if (codesToApply.length > 0) {
      const codedPromos = await this.prisma.promotion.findMany({
        where: {
          ...baseWhere,
          code: { in: codesToApply }
        }
      });
      // A full implementation would check for code validity here and return typed reasons 
      // if invalid/expired/not eligible. For MVP we just add valid ones.
      promos.push(...codedPromos);
    }

    return promos;
  }

  evaluatePromotions(
    promotions: Promotion[],
    context: PromotionEvaluationContext
  ): PromotionEvaluationResult {
    let currentSubtotal = context.subtotal;
    let orderDiscountAmount = 0;
    let freeShippingQualified = false;
    let shippingThresholdGap = 0;
    const itemDiscounts: { skuId: string; discountAmount: number }[] = [];
    const appliedPromotions: any[] = [];

    // Separate promotions by type
    const itemPromos = promotions.filter(p => p.benefitType === 'item_discount');
    const orderPromos = promotions.filter(p => p.benefitType === 'order_discount');
    const shippingPromos = promotions.filter(p => p.benefitType === 'free_shipping');

    // 1. Evaluate Item Discounts (MVP: applies to all items for simplicity, or specific if we add logic)
    // Here we just apply the best item discount.
    for (const promo of itemPromos) {
      // Simplification for MVP: apply to order as a whole if it's item_discount without SKU constraints
      // In real scenario, we'd check eligible SKUs.
    }

    // 2. Evaluate Order Discounts
    // Pick the best non-stackable or combine stackables. For MVP, just apply the single best order discount.
    let bestOrderPromo = null;
    let maxOrderDiscount = 0;

    for (const promo of orderPromos) {
      if (promo.minBasketValue && new Prisma.Decimal(currentSubtotal).lessThan(promo.minBasketValue)) {
        continue; // Does not meet minimum
      }

      let discount = 0;
      const value = promo.discountValue ? Number(promo.discountValue) : 0;
      if (promo.discountType === 'percentage') {
        discount = Math.round(currentSubtotal * (value / 100.0) * 100) / 100;
      } else if (promo.discountType === 'fixed_amount') {
        discount = value;
      }

      if (discount > maxOrderDiscount) {
        maxOrderDiscount = discount;
        bestOrderPromo = promo;
      }
    }

    if (bestOrderPromo) {
      orderDiscountAmount = maxOrderDiscount;
      currentSubtotal -= maxOrderDiscount;
      appliedPromotions.push({
        promotionId: bestOrderPromo.id,
        campaignName: bestOrderPromo.campaignName,
        benefitType: 'order_discount',
        valueApplied: maxOrderDiscount,
        description: bestOrderPromo.code ? 'COUPON' : 'AUTO_PROMO',
      });
    }

    // 3. Evaluate Free Shipping
    // Find the free shipping promo with the lowest threshold that we meet, or track the gap.
    let bestShippingPromo = null;
    let minGap = Infinity;

    for (const promo of shippingPromos) {
      const minVal = promo.minBasketValue ? Number(promo.minBasketValue) : 0;
      if (currentSubtotal >= minVal) {
        freeShippingQualified = true;
        shippingThresholdGap = 0;
        bestShippingPromo = promo;
        break; // We qualified
      } else {
        const gap = minVal - currentSubtotal;
        if (gap < minGap) {
          minGap = gap;
        }
      }
    }

    if (!freeShippingQualified && shippingPromos.length > 0) {
      shippingThresholdGap = minGap;
    }

    if (bestShippingPromo) {
      appliedPromotions.push({
        promotionId: bestShippingPromo.id,
        campaignName: bestShippingPromo.campaignName,
        benefitType: 'free_shipping',
        valueApplied: 0, // Fee will be zeroed out in caller
        description: 'FREE_SHIPPING_THRESHOLD',
      });
    }

    return {
      appliedPromotions,
      itemDiscounts,
      orderDiscountAmount,
      freeShippingQualified,
      shippingThresholdGap
    };
  }
}

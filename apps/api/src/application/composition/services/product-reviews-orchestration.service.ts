import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import {
  ExistingCustomerReview,
  ProductReviewPage,
  ProductReviewService,
  ProductReviewSummary,
  PublicProductReview,
} from '../../../modules/commerce/public';
import { PurchaseEligibilityReason, PurchaseVerificationService } from '../../../modules/ordering/public';
import { isAuthorizedDevReviewer, isDevTestReviewFlagEnabled } from '../../../platform/auth/dev-test-reviews';
import { CreateProductReviewDto } from '../dto/create-product-review.dto';
import { ProductReviewsQueryDto } from '../dto/product-reviews.dto';
import { ProductViewService } from './product-view.service';

export interface AuthenticatedReviewActor {
  id: string;
  name: string;
  email?: string | null;
  roles: readonly Role[];
  isActive?: boolean;
}

export type ReviewEligibilityReason =
  | 'GUEST'
  | 'ELIGIBLE_PURCHASE'
  | 'ELIGIBLE_DEV_TEST'
  | 'ALREADY_REVIEWED'
  | 'NO_PURCHASE'
  | 'NOT_YET_DELIVERED'
  | 'CANCELLED_OR_REFUNDED'
  | 'ACCOUNT_INACTIVE';

export interface ReviewEligibilityResponse {
  authenticated: boolean;
  canReview: boolean;
  reason: ReviewEligibilityReason;
  isTestMode: boolean;
  existingReview: ExistingCustomerReview | null;
}

export interface CreateProductReviewResponse {
  review: PublicProductReview;
  summary: ProductReviewSummary;
}

function purchaseBlockedMessage(reason: PurchaseEligibilityReason): string {
  switch (reason) {
    case 'NOT_YET_DELIVERED':
      return 'Reviews become available after your order for this product has been delivered.';
    case 'CANCELLED_OR_REFUNDED':
      return 'Cancelled, returned, or refunded orders do not qualify for product reviews.';
    case 'NO_PURCHASE':
    default:
      return 'Only customers with a delivered purchase of this product can submit a review.';
  }
}

@Injectable()
export class ProductReviewsOrchestrationService {
  constructor(
    private readonly productViewService: ProductViewService,
    private readonly productReviewService: ProductReviewService,
    private readonly purchaseVerificationService: PurchaseVerificationService,
  ) {}

  async listProductReviews(
    slugOrId: string,
    query: ProductReviewsQueryDto,
    actor?: AuthenticatedReviewActor | null,
  ): Promise<ProductReviewPage> {
    const product = await this.productViewService.getProductView(slugOrId);
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    // Isolated development test reviews are visible only to an active authorized developer
    // when ENABLE_DEV_TEST_REVIEWS=true in local development/test environments.
    const includeTestReviews = isDevTestReviewFlagEnabled() && isAuthorizedDevReviewer(actor);
    return this.productReviewService.listPublished(product.id, {
      ...query,
      includeTestReviews,
    });
  }

  async getEligibility(
    slugOrId: string,
    actor?: AuthenticatedReviewActor | null,
  ): Promise<ReviewEligibilityResponse> {
    const product = await this.productViewService.getProductView(slugOrId);
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    if (!actor?.id) {
      return {
        authenticated: false,
        canReview: false,
        reason: 'GUEST',
        isTestMode: false,
        existingReview: null,
      };
    }

    if (actor.isActive === false) {
      return {
        authenticated: true,
        canReview: false,
        reason: 'ACCOUNT_INACTIVE',
        isTestMode: false,
        existingReview: null,
      };
    }

    const existingReview = await this.productReviewService.findByCustomerAndProduct(actor.id, product.id);
    if (existingReview) {
      return {
        authenticated: true,
        canReview: false,
        reason: 'ALREADY_REVIEWED',
        isTestMode: false,
        existingReview,
      };
    }

    const purchase = await this.purchaseVerificationService.checkProductPurchaseEligibility(
      actor.id,
      product.id,
      product.skus.map((sku) => sku.id),
    );
    if (purchase.eligible) {
      return {
        authenticated: true,
        canReview: true,
        reason: 'ELIGIBLE_PURCHASE',
        isTestMode: false,
        existingReview: null,
      };
    }

    if (isDevTestReviewFlagEnabled() && isAuthorizedDevReviewer(actor)) {
      return {
        authenticated: true,
        canReview: true,
        reason: 'ELIGIBLE_DEV_TEST',
        isTestMode: true,
        existingReview: null,
      };
    }

    return {
      authenticated: true,
      canReview: false,
      reason: purchase.reason === 'DELIVERED_ELIGIBLE' ? 'ELIGIBLE_PURCHASE' : purchase.reason,
      isTestMode: false,
      existingReview: null,
    };
  }

  async submitReview(
    slugOrId: string,
    actor: AuthenticatedReviewActor,
    dto: CreateProductReviewDto,
  ): Promise<CreateProductReviewResponse> {
    if (!actor?.id || actor.isActive === false) {
      throw new ForbiddenException({
        code: 'ACCOUNT_INACTIVE',
        message: 'Active account required to submit a product review.',
      });
    }

    const product = await this.productViewService.getProductView(slugOrId);
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const skuIds = product.skus.map((sku) => sku.id);
    if (dto.skuId && !skuIds.includes(dto.skuId)) {
      throw new BadRequestException({
        code: 'INVALID_REVIEW_SKU',
        message: 'Selected product variant does not belong to this product.',
      });
    }

    const existing = await this.productReviewService.findByCustomerAndProduct(actor.id, product.id);
    if (existing) {
      throw new ConflictException({
        code: 'REVIEW_ALREADY_EXISTS',
        message: 'You have already reviewed this product.',
      });
    }

    const purchase = await this.purchaseVerificationService.checkProductPurchaseEligibility(
      actor.id,
      product.id,
      skuIds,
    );

    let review: PublicProductReview;
    if (purchase.eligible && purchase.orderId) {
      review = await this.productReviewService.createCustomerReview({
        productId: product.id,
        customerId: actor.id,
        skuId: dto.skuId ?? null,
        orderId: purchase.orderId,
        rating: dto.rating,
        title: dto.title ?? null,
        body: dto.body ?? null,
        authorName: actor.name,
        skinType: dto.skinType ?? null,
        isVerifiedPurchase: true,
        isTest: false,
      });
    } else if (isDevTestReviewFlagEnabled() && isAuthorizedDevReviewer(actor)) {
      review = await this.productReviewService.createCustomerReview({
        productId: product.id,
        customerId: actor.id,
        skuId: dto.skuId ?? null,
        orderId: null,
        rating: dto.rating,
        title: dto.title ?? null,
        body: dto.body ?? null,
        authorName: actor.name,
        skinType: dto.skinType ?? null,
        isVerifiedPurchase: false,
        isTest: true,
      });
    } else {
      throw new ForbiddenException({
        code: purchase.reason,
        message: purchaseBlockedMessage(purchase.reason),
      });
    }

    const summary = await this.productReviewService.getSummary(product.id);
    return { review, summary };
  }
}

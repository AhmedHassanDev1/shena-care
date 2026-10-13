import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class ProductDetailQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Select an eligible SKU belonging to this product. Defaults to the first eligible SKU.' })
  @IsOptional() @IsUUID()
  skuId?: string;
}

export class PublicIdentityDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() slug: string;
}

export class PublicPriceDto {
  @ApiProperty() amount: number;
  @ApiProperty() currency: string;
  @ApiProperty({ type: Number, nullable: true }) compareAtAmount: number | null;
}

export class PublicAvailabilityDto {
  @ApiProperty() isAvailable: boolean;
  @ApiProperty() isFresh: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) confirmedAt: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) observedAt: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) validUntil: string | null;
}

export class PublicProductMediaDto {
  @ApiProperty() id: string;
  @ApiProperty() skuId: string;
  @ApiProperty() type: string;
  @ApiProperty() url: string;
  @ApiProperty({ type: String, nullable: true }) altText: string | null;
  @ApiProperty() sortOrder: number;
  @ApiProperty() isPrimary: boolean;
  @ApiProperty() originType: string;
}

export class PublicFactDto {
  @ApiProperty() skuId: string;
  @ApiProperty() field: string;
  @ApiProperty({ oneOf: [{ type: 'string' }, { type: 'number' }] }) value: string | number;
  @ApiProperty() sourceUrl: string;
  @ApiProperty() sourceType: string;
  @ApiProperty({ format: 'date-time' }) verifiedAt: string;
}

export class PublicContentDto {
  @ApiProperty({ enum: ['ar'] }) language: string;
  @ApiProperty({ type: String, nullable: true }) name: string | null;
  @ApiProperty({ type: String, nullable: true }) description: string | null;
  @ApiProperty({ type: String, nullable: true }) ingredients: string | null;
  @ApiProperty({ type: String, nullable: true }) usage: string | null;
  @ApiProperty({ type: String, nullable: true }) warnings: string | null;
  @ApiProperty({ type: [PublicFactDto] }) verifiedFacts: PublicFactDto[];
}

export class PublicVariantDto {
  @ApiProperty() id: string;
  @ApiProperty() code: string;
  @ApiProperty({ type: String, nullable: true }) barcode: string | null;
  @ApiProperty() variantName: string;
  @ApiProperty({ type: Number, nullable: true }) size: number | null;
  @ApiProperty({ type: String, nullable: true }) sizeUnit: string | null;
  @ApiProperty({ type: PublicPriceDto, nullable: true }) price: PublicPriceDto | null;
  @ApiProperty() isAvailable: boolean;
  @ApiProperty() canOrder: boolean;
  @ApiProperty({ type: PublicAvailabilityDto }) availability: PublicAvailabilityDto;
  @ApiProperty({ type: [PublicProductMediaDto] }) media: PublicProductMediaDto[];
  @ApiProperty({ type: [PublicFactDto] }) verifiedFacts: PublicFactDto[];
  @ApiProperty({ type: PublicContentDto, nullable: true }) content: PublicContentDto | null;
  @ApiProperty({ type: 'object', nullable: true, description: 'Automatic order promotion preview for one unit. SellingPrice remains authoritative; checkout confirms final eligibility.', properties: {
    context: { type: 'string', enum: ['single_item_order_preview'] }, quantity: { type: 'number', enum: [1] }, currency: { type: 'string' },
    appliedPromotions: { type: 'array', items: { type: 'object' } }, orderDiscountAmount: { type: 'number' },
    subtotalAfterDiscount: { type: 'number' }, requiresCheckoutConfirmation: { type: 'boolean', enum: [true] },
  } }) promotions: Record<string, unknown> | null;
}

export class ProductDetailResponseDto extends PublicIdentityDto {
  @ApiProperty({ type: String, nullable: true }) description: string | null;
  @ApiProperty({ type: String, nullable: true }) usage: string | null;
  @ApiProperty({ type: String, nullable: true }) warnings: string | null;
  @ApiProperty({ type: PublicIdentityDto }) brand: PublicIdentityDto;
  @ApiProperty({ type: PublicIdentityDto, nullable: true }) productLine: PublicIdentityDto | null;
  @ApiProperty({ type: 'object', nullable: true, properties: {
    id: { type: 'string' }, name: { type: 'string' }, slug: { type: 'string' }, parentId: { type: 'string', nullable: true },
  } }) category: Record<string, unknown> | null;
  @ApiProperty({ type: [PublicVariantDto] }) skus: PublicVariantDto[];
  @ApiProperty({ type: [PublicProductMediaDto] }) media: PublicProductMediaDto[];
  @ApiProperty({ type: [PublicFactDto] }) verifiedFacts: PublicFactDto[];
  @ApiProperty({ type: PublicVariantDto }) selectedVariant: PublicVariantDto;
  @ApiProperty({ type: String, format: 'uuid' }) selectedSkuId: string;
  @ApiProperty({ type: 'object', properties: { identity: { type: 'string', enum: ['reviewed', 'unavailable'] }, content: { type: 'string', enum: ['reviewed', 'unavailable'] } } })
  factVerification: Record<string, string>;
  @ApiProperty({ type: 'array', items: { type: 'object' } }) routinePlacements: Record<string, unknown>[];
  @ApiProperty({ format: 'date-time' }) evaluatedAt: string;
}

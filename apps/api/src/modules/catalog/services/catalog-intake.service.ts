import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../../platform/database/prisma.service';

export interface ManualIntakeInput {
  brandId: string;
  categoryId?: string;
  productLineId?: string;
  name: string;
  variantName: string;
  skuCode: string;
  size: number;
  sizeUnit: string;
  packCount?: number;
  barcode?: string;
  hasOuterCarton?: boolean;
  /** Add this size/variant under an existing product instead of creating one. */
  productId?: string;
}

/** Identity states that let a SKU's images and facts stand for the physical product. A barcode is one way, not the only one. */
export const VERIFIED_IDENTITY_STATES: ReadonlySet<string> = new Set(['EVIDENCE_VERIFIED', 'BARCODE_VERIFIED', 'ADMIN_VERIFIED']);

export interface IdentityVerificationInput {
  status: 'EVIDENCE_VERIFIED' | 'BARCODE_VERIFIED' | 'ADMIN_VERIFIED';
  /** Pages that state this product's brand, name and size. */
  sourceUrls?: string[];
  /** Import identity fingerprints that resolved to this SKU: later rows with the same fingerprint link to it without a person. */
  fingerprints?: string[];
  rule: string;
  actorId?: string | null;
}

const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const slugify = (value: string) => normalize(value).replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || 'product';

/**
 * Canonical product intake and the reviewer's product workspace, independent of supplier files. New identities start unpublished. An existing identity is refused rather than
 * merged or overwritten: size, variant and pack each make a different SKU, and only a person decides that two records are the same product.
 */
@Injectable()
export class CatalogIntakeService {
  constructor(private readonly prisma: PrismaService) {}

  async intake(input: ManualIntakeInput) {
    const brand = await this.prisma.brand.findUnique({ where: { id: input.brandId } });
    if (!brand) throw new NotFoundException('Brand not found');
    if (input.categoryId && !(await this.prisma.category.findUnique({ where: { id: input.categoryId }, select: { id: true } }))) throw new NotFoundException('Category not found');
    if (input.productLineId) {
      const line = await this.prisma.productLine.findUnique({ where: { id: input.productLineId } });
      if (!line || line.brandId !== input.brandId) throw new BadRequestException('Product line does not belong to this brand');
    }
    const unit = input.sizeUnit.trim().toLowerCase();
    const variantName = input.variantName.trim();
    const name = input.name.trim();

    try {
      return await this.prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`catalog-intake:${input.brandId}:${normalize(name)}`}))`;
        if (input.barcode) {
          const byBarcode = await tx.sku.findFirst({ where: { barcode: input.barcode }, select: { id: true, productId: true } });
          const byAlias = byBarcode ?? await tx.skuBarcodeAlias.findFirst({ where: { barcode: input.barcode, status: 'approved' }, select: { skuId: true } });
          if (byAlias) throw new ConflictException({ code: 'DUPLICATE_SKU', message: 'This barcode already belongs to a SKU', existingSkuId: 'id' in byAlias ? byAlias.id : byAlias.skuId });
        }
        const siblings = input.productId
          ? await tx.product.findMany({ where: { id: input.productId }, include: { skus: true } })
          : (await tx.product.findMany({ where: { brandId: input.brandId }, include: { skus: true } })).filter(product => normalize(product.name) === normalize(name));
        if (input.productId && !siblings.length) throw new NotFoundException('Product not found');
        if (input.productId && siblings[0].brandId !== input.brandId) throw new BadRequestException('Product belongs to another brand');
        for (const product of siblings) {
          const same = product.skus.find(sku => sku.size?.toNumber() === input.size && sku.sizeUnit?.toLowerCase() === unit && normalize(sku.variantName) === normalize(variantName) && (sku.packCount ?? 1) === (input.packCount ?? 1));
          if (same) throw new ConflictException({ code: 'DUPLICATE_SKU', message: 'This brand, product, size, variant and pack already exist', existingSkuId: same.id });
        }
        // Same product under this brand: a new size or variant, not a new product, unless a person chose otherwise.
        const parent = siblings[0] ?? null;
        const product = parent ?? await tx.product.create({ data: {
          brandId: input.brandId, categoryId: input.categoryId ?? null, productLineId: input.productLineId ?? null, name, isPublished: false,
          slug: `${slugify(`${brand.slug}-${name}`)}-${Date.now().toString(36)}`,
        } });
        const sku = await tx.sku.create({ data: {
          productId: product.id, code: input.skuCode.trim(), variantName, size: new Prisma.Decimal(input.size), sizeUnit: unit, packCount: input.packCount ?? null,
          barcode: input.barcode ?? null, hasOuterCarton: input.hasOuterCarton ?? null, barcodeStatus: input.barcode ? 'ADMIN_ASSERTED' : 'UNKNOWN',
        } });
        return { productId: product.id, skuId: sku.id, createdProduct: !parent };
      }, { timeout: 30000 });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({ code: 'DUPLICATE_SKU', message: 'This SKU code or barcode already exists' });
      }
      throw error;
    }
  }

  async search(query: string | undefined, take: number) {
    const q = query?.trim();
    const skus = await this.prisma.sku.findMany({
      where: q ? { OR: [{ code: { contains: q, mode: 'insensitive' } }, { barcode: q }, { product: { name: { contains: q, mode: 'insensitive' } } }, { product: { brand: { name: { contains: q, mode: 'insensitive' } } } }] } : {},
      orderBy: { updatedAt: 'desc' }, take,
      include: { product: { select: { id: true, name: true, isPublished: true, brand: { select: { name: true } } } } },
    });
    return skus.map(sku => ({ skuId: sku.id, productId: sku.product.id, productName: sku.product.name, brandName: sku.product.brand.name, code: sku.code, variantName: sku.variantName,
      size: sku.size?.toNumber() ?? null, sizeUnit: sku.sizeUnit, barcode: sku.barcode, isPublished: sku.product.isPublished }));
  }

  /** Includes unpublished products: this is the reviewer's view, not the storefront's. */
  async getSkuDetail(skuId: string) {
    const sku = await this.prisma.sku.findUnique({ where: { id: skuId }, include: { product: { include: {
      brand: { select: { id: true, name: true, websiteUrl: true } }, category: { select: { id: true, name: true } },
      productIngredients: { where: { OR: [{ skuId }, { skuId: null }] }, orderBy: { sortOrder: 'asc' }, include: { ingredient: { select: { id: true, name: true, inciName: true, family: true, primaryFunction: true, functions: true, isActiveIngredient: true } } } },
      productLine: { select: { id: true, name: true } },
      safetyWarnings: { where: { isActive: true, OR: [{ skuId }, { skuId: null }] } }, usageRules: { where: { OR: [{ skuId }, { skuId: null }] } },
    } } } });
    if (!sku) throw new NotFoundException('Canonical SKU not found');
    return sku;
  }

  /**
   * Records how this SKU's identity is known, merging evidence with what is already recorded. Never downgrades: an Admin verification is not replaced by an automatic
   * one. The barcode status is a separate fact and is not touched here.
   */
  async recordIdentityVerification(skuId: string, input: IdentityVerificationInput) {
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sku-identity:${skuId}`}))`;
      const sku = await tx.sku.findUnique({ where: { id: skuId }, select: { identityStatus: true, identityEvidence: true } });
      if (!sku) throw new NotFoundException('Canonical SKU not found');
      const prior = (sku.identityEvidence as { sourceUrls?: string[]; fingerprints?: string[]; history?: unknown[] } | null) ?? {};
      const status = sku.identityStatus === 'ADMIN_VERIFIED' ? 'ADMIN_VERIFIED' : input.status;
      const evidence = {
        sourceUrls: [...new Set([...(prior.sourceUrls ?? []), ...(input.sourceUrls ?? [])])],
        fingerprints: [...new Set([...(prior.fingerprints ?? []), ...(input.fingerprints ?? [])])],
        history: [...(prior.history ?? []), { status: input.status, rule: input.rule, actorId: input.actorId ?? null, at: new Date().toISOString() }].slice(-20),
      };
      return tx.sku.update({ where: { id: skuId }, data: { identityStatus: status, identityEvidence: evidence as Prisma.InputJsonValue } });
    });
  }

  async setBarcodeStatus(skuId: string, barcodeStatus: 'UNKNOWN' | 'VERIFIED' | 'ADMIN_ASSERTED' | 'CONFLICT') {
    return this.prisma.sku.update({ where: { id: skuId }, data: { barcodeStatus } });
  }

  /** Identity facts the pipeline needs to decide an automatic link, without exposing the SKU row. */
  async identitySnapshot(skuIds: string[]) {
    const skus = await this.prisma.sku.findMany({ where: { id: { in: skuIds } }, select: { id: true, identityStatus: true, identityEvidence: true, barcode: true, barcodeStatus: true } });
    return new Map(skus.map(sku => [sku.id, { identityStatus: sku.identityStatus, barcode: sku.barcode, barcodeStatus: sku.barcodeStatus,
      identityEvidence: sku.identityEvidence as { fingerprints?: string[]; sourceUrls?: string[] } | null }]));
  }

  /** A brand's SKUs whose identity was verified, with the pages that verified them. Identity evidence only; no commercial data. */
  async verifiedSkusForBrand(brandId: string) {
    const skus = await this.prisma.sku.findMany({
      where: { isActive: true, identityStatus: { in: ['EVIDENCE_VERIFIED', 'ADMIN_VERIFIED', 'BARCODE_VERIFIED'] }, product: { brandId } },
      select: { id: true, size: true, sizeUnit: true, packCount: true, barcode: true, barcodeStatus: true, identityStatus: true, identityEvidence: true,
        product: { select: { id: true, name: true, categoryId: true } } }, take: 2000,
    });
    return skus.map(sku => ({ skuId: sku.id, productId: sku.product.id, productName: sku.product.name, categoryId: sku.product.categoryId, size: sku.size?.toNumber() ?? null,
      sizeUnit: sku.sizeUnit, packCount: sku.packCount, barcode: sku.barcode, barcodeStatus: sku.barcodeStatus, identityStatus: sku.identityStatus,
      sourceUrls: ((sku.identityEvidence as { sourceUrls?: string[] } | null)?.sourceUrls ?? []) }));
  }

  /** The deterministic product type and how the leaf category was settled. Rule output, kept apart from verified facts. */
  async setProductClassification(productId: string, input: { productType: string | null; productSubtype: string | null; classification: Record<string, unknown> }) {
    return this.prisma.product.update({ where: { id: productId }, data: { productType: input.productType, productSubtype: input.productSubtype,
      classification: input.classification as Prisma.InputJsonValue } });
  }

  /** Replaces one SKU's routine profile with a freshly computed one. The profile is derived data: recomputing it is always safe. */
  async saveRoutineProfile(skuId: string, data: Omit<Prisma.SkuRoutineProfileUncheckedCreateInput, 'id' | 'skuId' | 'computedAt'>) {
    return this.prisma.skuRoutineProfile.upsert({ where: { skuId }, create: { ...data, skuId, computedAt: new Date() }, update: { ...data, computedAt: new Date() } });
  }

  async getRoutineProfile(skuId: string) {
    return this.prisma.skuRoutineProfile.findUnique({ where: { skuId } });
  }

  /** Routine profiles for many SKUs at once, for the Routine Builder, the Recommendation Engine and Ask Shina. */
  async routineProfiles(skuIds: string[]) {
    return this.prisma.skuRoutineProfile.findMany({ where: { skuId: { in: skuIds.slice(0, 200) } } });
  }

  /** Whether a SKU's product is live; public consumers only ever see live products. */
  async isPublishedSku(skuId: string): Promise<boolean> {
    const sku = await this.prisma.sku.findUnique({ where: { id: skuId }, select: { isActive: true, product: { select: { isPublished: true } } } });
    return Boolean(sku?.isActive && sku.product.isPublished);
  }

  /** What a brand's verified catalog SKUs actually cover: the evidence for the portfolio part of a brand profile. */
  async brandPortfolio(brandId: string) {
    const brand = await this.prisma.brand.findUnique({ where: { id: brandId }, select: { id: true, name: true, slug: true, description: true, websiteUrl: true, countryOfOrigin: true,
      logoUrl: true, logoMetadata: true, profile: true, profileUpdatedAt: true, productLines: { select: { id: true, name: true } } } });
    if (!brand) throw new NotFoundException('Brand not found');
    const products = await this.prisma.product.findMany({ where: { brandId }, select: { id: true, name: true, productType: true, productSubtype: true, concerns: true,
      productLine: { select: { name: true } }, category: { select: { id: true, name: true, parent: { select: { id: true, name: true } } } },
      skus: { where: { isActive: true }, select: { id: true, identityStatus: true, identityEvidence: true } } } });
    return { brand, products };
  }

  /** Fills canonical Brand fields that are still empty; a recorded value is never replaced here. */
  async fillBrandIdentityIfEmpty(brandId: string, values: { websiteUrl?: string; description?: string; countryOfOrigin?: string }) {
    const brand = await this.prisma.brand.findUnique({ where: { id: brandId }, select: { websiteUrl: true, description: true, countryOfOrigin: true } });
    if (!brand) throw new NotFoundException('Brand not found');
    const data = {
      ...(values.websiteUrl && !brand.websiteUrl && { websiteUrl: values.websiteUrl }),
      ...(values.description && !brand.description && { description: values.description.slice(0, 1000) }),
      ...(values.countryOfOrigin && !brand.countryOfOrigin && { countryOfOrigin: values.countryOfOrigin }),
    };
    if (Object.keys(data).length) await this.prisma.brand.update({ where: { id: brandId }, data });
    return Object.keys(data);
  }

  /**
   * Puts a product in the brand's named line (range), creating the line under that brand when it does not exist yet. The name is the brand's own wording, kept as
   * stated; description and image stay empty until a source states them. A product already in a different line is refused, never moved.
   */
  async assignProductLine(productId: string, lineName: string, evidence: Record<string, unknown>): Promise<{ lineId: string; created: boolean }> {
    const name = lineName.normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (name.length < 2 || name.length > 80) throw new BadRequestException('A product line name is 2 to 80 characters');
    return this.prisma.$transaction(async tx => {
      const product = await tx.product.findUnique({ where: { id: productId }, include: { productLine: true, brand: { select: { name: true } } } });
      if (!product) throw new NotFoundException('Product not found');
      if (product.productLine) {
        if (normalize(product.productLine.name) === normalize(name)) return { lineId: product.productLine.id, created: false };
        throw new ConflictException({ code: 'CATALOG_VALUE_EXISTS', message: `This product is already in the ${product.productLine.name} line`, current: product.productLine.name });
      }
      // One line per brand and name, also when two products of the same range are researched at once.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`product-line:${product.brandId}`}))`;
      const lines = await tx.productLine.findMany({ where: { brandId: product.brandId }, select: { id: true, name: true } });
      let line = lines.find(item => normalize(item.name) === normalize(name));
      let created = false;
      if (!line) {
        const base = slugify(`${product.brand.name} ${name}`);
        // Non-Latin names fold to the brand part only, so a taken slug gets a stable suffix from the brand and the line's own name.
        const slug = (await tx.productLine.findUnique({ where: { slug: base }, select: { id: true } }))
          ? `${base}-${createHash('sha256').update(`${product.brandId}:${normalize(name)}`).digest('hex').slice(0, 10)}` : base;
        line = await tx.productLine.create({ data: { brandId: product.brandId, name, slug, isActive: true }, select: { id: true, name: true } });
        created = true;
      }
      const claims = { ...((product.claimsEvidence as Record<string, unknown> | null) ?? {}), productLine: { value: name, ...evidence, appliedAt: new Date().toISOString() } };
      await tx.product.update({ where: { id: productId }, data: { productLineId: line.id, claimsEvidence: claims as Prisma.InputJsonValue } });
      return { lineId: line.id, created };
    });
  }

  async saveBrandProfile(brandId: string, profile: Record<string, unknown>) {
    return this.prisma.brand.update({ where: { id: brandId }, data: { profile: profile as Prisma.InputJsonValue, profileUpdatedAt: new Date() } });
  }

  /**
   * Replaces a product's usage text only while it still equals what the caller read (compare-and-set): invalidating text an older rule applied never wipes a
   * value someone has since corrected. null clears it.
   */
  async replaceUsageIf(productId: string, expected: string, next: string | null): Promise<boolean> {
    const written = await this.prisma.product.updateMany({ where: { id: productId, usage: expected }, data: { usage: next } });
    return written.count === 1;
  }

  /** Every SKU whose identity is verified, for rebuilding derived profiles. */
  async verifiedSkuIds(limit = 2000): Promise<string[]> {
    const skus = await this.prisma.sku.findMany({ where: { isActive: true, identityStatus: { in: ['EVIDENCE_VERIFIED', 'ADMIN_VERIFIED', 'BARCODE_VERIFIED'] } }, select: { id: true }, take: limit, orderBy: { createdAt: 'asc' } });
    return skus.map(sku => sku.id);
  }

  async setOuterCarton(skuId: string, hasOuterCarton: boolean) {
    const sku = await this.prisma.sku.findUnique({ where: { id: skuId }, select: { id: true } });
    if (!sku) throw new NotFoundException('Canonical SKU not found');
    return this.prisma.sku.update({ where: { id: skuId }, data: { hasOuterCarton } });
  }

  /** The one-time editorial sign-off that puts a checked product live. */
  async publishReviewed(productId: string, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.product.updateMany({ where: { id: productId, archivedAt: null }, data: { isPublished: true, lastReviewedAt: new Date(), lastReviewedBy: actorId } });
      if (!updated.count) throw new ConflictException('Archived product must be restored before publication');
      return tx.product.findUniqueOrThrow({ where: { id: productId } });
    });
  }

  async unpublish(productId: string) {
    return this.prisma.product.update({ where: { id: productId }, data: { isPublished: false } });
  }
}

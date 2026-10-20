import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { BrandService, BrandSummary } from '../../catalog/public';
import { slugify } from '../../catalog/utils/slug.util';
import {
  BrandResolutionStatus,
  LineResolutionStatus,
  BrandResolutionResult,
  ProductLineResolutionResult,
  OfficialLogoInput,
  OfficialLogoMetadata,
  EnrichBrandDraftDto,
} from '../contracts/brand-enrichment.contract';
import { Prisma } from '@prisma/client';

// Curated brand alias dictionary (AR & EN mapping to canonical keys)
const BRAND_ALIASES: Record<string, { canonicalName: string; slug: string }> = {
  'سيرافي': { canonicalName: 'CeraVe', slug: 'cerave' },
  'cerave': { canonicalName: 'CeraVe', slug: 'cerave' },
  'cera-ve': { canonicalName: 'CeraVe', slug: 'cerave' },
  'بيوديرما': { canonicalName: 'Bioderma', slug: 'bioderma' },
  'bioderma': { canonicalName: 'Bioderma', slug: 'bioderma' },
  'لاروش بوزيه': { canonicalName: 'La Roche-Posay', slug: 'la-roche-posay' },
  'لاروش-بوزيه': { canonicalName: 'La Roche-Posay', slug: 'la-roche-posay' },
  'la roche posay': { canonicalName: 'La Roche-Posay', slug: 'la-roche-posay' },
  'la-roche-posay': { canonicalName: 'La Roche-Posay', slug: 'la-roche-posay' },
  'يوسيرين': { canonicalName: 'Eucerin', slug: 'eucerin' },
  'eucerin': { canonicalName: 'Eucerin', slug: 'eucerin' },
  'اورجيناري': { canonicalName: 'The Ordinary', slug: 'the-ordinary' },
  'the ordinary': { canonicalName: 'The Ordinary', slug: 'the-ordinary' },
  'the-ordinary': { canonicalName: 'The Ordinary', slug: 'the-ordinary' },
  'ordinary': { canonicalName: 'The Ordinary', slug: 'the-ordinary' },
  'فيشي': { canonicalName: 'Vichy', slug: 'vichy' },
  'vichy': { canonicalName: 'Vichy', slug: 'vichy' },
  'سيتافيل': { canonicalName: 'Cetaphil', slug: 'cetaphil' },
  'cetaphil': { canonicalName: 'Cetaphil', slug: 'cetaphil' },
  'ستارفيل': { canonicalName: 'Starville', slug: 'starville' },
  'starville': { canonicalName: 'Starville', slug: 'starville' },
  'افين': { canonicalName: 'Avène', slug: 'avene' },
  'avene': { canonicalName: 'Avène', slug: 'avene' },
  'نيتروجينا': { canonicalName: 'Neutrogena', slug: 'neutrogena' },
  'neutrogena': { canonicalName: 'Neutrogena', slug: 'neutrogena' },
  'بانوكسيل': { canonicalName: 'PanOxyl', slug: 'panoxyl' },
  'panoxyl': { canonicalName: 'PanOxyl', slug: 'panoxyl' },
  'كوسركس': { canonicalName: 'COSRX', slug: 'cosrx' },
  'cosrx': { canonicalName: 'COSRX', slug: 'cosrx' },
  'ايزدين': { canonicalName: 'ISDIN', slug: 'isdin' },
  'isdin': { canonicalName: 'ISDIN', slug: 'isdin' },
};

// Known marketing/functional adjectives that must NEVER be auto-created as official product lines
const MARKETING_ADJECTIVES = new Set([
  'whitening',
  'moisturizing',
  'hydrating',
  'anti-aging',
  'brightening',
  'acne',
  'smoothing',
  'cleansing',
  'repairing',
  'daily',
  'gentle',
  'intensive',
  'sunscreen',
  'spf50',
  'glow',
  'matte',
  'nourishing',
  'تفتيح',
  'ترطيب',
  'ضد التجاعيد',
  'مضاد للشيخوخة',
  'تنقية',
  'اشراقة',
  'يومي',
  'لطيف',
  'اصلاح',
  'مغذي',
]);

@Injectable()
export class BrandEnrichmentService {
  private readonly logger = new Logger(BrandEnrichmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly brandService: BrandService,
  ) {}

  private isUuid(val: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
  }

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

  isInvalidBrand(brand: string): boolean {
    if (!brand || !brand.trim()) return true;
    const trimmed = brand.trim().toLowerCase();
    if (/^\d+$/.test(trimmed) || trimmed.length < 2) return true;
    const invalidKeywords = [
      'unknown',
      'general',
      'fake',
      'fakebrand',
      'scam',
      'n/a',
      'none',
      'غير معروف',
      'عام',
      'invalid',
      'prohibited',
    ];
    return invalidKeywords.some((k) => trimmed.includes(k));
  }

  isMarketingAdjective(lineName: string): boolean {
    if (!lineName || !lineName.trim()) return false;
    const norm = this.normalizeString(lineName);
    const words = norm.split('-').filter(Boolean);
    return MARKETING_ADJECTIVES.has(norm) || (words.length === 1 && MARKETING_ADJECTIVES.has(words[0]));
  }

  /**
   * Resolves a candidate brand name against canonical brands and pending brand drafts.
   * Collapses spelling variations to canonical entities.
   * Reuses existing pending drafts across multiple incoming products.
   */
  async resolveBrand(rawBrand: string): Promise<BrandResolutionResult> {
    if (this.isInvalidBrand(rawBrand)) {
      return {
        status: BrandResolutionStatus.INVALID,
        brandId: null,
        brandDraftId: null,
        canonicalName: '',
        name: rawBrand,
        slug: '',
        isNewDraft: false,
        aliases: [],
      };
    }

    const trimmed = rawBrand.trim();
    const normalizedKey = this.normalizeString(trimmed);

    // 1. Check curated alias dictionary
    let canonicalInfo = BRAND_ALIASES[normalizedKey] || BRAND_ALIASES[trimmed.toLowerCase()];
    const targetSlug = canonicalInfo?.slug || slugify(trimmed);
    const targetName = canonicalInfo?.canonicalName || trimmed;

    // 2. Check canonical catalog brands
    const canonicalBrand = await this.prisma.brand.findFirst({
      where: {
        OR: [
          { slug: targetSlug },
          { name: { equals: targetName, mode: 'insensitive' } },
          { name: { equals: trimmed, mode: 'insensitive' } },
        ],
      },
    });

    if (canonicalBrand) {
      return {
        status: BrandResolutionStatus.EXACT_MATCH,
        brandId: canonicalBrand.id,
        brandDraftId: null,
        canonicalName: canonicalBrand.name,
        name: canonicalBrand.name,
        slug: canonicalBrand.slug,
        isNewDraft: false,
        aliases: [trimmed],
      };
    }

    // 3. Check existing BrandDrafts in ingestion schema
    // Reusable entity: two products referencing the same unseen brand must reuse ONE draft!
    const existingDraft = await this.prisma.brandDraft.findFirst({
      where: {
        OR: [
          { slug: targetSlug },
          { canonicalName: { equals: targetName, mode: 'insensitive' } },
          { aliases: { has: trimmed } },
          { aliases: { has: normalizedKey } },
        ],
      },
    });

    if (existingDraft) {
      // If new variation observed, collapse into aliases with provenance
      if (!existingDraft.aliases.includes(trimmed)) {
        await this.prisma.brandDraft.update({
          where: { id: existingDraft.id },
          data: {
            aliases: { push: trimmed },
          },
        });
      }

      return {
        status: BrandResolutionStatus.PENDING_DRAFT,
        brandId: existingDraft.canonicalBrandId ?? null,
        brandDraftId: existingDraft.id,
        canonicalName: existingDraft.canonicalName,
        name: existingDraft.name,
        slug: existingDraft.slug,
        isNewDraft: false,
        aliases: [...existingDraft.aliases, trimmed],
      };
    }

    // 4. Stage a new BrandDraft entity
    const newDraft = await this.prisma.brandDraft.create({
      data: {
        name: targetName,
        canonicalName: targetName,
        slug: targetSlug,
        aliases: [trimmed, normalizedKey],
        status: 'PENDING_REVIEW',
        evidence: {
          firstObservedSource: trimmed,
          observedAt: new Date().toISOString(),
        } as unknown as Prisma.InputJsonValue,
      },
    });

    return {
      status: BrandResolutionStatus.PENDING_DRAFT,
      brandId: null,
      brandDraftId: newDraft.id,
      canonicalName: newDraft.canonicalName,
      name: newDraft.name,
      slug: newDraft.slug,
      isNewDraft: true,
      aliases: [trimmed, normalizedKey],
    };
  }

  /**
   * Resolves a ProductLine for a given Brand.
   * Asserts Brand→Line ownership and prevents auto-creating lines from marketing adjectives.
   */
  async resolveProductLine(
    brandIdentifier: { brandId?: string; brandDraftId?: string },
    lineName: string,
  ): Promise<ProductLineResolutionResult> {
    if (!lineName || !lineName.trim()) {
      throw new BadRequestException('Product line name is required');
    }

    const trimmedLine = lineName.trim();

    // 1. Marketing adjective guard
    if (this.isMarketingAdjective(trimmedLine)) {
      return {
        status: LineResolutionStatus.REJECTED_MARKETING_ADJECTIVE,
        lineId: null,
        lineDraftId: null,
        name: trimmedLine,
        slug: slugify(trimmedLine),
        reason: `Marketing adjective '${trimmedLine}' cannot be auto-created as an official product line`,
      };
    }

    // 2. Canonical Brand resolution
    if (brandIdentifier.brandId) {
      const brand = await this.prisma.brand.findUnique({
        where: { id: brandIdentifier.brandId },
      });
      if (!brand) throw new NotFoundException('Brand not found');

      const expectedSlug = slugify(`${brand.name}-${trimmedLine}`);

      // Check if line exists in canonical catalog
      const existingLine = await this.prisma.productLine.findFirst({
        where: {
          OR: [
            { slug: expectedSlug },
            { name: { equals: trimmedLine, mode: 'insensitive' } },
          ],
        },
      });

      if (existingLine) {
        // Assert Brand→Line ownership
        if (existingLine.brandId !== brand.id) {
          return {
            status: LineResolutionStatus.CROSS_BRAND_COLLISION,
            lineId: existingLine.id,
            lineDraftId: null,
            name: trimmedLine,
            slug: existingLine.slug,
            reason: `Cross-brand collision: ProductLine '${trimmedLine}' belongs to Brand '${existingLine.brandId}', not '${brand.id}'`,
          };
        }

        return {
          status: LineResolutionStatus.MATCHED,
          lineId: existingLine.id,
          lineDraftId: null,
          name: existingLine.name,
          slug: existingLine.slug,
        };
      }

      // Check product line drafts linked to this brand
      const existingDraft = await this.prisma.productLineDraft.findFirst({
        where: {
          name: { equals: trimmedLine, mode: 'insensitive' },
        },
      });

      if (existingDraft) {
        return {
          status: LineResolutionStatus.PENDING_DRAFT,
          lineId: null,
          lineDraftId: existingDraft.id,
          name: existingDraft.name,
          slug: existingDraft.slug,
        };
      }
    }

    // 3. BrandDraft resolution
    if (brandIdentifier.brandDraftId) {
      const brandDraft = await this.prisma.brandDraft.findUnique({
        where: { id: brandIdentifier.brandDraftId },
      });
      if (!brandDraft) throw new NotFoundException('Brand draft not found');

      const lineSlug = slugify(`${brandDraft.name}-${trimmedLine}`);

      const existingLineDraft = await this.prisma.productLineDraft.findFirst({
        where: {
          brandDraftId: brandDraft.id,
          OR: [{ slug: lineSlug }, { name: { equals: trimmedLine, mode: 'insensitive' } }],
        },
      });

      if (existingLineDraft) {
        return {
          status: LineResolutionStatus.PENDING_DRAFT,
          lineId: null,
          lineDraftId: existingLineDraft.id,
          name: existingLineDraft.name,
          slug: existingLineDraft.slug,
        };
      }

      // Create new line draft linked to this brand draft
      const newLineDraft = await this.prisma.productLineDraft.create({
        data: {
          brandDraftId: brandDraft.id,
          name: trimmedLine,
          slug: lineSlug,
          status: 'PENDING_REVIEW',
        },
      });

      return {
        status: LineResolutionStatus.PENDING_DRAFT,
        lineId: null,
        lineDraftId: newLineDraft.id,
        name: newLineDraft.name,
        slug: newLineDraft.slug,
      };
    }

    throw new BadRequestException('Either brandId or brandDraftId must be provided');
  }

  /**
   * Enriches BrandDraft with official research facts and verified official logo ($0 policy).
   */
  async enrichBrandDraft(draftId: string, dto: EnrichBrandDraftDto): Promise<any> {
    if (!this.isUuid(draftId)) throw new BadRequestException('Invalid draft ID');

    const draft = await this.prisma.brandDraft.findUnique({ where: { id: draftId } });
    if (!draft) throw new NotFoundException('Brand draft not found');

    let verifiedLogoMetadata: OfficialLogoMetadata | null = null;
    let logoUrl: string | null = null;

    if (dto.logoInput) {
      // Validate official logo policy ($0 external cost, authentic real packshot/logo only)
      if (!dto.logoInput.isVerifiedOfficial) {
        throw new BadRequestException('Only verified official brand logos from authorized sources are permitted');
      }
      if (!['image/svg+xml', 'image/png', 'image/webp'].includes(dto.logoInput.mediaType)) {
        throw new BadRequestException('Invalid logo media type');
      }
      if (!dto.logoInput.sourceUrl || !dto.logoInput.sourceDomain) {
        throw new BadRequestException('Logo source URL and verified domain are mandatory');
      }

      verifiedLogoMetadata = {
        sourceUrl: dto.logoInput.sourceUrl,
        sourceDomain: dto.logoInput.sourceDomain,
        mediaType: dto.logoInput.mediaType,
        licenseType: 'EDITORIAL_BRAND_LOGO',
        isVerifiedOfficial: true,
        fetchedAt: new Date().toISOString(),
      };
      logoUrl = dto.logoInput.logoUrl;
    }

    return this.prisma.brandDraft.update({
      where: { id: draftId },
      data: {
        ...(dto.websiteUrl && { websiteUrl: dto.websiteUrl }),
        ...(dto.countryOfOrigin && { countryOfOrigin: dto.countryOfOrigin }),
        ...(dto.descriptionEn && { descriptionEn: dto.descriptionEn }),
        ...(dto.descriptionAr && { descriptionAr: dto.descriptionAr }),
        ...(logoUrl && { logoUrl }),
        ...(verifiedLogoMetadata && {
          logoMetadata: verifiedLogoMetadata as unknown as Prisma.InputJsonValue,
        }),
      },
      include: {
        productLines: true,
      },
    });
  }

  /**
   * Approves a BrandDraft into the canonical catalog (catalog.brands & catalog.product_lines).
   * Enforces Admin or Hub Operator authorization.
   */
  async approveBrandDraft(
    draftId: string,
    actorId: string,
  ): Promise<{ brand: BrandSummary; admittedLinesCount: number }> {
    if (!this.isUuid(draftId)) throw new BadRequestException('Invalid draft ID');
    if (!this.isUuid(actorId)) throw new BadRequestException('Invalid actor ID');

    const reviewer = await this.prisma.customer.findUnique({ where: { id: actorId } });
    if (!reviewer?.roles.includes('ADMIN')) {
      throw new ForbiddenException('Only administrators can approve brand admissions');
    }

    const draft = await this.prisma.brandDraft.findUnique({
      where: { id: draftId },
      include: { productLines: true },
    });
    if (!draft) throw new NotFoundException('Brand draft not found');

    if (draft.status === 'APPROVED' && draft.canonicalBrandId) {
      const existing = await this.brandService.getBrand(draft.canonicalBrandId);
      if (existing) return { brand: existing, admittedLinesCount: 0 };
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Upsert into canonical catalog.brands
      const description = draft.descriptionAr || draft.descriptionEn || null;
      let brand = await tx.brand.findUnique({ where: { slug: draft.slug } });

      if (brand) {
        brand = await tx.brand.update({
          where: { id: brand.id },
          data: {
            name: draft.name,
            description: description ?? brand.description,
            logoUrl: draft.logoUrl ?? brand.logoUrl,
            websiteUrl: draft.websiteUrl ?? brand.websiteUrl,
            countryOfOrigin: draft.countryOfOrigin ?? brand.countryOfOrigin,
          },
        });
      } else {
        brand = await tx.brand.create({
          data: {
            name: draft.name,
            slug: draft.slug,
            description,
            logoUrl: draft.logoUrl,
            websiteUrl: draft.websiteUrl,
            countryOfOrigin: draft.countryOfOrigin,
            isActive: true,
          },
        });
      }

      // 2. Admit associated ProductLine drafts
      let admittedLinesCount = 0;
      for (const lineDraft of draft.productLines) {
        if (lineDraft.status === 'REJECTED') continue;

        let line = await tx.productLine.findFirst({
          where: { brandId: brand.id, slug: lineDraft.slug },
        });

        if (!line) {
          line = await tx.productLine.create({
            data: {
              brandId: brand.id,
              name: lineDraft.name,
              slug: lineDraft.slug,
              description: lineDraft.descriptionAr || lineDraft.descriptionEn,
              isActive: true,
            },
          });
          admittedLinesCount++;
        }

        await tx.productLineDraft.update({
          where: { id: lineDraft.id },
          data: {
            status: 'APPROVED',
            canonicalLineId: line.id,
          },
        });
      }

      // 3. Mark BrandDraft as APPROVED
      await tx.brandDraft.update({
        where: { id: draftId },
        data: {
          status: 'APPROVED',
          canonicalBrandId: brand.id,
          reviewedBy: actorId,
          reviewedAt: new Date(),
        },
      });

      const brandSummary: BrandSummary = {
        id: brand.id,
        name: brand.name,
        slug: brand.slug,
        description: brand.description,
        logoUrl: brand.logoUrl,
        websiteUrl: brand.websiteUrl,
        countryOfOrigin: brand.countryOfOrigin,
        isActive: brand.isActive,
        productLines: [],
      };

      return { brand: brandSummary, admittedLinesCount };
    });
  }

  /**
   * Rejects a BrandDraft with explicit reason.
   */
  async rejectBrandDraft(draftId: string, actorId: string, reason: string): Promise<any> {
    if (!this.isUuid(draftId)) throw new BadRequestException('Invalid draft ID');
    if (!this.isUuid(actorId)) throw new BadRequestException('Invalid actor ID');
    if (!reason || !reason.trim()) throw new BadRequestException('Rejection reason is required');

    const reviewer = await this.prisma.customer.findUnique({ where: { id: actorId } });
    if (!reviewer?.roles.includes('ADMIN')) {
      throw new ForbiddenException('Only administrators can reject brand drafts');
    }

    const draft = await this.prisma.brandDraft.findUnique({ where: { id: draftId } });
    if (!draft) throw new NotFoundException('Brand draft not found');

    return this.prisma.brandDraft.update({
      where: { id: draftId },
      data: {
        status: 'REJECTED',
        rejectionReason: reason,
        reviewedBy: actorId,
        reviewedAt: new Date(),
      },
    });
  }

  /**
   * Retrieves pending brand drafts for editorial review.
   */
  async getBrandDrafts(status = 'PENDING_REVIEW'): Promise<any[]> {
    return this.prisma.brandDraft.findMany({
      where: { status },
      include: { productLines: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Retrieves detail for a single brand draft.
   */
  async getBrandDraft(id: string): Promise<any> {
    if (!this.isUuid(id)) throw new BadRequestException('Invalid draft ID');
    const draft = await this.prisma.brandDraft.findUnique({
      where: { id },
      include: { productLines: true },
    });
    if (!draft) throw new NotFoundException('Brand draft not found');
    return draft;
  }
}

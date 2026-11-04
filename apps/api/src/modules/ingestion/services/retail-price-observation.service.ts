import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RetailObservationStatus, RetailPriceObservation } from '@prisma/client';
import * as crypto from 'crypto';
import { CatalogService } from '../../catalog/public';
import { PrismaService } from '../../../platform/database/prisma.service';
import { validateSafeUrl } from '../../../platform/security/url-validator';
import { RecordRetailObservationDto } from '../dto/retail-price.dto';
import { ProductResearchService } from './product-research.service';
import { RowNormalizationService } from './row-normalization.service';

const maxObservationAgeDays = () => Number(process.env.RETAIL_OBSERVATION_MAX_AGE_DAYS ?? 120);
const OUTLIER_RATIO = 2;
const OUTLIER_MIN_SAMPLE = 3;
const RESEARCH_COOLDOWN_MS = 24 * 3600 * 1000;
const RESEARCH_MAX_PAGES = 3;
const RESEARCHED_CONFIDENCE = 0.6;
const DAY_MS = 24 * 3600 * 1000;
const EGP_PRICE = /(?:(?:EGP|LE|L\.E\.?|ج\.?\s?م\.?|جنيه)\s*([\d٠-٩][\d٠-٩,.]*))|(?:([\d٠-٩][\d٠-٩,.]*)\s*(?:EGP|LE\b|L\.E\.?|ج\.?\s?م\.?|جنيه))/gi;
const toLatinDigits = (value: string) => value.replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x0660));

export interface RetailBenchmark {
  skuId: string;
  sampleSize: number;
  minEgp: number | null;
  medianEgp: number | null;
  maxEgp: number | null;
  sellers: string[];
  earliestObservedAt: string | null;
  latestObservedAt: string | null;
  statement: string;
  observations: Array<{ sourceUrl: string; sellerName: string; priceEgp: number; regularPriceEgp: number | null; inStock: boolean | null; observedAt: string }>;
}

export type RetailResearchStatus = 'NOT_CONFIGURED' | 'PROVIDER_UNAVAILABLE' | 'COOLDOWN' | 'COMPLETED';

/** Prices worth reading off a page: one, or a sale and a regular price. More than that is ambiguous and yields nothing. */
export function extractListedPrices(text: string): { price: number; regular: number | null } | null {
  const found = new Set<number>();
  for (const match of text.matchAll(EGP_PRICE)) {
    const value = Number(toLatinDigits(match[1] ?? match[2]).replace(/,/g, ''));
    if (Number.isFinite(value) && value > 0) found.add(value);
  }
  const prices = [...found].sort((a, b) => a - b);
  if (prices.length === 1) return { price: prices[0], regular: null };
  if (prices.length === 2) return { price: prices[0], regular: prices[1] };
  return null;
}

/**
 * GLO-285 read-only market evidence. Listed retail prices seen at a named seller on a named date, nothing more: this
 * service reads the catalog's SKU facts and writes only its own table. It has no path to a SupplierOffer, an acquisition
 * cost, stock or a customer SellingPrice.
 */
@Injectable()
export class RetailPriceObservationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly normalization: RowNormalizationService,
    private readonly research: ProductResearchService,
  ) {}

  async record(dto: RecordRetailObservationDto, collectedBy: string): Promise<RetailPriceObservation> {
    const sku = await this.catalog.getSkuEvidenceFacts(dto.skuId);
    if (!sku) throw new NotFoundException('Canonical SKU not found');
    validateSafeUrl(dto.sourceUrl);
    const url = new URL(dto.sourceUrl);
    if (url.protocol !== 'https:') throw new BadRequestException('A retail observation needs an https source');
    const observedAt = new Date(dto.observedAt);
    const day = dto.observedAt.slice(0, 10);
    const dedupeKey = crypto.createHash('sha256').update([dto.skuId, url.href, dto.priceEgp, day].join('|')).digest('hex');
    const existing = await this.prisma.retailPriceObservation.findUnique({ where: { dedupeKey } });
    if (existing) return existing;

    const rejectReason = await this.rejectionFor(dto, sku, observedAt, url.hostname);
    return this.prisma.retailPriceObservation.create({
      data: {
        skuId: dto.skuId, sourceUrl: url.href, sellerName: dto.sellerName, sellerDomain: url.hostname.toLowerCase(), observedAt, retrievedAt: new Date(),
        priceEgp: dto.priceEgp, regularPriceEgp: dto.regularPriceEgp ?? null, inStock: dto.inStock ?? null, packText: dto.packText,
        confidence: dto.confidence, evidenceExcerpt: dto.evidenceExcerpt ?? null, status: rejectReason ? RetailObservationStatus.REJECTED : RetailObservationStatus.ACCEPTED,
        rejectReason, collectedBy, dedupeKey,
      },
    });
  }

  /** A rejected observation is kept with its reason: it is evidence of what was seen, and never counts toward a benchmark. */
  private async rejectionFor(dto: RecordRetailObservationDto, sku: { size: number | null; sizeUnit: string | null; packCount: number | null }, observedAt: Date, host: string): Promise<string | null> {
    if (dto.currency !== 'EGP') return 'NOT_EGP';
    if (!(dto.priceEgp > 0)) return 'INVALID_PRICE';
    if (dto.regularPriceEgp !== undefined && dto.regularPriceEgp < dto.priceEgp) return 'SALE_PRICE_ABOVE_REGULAR';
    if (observedAt.getTime() > Date.now() + 5 * 60 * 1000) return 'OBSERVED_IN_FUTURE';
    if (Date.now() - observedAt.getTime() > maxObservationAgeDays() * DAY_MS) return 'EXPIRED';
    if (sku.size === null || !sku.sizeUnit) return 'SKU_SIZE_UNKNOWN';
    const stated = this.normalization.extractSizeAndPack(dto.packText);
    if (stated.size === null || !stated.unit) return 'PACK_NOT_STATED';
    if (stated.size !== sku.size || stated.unit.toLowerCase() !== sku.sizeUnit.toLowerCase()) return 'WRONG_PACK_SIZE';
    if ((stated.packCount ?? 1) !== (sku.packCount ?? 1)) return 'WRONG_PACK_COUNT';

    const accepted = await this.acceptedInWindow(dto.skuId);
    const sameDay = accepted.filter(row => row.sellerDomain === host.toLowerCase() && row.observedAt.toISOString().slice(0, 10) === dto.observedAt.slice(0, 10));
    if (sameDay.some(row => row.priceEgp.toNumber() !== dto.priceEgp)) return 'CONTRADICTS_SAME_SELLER_SAME_DAY';
    if (accepted.length >= OUTLIER_MIN_SAMPLE) {
      const median = this.median(accepted.map(row => row.priceEgp.toNumber()));
      if (dto.priceEgp > median * OUTLIER_RATIO || dto.priceEgp < median / OUTLIER_RATIO) return 'OUTLIER';
    }
    return null;
  }

  private acceptedInWindow(skuId: string) {
    return this.prisma.retailPriceObservation.findMany({
      where: { skuId, status: RetailObservationStatus.ACCEPTED, observedAt: { gte: new Date(Date.now() - maxObservationAgeDays() * DAY_MS) } },
      orderBy: [{ observedAt: 'desc' }, { id: 'asc' }],
    });
  }

  private median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  async benchmark(skuId: string): Promise<RetailBenchmark> {
    const rows = await this.acceptedInWindow(skuId);
    const prices = rows.map(row => row.priceEgp.toNumber());
    return {
      skuId,
      sampleSize: rows.length,
      minEgp: prices.length ? Math.min(...prices) : null,
      medianEgp: prices.length ? this.median(prices) : null,
      maxEgp: prices.length ? Math.max(...prices) : null,
      sellers: [...new Set(rows.map(row => row.sellerName))],
      earliestObservedAt: rows.length ? rows[rows.length - 1].observedAt.toISOString() : null,
      latestObservedAt: rows.length ? rows[0].observedAt.toISOString() : null,
      statement: 'Listed prices at the named sellers on the stated dates. Not a market price, a supplier cost or a selling price.',
      observations: rows.map(row => ({ sourceUrl: row.sourceUrl, sellerName: row.sellerName, priceEgp: row.priceEgp.toNumber(),
        regularPriceEgp: row.regularPriceEgp?.toNumber() ?? null, inStock: row.inStock, observedAt: row.observedAt.toISOString() })),
    };
  }

  /** Bounded automated collection: only hosts the owner has allowed, a few pages, once a day per SKU, and no guessing. */
  async researchSku(skuId: string, actorId: string): Promise<{ status: RetailResearchStatus; recorded: number; skipped: number; pagesRead: number }> {
    const none = { recorded: 0, skipped: 0, pagesRead: 0 };
    const sku = await this.catalog.getSkuEvidenceFacts(skuId);
    if (!sku) throw new NotFoundException('Canonical SKU not found');
    const allowedHosts = (process.env.RETAIL_RESEARCH_ALLOWED_HOSTS ?? '').split(',').map(host => host.trim().toLowerCase()).filter(Boolean);
    if (!allowedHosts.length) return { status: 'NOT_CONFIGURED', ...none };
    const recent = await this.prisma.retailPriceObservation.findFirst({ where: { skuId, collectedBy: `research:${actorId}`, retrievedAt: { gte: new Date(Date.now() - RESEARCH_COOLDOWN_MS) } }, select: { id: true } });
    if (recent) return { status: 'COOLDOWN', ...none };

    const query = `${sku.brandName} ${sku.productName} ${sku.size ?? ''}${sku.sizeUnit ?? ''} السعر مصر`;
    const pages = await this.research.discoverPages(query, RESEARCH_MAX_PAGES * 2);
    if (pages === null) return { status: 'PROVIDER_UNAVAILABLE', ...none };
    const permitted = pages.filter(page => {
      try { const host = new URL(page.url).hostname.toLowerCase(); return allowedHosts.some(allowed => host === allowed || host.endsWith(`.${allowed}`)); } catch { return false; }
    }).slice(0, RESEARCH_MAX_PAGES);

    let recorded = 0;
    let skipped = 0;
    let pagesRead = 0;
    for (const page of permitted) {
      const content = await this.research.readPage(page.url);
      if (content === null) return { status: 'PROVIDER_UNAVAILABLE', recorded, skipped, pagesRead };
      pagesRead++;
      const flat = content.replace(/\s+/g, ' ');
      const listed = extractListedPrices(flat.slice(0, 20000));
      if (!listed || sku.size === null || !sku.sizeUnit) { skipped++; continue; }
      const packText = `${page.title} ${flat.slice(0, 2000)}`;
      if (!packText.toLowerCase().includes(sku.brandName.toLowerCase())) { skipped++; continue; }
      const observation = await this.record({
        skuId, sourceUrl: page.url, sellerName: new URL(page.url).hostname, priceEgp: listed.price, regularPriceEgp: listed.regular ?? undefined,
        currency: 'EGP', observedAt: new Date().toISOString(), packText: page.title, confidence: RESEARCHED_CONFIDENCE, evidenceExcerpt: flat.slice(0, 300),
      }, `research:${actorId}`);
      if (observation.status === RetailObservationStatus.ACCEPTED) recorded++; else skipped++;
    }
    return { status: 'COMPLETED', recorded, skipped, pagesRead };
  }
}


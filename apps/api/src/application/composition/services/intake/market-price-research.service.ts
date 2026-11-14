import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { MarketPriceCheckStatus } from '@prisma/client';
import {
  CatalogIntakeService, extractProductFacts, hostIsBrandDomain, ProductResearchService, ResearchSourceFetcher, VERIFIED_IDENTITY_STATES,
} from '../../../../modules/catalog/public';
import { checkObservation, extractPageOffers, MARKET_RULE_VERSION, MarketPriceStoreService, marketReference, MarketSourceType, readMarketPriceEvidence } from '../../../../modules/intake/public';
import { getSourcingMode, OfferIntakeService } from '../../../../modules/sourcing/public';

/** Fresh enough: observations older than this are not a current market price. */
export const MARKET_MAX_AGE_DAYS = 14;
/** Sufficient coverage: this many distinct sellers make the reference without new fetches. */
const SUFFICIENT_SELLERS = 2;
const MAX_PAGES = 10;

/**
 * Egyptian online pharmacies and beauty retailers whose product pages state their own price in structured data. Overridable with MARKET_TRUSTED_RETAILERS
 * (comma-separated hosts). A retailer here is trusted to state ITS price, never to establish identity.
 */
// Evidence 2026-11-09 (output/intake-real-run-2026-11-09/retailer-probe.json): readable under robots.txt and stating a structured EGP price on product pages.
export const DEFAULT_TRUSTED_RETAILERS: string[] = ['elghazawy.com', 'cosmostoreegypt.com', 'merlacare.com', 'mainasrpharmacy.com', 'medstic.net'];

const hostsFrom = (value: string | undefined) => (value ?? '').split(',').map(host => host.trim().toLowerCase().replace(/^www\./, '')).filter(Boolean);
const bare = (host: string) => host.toLowerCase().replace(/^www\./, '');

type Tier = 'OFFICIAL' | 'TRUSTED_RETAILER' | 'DISCOVERED';

/**
 * Market Price Research for one verified canonical SKU. Advisory only: it records sourced observations and an outlier-trimmed range; it never writes a cost, a
 * selling price or a listing. "Unavailable" is a recorded answer with its reason and never blocks a draft.
 */
@Injectable()
export class MarketPriceResearchService {
  private readonly logger = new Logger(MarketPriceResearchService.name);

  constructor(
    private readonly catalog: CatalogIntakeService,
    private readonly store: MarketPriceStoreService,
    private readonly providers: ProductResearchService,
    private readonly fetcher: ResearchSourceFetcher,
    private readonly offers: OfferIntakeService,
  ) {}

  private retailers(): string[] {
    const configured = hostsFrom(process.env.MARKET_TRUSTED_RETAILERS);
    return configured.length ? configured : DEFAULT_TRUSTED_RETAILERS;
  }

  async latest(skuId: string) {
    const [check, observations, costs] = await Promise.all([this.store.latestCheck(skuId), this.store.observations(skuId, MARKET_MAX_AGE_DAYS), this.offers.purchaseCosts([skuId])]);
    const reference = this.reference(observations);
    return { check: check ? { ...check, reference, status: reference && reference.confidence !== 'UNVERIFIED' ? MarketPriceCheckStatus.REFERENCE_READY : MarketPriceCheckStatus.UNAVAILABLE,
      reasonCode: reference ? reference.confidence === 'UNVERIFIED' ? reference.priceReviewRequired ? 'PRICE_ONLY_REVIEW_REQUIRED' : 'REGULAR_PRICE_NOT_CORROBORATED' : null : 'NO_VERIFIED_REGULAR_PRICE' } : null,
      observations, pricing: this.pricingState(costs.get(skuId) ?? null) };
  }

  private reference(items: Awaited<ReturnType<MarketPriceStoreService['observations']>>) {
    return marketReference(items.map(item => ({ id: item.id, sellerDomain: item.sellerDomain, priceEgp: item.priceEgp.toNumber(), regularPriceEgp: item.regularPriceEgp?.toNumber() ?? null,
      observedAt: item.observedAt, confidence: item.confidence.toNumber(), sourceUrl: item.sourceUrl, evidenceExcerpt: item.evidenceExcerpt })), new Date(), MARKET_MAX_AGE_DAYS);
  }

  private pricingState(cost: { purchasePrice: number; consumerPrice: number | null; supplierCount: number } | null) {
    return cost ? { state: 'READY_FOR_PRICING_DECISION', purchaseCost: cost.purchasePrice, supplierConsumerPrice: cost.consumerPrice, suppliers: cost.supplierCount,
      note: 'Commerce owns the selling price: an Admin approves it; nothing is copied or published automatically' }
      : getSourcingMode() === 'OFFER_BASED' ? { state: 'WAIT_FOR_SUPPLIER_COST', purchaseCost: null, note: 'Market data is kept; offer-based pricing still needs a validated supplier purchase cost' }
        : { state: 'OWNED_BY_COMMERCE', purchaseCost: null, note: 'Market evidence is advisory. Commerce owns selling-price approval; this sourcing mode does not require a supplier offer cost' };
  }

  async research(skuId: string, actorId: string, options: { force?: boolean } = {}) {
    const sku = await this.catalog.getSkuDetail(skuId);
    if (!VERIFIED_IDENTITY_STATES.has(sku.identityStatus)) throw new ConflictException({ code: 'IDENTITY_NOT_VERIFIED', message: 'Market prices are researched only for a verified canonical SKU' });
    const check = await this.store.startCheck(skuId, actorId);
    const usageBefore = { searches: this.providers.usage.searches, pageFetches: this.fetcher.usage.pageFetches };
    const coverage: Record<string, { pages: number; accepted: number; rejected: Record<string, number> }> = {};
    const bump = (tier: string, accepted: boolean, reason: string | null) => {
      const entry = (coverage[tier] ??= { pages: 0, accepted: 0, rejected: {} });
      entry.pages++;
      if (accepted) entry.accepted++;
      else if (reason) entry.rejected[reason] = (entry.rejected[reason] ?? 0) + 1;
    };
    const finish = async (status: MarketPriceCheckStatus, reasonCode: string | null) => {
      const accepted = await this.store.observations(skuId, MARKET_MAX_AGE_DAYS);
      const reference = this.reference(accepted);
      const reliable = reference && reference.confidence !== 'UNVERIFIED';
      const finalStatus = reliable ? MarketPriceCheckStatus.REFERENCE_READY : reference ? MarketPriceCheckStatus.UNAVAILABLE : status;
      const cost = { searches: this.providers.usage.searches - usageBefore.searches, pageFetches: this.fetcher.usage.pageFetches - usageBefore.pageFetches, rule: MARKET_RULE_VERSION };
      const saved = await this.store.finishCheck(check.id, { status: finalStatus, reasonCode: reliable ? null : reference ? reference.priceReviewRequired ? 'PRICE_ONLY_REVIEW_REQUIRED' : 'REGULAR_PRICE_NOT_CORROBORATED' : reasonCode, reference, coverage, cost });
      const costs = await this.offers.purchaseCosts([skuId]);
      return { check: saved, reference, pricing: this.pricingState(costs.get(skuId) ?? null) };
    };

    try {
      // 1. Reuse recent valid evidence; no duplicate fetches.
      const existing = await this.store.observations(skuId, MARKET_MAX_AGE_DAYS);
      const sellers = new Set(existing.filter(item => readMarketPriceEvidence(item.evidenceExcerpt)?.priceType === 'REGULAR').map(item => item.sellerDomain));
      coverage.REUSED = { pages: existing.length, accepted: existing.length, rejected: {} };
      if (!options.force && sellers.size >= SUFFICIENT_SELLERS) return finish(MarketPriceCheckStatus.REFERENCE_READY, null);

      const recentlyRead = options.force ? new Set<string>() : await this.store.recentlyRead(skuId, 24);
      const expectation = { brand: sku.product.brand.name, productName: sku.product.name, size: sku.size?.toNumber() ?? null, sizeUnit: sku.sizeUnit, barcode: sku.barcode };
      const query = `${sku.product.brand.name} ${sku.product.name}${sku.size ? ` ${sku.size.toNumber()} ${sku.sizeUnit ?? ''}` : ''}`.trim();
      const brandHost = (() => { try { return sku.product.brand.websiteUrl ? bare(new URL(sku.product.brand.websiteUrl).hostname) : null; } catch { return null; } })();
      const retailers = this.retailers();
      const distributors = hostsFrom(process.env.RESEARCH_ALLOWED_HOSTS);
      const read = new Set<string>();
      let acceptedNow = 0;

      const readPage = async (url: string, tier: Tier, allowed: (host: string) => boolean) => {
        if (read.has(url) || read.size >= MAX_PAGES || recentlyRead.has(url)) return;
        read.add(url);
        let host: string;
        try { host = bare(new URL(url).hostname); } catch { return; }
        const fetched = await this.fetcher.fetch(url, { kind: 'page', isApprovedHost: h => allowed(bare(h)), bypassCache: options.force });
        if (fetched.outcome !== 'OK' || !fetched.body) { bump(tier, false, `FETCH_${fetched.outcome}`); return; }
        const html = fetched.body.toString('utf8');
        const identity = extractProductFacts(html, fetched.finalUrl, expectation);
        host = bare(new URL(fetched.finalUrl).hostname);
        const official = (brandHost !== null && (host === brandHost || host.endsWith(`.${brandHost}`))) || hostIsBrandDomain(host, expectation.brand);
        const trusted = retailers.some(r => host === r || host.endsWith(`.${r}`));
        // A marketplace host cannot vouch for its third-party sellers. No verified-seller adapter exists yet.
        const marketplace = /(^|\.)(?:jumia\.com\.eg|amazon\.eg|noon\.com)$/.test(host);
        const distributor = distributors.some(r => host === r || host.endsWith(`.${r}`));
        const sourceType: MarketSourceType = marketplace ? 'UNVERIFIED' : official ? 'OFFICIAL' : distributor ? 'AUTHORIZED_DISTRIBUTOR'
          : trusted ? host === 'mainasrpharmacy.com' || host.endsWith('.mainasrpharmacy.com') ? 'ESTABLISHED_PHARMACY' : 'TRUSTED_RETAILER' : 'UNVERIFIED';
        const offers = extractPageOffers(html);
        if (!offers.length) { bump(tier, false, 'NO_STRUCTURED_PRICE'); return; }
        const seller = (html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i)?.[1] ?? host).slice(0, 120);
        // One offer per page: the page's own product; several offers for one product (variants) are each checked, and only one may be accepted.
        let recorded = false;
        for (const offer of offers.slice(0, 4)) {
          // A page may carry related products/variant offers: validate the offered title independently too.
          const offerIdentity = extractProductFacts(`<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: offer.name })}</script>`, fetched.finalUrl, expectation);
          const verdict = checkObservation(offer, expectation, { identityMatched: identity.identityMatched && offerIdentity.identityMatched,
            sellerTrust: sourceType === 'UNVERIFIED' ? 'DISCOVERED' : sourceType === 'OFFICIAL' ? 'OFFICIAL' : 'TRUSTED_RETAILER' });
          if (!verdict.accepted && recorded) continue;
          await this.store.record({ skuId, sourceUrl: fetched.finalUrl, sellerName: seller, sellerDomain: host, priceEgp: offer.price, regularPriceEgp: offer.regularPrice, inStock: offer.inStock,
            packText: offer.name || '(unnamed offer)', confidence: verdict.confidence, evidenceExcerpt: offer.excerpt, accepted: verdict.accepted, rejectReason: verdict.reason, collectedBy: actorId,
            priceType: offer.priceType, sourceType, currency: offer.currency });
          bump(tier, verdict.accepted, verdict.reason);
          recorded = true;
          if (verdict.accepted) { acceptedNow++; break; }
        }
      };

      // 2. The brand's own price for this exact SKU, on its verified identity pages.
      const identityPages = ((sku.identityEvidence as { sourceUrls?: string[] } | null)?.sourceUrls ?? []).slice(0, 2);
      for (const url of identityPages) await readPage(url, 'OFFICIAL', host => host === brandHost || (brandHost !== null && host.endsWith(`.${brandHost}`)) || identityPages.some(page => { try { return bare(new URL(page).hostname) === host; } catch { return false; } }));

      if (distributors.length && this.providers.discoveryConfigured()) {
        const found = (await this.providers.discoverPages(query, 3, { includeDomains: distributors })) ?? [];
        for (const page of found) await readPage(page.url, 'TRUSTED_RETAILER', host => distributors.some(r => host === r || host.endsWith(`.${r}`)));
      }

      if (!this.providers.discoveryConfigured() && !retailers.length) return finish(MarketPriceCheckStatus.UNAVAILABLE, acceptedNow ? null : 'SEARCH_NOT_CONFIGURED');

      // 3. Trusted Egyptian retailers' product pages for the same size, variant and pack.
      if (retailers.length) {
        const found = (await this.providers.discoverPages(query, 8, { includeDomains: retailers })) ?? [];
        for (const page of found) await readPage(page.url, 'TRUSTED_RETAILER', host => retailers.some(r => host === r || host.endsWith(`.${r}`)));
      }

      // 4. Coverage still missing: web discovery finds more retailer pages. It is never a price itself; every page is read and validated like the rest.
      const sellersNow = this.reference(await this.store.observations(skuId, MARKET_MAX_AGE_DAYS))?.sellers ?? 0;
      if (sellersNow < SUFFICIENT_SELLERS && this.providers.discoveryConfigured()) {
        const found = (await this.providers.discoverPages(`${query} price Egypt`, 10)) ?? [];
        // Discovery does not verify a seller: unknown stores/marketplace sellers remain rejected evidence even if they state EGP.
        for (const page of found) {
          let host: string;
          try { host = bare(new URL(page.url).hostname); } catch { continue; }
          if (host === brandHost) continue;
          await readPage(page.url, 'DISCOVERED', h => h === host);
        }
      }
      return finish(MarketPriceCheckStatus.UNAVAILABLE, read.size ? 'NO_RELIABLE_OBSERVATION' : 'NO_PRICE_PAGES_FOUND');
    } catch (error) {
      this.logger.warn(`Market price research for ${skuId} failed: ${error instanceof Error ? error.message : error}`);
      await this.store.finishCheck(check.id, { status: MarketPriceCheckStatus.FAILED, reasonCode: 'RESEARCH_FAILED', reference: null, coverage, cost: null });
      return { check: await this.store.latestCheck(skuId), reference: null, pricing: null, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

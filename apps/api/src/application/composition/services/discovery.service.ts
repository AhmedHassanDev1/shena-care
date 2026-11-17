import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { CatalogService, PublishedProduct, SEARCH_PROVIDER, SearchProvider, SearchFilters, normalizeSearchText } from '../../../modules/catalog/public';
import { CareService } from '../../../modules/care/public';
import { DiscoveryQueryDto, SuggestQueryDto } from '../dto/discovery.dto';
import { ProductView, ProductViewService } from './product-view.service';

@Injectable()
export class DiscoveryService {
  constructor(private readonly catalog: CatalogService, private readonly views: ProductViewService,
    @Inject(SEARCH_PROVIDER) private readonly searchProvider: SearchProvider,
    private readonly care: CareService) {}

  private async searchFilters(query: DiscoveryQueryDto, snapshotAt: Date): Promise<SearchFilters> {
    const q = query.q?.trim() ?? '';
    const concerns = q ? await this.care.getPublicConcerns() : [];
    const matched = concerns.find(c => normalizeSearchText(c.name) === normalizeSearchText(q) || c.slug === q);
    return { q, category: query.category, brand: query.brand, productLine: query.productLine,
      concern: query.concern, matchedConcern: matched?.slug, snapshotAt };
  }

  private async recheckVisible(views: Array<ProductView | null>, filters: SearchFilters): Promise<Array<ProductView | null>> {
    if (!filters.q) return views;
    const visible = views.filter((view): view is ProductView => view !== null);
    if (!visible.length) return views;
    // Reuse Catalog's reviewed aliases/typo rules, while excluding matches whose
    // only evidence was a SKU removed by Commerce/media/availability gates.
    const ids = new Set(await this.searchProvider.search({ ...filters, visibility: {
      productIds: visible.map(view => view.id), skuIds: visible.flatMap(view => view.skus.map(sku => sku.id)),
    } }));
    return views.map(view => view && ids.has(view.id) ? view : null);
  }

  async suggest(query: SuggestQueryDto) {
    const snapshotAt = new Date();
    const filters = await this.searchFilters(query, snapshotAt);
    const items: Array<{ id: string; name: string; slug: string; brand: { name: string; slug: string };
      imageUrl: string | null; category: { name: string; slug: string } | null }> = [];
    for (let offset = 0; items.length < (query.limit ?? 8); offset += 50) {
      const ids = await this.searchProvider.suggest(filters, 50, offset);
      if (!ids.length) break;
      const batch = await this.catalog.getPublishedProductsByIds(ids);
      const byId = new Map(batch.map(p => [p.id, p]));
      for (let i = 0; i < ids.length && items.length < (query.limit ?? 8); i += 10) {
        const selected = ids.slice(i, i + 10).map(id => byId.get(id)).filter((p): p is PublishedProduct => !!p);
        const composed = await this.views.composeProducts(selected);
        const visible = await this.recheckVisible(composed, filters);
        for (const view of visible) {
          if (view) items.push({ id: view.id, name: view.name, slug: view.slug,
            brand: { name: view.brand.name, slug: view.brand.slug },
            imageUrl: (view.media?.find(media => media.isPrimary && media.type === 'image') ?? view.media?.find(media => media.type === 'image'))?.url ?? null,
            category: view.category ? { name: view.category.name, slug: view.category.slug } : null });
          if (items.length >= (query.limit ?? 8)) break;
        }
      }
      if (ids.length < 50) break;
    }
    return { items, query: filters.q };
  }

  async discover(query: DiscoveryQueryDto) {
    const filters = { q: query.q?.trim() || undefined, category: query.category, brand: query.brand,
      productLine: query.productLine, concern: query.concern, sort: query.sort ?? 'relevance' };
    const fingerprint = createHash('sha256').update(JSON.stringify(filters)).digest('hex');
    let snapshotAt = new Date();
    let afterId: string | undefined;
    if (query.cursor) {
      try {
        const cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'));
        if (cursor.v !== 1 || cursor.f !== fingerprint || typeof cursor.t !== 'string' ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(cursor.id)) throw new Error();
        snapshotAt = new Date(cursor.t);
        if (!Number.isFinite(snapshotAt.getTime()) || snapshotAt > new Date()) throw new Error();
        afterId = cursor.id;
      } catch { throw new BadRequestException('Invalid discovery cursor or changed filters'); }
    }
    // Full eligibility evaluation is necessary for honest facets/totals.
    const visible: ProductView[] = [];
    const evaluatedAt = new Date();
    if (filters.q || filters.concern) {
      const searchFilters = await this.searchFilters(query, snapshotAt);
      const ids = await this.searchProvider.search(searchFilters);
      for (let start = 0; start < ids.length; start += 100) {
        const batch = await this.catalog.getPublishedProductsByIds(ids.slice(start, start + 100));
        const byId = new Map(batch.map(p => [p.id, p]));
        for (let i = start; i < Math.min(start + 100, ids.length); i += 100) {
          const selected = ids.slice(i, i + 100).map(id => byId.get(id)).filter((p): p is PublishedProduct => !!p);
          const views = await this.views.composeProducts(selected, evaluatedAt);
          const composed = await this.recheckVisible(views, searchFilters);
          visible.push(...composed.filter((p): p is ProductView => p !== null));
        }
      }
    } else {
      let scanAfter: string | undefined;
      do {
        const batch = await this.catalog.scanPublishedProducts(filters, snapshotAt, scanAfter);
        for (let start = 0; start < batch.products.length; start += 100) {
          const composed = await this.views.composeProducts(batch.products.slice(start, start + 100), evaluatedAt);
          visible.push(...composed.filter((p): p is ProductView => p !== null));
        }
        scanAfter = batch.nextAfterId ?? undefined;
      } while (scanAfter);
    }
    if (filters.sort !== 'relevance') {
      if (filters.sort === 'price-asc' || filters.sort === 'price-desc') {
        const currencies = new Set(visible.flatMap(product => product.skus.flatMap(sku => sku.price ? [sku.price.currency.toUpperCase()] : [])));
        if (currencies.size > 1) throw new BadRequestException('Cannot sort prices across different currencies');
      }
      const minimumPrice = (product: ProductView) => Math.min(...product.skus.flatMap(sku =>
        sku.price && Number.isFinite(sku.price.amount) ? [sku.price.amount] : []));
      visible.sort((a, b) => {
        let comparison: number;
        if (filters.sort === 'name-asc') comparison = a.name.localeCompare(b.name, 'ar');
        else {
          const left = minimumPrice(a), right = minimumPrice(b);
          comparison = !Number.isFinite(left) || !Number.isFinite(right)
            ? Number(!Number.isFinite(left)) - Number(!Number.isFinite(right))
            : (left - right) * (filters.sort === 'price-desc' ? -1 : 1);
        }
        return comparison || a.id.localeCompare(b.id);
      });
    }
    const facets = (key: 'brand' | 'category' | 'productLine') => {
      const counts = new Map<string, { slug: string; name: string; count: number }>();
      for (const product of visible) {
        const value = product[key];
        if (!value) continue;
        const current = counts.get(value.slug) ?? { slug: value.slug, name: value.name, count: 0 };
        current.count++; counts.set(value.slug, current);
      }
      return [...counts.values()].sort((a, b) => a.slug.localeCompare(b.slug));
    };
    const limit = query.limit ?? 20;
    const ordered = Boolean(filters.q) || filters.sort !== 'relevance';
    const afterIndex = afterId && ordered ? visible.findIndex(p => p.id === afterId) : -1;
    if (afterId && ordered && afterIndex < 0) throw new BadRequestException('Invalid discovery cursor or changed results');
    const remaining = ordered ? visible.slice(afterIndex + 1) : visible.filter(p => !afterId || p.id > afterId);
    const items = remaining.slice(0, limit);
    const hasNextPage = remaining.length > limit;
    const nextCursor = hasNextPage ? Buffer.from(JSON.stringify({ v: 1, f: fingerprint, t: snapshotAt.toISOString(), id: items[items.length - 1].id })).toString('base64url') : null;
    return { items, total: visible.length, facets: { brands: facets('brand'), categories: facets('category'), productLines: facets('productLine') },
      pageInfo: { limit, hasNextPage, nextCursor, snapshotAt: snapshotAt.toISOString(), evaluatedAt: evaluatedAt.toISOString() } };
  }
}

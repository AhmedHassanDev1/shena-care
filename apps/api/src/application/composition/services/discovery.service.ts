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

  private matchesVisible(product: PublishedProduct, visible: ProductView, filters: SearchFilters): boolean {
    const q = normalizeSearchText(filters.q);
    if (!q) return true;
    if (filters.matchedConcern && product.concerns.includes(filters.matchedConcern)) return true;
    return [visible.name, visible.brand.name,
      ...visible.skus.flatMap(s => [s.code, s.barcode ?? '', s.variantName])]
      .some(value => normalizeSearchText(value).includes(q));
  }

  async suggest(query: SuggestQueryDto) {
    const snapshotAt = new Date();
    const filters = await this.searchFilters(query, snapshotAt);
    const ids = await this.searchProvider.suggest(filters, 100);
    const items: Array<{ id: string; name: string; slug: string; brand: { name: string; slug: string } }> = [];
    for (let start = 0; start < ids.length && items.length < (query.limit ?? 8); start += 50) {
      const batch = await this.catalog.getPublishedProductsByIds(ids.slice(start, start + 50));
      const byId = new Map(batch.map(p => [p.id, p]));
      for (let i = start; i < Math.min(start + 50, ids.length) && items.length < (query.limit ?? 8); i += 10) {
        const visible = await Promise.all(ids.slice(i, i + 10).map(async id => {
          const product = byId.get(id);
          if (!product) return null;
          const view = await this.views.composeProduct(product);
          return view && this.matchesVisible(product, view, filters) ? view : null;
        }));
        for (const view of visible) {
          if (view) items.push({ id: view.id, name: view.name, slug: view.slug,
            brand: { name: view.brand.name, slug: view.brand.slug } });
          if (items.length >= (query.limit ?? 8)) break;
        }
      }
    }
    return { items, query: filters.q };
  }

  async discover(query: DiscoveryQueryDto) {
    const filters = { q: query.q?.trim() || undefined, category: query.category, brand: query.brand,
      productLine: query.productLine, concern: query.concern };
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
        for (let i = start; i < Math.min(start + 100, ids.length); i += 10) {
          const composed = await Promise.all(ids.slice(i, i + 10).map(async id => {
            const product = byId.get(id);
            if (!product) return null;
            const view = await this.views.composeProduct(product, evaluatedAt);
            return view && this.matchesVisible(product, view, searchFilters) ? view : null;
          }));
          visible.push(...composed.filter((p): p is ProductView => p !== null));
        }
      }
    } else {
      let scanAfter: string | undefined;
      do {
        const batch = await this.catalog.scanPublishedProducts(filters, snapshotAt, scanAfter);
        for (let start = 0; start < batch.products.length; start += 10) {
          const composed = await Promise.all(batch.products.slice(start, start + 10).map(p => this.views.composeProduct(p, evaluatedAt)));
          visible.push(...composed.filter((p): p is ProductView => p !== null));
        }
        scanAfter = batch.nextAfterId ?? undefined;
      } while (scanAfter);
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
    const afterIndex = afterId && filters.q ? visible.findIndex(p => p.id === afterId) : -1;
    if (afterId && filters.q && afterIndex < 0) throw new BadRequestException('Invalid discovery cursor or changed results');
    const remaining = filters.q ? visible.slice(afterIndex + 1) : visible.filter(p => !afterId || p.id > afterId);
    const items = remaining.slice(0, limit);
    const hasNextPage = remaining.length > limit;
    const nextCursor = hasNextPage ? Buffer.from(JSON.stringify({ v: 1, f: fingerprint, t: snapshotAt.toISOString(), id: items[items.length - 1].id })).toString('base64url') : null;
    return { items, total: visible.length, facets: { brands: facets('brand'), categories: facets('category'), productLines: facets('productLine') },
      pageInfo: { limit, hasNextPage, nextCursor, snapshotAt: snapshotAt.toISOString(), evaluatedAt: evaluatedAt.toISOString() } };
  }
}

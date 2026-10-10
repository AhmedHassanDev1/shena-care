import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { CatalogService } from '../../../modules/catalog/public';
import { DiscoveryQueryDto } from '../dto/discovery.dto';
import { ProductView, ProductViewService } from './product-view.service';

@Injectable()
export class DiscoveryService {
  constructor(private readonly catalog: CatalogService, private readonly views: ProductViewService) {}

  async discover(query: DiscoveryQueryDto) {
    const filters = { q: query.q?.trim() || undefined, category: query.category, brand: query.brand, productLine: query.productLine };
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
    // Full eligibility evaluation is necessary for honest facets/totals in this MVP.
    // Bound database batches and concurrent composition; no pre-filter pagination.
    const visible: ProductView[] = [];
    const evaluatedAt = new Date();
    let scanAfter: string | undefined;
    do {
      const batch = await this.catalog.scanPublishedProducts(filters, snapshotAt, scanAfter);
      for (let start = 0; start < batch.products.length; start += 10) {
        const composed = await Promise.all(batch.products.slice(start, start + 10).map(p => this.views.composeProduct(p, evaluatedAt)));
        const search = filters.q?.toLowerCase();
        visible.push(...composed.filter((p): p is ProductView => p !== null).filter(p => !search ||
          [p.name, p.brand.name, ...p.skus.flatMap(s => [s.code, s.barcode ?? '', s.variantName])]
            .some(value => value.toLowerCase().includes(search))));
      }
      scanAfter = batch.nextAfterId ?? undefined;
    } while (scanAfter);
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
    const remaining = visible.filter(p => !afterId || p.id > afterId);
    const items = remaining.slice(0, limit);
    const hasNextPage = remaining.length > limit;
    const nextCursor = hasNextPage ? Buffer.from(JSON.stringify({ v: 1, f: fingerprint, t: snapshotAt.toISOString(), id: items[items.length - 1].id })).toString('base64url') : null;
    return { items, total: visible.length, facets: { brands: facets('brand'), categories: facets('category'), productLines: facets('productLine') },
      pageInfo: { limit, hasNextPage, nextCursor, snapshotAt: snapshotAt.toISOString(), evaluatedAt: evaluatedAt.toISOString() } };
  }
}

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import { SearchFilters, SearchProvider } from './search-provider';
import { normalizeSearchText } from './search-text';
import { searchBrandSpellings, searchTerms, transpositionPattern } from './search-terms';
import { curatedSpellings, verifiedProfileAliases } from '../research/brand-aliases';

@Injectable()
export class PostgresSearchProvider implements SearchProvider {
  constructor(private readonly prisma: PrismaService) {}

  async search(filters: SearchFilters): Promise<string[]> {
    return this.find(filters);
  }

  async suggest(filters: SearchFilters, limit: number): Promise<string[]> {
    return this.find(filters, limit);
  }

  private async find(filters: SearchFilters, limit?: number): Promise<string[]> {
    const q = normalizeSearchText(filters.q);
    if (!q && !filters.concern) return [];
    if (filters.visibility && !filters.visibility.productIds.length) return [];
    const [brands, drafts] = /\p{L}/u.test(q) ? await Promise.all([
      this.prisma.brand.findMany({ select: { id: true, name: true, slug: true, profile: true } }),
      this.prisma.brandDraft.findMany({ where: { status: 'APPROVED', canonicalBrandId: { not: null } }, select: { canonicalBrandId: true, aliases: true } }),
    ]) : [[], []];
    const groups = searchTerms(q, brands.map(b => ({ brandId: b.id, spellings: [b.name, b.slug.replace(/-/g, ' '),
      ...curatedSpellings(b.name), ...searchBrandSpellings(b.name), ...verifiedProfileAliases(b.profile), ...drafts.filter(d => d.canonicalBrandId === b.id).flatMap(d => d.aliases)] })));
    const escaped = q.replace(/[!%_]/g, '!$&');
    const prefix = `${escaped}%`;
    const contains = `%${escaped}%`;
    const short = q.length < 3;
    const match = (column: Prisma.Sql) => Prisma.sql`${column} LIKE ${short ? prefix : contains} ESCAPE '!'`;
    const name = Prisma.sql`catalog.search_normalize(p.name)`;
    const brand = Prisma.sql`catalog.search_normalize(b.name)`;
    const concernMatch = filters.matchedConcern ? Prisma.sql`p.concerns @> ARRAY[${filters.matchedConcern}]::text[]` : Prisma.sql`FALSE`;
    const line = Prisma.sql`catalog.search_normalize(COALESCE(pl.name, ''))`;
    const metadata = [name, brand, line, Prisma.sql`catalog.search_normalize(COALESCE(c.name, ''))`,
      Prisma.sql`catalog.search_normalize(COALESCE(parent.name, ''))`, Prisma.sql`catalog.search_normalize(array_to_string(p.concerns, ' '))`];
    const termMatch = (column: Prisma.Sql, term: string, fuzzy: boolean) => {
      const pattern = `${q.length < 3 && groups.length === 1 ? '' : '%'}${term.replace(/[!%_]/g, '!$&')}%`;
      const literal = Prisma.sql`${column} LIKE ${pattern} ESCAPE '!'`;
      // Only words can be approximate. Barcodes, SKU codes, sizes and strengths cannot.
      const swapped = fuzzy ? transpositionPattern(term) : null;
      return fuzzy && /^[\p{L}]{5,30}$/u.test(term)
        ? Prisma.sql`(${literal} OR public.word_similarity(${term}, ${column}) >= 0.7 ${swapped ? Prisma.sql`OR ${column} ~ ${swapped}` : Prisma.empty})` : literal;
    };
    const uuidList = (ids: string[]) => Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`));
    const visibleSku = filters.visibility ? (filters.visibility.skuIds.length ? Prisma.sql`s.id IN (${uuidList(filters.visibility.skuIds)})` : Prisma.sql`FALSE`) : Prisma.sql`TRUE`;
    const terms = groups.map(group => {
      const alternatives = group.alternatives.flatMap(term => [
        ...metadata.map(column => termMatch(column, term, true)),
        Prisma.sql`(${visibleSku} AND (${termMatch(Prisma.sql`catalog.search_normalize(s.code)`, term, false)}
          OR ${termMatch(Prisma.sql`catalog.search_normalize(COALESCE(s.barcode, ''))`, term, false)}
          OR ${termMatch(Prisma.sql`catalog.search_normalize(s.variant_name)`, term, true)}))`,
      ]);
      if (group.brandIds.length) alternatives.push(Prisma.sql`b.id IN (${uuidList(group.brandIds)})`);
      return Prisma.sql`(${Prisma.join(alternatives, ' OR ')})`;
    });
    // All SKU-dependent words must be satisfied by the same active, visible SKU.
    const textMatch = Prisma.sql`EXISTS (SELECT 1 FROM catalog.skus s WHERE s.product_id = p.id AND s.is_active
      AND (${q ? Prisma.sql`(${concernMatch} OR (${Prisma.join(terms, ' AND ')}))` : Prisma.sql`TRUE`}))`;
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT p.id FROM catalog.products p
      JOIN catalog.brands b ON b.id = p.brand_id
      LEFT JOIN catalog.categories c ON c.id = p.category_id
      LEFT JOIN catalog.categories parent ON parent.id = c.parent_id
      LEFT JOIN catalog.product_lines pl ON pl.id = p.product_line_id
      WHERE p.is_published AND p.created_at <= ${filters.snapshotAt}
        ${filters.visibility ? Prisma.sql`AND p.id IN (${uuidList(filters.visibility.productIds)})` : Prisma.empty}
        ${filters.brand ? Prisma.sql`AND b.slug = ${filters.brand}` : Prisma.empty}
        ${filters.category ? Prisma.sql`AND (c.slug = ${filters.category} OR parent.slug = ${filters.category})` : Prisma.empty}
        ${filters.productLine ? Prisma.sql`AND pl.slug = ${filters.productLine}` : Prisma.empty}
        ${filters.concern ? Prisma.sql`AND p.concerns @> ARRAY[${filters.concern}]::text[]` : Prisma.empty}
        AND ${textMatch}
      ORDER BY
        CASE WHEN EXISTS (SELECT 1 FROM catalog.skus s WHERE s.product_id = p.id AND s.is_active AND ${visibleSku}
               AND (catalog.search_normalize(s.code) = ${q} OR catalog.search_normalize(COALESCE(s.barcode, '')) = ${q})) THEN 110
             WHEN ${name} = ${q} THEN 100
             WHEN ${name} LIKE ${prefix} ESCAPE '!' THEN 90
             WHEN ${match(name)} THEN 80
             WHEN ${brand} LIKE ${prefix} ESCAPE '!' THEN 70
             WHEN ${match(brand)} THEN 60
             WHEN ${line} = ${q} THEN 55
             WHEN ${concernMatch} THEN 50 ELSE 10 END DESC,
        p.id ASC
      ${limit ? Prisma.sql`LIMIT ${limit}` : Prisma.empty}
    `);
    return rows.map(row => row.id);
  }
}

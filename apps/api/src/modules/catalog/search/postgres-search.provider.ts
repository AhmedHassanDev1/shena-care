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

  async suggest(filters: SearchFilters, limit: number, offset = 0): Promise<string[]> {
    return this.find(filters, limit, offset);
  }

  private async find(filters: SearchFilters, limit?: number, offset = 0): Promise<string[]> {
    const q = normalizeSearchText(filters.q);
    if (q.length > 120 || [...q].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return [];
    if (!q && !filters.concern) return [];
    if (filters.visibility && !filters.visibility.productIds.length) return [];
    const [brands, drafts, ingredients] = /\p{L}/u.test(q) ? await Promise.all([
      this.prisma.brand.findMany({ select: { id: true, name: true, slug: true, profile: true } }),
      this.prisma.brandDraft.findMany({ where: { status: 'APPROVED', canonicalBrandId: { not: null } }, select: { canonicalBrandId: true, aliases: true } }),
      this.prisma.ingredient.findMany({ where: { status: 'APPROVED', isActiveIngredient: true }, select: { id: true, name: true, nameAr: true, inciName: true, aliases: true } }),
    ]) : [[], [], []];
    const groups = searchTerms(q, brands.map(b => ({ brandId: b.id, spellings: [b.name, b.slug.replace(/-/g, ' '),
      ...curatedSpellings(b.name), ...searchBrandSpellings(b.name), ...verifiedProfileAliases(b.profile), ...drafts.filter(d => d.canonicalBrandId === b.id).flatMap(d => d.aliases)] })),
      ingredients.map(i => ({ id: i.id, spellings: [i.name, i.nameAr ?? '', i.inciName, ...i.aliases] })));
    if (q && !groups.length) return [];
    const escaped = q.replace(/[!%_]/g, '!$&');
    const prefix = `${escaped}%`;
    const contains = `%${escaped}%`;
    const short = q.length < 3;
    const match = (column: Prisma.Sql) => Prisma.sql`${column} LIKE ${short ? prefix : contains} ESCAPE '!'`;
    const name = Prisma.sql`doc.product_name`;
    const brand = Prisma.sql`doc.brand_name`;
    const concernMatch = filters.matchedConcern ? Prisma.sql`p.concerns @> ARRAY[${filters.matchedConcern}]::text[]` : Prisma.sql`FALSE`;
    const line = Prisma.sql`doc.line_name`;
    const metadata = [name, brand, line, Prisma.sql`doc.category_name`, Prisma.sql`doc.parent_name`, Prisma.sql`doc.product_type`, Prisma.sql`doc.product_subtype`];
    const termMatch = (column: Prisma.Sql, term: string, fuzzy: boolean) => {
      const pattern = `${q.length < 3 && groups.length === 1 ? '' : '%'}${term.replace(/[!%_]/g, '!$&')}%`;
      const literal = /^\d{8,14}$/.test(term) || /^(?=.*[-_])(?=.*\d)[\p{L}\p{N}_-]+$/u.test(term)
        ? Prisma.sql`${column} = ${term}` : /^\d+$/.test(term)
          ? Prisma.sql`${column} ~ ${`(^|[^[:alnum:]])${term}([^[:alnum:]]|$)`}`
          : Prisma.sql`${column} LIKE ${pattern} ESCAPE '!'`;
      // Only words can be approximate. Barcodes, SKU codes, sizes and strengths cannot.
      const swapped = fuzzy ? transpositionPattern(term) : null;
      return fuzzy && /^[\p{L}]{5,30}$/u.test(term)
        ? Prisma.sql`(${literal} ${swapped ? Prisma.sql`OR ${column} ~ ${swapped}` : Prisma.empty} OR public.word_similarity(${term}, ${column}) >= 0.7)` : literal;
    };
    const uuidList = (ids: string[]) => Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`));
    const visibleSku = filters.visibility ? (filters.visibility.skuIds.length ? Prisma.sql`s.id IN (${uuidList(filters.visibility.skuIds)})` : Prisma.sql`FALSE`) : Prisma.sql`TRUE`;
    const terms = groups.map(group => {
      if (group.intent) {
        const { kind, values } = group.intent;
        if (kind === 'spf') return Prisma.sql`p.spf = ${Number(values[0])}`;
        if (kind === 'ingredient') return Prisma.sql`EXISTS (SELECT 1 FROM catalog.product_ingredients pi
          WHERE pi.product_id = p.id AND (pi.sku_id IS NULL OR (pi.sku_id = s.id AND ${visibleSku}))
          AND pi.ingredient_id IN (${uuidList(values)}))`;
        if (kind === 'concern') return Prisma.sql`(p.concerns && ARRAY[${Prisma.join(values)}]::text[] OR EXISTS (
          SELECT 1 FROM catalog.sku_routine_profiles rp,
          jsonb_array_elements(CASE WHEN jsonb_typeof(rp.suitability->'concerns') = 'array' THEN rp.suitability->'concerns' ELSE '[]'::jsonb END) claim
          WHERE rp.sku_id = s.id AND ${visibleSku} AND claim->>'concern' IN (${Prisma.join(values)})
          AND claim->>'status' IN ('VERIFIED', 'MANUFACTURER_CLAIM') AND COALESCE(claim->>'source', '') <> ''))`;
        const key = kind === 'skin' ? 'skinTypes' : 'hairTypes';
        return Prisma.sql`EXISTS (SELECT 1 FROM catalog.sku_routine_profiles rp WHERE rp.sku_id = s.id AND ${visibleSku}
          AND rp.suitability->${key}->>'status' = 'VERIFIED'
          AND rp.suitability->${key}->'value' ?| ARRAY[${Prisma.join([...values, ...values.map(value => value.toLowerCase()), 'all', 'ALL'])}]::text[])`;
      }
      const alternatives = group.alternatives.flatMap((term, index) => [
        ...metadata.map(column => termMatch(column, term, index === 0)),
        Prisma.sql`(${visibleSku} AND (${termMatch(Prisma.sql`catalog.search_normalize(s.code)`, term, false)}
          OR ${termMatch(Prisma.sql`catalog.search_normalize(COALESCE(s.barcode, ''))`, term, false)}
          OR ${termMatch(Prisma.sql`catalog.search_normalize(s.variant_name)`, term, index === 0)}))`,
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
      -- OFFSET 0 keeps this lateral projection from being inlined. Expensive Unicode
      -- normalization is evaluated once per candidate, shared by matching and ranking.
      CROSS JOIN LATERAL (SELECT catalog.search_normalize(p.name) AS product_name,
        catalog.search_normalize(b.name) AS brand_name,
        catalog.search_normalize(COALESCE(pl.name, '')) AS line_name,
        catalog.search_normalize(COALESCE(c.name, '')) AS category_name,
        catalog.search_normalize(COALESCE(parent.name, '')) AS parent_name,
        catalog.search_normalize(COALESCE(p.product_type, '')) AS product_type,
        catalog.search_normalize(COALESCE(p.product_subtype, '')) AS product_subtype OFFSET 0) doc
      WHERE p.is_published AND p.archived_at IS NULL AND p.created_at <= ${filters.snapshotAt}
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
        ${groups.length ? Prisma.join(groups.map(group => group.intent || group.brandIds.length
          ? Prisma.sql`0::int` : Prisma.sql`GREATEST(${Prisma.join(group.alternatives.flatMap(term => [name, brand, line].map(column => Prisma.sql`CASE
              WHEN ${column} = ${term} THEN 40
              WHEN ${column} LIKE ${`${term.replace(/[!%_]/g, '!$&')}%`} ESCAPE '!' THEN 30
              WHEN ${column} LIKE ${`%${term.replace(/[!%_]/g, '!$&')}%`} ESCAPE '!' THEN 15 ELSE 0 END`)))})`), ' + ') : Prisma.sql`0::int`} DESC,
        p.id ASC
      ${limit ? Prisma.sql`LIMIT ${limit}` : Prisma.empty}
      ${offset ? Prisma.sql`OFFSET ${offset}` : Prisma.empty}
    `);
    return rows.map(row => row.id);
  }
}

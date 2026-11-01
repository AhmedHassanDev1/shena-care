import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import { SearchFilters, SearchProvider } from './search-provider';
import { normalizeSearchText } from './search-text';

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
    const escaped = q.replace(/[!%_]/g, '!$&');
    const prefix = `${escaped}%`;
    const contains = `%${escaped}%`;
    const short = q.length < 3;
    const match = (column: Prisma.Sql) => Prisma.sql`${column} LIKE ${short ? prefix : contains} ESCAPE '!'`;
    const name = Prisma.sql`catalog.search_normalize(p.name)`;
    const brand = Prisma.sql`catalog.search_normalize(b.name)`;
    const concernMatch = filters.matchedConcern ? Prisma.sql`p.concerns @> ARRAY[${filters.matchedConcern}]::text[]` : Prisma.sql`FALSE`;
    const sku = Prisma.sql`EXISTS (SELECT 1 FROM catalog.skus s WHERE s.product_id = p.id AND s.is_active AND
      (${match(Prisma.sql`catalog.search_normalize(s.code)`)} OR ${match(Prisma.sql`catalog.search_normalize(COALESCE(s.barcode, ''))`)} OR
       ${match(Prisma.sql`catalog.search_normalize(s.variant_name)`)}) )`;
    const textMatch = q ? Prisma.sql`(${match(name)} OR ${match(brand)} OR ${concernMatch} OR ${sku})` : Prisma.sql`TRUE`;
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT p.id FROM catalog.products p
      JOIN catalog.brands b ON b.id = p.brand_id
      LEFT JOIN catalog.categories c ON c.id = p.category_id
      LEFT JOIN catalog.categories parent ON parent.id = c.parent_id
      LEFT JOIN catalog.product_lines pl ON pl.id = p.product_line_id
      WHERE p.is_published AND p.created_at <= ${filters.snapshotAt}
        ${filters.brand ? Prisma.sql`AND b.slug = ${filters.brand}` : Prisma.empty}
        ${filters.category ? Prisma.sql`AND (c.slug = ${filters.category} OR parent.slug = ${filters.category})` : Prisma.empty}
        ${filters.productLine ? Prisma.sql`AND pl.slug = ${filters.productLine}` : Prisma.empty}
        ${filters.concern ? Prisma.sql`AND p.concerns @> ARRAY[${filters.concern}]::text[]` : Prisma.empty}
        AND ${textMatch}
      ORDER BY
        CASE WHEN ${name} = ${q} THEN 100
             WHEN ${name} LIKE ${prefix} ESCAPE '!' THEN 90
             WHEN ${match(name)} THEN 80
             WHEN ${brand} LIKE ${prefix} ESCAPE '!' THEN 70
             WHEN ${match(brand)} THEN 60
             WHEN ${concernMatch} THEN 50 ELSE 10 END DESC,
        p.id ASC
      ${limit ? Prisma.sql`LIMIT ${limit}` : Prisma.empty}
    `);
    return rows.map(row => row.id);
  }
}

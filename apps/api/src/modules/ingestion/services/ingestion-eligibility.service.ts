import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isDeepStrictEqual } from 'node:util';
import { PrismaService } from '../../../platform/database/prisma.service';
import { PreviewEligibilityPolicyDto, PreviewEligibilityMappingsDto } from '../dto/eligibility-policy.dto';
import { compileEligibilityPolicy, EligibilityDocument, eligibilityMappingKey } from './ingestion-eligibility.policy';

// One physical source row remains one unresolved case after any number of partial HOLD successors.
// Normalize in PostgreSQL before GROUP/LIMIT, so counts are not a sample of the first 200 rows.
const heldRows = Prisma.sql`WITH RECURSIVE lineage AS (
  SELECT j.id, j.id AS root_id, ARRAY[j.id] AS path FROM ingestion.ingestion_jobs j
  WHERE j.row_outcomes @> '[{"outcome":"POLICY_HOLD"}]'::jsonb
    AND NOT EXISTS (SELECT 1 FROM ingestion.ingestion_jobs p WHERE p.id::text = j.source_metadata->>'eligibilityRetryOf')
  UNION ALL
  SELECT child.id, parent.root_id, parent.path || child.id FROM ingestion.ingestion_jobs child
    JOIN lineage parent ON child.source_metadata->>'eligibilityRetryOf' = parent.id::text
    WHERE NOT child.id = ANY(parent.path)
), observations AS (
  SELECT j.id AS job_id, j.supplier_id, j.eligibility_policy_id, j.created_at, r,
    row_number() OVER (PARTITION BY l.root_id, r->>'sourceRow'
      ORDER BY COALESCE(p.version, 0) DESC, j.created_at DESC, cardinality(l.path) DESC, j.id DESC) AS latest
  FROM lineage l JOIN ingestion.ingestion_jobs j ON j.id = l.id
    LEFT JOIN ingestion.eligibility_policies p ON p.id = j.eligibility_policy_id
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(j.row_outcomes) = 'array' THEN j.row_outcomes ELSE '[]'::jsonb END) r
), held AS (
  SELECT *, regexp_replace(translate(regexp_replace(lower(normalize(COALESCE(r->>'brand', ''), NFKC)), '[ـً-ٰٟ]', '', 'g'), 'أإآٱىکیة', 'اااايكيه'), '[^[:alnum:]]+', '', 'g') AS brand_key,
    regexp_replace(translate(regexp_replace(lower(normalize(COALESCE(r->>'category', ''), NFKC)), '[ـً-ٰٟ]', '', 'g'), 'أإآٱىکیة', 'اااايكيه'), '[^[:alnum:]]+', '', 'g') AS category_key
  FROM observations WHERE latest = 1 AND r->>'outcome' = 'POLICY_HOLD'
)`;

export interface HeldExample { jobId: string; sourceRow: number; brand: string; category: string; name: string; reason: string }
export interface HeldGroup {
  supplierId: string; brandKey: string; categoryKey: string; count: number; jobCount: number;
  reasons: string[]; examples: HeldExample[]; totalGroups: number; totalRows: number;
}

@Injectable()
export class IngestionEligibilityService {
  private readonly compiled = new Map<string, ReturnType<typeof compileEligibilityPolicy>>();
  constructor(private readonly prisma: PrismaService) {}

  async assertAdmin(actorId: string, db: Prisma.TransactionClient = this.prisma) {
    const actor = await db.customer.findUnique({ where: { id: actorId }, select: { isActive: true, roles: true } });
    if (!actor?.isActive || !actor.roles.includes('ADMIN')) throw new ForbiddenException('Active Admin required');
  }
  async current(db: Prisma.TransactionClient = this.prisma) {
    return db.ingestionEligibilityPolicy.findFirst({ where: { status: 'APPROVED' }, orderBy: { version: 'desc' } });
  }
  async compile(id: string | null | undefined, db: Prisma.TransactionClient = this.prisma) {
    if (id && this.compiled.has(id)) return this.compiled.get(id)!;
    const row = id ? await db.ingestionEligibilityPolicy.findUnique({ where: { id } }) : null;
    if (id && (!row || row.status !== 'APPROVED' || !row.version)) throw new ConflictException('Approved policy snapshot unavailable');
    const policy = compileEligibilityPolicy(row?.version ? { id: row.id, version: row.version, document: row.document as unknown as EligibilityDocument } : null);
    if (id) {
      if (this.compiled.size >= 16) this.compiled.delete(this.compiled.keys().next().value!);
      this.compiled.set(id, policy);
    }
    return policy;
  }
  async options() {
    const [brands, categories, suppliers] = await Promise.all([
      this.prisma.brand.findMany({ select: { id: true, name: true, slug: true, isActive: true }, orderBy: { name: 'asc' } }),
      this.prisma.category.findMany({ select: { id: true, name: true, parentId: true, slug: true, isActive: true }, orderBy: { name: 'asc' } }),
      this.prisma.supplier.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ]);
    return { brands, categories, suppliers };
  }
  async history() {
    return this.prisma.ingestionEligibilityPolicy.findMany({ where: { status: 'APPROVED' }, orderBy: { version: 'desc' }, take: 50 });
  }
  async holds() {
    const groups = await this.prisma.$queryRaw<HeldGroup[]>(Prisma.sql`${heldRows}, sampled AS (
      SELECT *, row_number() OVER (PARTITION BY supplier_id, brand_key, category_key ORDER BY created_at DESC, job_id, r->>'sourceRow') AS sample
      FROM held
    ), grouped AS (
      SELECT supplier_id AS "supplierId", brand_key AS "brandKey", category_key AS "categoryKey", count(*)::int AS count,
        count(DISTINCT job_id)::int AS "jobCount", array_agg(DISTINCT r->>'reason') AS reasons, max(created_at) AS newest,
        jsonb_agg(jsonb_build_object('jobId', job_id, 'sourceRow', (r->>'sourceRow')::int,
          'brand', COALESCE(r->>'brand', ''), 'category', COALESCE(r->>'category', ''),
          'name', COALESCE(r->>'name', r->'rawRow'->>'name', ''), 'reason', r->>'reason') ORDER BY sample) FILTER (WHERE sample <= 3) AS examples
      FROM sampled GROUP BY supplier_id, brand_key, category_key
    ) SELECT *, count(*) OVER ()::int AS "totalGroups", sum(count) OVER ()::int AS "totalRows"
      FROM grouped ORDER BY newest DESC, "supplierId", "brandKey", "categoryKey" LIMIT 200`);
    const current = await this.current();
    const policy = await this.compile(current?.id);
    const suggestions = new Map<string, ReturnType<typeof policy.suggestBrands>>();
    const result = groups.map(group => {
      if (!suggestions.has(group.brandKey)) suggestions.set(group.brandKey, policy.suggestBrands(group.examples[0].brand));
      return { ...group, suggestions: suggestions.get(group.brandKey)! };
    });
    // Compatibility samples for existing API readers; the Admin workflow uses groups, never individual row approval.
    return { groups: result, rows: result.flatMap(g => g.examples.map(e => ({ ...e, supplierId: g.supplierId }))).slice(0, 200),
      totalGroups: groups[0]?.totalGroups ?? 0, totalRows: groups[0]?.totalRows ?? 0, limit: 200, policyVersion: current?.version ?? null };
  }
  async heldGroupJobs(supplierId: string, brand: string, category: string, policyId: string) {
    return this.prisma.$queryRaw<Array<{ jobId: string }>>(Prisma.sql`${heldRows}
      SELECT DISTINCT job_id AS "jobId" FROM held WHERE supplier_id = ${supplierId}::uuid
        AND brand_key = ${eligibilityMappingKey(brand)} AND category_key = ${eligibilityMappingKey(category)}
        AND eligibility_policy_id IS DISTINCT FROM ${policyId}::uuid ORDER BY job_id LIMIT 21`);
  }
  async previewMappings(dto: PreviewEligibilityMappingsDto, actorId: string) {
    await this.assertAdmin(actorId);
    const current = await this.current();
    if (!current || current.version !== dto.expectedVersion) throw new ConflictException('Reload the current central policy before mapping names');
    const doc = current.document as unknown as EligibilityDocument;
    if (new Set(dto.brands.map(b => b.id)).size !== dto.brands.length || new Set(dto.categories.map(c => c.id)).size !== dto.categories.length ||
      dto.brands.some(b => !doc.brands.some(x => x.id === b.id)) || dto.categories.some(c => !doc.categories.some(x => x.id === c.id)))
      throw new BadRequestException('Map names only to existing canonical IDs in the policy snapshot');
    return this.preview({ expectedVersion: dto.expectedVersion, reason: dto.reason,
      brands: doc.brands.map(b => ({ id: b.id, effect: b.effect, aliases: dto.brands.find(x => x.id === b.id)?.aliases ?? b.aliases })),
      categories: doc.categories.map(c => ({ id: c.id, effect: c.effect, aliases: dto.categories.find(x => x.id === c.id)?.aliases ?? c.aliases ?? [] })),
      mappings: dto.mappings }, actorId, 'NAME_MAPPINGS');
  }
  private async resolve(dto: PreviewEligibilityPolicyDto, db: Prisma.TransactionClient): Promise<EligibilityDocument> {
    const [brands, categories, suppliers] = await Promise.all([
      db.brand.findMany({ select: { id: true, name: true, isActive: true }, orderBy: { id: 'asc' } }),
      db.category.findMany({ select: { id: true, name: true, parentId: true, isActive: true }, orderBy: { id: 'asc' } }),
      db.supplier.findMany({ where: { id: { in: dto.mappings.map(m => m.supplierId) } }, select: { id: true } }),
    ]);
    const brandIds = new Set(brands.map(b => b.id));
    const categoryIds = new Set(categories.map(c => c.id));
    const supplierIds = new Set(suppliers.map(s => s.id));
    const parents = new Set(categories.map(c => c.parentId));
    if (new Set(dto.brands.map(b => b.id)).size !== dto.brands.length || new Set(dto.categories.map(c => c.id)).size !== dto.categories.length)
      throw new BadRequestException('Duplicate canonical rules');
    if (dto.brands.some(b => !brandIds.has(b.id)) || dto.categories.some(c => !categoryIds.has(c.id)))
      throw new BadRequestException('Unknown canonical ID');
    for (const c of dto.categories) if (c.effect === 'ALLOW' && (parents.has(c.id) || !categories.find(x => x.id === c.id)!.isActive))
      throw new BadRequestException('ALLOW requires an active exact leaf; descendants are never inherited');
    const labels = new Map<string, string>();
    const checkLabel = (label: string, id: string) => {
      const key = eligibilityMappingKey(label);
      if (!key || (labels.has(key) && labels.get(key) !== id)) throw new BadRequestException('Brand alias collides with another canonical brand');
      labels.set(key, id);
    };
    for (const b of brands) checkLabel(b.name, b.id);
    for (const b of dto.brands) {
      if (b.effect === 'ALLOW' && !brands.find(x => x.id === b.id)!.isActive) throw new BadRequestException('Inactive brand');
      for (const alias of b.aliases) checkLabel(alias, b.id);
    }
    const categoryLabels = new Map<string, Set<string>>();
    for (const c of categories) {
      const key = eligibilityMappingKey(c.name);
      if (!categoryLabels.has(key)) categoryLabels.set(key, new Set());
      categoryLabels.get(key)!.add(c.id);
    }
    for (const c of dto.categories) for (const label of c.aliases ?? []) {
      const key = eligibilityMappingKey(label);
      if (!key || [...(categoryLabels.get(key) ?? [])].some(id => id !== c.id)) throw new BadRequestException('Category alias collides with another canonical category');
      categoryLabels.set(key, new Set([c.id]));
    }
    const mappingKeys = new Set<string>();
    for (const m of dto.mappings) {
      const key = `${m.supplierId}:${eligibilityMappingKey(m.label)}`;
      if (!supplierIds.has(m.supplierId) || !eligibilityMappingKey(m.label) || mappingKeys.has(key) || m.categoryIds.some(id => !categoryIds.has(id)))
        throw new BadRequestException('Invalid or duplicate supplier category mapping');
      mappingKeys.add(key);
    }
    return {
      resolutionVersion: 2,
      brands: brands.map(b => ({ ...b, effect: dto.brands.find(r => r.id === b.id)?.effect ?? null, aliases: dto.brands.find(r => r.id === b.id)?.aliases ?? [] })),
      categories: categories.map(c => ({ ...c, effect: dto.categories.find(r => r.id === c.id)?.effect ?? null, aliases: dto.categories.find(r => r.id === c.id)?.aliases ?? [] })),
      mappings: dto.mappings,
    };
  }
  async preview(dto: PreviewEligibilityPolicyDto, actorId: string, changeKind: 'CENTRAL_POLICY' | 'NAME_MAPPINGS' = 'CENTRAL_POLICY') {
    if (dto.reason.trim().length < 5) throw new BadRequestException('Meaningful review reason required');
    return this.prisma.$transaction(async db => {
      await this.assertAdmin(actorId, db);
      const current = await this.current(db);
      if ((current?.version ?? 0) !== dto.expectedVersion) throw new ConflictException('Policy changed; reload before preview');
      const document = await this.resolve(dto, db);
      const allowedBrands = document.brands.filter(b => b.effect === 'ALLOW').map(b => b.id);
      const evaluator = compileEligibilityPolicy({ id: 'preview', version: 1, document });
      const allowedBrand = document.brands.find(b => b.effect === 'ALLOW');
      const allowedCategories = allowedBrand ? document.categories.filter(c =>
        evaluator.evaluate('', allowedBrand.name, c.name).outcome === 'ALLOW').map(c => c.id) : [];
      const counts = await db.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT count(*) FROM sourcing.supplier_offers o
        JOIN catalog.skus s ON s.id = o.sku_id JOIN catalog.products p ON p.id = s.product_id
        WHERE p.brand_id::text NOT IN (${Prisma.join(allowedBrands.length ? allowedBrands : [''])})
          OR p.category_id IS NULL OR p.category_id::text NOT IN (${Prisma.join(allowedCategories.length ? allowedCategories : [''])})`);
      const existingOffersAffected = Number(counts[0].count);
      return db.ingestionEligibilityPolicy.create({ data: {
        baseVersion: dto.expectedVersion, actorId, reason: dto.reason.trim(),
        document: document as unknown as Prisma.InputJsonValue,
        impact: { changeKind, existingOffersAffected, existingOffersChanged: 0, acceptedOrdersChanged: 0,
          scope: 'Future imports only. Existing jobs retain their approved snapshot. Full snapshot exclusions block deactivation.' },
      } });
    });
  }
  async approve(id: string, actorId: string) {
    return this.prisma.$transaction(async db => {
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ingestion-eligibility-policy'))`;
      await this.assertAdmin(actorId, db);
      const row = await db.ingestionEligibilityPolicy.findUnique({ where: { id } });
      if (!row) throw new NotFoundException('Preview not found');
      if (row.actorId !== actorId) throw new ForbiddenException('Preview belongs to another Admin');
      if (row.status !== 'PREVIEW') throw new ConflictException('Preview already used');
      if (Date.now() - row.createdAt.getTime() > 30 * 60_000) throw new ConflictException('Preview expired');
      const current = await this.current(db);
      if ((current?.version ?? 0) !== row.baseVersion) throw new ConflictException('Policy changed; preview again');
      const doc = row.document as unknown as EligibilityDocument;
      const resolved = await this.resolve({ expectedVersion: row.baseVersion, reason: row.reason,
        brands: doc.brands.filter(b => b.effect || b.aliases.length).map(b => ({ id: b.id, effect: b.effect, aliases: b.aliases })),
        categories: doc.categories.filter(c => c.effect || c.aliases?.length).map(c => ({ id: c.id, effect: c.effect, aliases: c.aliases ?? [] })), mappings: doc.mappings }, db);
      if (!isDeepStrictEqual(resolved, doc)) throw new ConflictException('Taxonomy changed; preview again');
      return db.ingestionEligibilityPolicy.update({ where: { id }, data: { status: 'APPROVED', version: row.baseVersion + 1, approvedAt: new Date() } });
    });
  }
}

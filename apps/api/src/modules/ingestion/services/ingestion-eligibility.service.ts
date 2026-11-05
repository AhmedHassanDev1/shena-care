import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { PrismaService } from '../../../platform/database/prisma.service';
import { BrandService } from '../../catalog/public';
import { CreatePolicyBrandDto, PreviewEligibilityPolicyDto, PreviewEligibilityMappingsDto, UpdateBrandPolicyDto } from '../dto/eligibility-policy.dto';
import { compileEligibilityPolicy, EligibilityDocument, eligibilityMappingKey, PolicyEffect, PolicyExclusion } from './ingestion-eligibility.policy';

/** What a policy snapshot is built from: canonical IDs and reviewed choices only; names are always re-read from the catalog. */
interface ResolveInput {
  brands: Array<{ id: string; effect: PolicyEffect | null; aliases: string[]; categoryIds?: string[] }>;
  categories: Array<{ id: string; effect: PolicyEffect | null; aliases?: string[] }>;
  mappings: PreviewEligibilityPolicyDto['mappings'];
  exclusions?: PolicyExclusion[];
}

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
  constructor(private readonly prisma: PrismaService, private readonly brands: BrandService) {}

  async assertAdmin(actorId: string, db: Prisma.TransactionClient = this.prisma) {
    const actor = await db.customer.findUnique({ where: { id: actorId }, select: { isActive: true, roles: true } });
    if (!actor?.isActive || !actor.roles.includes('ADMIN')) throw new ForbiddenException('Active Admin required');
  }
  async current(db: Prisma.TransactionClient = this.prisma) {
    return db.ingestionEligibilityPolicy.findFirst({ where: { status: 'APPROVED' }, orderBy: { version: 'desc' } });
  }
  /** The approved version a receipt was pinned to, for its row accounting. */
  async pinnedVersion(id: string | null | undefined): Promise<number | null> {
    if (!id) return null;
    return (await this.prisma.ingestionEligibilityPolicy.findUnique({ where: { id }, select: { version: true } }))?.version ?? null;
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
  /** The approved snapshot a row was admitted under, or null when the row carries no resolvable snapshot (approved snapshots are immutable). */
  async compilePinned(id: string | null | undefined) {
    if (!id) return null;
    const exists = this.compiled.has(id) || await this.prisma.ingestionEligibilityPolicy.count({ where: { id, status: 'APPROVED' } });
    return exists ? this.compile(id) : null;
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

  // ── Catalog Policy: one Brand at a time ──────────────────────────────────────────────────────────────────────────
  // Each change is small, explicit and immediately effective, so it publishes the next immutable approved version in one
  // transaction (same lock, same validation and same snapshot model as preview → approve). History stays complete.

  /** Brands, their allowed leaves and exclusions as the Admin page shows them. Every value is read from the database. */
  async catalogPolicy() {
    const current = await this.current();
    const doc = current?.document as unknown as EligibilityDocument | undefined;
    const [brands, categories, productCounts] = await Promise.all([
      this.prisma.brand.findMany({ select: { id: true, name: true, slug: true, isActive: true, logoUrl: true, websiteUrl: true, description: true, countryOfOrigin: true }, orderBy: { name: 'asc' } }),
      this.prisma.category.findMany({ select: { id: true, name: true, slug: true, parentId: true, isActive: true, sortOrder: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      this.prisma.product.groupBy({ by: ['brandId'], _count: { _all: true } }),
    ]);
    const parents = new Set<string | null>(categories.map(c => c.parentId).filter(Boolean));
    const rules = new Map(doc?.brands.map(b => [b.id, b]) ?? []);
    const counts = new Map(productCounts.map(c => [c.brandId, c._count._all]));
    return {
      policyId: current?.id ?? null, version: current?.version ?? 0, approvedAt: current?.approvedAt ?? null,
      brands: brands.map(b => {
        const rule = rules.get(b.id);
        return { ...b, enabled: rule?.effect === 'ALLOW', denied: rule?.effect === 'DENY', aliases: rule?.aliases ?? [],
          categoryIds: this.effectiveLeaves(rule, doc, parents), productCount: counts.get(b.id) ?? 0,
          exclusions: (doc?.exclusions ?? []).filter(e => e.brandId === b.id) };
      }),
      categories: categories.map(c => ({ ...c, isLeaf: !parents.has(c.id) })),
    };
  }

  /** A brand configured before brand scoping keeps the central leaf list until it is first edited here. */
  private effectiveLeaves(rule: EligibilityDocument['brands'][number] | undefined, doc: EligibilityDocument | undefined, parents: Set<string | null>): string[] {
    if (rule?.categoryIds) return rule.categoryIds;
    if (rule?.effect !== 'ALLOW' || !doc) return [];
    return doc.categories.filter(c => c.effect === 'ALLOW' && !parents.has(c.id)).map(c => c.id);
  }

  /** Canonical products of one brand, for choosing an exclusion. Never a free-text identity. */
  async brandProducts(brandId: string, query = '') {
    const q = query.normalize('NFKC').trim().slice(0, 100);
    const products = await this.prisma.product.findMany({
      where: { brandId, ...(q && { OR: [{ name: { contains: q, mode: 'insensitive' } }, { skus: { some: { OR: [{ code: { contains: q, mode: 'insensitive' } }, { barcode: q }] } } }] }) },
      select: { id: true, name: true, isPublished: true, categoryId: true, skus: { select: { code: true, variantName: true }, take: 3 } },
      orderBy: { name: 'asc' }, take: 20,
    });
    return products;
  }

  async updateBrand(brandId: string, dto: UpdateBrandPolicyDto, actorId: string) {
    return this.prisma.$transaction(async db => {
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ingestion-eligibility-policy'))`;
      await this.assertAdmin(actorId, db);
      const current = await this.current(db);
      if ((current?.version ?? 0) !== dto.expectedVersion) throw new ConflictException({ code: 'POLICY_CHANGED', message: 'The policy changed; reload before editing' });
      const brand = await db.brand.findUnique({ where: { id: brandId }, select: { id: true, name: true } });
      if (!brand) throw new NotFoundException('Brand not found');
      const doc: EligibilityDocument = (current?.document as unknown as EligibilityDocument | undefined) ?? { brands: [], categories: [], mappings: [] };
      const parents = new Set<string | null>((await db.category.findMany({ select: { parentId: true } })).map(c => c.parentId).filter(Boolean));
      const rule = doc.brands.find(b => b.id === brandId);
      let effect = rule?.effect ?? null;
      let aliases = rule?.aliases ?? [];
      let categoryIds = this.effectiveLeaves(rule, doc, parents);
      let exclusions = [...(doc.exclusions ?? [])];
      const changes: string[] = [];
      if (dto.enabled !== undefined && dto.enabled !== (effect === 'ALLOW')) {
        effect = dto.enabled ? 'ALLOW' : null;
        changes.push(dto.enabled ? 'تفعيل البراند' : 'إيقاف البراند');
      }
      if (dto.addAliases?.length) {
        const known = new Set(aliases.map(eligibilityMappingKey));
        const fresh = [...new Set(dto.addAliases.map(a => a.normalize('NFKC').replace(/\s+/g, ' ').trim()).filter(a => a && !known.has(eligibilityMappingKey(a)) && eligibilityMappingKey(a) !== eligibilityMappingKey(brand.name)))];
        for (const alias of fresh) {
          const owner = await this.findExistingBrand(alias, brandId);
          if (owner) throw new ConflictException({ code: 'ALIAS_CONFLICT', message: `"${alias}" already names ${owner.name}`, brandId: owner.id, name: owner.name });
        }
        if (fresh.length) { aliases = [...aliases, ...fresh]; changes.push(`أسماء بديلة: ${fresh.join('، ')}`); }
      }
      if (dto.categoryIds) {
        const next = [...new Set(dto.categoryIds)];
        if (next.length !== categoryIds.length || next.some(id => !categoryIds.includes(id))) changes.push(`التصنيفات المسموحة: ${next.length}`);
        categoryIds = next;
      }
      if (dto.excludeProductId && !exclusions.some(e => e.productId === dto.excludeProductId)) {
        const product = await db.product.findUnique({ where: { id: dto.excludeProductId }, select: { id: true, name: true, brandId: true } });
        if (!product || product.brandId !== brandId) throw new BadRequestException({ code: 'PRODUCT_NOT_IN_BRAND', message: 'Choose a canonical product of this brand' });
        exclusions.push({ productId: product.id, brandId, name: product.name, reason: dto.reason?.trim() || 'استبعاد يدوي', actorId, at: new Date().toISOString() });
        changes.push(`استبعاد منتج: ${product.name}`);
      }
      if (dto.restoreProductId && exclusions.some(e => e.productId === dto.restoreProductId)) {
        const restored = exclusions.find(e => e.productId === dto.restoreProductId)!;
        if (restored.brandId !== brandId) throw new BadRequestException({ code: 'PRODUCT_NOT_IN_BRAND', message: 'The exclusion belongs to another brand' });
        exclusions = exclusions.filter(e => e.productId !== dto.restoreProductId);
        changes.push(`إعادة منتج: ${restored.name}`);
      }
      if (!changes.length) return { policyId: current?.id ?? null, version: current?.version ?? 0, changed: false };
      const document = await this.resolve({
        brands: [
          ...doc.brands.filter(b => b.id !== brandId && (b.effect || b.aliases.length || b.categoryIds))
            .map(b => ({ id: b.id, effect: b.effect, aliases: b.aliases, ...(b.categoryIds && { categoryIds: b.categoryIds }) })),
          { id: brandId, effect, aliases, categoryIds },
        ],
        categories: doc.categories.filter(c => c.effect || c.aliases?.length).map(c => ({ id: c.id, effect: c.effect, aliases: c.aliases ?? [] })),
        mappings: doc.mappings, exclusions,
      }, db);
      const version = (current?.version ?? 0) + 1;
      const created = await db.ingestionEligibilityPolicy.create({ data: {
        baseVersion: current?.version ?? 0, version, status: 'APPROVED', approvedAt: new Date(), actorId,
        reason: `${brand.name} — ${changes.join('، ')}`.slice(0, 1000),
        document: document as unknown as Prisma.InputJsonValue,
        impact: { changeKind: 'BRAND_POLICY', brandId, existingOffersAffected: await this.offersOutside(document, db), existingOffersChanged: 0, acceptedOrdersChanged: 0,
          scope: 'Future imports only. Existing products, offers and orders are unchanged.' },
      } });
      return { policyId: created.id, version, changed: true };
    });
  }

  /** The one rule against a second record for the same brand: its name or any reviewed alias, in any spelling the mapping key folds together. */
  async findExistingBrand(label: string, ignoreBrandId?: string): Promise<{ id: string; name: string } | null> {
    const key = eligibilityMappingKey(label);
    if (!key) return null;
    const doc = (await this.current())?.document as unknown as EligibilityDocument | undefined;
    const brands = await this.prisma.brand.findMany({ select: { id: true, name: true } });
    const aliases = new Map((doc?.brands ?? []).flatMap(b => b.aliases.map(a => [eligibilityMappingKey(a), b.id] as const)));
    const hit = brands.find(b => b.id !== ignoreBrandId && eligibilityMappingKey(b.name) === key) ?? brands.find(b => b.id !== ignoreBrandId && b.id === aliases.get(key));
    return hit ?? null;
  }
  async assertNewBrand(label: string): Promise<void> {
    if (eligibilityMappingKey(label).length < 2) throw new BadRequestException('Brand name is required');
    const existing = await this.findExistingBrand(label);
    if (existing) throw new ConflictException({ code: 'BRAND_EXISTS', message: `${existing.name} already exists`, brandId: existing.id, name: existing.name });
  }
  brandSlug(name: string): string {
    const latin = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return latin || `brand-${createHash('sha256').update(eligibilityMappingKey(name)).digest('hex').slice(0, 10)}`;
  }

  /** Adds a new canonical Brand (never a second copy of an existing one) and enables it with no categories yet. */
  async createBrand(dto: CreatePolicyBrandDto, actorId: string) {
    await this.assertAdmin(actorId);
    const name = dto.name.normalize('NFKC').replace(/\s+/g, ' ').trim();
    await this.assertNewBrand(name);
    const brand = await this.brands.createBrand({ name, slug: this.brandSlug(name) });
    const result = await this.updateBrand(brand.id, { expectedVersion: dto.expectedVersion, enabled: true, categoryIds: [] }, actorId);
    return { brandId: brand.id, ...result };
  }

  /** Canonical product identity (Brand/Category) behind resolved SKUs, for identity-stage policy checks. Read-only. */
  async productsForSkus(skuIds: string[]): Promise<Map<string, { productId: string; brandId: string; categoryId: string | null }>> {
    if (!skuIds.length) return new Map();
    const skus = await this.prisma.sku.findMany({ where: { id: { in: [...new Set(skuIds)] } },
      select: { id: true, product: { select: { id: true, brandId: true, categoryId: true } } } });
    return new Map(skus.map(s => [s.id, { productId: s.product.id, brandId: s.product.brandId, categoryId: s.product.categoryId }]));
  }

  /** Existing offers whose canonical product the given document would not admit. Reported, never changed. */
  private async offersOutside(document: EligibilityDocument, db: Prisma.TransactionClient): Promise<number> {
    const rows = await db.$queryRaw<Array<{ productId: string; brandId: string; categoryId: string | null; count: bigint }>>(Prisma.sql`
      SELECT p.id AS "productId", p.brand_id AS "brandId", p.category_id AS "categoryId", count(*) AS count FROM sourcing.supplier_offers o
      JOIN catalog.skus s ON s.id = o.sku_id JOIN catalog.products p ON p.id = s.product_id GROUP BY p.id`);
    const evaluator = compileEligibilityPolicy({ id: 'impact', version: 1, document });
    return rows.reduce((sum, r) => sum + (evaluator.evaluateIdentity(r).outcome === 'ALLOW' ? 0 : Number(r.count)), 0);
  }

  private async resolve(dto: ResolveInput, db: Prisma.TransactionClient): Promise<EligibilityDocument> {
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
    // Brand-scoped leaves: exact, active, distinct leaves only. A parent would silently approve its future children.
    for (const b of dto.brands) if (b.categoryIds) {
      if (new Set(b.categoryIds).size !== b.categoryIds.length) throw new BadRequestException('Duplicate brand category');
      for (const id of b.categoryIds) {
        const c = categories.find(x => x.id === id);
        if (!c) throw new BadRequestException('Unknown canonical category');
        if (parents.has(id) || !c.isActive) throw new BadRequestException({ code: 'CATEGORY_REQUIRES_LEAF', message: 'Brands allow active exact leaf categories only; a parent never approves its children' });
      }
    }
    const exclusions = dto.exclusions ? await db.product.findMany({ where: { id: { in: dto.exclusions.map(e => e.productId) } }, select: { id: true, name: true, brandId: true } }) : [];
    if (dto.exclusions && (new Set(dto.exclusions.map(e => e.productId)).size !== dto.exclusions.length ||
      dto.exclusions.some(e => exclusions.find(p => p.id === e.productId)?.brandId !== e.brandId)))
      throw new BadRequestException('Exclusions must name existing canonical products of their brand');
    return {
      resolutionVersion: 2,
      brands: brands.map(b => {
        const rule = dto.brands.find(r => r.id === b.id);
        return { ...b, effect: rule?.effect ?? null, aliases: rule?.aliases ?? [], ...(rule?.categoryIds && { categoryIds: rule.categoryIds }) };
      }),
      categories: categories.map(c => ({ ...c, effect: dto.categories.find(r => r.id === c.id)?.effect ?? null, aliases: dto.categories.find(r => r.id === c.id)?.aliases ?? [] })),
      mappings: dto.mappings,
      ...(dto.exclusions?.length && { exclusions: dto.exclusions.map(e => ({ ...e, name: exclusions.find(p => p.id === e.productId)!.name })) }),
    };
  }
  async preview(dto: PreviewEligibilityPolicyDto, actorId: string, changeKind: 'CENTRAL_POLICY' | 'NAME_MAPPINGS' = 'CENTRAL_POLICY') {
    if (dto.reason.trim().length < 5) throw new BadRequestException('Meaningful review reason required');
    return this.prisma.$transaction(async db => {
      await this.assertAdmin(actorId, db);
      const current = await this.current(db);
      if ((current?.version ?? 0) !== dto.expectedVersion) throw new ConflictException('Policy changed; reload before preview');
      // Brand scopes and product exclusions are edited on the Catalog Policy page; a central preview carries them forward unchanged.
      const previous = current?.document as unknown as EligibilityDocument | undefined;
      const document = await this.resolve({ ...dto,
        brands: dto.brands.map(b => {
          const categoryIds = previous?.brands.find(x => x.id === b.id)?.categoryIds;
          return { ...b, ...(categoryIds && { categoryIds }) };
        }),
        exclusions: previous?.exclusions }, db);
      const existingOffersAffected = await this.offersOutside(document, db);
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
      const resolved = await this.resolve({
        brands: doc.brands.filter(b => b.effect || b.aliases.length || b.categoryIds)
          .map(b => ({ id: b.id, effect: b.effect, aliases: b.aliases, ...(b.categoryIds && { categoryIds: b.categoryIds }) })),
        categories: doc.categories.filter(c => c.effect || c.aliases?.length).map(c => ({ id: c.id, effect: c.effect, aliases: c.aliases ?? [] })),
        mappings: doc.mappings, exclusions: doc.exclusions }, db);
      if (!isDeepStrictEqual(resolved, doc)) throw new ConflictException('Taxonomy changed; preview again');
      return db.ingestionEligibilityPolicy.update({ where: { id }, data: { status: 'APPROVED', version: row.baseVersion + 1, approvedAt: new Date() } });
    });
  }
}

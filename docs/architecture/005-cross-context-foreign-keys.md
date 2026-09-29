# ADR-005: Cross-Context Foreign Keys

**Status**: Accepted

## Context

In a modular monolith with separate database schemas, we face a tradeoff:

**Purity**: Never use foreign keys across contexts (schemas) to maximize future service extraction.

**Pragmatism**: We're building in a single database today. Referential integrity has real value. Future extraction is uncertain.

We need a policy that balances architectural cleanliness with practical correctness.

## Decision

**Cross-context foreign keys are allowed selectively** when:
1. Both contexts are co-located in the same database
2. The referenced identity is stable (UUID, not mutable natural key)
3. The relationship is structurally important
4. Referential integrity provides meaningful safety
5. The FK is explicitly documented

**However**:
- No cross-context ORM navigation
- No cross-context repository sharing
- No cross-context cascade deletes
- Mutations still go through owning module's API
- FK must be listed in extraction cost documentation

## Approved Cross-Context FKs

### `commerce.listings.sku_id → catalog.skus.id`
**Rationale**: A listing cannot exist without a SKU. Referential integrity prevents orphaned listings. The SKU ID is stable.

### `commerce.selling_prices.sku_id → catalog.skus.id`
**Rationale**: A price cannot exist without a SKU. We need to prevent prices for deleted SKUs.

## Forbidden Patterns

### Cross-Context Cascade Deletes
```sql
-- FORBIDDEN
FOREIGN KEY (sku_id) REFERENCES catalog.skus(id) ON DELETE CASCADE
```
**Why**: Deleting a catalog SKU should not silently delete commerce listings. Commerce must explicitly handle SKU removal.

### Cross-Context ORM Navigation
```typescript
// FORBIDDEN
const listing = await listingRepository.findOne({
  relations: ['sku', 'sku.product', 'sku.product.brand']
});
```
**Why**: Creates hidden coupling. Commerce should not navigate Catalog's entity graph.

### Repository Sharing
```typescript
// FORBIDDEN - Commerce importing Catalog repository
import { SkuRepository } from '../catalog/repositories/sku.repository';
```
**Why**: Violates module boundaries. Use Catalog's public API instead.

## Consequences

### Positive

- **Data integrity** - Database prevents invalid references
- **Simpler application code** - No manual FK validation needed
- **Safer operations** - Accidental deletions caught at DB level
- **Familiar patterns** - Standard relational model

### Negative

- **Extraction cost** - FKs must be removed before service separation
- **Partial coupling** - Database knows about relationships even if app code doesn't
- **Migration coordination** - Must ensure referenced data exists

## Alternatives Considered

### No Cross-Context FKs (Pure Microservice Simulation)
**Rejected**: We're not running microservices. Giving up referential integrity for theoretical future-proofing introduces real bugs today. When extraction happens, removing FKs is a known, manageable task.

### FK Everywhere
**Rejected**: Would allow unbounded coupling. This policy requires explicit justification for each cross-context FK.

### Application-Level FK Validation Only
**Rejected**: Relies on perfect application code. Race conditions, bugs, and direct SQL can violate integrity. Defense in depth is better.

## Extraction Path

When extracting a context to a service:

1. **Before extraction**:
   - Identify all cross-context FKs involving the context
   - Add application-level validation
   - Add reconciliation jobs
   - Test with FKs disabled

2. **During extraction**:
   - Drop cross-context FKs
   - Migrate schema to new database
   - Replace direct queries with API calls

3. **After extraction**:
   - Run reconciliation to detect orphaned references
   - Add monitoring for referential integrity violations

## Review Checklist

Before adding a cross-context FK:
- [ ] Is the referenced ID stable (UUID)?
- [ ] Is referential integrity valuable here?
- [ ] Have I documented it in this ADR?
- [ ] Have I added it to the extraction cost inventory?
- [ ] Is there no cascade delete?
- [ ] Does the owning module still control mutations?

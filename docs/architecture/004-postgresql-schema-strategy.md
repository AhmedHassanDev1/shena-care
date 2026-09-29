# ADR-004: PostgreSQL Schema Strategy

**Status**: Accepted

## Context

We have multiple business contexts in a single PostgreSQL database. We need a way to:
- Make ownership visible
- Organize migrations
- Enable future extraction
- Maintain some logical separation

## Decision

Use **separate PostgreSQL schemas** per major business context:

```
catalog.*       - Product, SKU, Brand, ProductMedia
commerce.*      - Listing, SellingPrice, Cart, Order
sourcing.*      - Supplier, SupplierOffer, SupplyPlan (future)
fulfillment.*   - FulfillmentLocation, Inventory, Reservation (future)
care.*          - CustomerCareProfile, Routine (future)
guidance.*      - Conversation, Recommendation (future)
accounts.*      - Identity, Session (future)
```

## Consequences

### Positive

- **Ownership visibility** - Schema name shows which context owns a table
- **Migration organization** - Migrations naturally group by context
- **Namespace isolation** - Reduces naming collisions
- **Extraction preparation** - Schema boundaries help identify service boundaries
- **Review clarity** - Cross-schema references are easily spotted in code review

### Negative

- **Schema != Enforcement** - A role with access to all schemas can still violate boundaries
- **Migration coordination** - Cross-schema changes need careful sequencing
- **Slightly verbose queries** - Must qualify table names with schema

## Alternatives Considered

### Single Schema
**Rejected**: Makes ownership invisible. A table named `products` doesn't indicate whether it's owned by Catalog or Commerce. Cross-boundary access is harder to spot.

### Table Prefixes (catalog_products, commerce_listings)
**Rejected**: More verbose than schemas. Doesn't provide namespace benefits. Harder to query with ORMs.

### Separate Databases
**Rejected**: Forces distributed transactions immediately. Loses PostgreSQL's ACID guarantees across contexts. Significantly increases operational complexity.

## Enforcement Strategy

Schemas alone are **not sufficient** for architectural enforcement. We also need:

1. **Module boundaries** - TypeScript imports restricted to public APIs
2. **Persistence encapsulation** - Each context's repositories are private
3. **Architecture tests** - Verify no direct cross-schema entity access
4. **Code review** - Flag raw SQL that crosses schemas
5. **Migration review** - Cross-schema migrations require architectural justification

## Foreign Key Policy

See [ADR-005: Cross-Context Foreign Keys](005-cross-context-foreign-keys.md) for FK policy across schemas.

## Example Usage

```sql
-- Clear ownership
SELECT * FROM catalog.products WHERE id = $1;
SELECT * FROM commerce.listings WHERE sku_id = $1;

-- Cross-schema FK (documented exception)
ALTER TABLE commerce.listings 
  ADD CONSTRAINT fk_listing_sku 
  FOREIGN KEY (sku_id) REFERENCES catalog.skus(id);
```

## Migration Path

If a context is extracted to a service:
1. Remove cross-schema dependencies first
2. Migrate schema to new database
3. Replace direct queries with API calls
4. Keep context intact during transition

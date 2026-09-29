# ADR-003: Product and SKU Identity

**Status**: Accepted

## Context

Beauty products have complex identity requirements:
- Same product in different sizes (50ml, 100ml)
- Same product in different shades/formulations
- Products identified by barcodes in supplier systems
- Multiple identifiers (EAN, UPC, internal codes)
- Need stable IDs that survive data migrations

## Decision

We use a two-level identity model:

### Product
- Customer-facing product identity
- Has a stable internal UUID
- Has a human-readable slug for URLs
- Represents a coherent product concept (e.g., "CeraVe Moisturizing Cream")

### SKU (Stock Keeping Unit)
- Specific sellable physical variant
- Has a stable internal UUID
- Has an internal code (e.g., "CRV-MC-177")
- Has a variant name (e.g., "6 oz Jar")
- May have a barcode, but **barcode is not the primary key**

### Identifiers
- Barcodes, EAN, UPC are stored as separate identifiers
- Used for matching and lookup
- Not used as primary keys or foreign keys
- Can be conflicting across sources (same barcode, different product)

## Consequences

### Positive

- **Stable identity** - UUIDs never change, even if barcodes are corrected
- **Flexible matching** - Can handle multiple identifiers per SKU
- **Conflict resolution** - Can detect and resolve barcode conflicts
- **URL stability** - Slugs provide human-readable, stable URLs
- **Variant clarity** - Size/shade/formulation differences are explicit

### Negative

- **Indirection** - Barcode lookups require an extra hop
- **Identifier management** - Must track multiple identifiers per SKU

## Alternatives Considered

### Barcode as Primary Key
**Rejected**: Barcodes are not globally unique or stable. The same barcode might appear on different products from different suppliers. Corrections would require cascading updates.

### Compound Natural Keys
**Rejected** (e.g., brand + product name + size): Natural keys are verbose, can change, and make foreign keys cumbersome.

### Single Product Entity
**Rejected**: Conflates product identity with variant. A moisturizer is one product with multiple SKUs (sizes), not multiple products.

## Implementation

```typescript
// Stable internal identity
Product { id: UUID, slug: string, ... }
SKU { id: UUID, productId: UUID, code: string, ... }

// Identifiers as attributes/associations
SKU { barcode: string | null }

// Future: separate identifier table if needed
Identifier { skuId: UUID, type: 'EAN' | 'UPC', value: string }
```

## Examples

**CeraVe Moisturizing Cream**
- Product: `id: uuid-1, slug: 'cerave-moisturizing-cream'`
- SKU 1: `id: uuid-2, code: 'CRV-MC-177', variant: '6 oz', barcode: '360600...'`
- SKU 2: `id: uuid-3, code: 'CRV-MC-539', variant: '19 oz', barcode: '360600...'`

# Architecture Review Summary

**Date**: 2026-09-29  
**Reviewer**: Claude Opus 5  
**Status**: APPROVED - Evolution, Not Revolution

---

## Executive Summary

The existing Shena Care architecture **aligns strongly** with the new Product Workflow requirements. The current implementation provides a solid foundation that requires **additive changes** (new modules) rather than refactoring. The modular monolith is well-designed, boundaries are clean, and the catalog/commerce separation is correct.

---

## Key Findings

### ✅ What Already Works

1. **Modular Monolith Foundation**
   - Clean module boundaries with `public.ts` APIs
   - Schema-per-context organization (catalog, commerce)
   - Cross-context FK policy documented and pragmatic
   - No premature optimization (no CQRS, event sourcing, microservices)

2. **Catalog Module (Correct Destination)**
   - Brand, Product, SKU, ProductMedia entities
   - UUID-based stable identity
   - Product/SKU separation (not just barcodes)
   - `isPublished` flag (workflow gate)
   - Public API enforces published-only access

3. **Commerce Module (Correct Boundary)**
   - Listing and SellingPrice separated from Catalog
   - Sellability policy owned by Commerce
   - FK to SKU (not Product) is correct

4. **Architecture Documentation**
   - ADRs document key decisions
   - Context ownership clearly defined
   - Migration path considered

### 🔧 What Needs to Change

1. **Add Ingestion Module** (Product Workflow Gateway)
   - Location: `apps/api/src/modules/ingestion/`
   - Schema: `ingestion.*`
   - Owns: IntakeJob, ProductCandidate, ProductFingerprint, CandidateMatch, GeneratedContent, ReviewDecision
   - Purpose: Controlled gateway for product creation

2. **Add Sourcing Module**
   - Location: `apps/api/src/modules/sourcing/`
   - Schema: `sourcing.*`
   - Owns: Supplier, SupplierOffer
   - Key Rule: SupplierOffer → SKU (not Product)

3. **Extend Catalog Module**
   - Add Category entity for taxonomy
   - Extend ProductMedia with `originType` (verified/generated/derived)
   - Add generation metadata tracking

4. **Add AI Integration**
   - FastAPI service for AI workloads
   - NestJS → FastAPI client in Ingestion module
   - FastAPI returns structured data, NestJS validates and persists

### 🚨 Architectural Contradictions

**NONE FOUND**. The existing architecture does not contradict the new direction. It's **incomplete**, not wrong.

---

## Recommended Module Structure

```
apps/api/src/modules/
├── catalog/           ✅ EXISTS - Keep as-is, minor additions
│   └── (Brand, Product, SKU, ProductMedia, Category)
│
├── commerce/          ✅ EXISTS - No changes needed
│   └── (Listing, SellingPrice)
│
├── ingestion/         ⚠️ NEW - Product workflow orchestration
│   └── (IntakeJob, ProductCandidate, ProductFingerprint, etc.)
│
├── sourcing/          ⚠️ NEW - Supplier relationships
│   └── (Supplier, SupplierOffer)
│
└── (future)
    ├── fulfillment/
    ├── care/
    ├── guidance/
    └── accounts/
```

---

## Critical Ownership Rules

| Entity | Owner | Why |
|--------|-------|-----|
| Product, SKU | **Catalog** | Canonical product truth |
| Listing, SellingPrice | **Commerce** | Sellability policy |
| Supplier, SupplierOffer | **Sourcing** | Commercial relationships |
| ProductCandidate | **Ingestion** | Pre-publication workflow state |
| GeneratedContent | **Ingestion** | AI-generated text versions |

**Key Rule**: `SupplierOffer → SKU` (not Product). Multiple suppliers can offer the same SKU.

---

## Product Workflow Summary

```
Supplier Data
  ↓
IntakeJob → RawSupplierItem
  ↓
Normalize → ProductCandidate
  ↓
Fingerprint → Match Existing SKU?
  ↓
├─ EXACT MATCH → Update SupplierOffer only
│
└─ NO MATCH → Research → Enrich → Review → Publish
                                              ↓
                                    Catalog.Product + SKU
                                              ↓
                                    Sourcing.SupplierOffer
```

**Core Principle**: Ingestion is the **only** path to create catalog products. No direct creation from suppliers.

---

## ER Model Assessment

### Entities to Add in Phase 1

**Catalog Extensions**:
- ✅ Category (taxonomy)
- ✅ ProductMedia.originType (verified/generated/derived)

**Sourcing** (new module):
- ✅ Supplier
- ✅ SupplierOffer

**Ingestion** (new module):
- ✅ IntakeJob
- ✅ RawSupplierItem
- ✅ ProductCandidate
- ✅ ProductFingerprint
- ✅ CandidateMatch
- ✅ GeneratedContentVersion
- ✅ GeneratedMediaAsset
- ✅ ReviewDecision

### Entities to Defer

- SKUBarcode (multi-barcode support) - use single `skus.barcode` for MVP
- Ingredient, ProductIngredient - wait for formula data
- ProductLine - wait for brand line data
- SourceArtifact - store in IntakeJob.raw_data JSONB for MVP
- CandidateEvidence - store in ProductCandidate.evidence JSONB for MVP

### Assessment: Appropriately Sized

The proposed ER model is **not over-modeled**. The workflow's complexity justifies the entity count. Simplifications would lose critical workflow state.

---

## AI Integration Strategy

**Architecture**: NestJS + FastAPI

```
NestJS Ingestion Module
  ↓ (orchestrates)
HTTP POST → FastAPI
  ↓ (returns JSON)
NestJS validates
  ↓
NestJS persists to PostgreSQL
```

**FastAPI Handles**:
- LLM API calls (Claude, GPT)
- Structured extraction
- Content generation
- Image generation (future)
- Embeddings (future)

**NestJS Handles**:
- Workflow orchestration
- State management
- Validation
- Persistence
- Business rules

**Key Rule**: FastAPI does **NOT** mutate Catalog/Commerce/Sourcing state directly.

---

## Implementation Roadmap

### Phase 0: ER Model Stabilization (1-2 weeks) 🚧 **CURRENT**

**Goal**: Stabilize data model before workflow implementation

**Deliverables**:
1. ✅ Document complete ER model
2. Add Category entity to Catalog
3. Extend ProductMedia with origin tracking
4. Create Sourcing schema stub
5. Create Ingestion schema stub
6. Update seed data with categories
7. Update documentation

**Effort**: 1-2 weeks

### Phase 1: Product Workflow MVP (2-3 weeks)

**Goal**: Pilot full workflow with 10-20 real products from one supplier

**Simplified First Pass**:
- Supplier intake (CSV or manual entry)
- Normalization
- Fingerprint matching (one pass)
- **Manual research** (human fills facts)
- AI content generation (title, description)
- Manual review UI
- Catalog publication
- SupplierOffer creation

**Skip for MVP**:
- Automated research/scraping
- Second fingerprint pass
- AI media generation
- CandidateEvidence separate table

**Effort**: 2-3 weeks

### Phase 1.5: AI Content Generation (1 week)

- FastAPI service deployment
- NestJS AI client
- GeneratedContentVersion tracking
- Content regeneration support

### Phase 2: E-commerce Core (2-3 weeks)

- Cart
- Checkout (Guest checkout approved)
- COD payment
- Order management
- Customer order view

---

## Changes to Existing Vertical Slice

### Catalog Changes

**Schema**:
```sql
-- Add Category table
CREATE TABLE catalog.categories (...);

-- Add category to products
ALTER TABLE catalog.products
  ADD COLUMN category_id UUID REFERENCES categories(id);

-- Extend ProductMedia
ALTER TABLE catalog.product_media
  ADD COLUMN origin_type VARCHAR DEFAULT 'verified',
  ADD COLUMN generation_metadata JSONB;
```

**Entity**:
- Add Category entity
- Update Product with categoryId relation
- Update ProductMedia with originType and generationMetadata

**Service**:
- No breaking changes to public API
- Internal creation methods accept originType

### Commerce Changes

**NONE REQUIRED**. Commerce already correctly references SKU (not Product).

### Composition Layer Changes

**NONE REQUIRED**. ProductView continues to compose Catalog + Commerce.

---

## Risk Assessment

### Low Risk ✅

- Module boundaries are clean
- Existing code continues to work
- Additive changes (new modules, not refactoring)
- Product Workflow can be built iteratively

### Medium Risk ⚠️

- **Complexity**: Product Workflow adds significant business logic
- **AI Integration**: FastAPI + NestJS coordination needs careful design
- **Data Volume**: 10-20 products manageable, but state machine complexity increases
- **Review UX**: Human review UI needs to be intuitive

### Mitigation

1. Build incrementally (start with manual steps, automate later)
2. Pilot with small dataset (10-20 products reveals workflow issues)
3. Clear state machine (document ProductCandidate workflow stages)
4. Preserve raw data (always keep SourceArtifact/RawSupplierItem)
5. Idempotent operations (fingerprint/matching should be repeatable)

---

## Success Criteria

### Phase 0 Complete When:
- [x] ER model documented
- [ ] Category entity implemented
- [ ] ProductMedia extended
- [ ] Sourcing/Ingestion schemas created
- [ ] Seed data updated
- [ ] Documentation updated
- [ ] All existing tests pass

### Phase 1 Complete When:
- [ ] 10-20 real products processed through workflow
- [ ] No duplicate products in catalog
- [ ] Supplier intake working (CSV or manual)
- [ ] Fingerprint matching catching duplicates
- [ ] Review UI functional
- [ ] Catalog publication working
- [ ] SupplierOffer creation working
- [ ] AI content generation working

---

## Key Architectural Principles (Unchanged)

1. **Module ownership** - Each table/entity has exactly one owning module
2. **Explicit contracts** - Modules communicate through public APIs
3. **No shared entities** - ORM entities never cross module boundaries
4. **Composed queries** - ProductView combines Catalog and Commerce through composition layer
5. **Simple when possible** - Only introduce complexity when justified

---

## Confidence Assessment

**Confidence Level**: **HIGH**

**Rationale**:
1. Existing architecture is well-designed
2. New requirements fit naturally into existing structure
3. No refactoring needed, only additive changes
4. Modular monolith supports iterative development
5. Clear migration path from current state to target state

**Recommendation**: **PROCEED** with Phase 0, then Phase 1.

---

## References

- [ARCHITECTURE_REVIEW.md](ARCHITECTURE_REVIEW.md) - Detailed analysis
- [ER_MODEL.md](ER_MODEL.md) - Complete data model
- [ADR-006](006-product-workflow-architecture.md) - Product workflow architecture
- [ADR-007](007-ai-integration-strategy.md) - AI integration strategy
- [PHASE_0_PLAN.md](PHASE_0_PLAN.md) - Implementation plan

---

**Review Complete**: 2026-09-29  
**Status**: APPROVED FOR IMPLEMENTATION

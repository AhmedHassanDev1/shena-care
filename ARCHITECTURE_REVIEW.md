# Architecture Review: Product Workflow Integration

**Date**: 2026-09-29  
**Review Scope**: Alignment of existing modular monolith with new Product Workflow architecture decisions

## Executive Summary

The existing Product vertical slice provides a **strong foundation** that aligns well with the new architectural direction. The modular monolith is sound, boundaries are clean, and the catalog/commerce separation is correct. However, the current implementation focuses on **catalog publication** (the output), while the new architecture requires **product workflow** (the controlled input pipeline).

**Key Finding**: We need to **add** new modules and entities, not rebuild. The existing Catalog and Commerce modules remain intact and serve as the destination for the workflow.

---

## 1. What Already Aligns ✅

### 1.1 Modular Monolith Foundation
- ✅ **Clean module boundaries** with explicit `public.ts` APIs
- ✅ **Schema-per-context** (catalog, commerce) strategy established
- ✅ **Cross-context FKs** policy already documented and pragmatic
- ✅ **Composition layer** pattern working (ProductViewService)
- ✅ **TypeORM + PostgreSQL** stack suitable for workflow state

### 1.2 Catalog Ownership
The Catalog module correctly owns canonical product truth:
- ✅ Brand, Product, SKU, ProductMedia entities
- ✅ Product/SKU identity separation (not just barcodes)
- ✅ UUID-based stable identity
- ✅ Slug-based human-readable URLs
- ✅ `isPublished` flag (workflow gate)
- ✅ Public API enforces published-only access

**This is the destination**. Product Workflow will feed into Catalog, not replace it.

### 1.3 Commerce Ownership
- ✅ Listing and SellingPrice correctly separated from Catalog
- ✅ Commerce owns sellability, not product facts
- ✅ Cross-context FK to SKU (not Product) is correct
- ✅ Temporal pricing model (validFrom/validUntil) works

### 1.4 Architecture Documentation
- ✅ ADRs document key decisions
- ✅ Context ownership clearly defined
- ✅ Migration path considered
- ✅ No premature optimization (CQRS, event sourcing, microservices)

---

## 2. What Needs to Change 🔧

### 2.1 Missing: Product Workflow / Ingestion Module

**Current State**: No controlled gateway for product creation. If a supplier sends product data, there's no place to process it before Catalog publication.

**Required**: New **Ingestion** module as the workflow orchestrator.

**Location**: `apps/api/src/modules/ingestion/`

**Schema**: `ingestion.*` (parallel to catalog, commerce)

### 2.2 Missing: Sourcing Module

**Current State**: No Supplier or SupplierOffer entities exist.

**Required**: New **Sourcing** module to own supplier commercial relationships.

**Location**: `apps/api/src/modules/sourcing/`

**Schema**: `sourcing.*`

**Critical Relationship**:
```
SupplierOffer → SKU (not Product)
```
Multiple suppliers can offer the same SKU at different costs/availability.

### 2.3 Missing: Barcode/Identifier Table

**Current State**: SKU has ONE barcode field. This assumes barcodes are unique and stable.

**Reality**: 
- Same product may have different barcodes in different markets
- Barcode corrections require tracking history
- Multiple identifier types (EAN, UPC, supplier codes)

**Decision Needed**: 
- **Phase 0 (MVP)**: Keep `sku.barcode` as-is for simplicity
- **Phase 1**: Add `SKUBarcode` table when real supplier data reveals conflicts

### 2.4 Product Fingerprinting Not Implemented

**Current State**: No deduplication logic. Creating a duplicate product is not prevented.

**Required**: ProductFingerprint logic before and after enrichment.

### 2.5 No AI/Research Integration

**Current State**: No FastAPI service. No AI client in NestJS.

**Required**: 
- FastAPI service for AI workloads
- NestJS → FastAPI client
- Validation/persistence in NestJS

### 2.6 ProductMedia Lacks Origin Tracking

**Current State**: `ProductMedia` has `type` (image/video) but not `originType` (verified/generated).

**Required**: Distinguish supplier package photos from AI-generated lifestyle images.

---

## 3. Architectural Contradictions 🚨

### 3.1 None Found

The existing architecture does NOT contradict the new direction. It's **incomplete**, not wrong.

**Why This Matters**:
- No need to refactor Catalog
- No need to change Commerce
- No need to rebuild the database
- Workflow modules **extend** the system, they don't replace it

---

## 4. Recommended Module Boundaries

### 4.1 Proposed Module Structure

```
apps/api/src/modules/
├── catalog/           ✅ EXISTS - Canonical product truth
│   ├── entities/
│   │   ├── brand.entity.ts
│   │   ├── product.entity.ts
│   │   ├── sku.entity.ts
│   │   ├── product-media.entity.ts
│   │   └── (future) product-ingredient.entity.ts
│   ├── services/
│   │   └── catalog.service.ts
│   └── public.ts
│
├── commerce/          ✅ EXISTS - Sellability and pricing
│   ├── entities/
│   │   ├── listing.entity.ts
│   │   └── selling-price.entity.ts
│   ├── services/
│   │   └── commerce.service.ts
│   └── public.ts
│
├── ingestion/         ⚠️ NEW - Product workflow orchestration
│   ├── entities/
│   │   ├── intake-job.entity.ts
│   │   ├── source-artifact.entity.ts
│   │   ├── raw-supplier-item.entity.ts
│   │   ├── product-candidate.entity.ts
│   │   ├── candidate-evidence.entity.ts
│   │   ├── product-fingerprint.entity.ts
│   │   ├── candidate-match.entity.ts
│   │   ├── generated-content-version.entity.ts
│   │   ├── generated-media-asset.entity.ts
│   │   └── review-decision.entity.ts
│   ├── services/
│   │   ├── intake.service.ts
│   │   ├── normalization.service.ts
│   │   ├── fingerprint.service.ts
│   │   ├── matching.service.ts
│   │   ├── enrichment.service.ts
│   │   ├── content-generation.service.ts
│   │   └── review.service.ts
│   ├── clients/
│   │   └── ai.client.ts          # Calls FastAPI
│   └── public.ts
│
├── sourcing/          ⚠️ NEW - Supplier commercial relationships
│   ├── entities/
│   │   ├── supplier.entity.ts
│   │   └── supplier-offer.entity.ts
│   ├── services/
│   │   └── sourcing.service.ts
│   └── public.ts
│
└── (future modules)
    ├── fulfillment/   - Inventory, reservations
    ├── care/          - Customer profiles, routines
    ├── guidance/      - AI recommendations
    └── accounts/      - Identity, auth
```

### 4.2 Module Ownership Matrix

| Entity/Concept | Owner | Why |
|----------------|-------|-----|
| Brand | Catalog | Canonical brand identity |
| Product | Catalog | Canonical product identity |
| SKU | Catalog | Canonical variant identity |
| ProductMedia | Catalog | Published media assets |
| Ingredient | Catalog | Product composition facts |
| Listing | Commerce | Sellability policy |
| SellingPrice | Commerce | Customer-facing price |
| Supplier | Sourcing | Supplier master data |
| SupplierOffer | Sourcing | Commercial terms per SKU |
| IntakeJob | Ingestion | Workflow orchestration state |
| ProductCandidate | Ingestion | Pre-publication product data |
| ProductFingerprint | Ingestion | Deduplication logic |
| CandidateEvidence | Ingestion | Research provenance |
| GeneratedContent | Ingestion | AI-generated text |
| GeneratedMediaAsset | Ingestion | AI-generated images |
| ReviewDecision | Ingestion | Human review outcomes |

---

## 5. ER Model Analysis

### 5.1 Proposed Entities Review

**Catalog** (exists, minor additions):
- ✅ Brand
- ✅ Product
- ✅ ProductLine (⚠️ add if products have line grouping)
- ✅ Category (⚠️ add for taxonomy)
- ✅ SKU
- ⚠️ SKUBarcode (defer to Phase 1)
- ⚠️ Ingredient (add when formula data available)
- ⚠️ ProductIngredient (join table, add with Ingredient)
- ✅ ProductMedia (extend with `originType`)

**Ingestion** (new module):
- ✅ IntakeJob - YES, needed for batch tracking
- ✅ SourceArtifact - YES, retain raw input (CSV, image, API payload)
- ✅ RawSupplierItem - YES, one row per supplier item before normalization
- ✅ ProductCandidate - YES, normalized candidate before publishing
- ✅ CandidateEvidence - YES, research provenance
- ✅ ProductFingerprint - YES, versioned deduplication
- ✅ CandidateMatch - YES, link candidate to existing SKU
- ✅ GeneratedContentVersion - YES, AI-generated text (versioned)
- ✅ GeneratedMediaAsset - YES, AI-generated images (versioned)
- ✅ ReviewDecision - YES, human review outcomes

**Sourcing** (new module):
- ✅ Supplier - YES
- ✅ SupplierOffer - YES, FK to SKU

### 5.2 Over-Modeled Concerns

**Question**: Is this too many tables for MVP?

**Analysis**:
- IntakeJob, RawSupplierItem, ProductCandidate: **REQUIRED** for workflow state
- SourceArtifact: **OPTIONAL** for MVP (can store as JSON in IntakeJob)
- CandidateEvidence: **OPTIONAL** for MVP (can store as JSONB in ProductCandidate)
- ProductFingerprint: **REQUIRED** (core deduplication logic)
- CandidateMatch: **REQUIRED** (maps candidate → existing SKU)
- GeneratedContentVersion: **REQUIRED** (track AI output, enable regeneration)
- GeneratedMediaAsset: **REQUIRED** (distinguish verified vs generated media)
- ReviewDecision: **REQUIRED** (human review state)

**Recommendation**: The proposed ER model is **appropriately sized** for the workflow's complexity. Simplifications risk losing critical workflow state.

### 5.3 Missing Critical Concepts

**None identified**. The workflow covers:
- ✅ Raw input capture
- ✅ Normalization
- ✅ Fingerprinting
- ✅ Matching
- ✅ Research/enrichment
- ✅ Content generation
- ✅ Media generation
- ✅ Review
- ✅ Publication

---

## 6. Physical Tables vs Domain Concepts

### 6.1 Physical Tables Now (Phase 0-1)

**Catalog**:
- `catalog.brands`
- `catalog.products`
- `catalog.skus`
- `catalog.product_media` (extend with `origin_type`)
- `catalog.categories` (add now for taxonomy)
- `catalog.product_lines` (defer until needed)

**Commerce**:
- `commerce.listings`
- `commerce.selling_prices`

**Sourcing** (Phase 1):
- `sourcing.suppliers`
- `sourcing.supplier_offers`

**Ingestion** (Phase 1):
- `ingestion.intake_jobs`
- `ingestion.raw_supplier_items`
- `ingestion.product_candidates`
- `ingestion.product_fingerprints`
- `ingestion.candidate_matches`
- `ingestion.generated_content_versions`
- `ingestion.generated_media_assets`
- `ingestion.review_decisions`

**Defer**:
- `catalog.sku_barcodes` (use `skus.barcode` for now)
- `catalog.ingredients` (wait for formula data)
- `catalog.product_ingredients`
- `ingestion.source_artifacts` (store in `intake_jobs.raw_data JSONB`)
- `ingestion.candidate_evidence` (store in `product_candidates.evidence JSONB`)

### 6.2 Domain Concepts Only (No Table)

- **ProductFingerprint Algorithm**: Version the algorithm itself, but fingerprints are stored per candidate
- **Match Outcome Enum**: (EXACT_MATCH, LIKELY_MATCH, NO_MATCH, CONFLICT) - database enum
- **Workflow Stage**: State machine tracked in `product_candidates.workflow_stage`

---

## 7. Minimum Implementation for First 10-20 Products

### 7.1 Phase 0: ER Model + Catalog Extensions

**Goal**: Stabilize the data model before workflow implementation.

**Deliverables**:
1. Document final ER model (entities, relationships, ownership)
2. Add `catalog.categories` table
3. Extend `catalog.product_media` with `origin_type` field
4. Create migration for Phase 1 schemas (ingestion, sourcing)
5. Update ADRs with new architectural decisions

**Effort**: 1-2 days

### 7.2 Phase 1: Supplier Intake → Catalog Publication

**Goal**: Pilot the full workflow with 10-20 real products from one supplier.

**Simplified First Pass**:

```
Supplier CSV/Manual Entry
  ↓
RawSupplierItem (capture)
  ↓
ProductCandidate (normalize)
  ↓
ProductFingerprint (deduplicate)
  ↓
CandidateMatch (existing SKU or new?)
  ↓
IF NEW:
  ├─ Manual Research (human fills facts)
  ├─ AI Content Generation (title, description)
  ├─ Manual Review
  └─ Publish → Catalog (Product/SKU)
  ↓
SupplierOffer creation (link to SKU)
```

**Simplified Workflow** (skip for MVP):
- ❌ Automated research/scraping (manual for first 20 products)
- ❌ AI media generation (use supplier photos only)
- ❌ CandidateEvidence table (store provenance as JSONB)
- ❌ Second fingerprint pass (one pass before review)

**Core Implementation**:
- ✅ Sourcing module (Supplier, SupplierOffer)
- ✅ Ingestion intake (IntakeJob, RawSupplierItem)
- ✅ Normalization service
- ✅ Fingerprint service (brand + name + size matching)
- ✅ Matching service (find existing SKU)
- ✅ ProductCandidate entity + basic workflow state machine
- ✅ Manual review UI (simple admin form)
- ✅ Catalog publication service (ProductCandidate → Product/SKU)
- ✅ SupplierOffer creation after publication

**Effort**: 2-3 weeks

### 7.3 Phase 1.5: AI Content Generation

**Goal**: Generate store-facing content from canonical facts.

**Implementation**:
- FastAPI service for AI workloads
- NestJS AI client
- GeneratedContentVersion entity
- Content generation service
- Regeneration support (when facts or style changes)

**Effort**: 1 week

### 7.4 Phase 2: E-commerce (Cart, Checkout, Order)

**Note**: Guest checkout is approved UX decision, so don't force authentication.

---

## 8. Changes Needed to Catalog/Commerce Vertical Slice

### 8.1 Catalog Changes

**Schema Changes**:
```sql
-- Add origin tracking to product_media
ALTER TABLE catalog.product_media 
  ADD COLUMN origin_type VARCHAR NOT NULL DEFAULT 'verified'
  CHECK (origin_type IN ('verified', 'generated', 'derived'));

ALTER TABLE catalog.product_media
  ADD COLUMN generation_metadata JSONB;

-- Add categories table
CREATE TABLE catalog.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR NOT NULL,
  slug VARCHAR NOT NULL UNIQUE,
  parent_id UUID REFERENCES catalog.categories(id),
  description TEXT,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

-- Add category to products
ALTER TABLE catalog.products
  ADD COLUMN category_id UUID REFERENCES catalog.categories(id);
```

**Entity Changes**:
```typescript
// product-media.entity.ts
export enum MediaOriginType {
  VERIFIED = 'verified',    // Supplier/manufacturer photo
  GENERATED = 'generated',  // AI-generated
  DERIVED = 'derived'       // Processed from verified
}

@Column({ 
  type: 'enum', 
  enum: MediaOriginType,
  default: MediaOriginType.VERIFIED 
})
originType: MediaOriginType;

@Column({ type: 'jsonb', nullable: true })
generationMetadata: {
  model?: string;
  promptVersion?: string;
  generatedAt?: string;
  sourceMediaId?: string;
} | null;
```

**Service Changes**:
- No breaking changes to public API
- Internal creation methods accept `originType`

### 8.2 Commerce Changes

**No changes required**. Commerce already correctly:
- References SKU (not Product)
- Owns sellability logic
- Separates from catalog facts

### 8.3 Composition Layer Changes

**No changes required**. ProductView continues to compose Catalog + Commerce.

Future: Add Sourcing availability when that module exists.

---

## 9. Recommendations

### 9.1 Immediate Actions (This Week)

1. **Create ER diagram** showing all entities, relationships, and ownership
2. **Write ADR-006: Product Workflow Architecture**
3. **Write ADR-007: Ingestion Module Responsibilities**
4. **Write ADR-008: AI Integration Strategy (FastAPI)**
5. **Update README** with new architecture vision

### 9.2 Phase 0 Scope (Next 1-2 Weeks)

**Goal**: Data model stabilization

- [ ] Add `catalog.categories` migration
- [ ] Extend `catalog.product_media` with origin tracking
- [ ] Create `sourcing.*` schema stub
- [ ] Create `ingestion.*` schema stub
- [ ] Seed categories (Cleansers, Moisturizers, Serums, Sunscreens, etc.)
- [ ] Update existing seed data with category assignments

### 9.3 Phase 1 Scope (Next 3-4 Weeks)

**Goal**: First 10-20 products through controlled workflow

- [ ] Implement Sourcing module (Supplier, SupplierOffer)
- [ ] Implement Ingestion module (simplified workflow)
- [ ] Build supplier intake form (CSV or manual entry)
- [ ] Implement fingerprint matching
- [ ] Build review UI for ProductCandidates
- [ ] Implement Catalog publication from approved candidates
- [ ] Test with 10-20 real products

### 9.4 Explicitly Defer

- Redis caching
- Elasticsearch
- Kafka/event bus
- CQRS framework
- Microservices extraction
- Advanced AI research/scraping
- Automated media generation
- Barcode conflict resolution (use single barcode field for MVP)

---

## 10. Risk Assessment

### 10.1 Low Risk ✅

- Module boundaries are clean
- Existing code continues to work
- Additive changes (new modules, not refactoring)
- Product Workflow can be built iteratively

### 10.2 Medium Risk ⚠️

- **Complexity**: Product Workflow adds significant business logic
- **AI Integration**: FastAPI + NestJS coordination needs careful design
- **Data Volume**: 10-20 products is manageable, but state machine complexity increases
- **Review UX**: Human review UI needs to be intuitive

### 10.3 Mitigation Strategies

1. **Build incrementally**: Start with manual steps, automate later
2. **Pilot with small dataset**: 10-20 products reveals workflow issues
3. **Clear state machine**: Document ProductCandidate workflow states
4. **Preserve raw data**: Always keep SourceArtifact/RawSupplierItem
5. **Idempotent operations**: Fingerprint/matching should be repeatable

---

## 11. Conclusion

The existing architecture is **fundamentally sound** and aligns well with the new Product Workflow vision. The current Catalog and Commerce modules serve as the correct destination for workflow output.

**Key Insight**: This is an **evolution**, not a revolution. We're adding controlled input (Ingestion) to an already-correct output (Catalog).

**Next Steps**:
1. Finalize ER model
2. Document workflow in ADRs
3. Implement Phase 0 (data model extensions)
4. Build Phase 1 (simplified workflow with manual steps)
5. Pilot with real supplier data
6. Iterate based on learnings

**Confidence Level**: HIGH. The modular monolith is well-designed, and the new requirements fit naturally into the existing structure.

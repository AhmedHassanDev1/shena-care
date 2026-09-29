# Product Workflow Architecture - Visual Overview

**Date**: 2026-09-29

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        NEXT.JS FRONTEND                          │
│                     (Customer Experience)                        │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│                   NESTJS MODULAR MONOLITH                        │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │   CATALOG    │  │   COMMERCE   │  │   SOURCING   │         │
│  │              │  │              │  │              │         │
│  │ • Brand      │  │ • Listing    │  │ • Supplier   │         │
│  │ • Product    │  │ • Selling    │  │ • Supplier   │         │
│  │ • SKU        │  │   Price      │  │   Offer      │         │
│  │ • Category   │  │              │  │              │         │
│  │ • Media      │  │ Owns:        │  │ Owns:        │         │
│  │              │  │ Sellability  │  │ Commercial   │         │
│  │ Owns:        │  │              │  │ Terms        │         │
│  │ Canonical    │  └──────────────┘  └──────────────┘         │
│  │ Product      │                                               │
│  │ Truth        │  ┌──────────────────────────────────────┐   │
│  └──────────────┘  │        INGESTION                     │   │
│                    │   (Product Workflow Gateway)         │   │
│                    │                                      │   │
│                    │ • IntakeJob                          │   │
│                    │ • RawSupplierItem                    │   │
│                    │ • ProductCandidate                   │   │
│                    │ • ProductFingerprint                 │   │
│                    │ • CandidateMatch                     │   │
│                    │ • GeneratedContentVersion            │   │
│                    │ • ReviewDecision                     │   │
│                    │                                      │   │
│                    │ Owns:                                │   │
│                    │ Workflow Orchestration               │   │
│                    │ Deduplication                        │   │
│                    │ AI Enrichment Coordination           │   │
│                    └───────────────┬──────────────────────┘   │
│                                    │ HTTP                      │
└────────────────────────────────────┼───────────────────────────┘
                                     ↓
                          ┌──────────────────┐
                          │  FASTAPI SERVICE │
                          │                  │
                          │ • LLM Calls      │
                          │ • Extraction     │
                          │ • Generation     │
                          │ • Embeddings     │
                          │                  │
                          │ Owns:            │
                          │ AI Computation   │
                          └──────────────────┘
```

---

## Product Workflow Pipeline

```
┌──────────────────────────────────────────────────────────────────┐
│ INPUT SOURCES                                                    │
├──────────────────────────────────────────────────────────────────┤
│ • Supplier CSV/API                                               │
│ • Package Image (OCR)                                            │
│ • Barcode Scanner                                                │
│ • Manual Admin Entry                                             │
└────────────────────────┬─────────────────────────────────────────┘
                         ↓
        ┌────────────────────────────────────┐
        │  INTAKE & NORMALIZATION            │
        │  (Ingestion Module)                │
        │                                    │
        │  IntakeJob                         │
        │    ↓                               │
        │  RawSupplierItem                   │
        │    ↓                               │
        │  Normalize: brand, name, size      │
        │    ↓                               │
        │  ProductCandidate                  │
        └────────────────┬───────────────────┘
                         ↓
        ┌────────────────────────────────────┐
        │  FINGERPRINTING (FIRST PASS)       │
        │                                    │
        │  Generate ProductFingerprint       │
        │  hash(brand + name + size + unit)  │
        │                                    │
        │  Match against:                    │
        │  • Existing SKUs in Catalog        │
        │  • Other candidates in batch       │
        └────────────────┬───────────────────┘
                         ↓
                    ┌────────┐
                    │ Match? │
                    └───┬────┘
         ┌──────────────┼──────────────┐
         │ EXACT        │ NO MATCH     │ CONFLICT
         ↓              ↓              ↓
   ┌─────────┐   ┌─────────────┐  ┌──────────┐
   │ Update  │   │  RESEARCH   │  │  HUMAN   │
   │Supplier │   │     &       │  │  REVIEW  │
   │ Offer   │   │ ENRICHMENT  │  │ REQUIRED │
   │         │   └──────┬──────┘  └──────────┘
   └─────────┘          ↓
                ┌───────────────────────────┐
                │ Research Trusted Sources  │
                │ • Manufacturer website    │
                │ • Verified packaging      │
                │ • Trusted retailers       │
                │                           │
                │ Extract Canonical Facts   │
                │ Store Provenance          │
                └──────────┬────────────────┘
                           ↓
                ┌───────────────────────────┐
                │ AI CONTENT GENERATION     │
                │ (via FastAPI)             │
                │                           │
                │ Generate:                 │
                │ • Customer-facing title   │
                │ • Short description       │
                │ • Long description        │
                │ • Benefits copy           │
                │ • Usage instructions      │
                │ • SEO content             │
                │                           │
                │ Track: model + prompt ver │
                └──────────┬────────────────┘
                           ↓
                ┌───────────────────────────┐
                │ FINGERPRINTING (2ND PASS) │
                │                           │
                │ Re-run with research-     │
                │ revealed facts            │
                │                           │
                │ Catch late duplicates     │
                └──────────┬────────────────┘
                           ↓
                    ┌──────────┐
                    │ Review   │
                    │ Needed?  │
                    └────┬─────┘
              ┌──────────┴──────────┐
              │ YES                 │ NO
              ↓                     ↓
       ┌─────────────┐       ┌─────────────┐
       │   HUMAN     │       │    AUTO     │
       │   REVIEW    │       │   PUBLISH   │
       │             │       │             │
       │ • Approve   │       │ Confidence  │
       │ • Reject    │       │ > 0.90      │
       │ • Revise    │       │ No conflict │
       └──────┬──────┘       └──────┬──────┘
              └──────────┬───────────┘
                         ↓
              ┌──────────────────────────┐
              │ CATALOG PUBLICATION      │
              │ (Catalog Module)         │
              │                          │
              │ Create:                  │
              │ • Product                │
              │ • SKU                    │
              │ • ProductMedia           │
              │                          │
              │ Set: isPublished = true  │
              └──────────┬───────────────┘
                         ↓
              ┌──────────────────────────┐
              │ SOURCING                 │
              │ (Sourcing Module)        │
              │                          │
              │ Create/Update:           │
              │ • SupplierOffer          │
              │ • Link to SKU            │
              └──────────────────────────┘
                         ↓
              ┌──────────────────────────┐
              │ CUSTOMER-VISIBLE         │
              │ Product available in     │
              │ catalog with price       │
              └──────────────────────────┘
```

---

## Database Schema Organization

```
┌─────────────────────────────────────────────────────────────────┐
│                     POSTGRESQL DATABASE                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  catalog.*                          ✅ IMPLEMENTED + EXTENSIONS  │
│  ├── brands                                                      │
│  ├── categories                     ⚠️ ADD IN PHASE 0            │
│  ├── products                                                    │
│  ├── skus                                                        │
│  └── product_media                  ⚠️ EXTEND IN PHASE 0         │
│       └── + origin_type                                          │
│       └── + generation_metadata                                  │
│                                                                  │
│  commerce.*                         ✅ IMPLEMENTED               │
│  ├── listings                                                    │
│  └── selling_prices                                              │
│                                                                  │
│  sourcing.*                         🚧 CREATE IN PHASE 0         │
│  ├── suppliers                      🔨 IMPLEMENT IN PHASE 1      │
│  └── supplier_offers                                             │
│                                                                  │
│  ingestion.*                        🚧 CREATE IN PHASE 0         │
│  ├── intake_jobs                    🔨 IMPLEMENT IN PHASE 1      │
│  ├── raw_supplier_items                                          │
│  ├── product_candidates                                          │
│  ├── product_fingerprints                                        │
│  ├── candidate_matches                                           │
│  ├── generated_content_versions                                  │
│  ├── generated_media_assets                                      │
│  └── review_decisions                                            │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘

Legend:
✅ Implemented      ⚠️ Extend/Modify      🚧 Create Schema      🔨 Implement Logic
```

---

## Module Ownership Matrix

```
┌──────────────────────┬──────────────┬────────────────────────────┐
│ Entity/Concept       │ Owner        │ Responsibility             │
├──────────────────────┼──────────────┼────────────────────────────┤
│ Brand                │ Catalog      │ Brand master data          │
│ Category             │ Catalog      │ Product taxonomy           │
│ Product              │ Catalog      │ Canonical product identity │
│ SKU                  │ Catalog      │ Canonical variant identity │
│ ProductMedia         │ Catalog      │ Published media assets     │
├──────────────────────┼──────────────┼────────────────────────────┤
│ Listing              │ Commerce     │ Sellability policy         │
│ SellingPrice         │ Commerce     │ Customer-facing price      │
├──────────────────────┼──────────────┼────────────────────────────┤
│ Supplier             │ Sourcing     │ Supplier master data       │
│ SupplierOffer        │ Sourcing     │ Commercial terms per SKU   │
├──────────────────────┼──────────────┼────────────────────────────┤
│ IntakeJob            │ Ingestion    │ Bulk import tracking       │
│ RawSupplierItem      │ Ingestion    │ Pre-normalization data     │
│ ProductCandidate     │ Ingestion    │ Pre-publication candidate  │
│ ProductFingerprint   │ Ingestion    │ Deduplication hash         │
│ CandidateMatch       │ Ingestion    │ Duplicate detection result │
│ GeneratedContent     │ Ingestion    │ AI-generated text versions │
│ GeneratedMediaAsset  │ Ingestion    │ AI-generated images        │
│ ReviewDecision       │ Ingestion    │ Human review outcome       │
└──────────────────────┴──────────────┴────────────────────────────┘
```

---

## Key Relationships

```
┌─────────────────────────────────────────────────────────────────┐
│ WITHIN-CONTEXT RELATIONSHIPS                                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Brand 1:N Product                                               │
│  Category 1:N Product                                            │
│  Product 1:N SKU                                                 │
│  Product 1:N ProductMedia                                        │
│                                                                  │
│  Supplier 1:N SupplierOffer                                      │
│                                                                  │
│  IntakeJob 1:N RawSupplierItem                                   │
│  RawSupplierItem 1:1 ProductCandidate                            │
│  ProductCandidate 1:1 ProductFingerprint                         │
│  ProductCandidate 1:N CandidateMatch                             │
│  ProductCandidate 1:N GeneratedContentVersion                    │
│  ProductCandidate 1:N ReviewDecision                             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ CROSS-CONTEXT FOREIGN KEYS (Documented Exceptions)             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  commerce.listings.sku_id → catalog.skus.id                      │
│  commerce.selling_prices.sku_id → catalog.skus.id                │
│  sourcing.supplier_offers.sku_id → catalog.skus.id               │
│  ingestion.candidate_matches.matched_sku_id → catalog.skus.id    │
│                                                                  │
│  Constraints:                                                    │
│  • NO cascade deletes                                            │
│  • IDs are stable UUIDs                                          │
│  • Mutations go through owner's API                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Critical Design Rules

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Product ≠ SKU                                                │
│    Product = "CeraVe Moisturizing Cream"                        │
│    SKU = "6 oz Jar" | "19 oz Tub" | "12 oz Pump"               │
├─────────────────────────────────────────────────────────────────┤
│ 2. SupplierOffer → SKU (not Product)                            │
│    Suppliers offer specific variants, not abstract products     │
├─────────────────────────────────────────────────────────────────┤
│ 3. Barcode is an Identifier, NOT Primary Key                    │
│    Barcodes can change, conflict, or be missing                 │
├─────────────────────────────────────────────────────────────────┤
│ 4. Ingestion is the ONLY Gateway                                │
│    No direct Product/SKU creation from suppliers                │
├─────────────────────────────────────────────────────────────────┤
│ 5. FastAPI Does NOT Mutate State                                │
│    NestJS orchestrates, validates, and persists                 │
├─────────────────────────────────────────────────────────────────┤
│ 6. Generated Content ≠ Truth                                    │
│    AI-generated text derives from canonical facts               │
├─────────────────────────────────────────────────────────────────┤
│ 7. Customer Never Sees Suppliers                                │
│    Sourcing is internal; customer sees unified catalog          │
└─────────────────────────────────────────────────────────────────┘
```

---

## Implementation Timeline

```
PHASE 0: ER Model Stabilization (1-2 weeks) 🚧 CURRENT
├─ Add Category entity
├─ Extend ProductMedia with origin tracking
├─ Create Sourcing schema stub
├─ Create Ingestion schema stub
├─ Update seed data
└─ Update documentation

PHASE 1: Product Workflow MVP (2-3 weeks)
├─ Implement Sourcing module
│  ├─ Supplier entity and service
│  └─ SupplierOffer entity and service
├─ Implement Ingestion module
│  ├─ Intake service (CSV/manual)
│  ├─ Normalization service
│  ├─ Fingerprint service
│  ├─ Matching service
│  ├─ Enrichment service (AI client)
│  └─ Review service
├─ Build admin UI
│  ├─ Supplier intake form
│  └─ Candidate review interface
├─ Deploy FastAPI service
│  ├─ Extraction endpoint
│  └─ Generation endpoint
└─ Pilot with 10-20 real products

PHASE 1.5: AI Content Generation (1 week)
├─ GeneratedContentVersion tracking
├─ Content regeneration support
└─ Prompt versioning

PHASE 2: E-commerce Core (2-3 weeks)
├─ Cart
├─ Checkout (Guest checkout approved)
├─ Order management
└─ Customer order view

PHASE 3+: Fulfillment, Care, Guidance (Future)
```

---

## Review Status

```
┌─────────────────────────────────────────────────────────────────┐
│ ARCHITECTURE REVIEW: ✅ APPROVED                                 │
├─────────────────────────────────────────────────────────────────┤
│ Date: 2026-09-29                                                │
│ Reviewer: Claude Opus 5                                         │
│ Confidence: HIGH                                                │
│                                                                  │
│ Findings:                                                       │
│ ✅ Existing architecture is sound                                │
│ ✅ No contradictions with new requirements                       │
│ ✅ No rebuild needed, only additive changes                      │
│ ✅ Clear implementation path                                     │
│ ✅ Risks are manageable                                          │
│                                                                  │
│ Recommendation: PROCEED with confidence 🚀                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## Quick Reference

**Key Documents**:
- [ARCHITECTURE_REVIEW_SUMMARY.md](ARCHITECTURE_REVIEW_SUMMARY.md) - Start here
- [PHASE_0_PLAN.md](docs/architecture/PHASE_0_PLAN.md) - Implementation checklist
- [ER_MODEL.md](docs/architecture/ER_MODEL.md) - Complete data model
- [ADR-006](docs/architecture/006-product-workflow-architecture.md) - Workflow details
- [ADR-007](docs/architecture/007-ai-integration-strategy.md) - AI integration

**Module Public APIs**:
- Catalog: `getPublishedProduct()`, `getPublishedSku()`, `validateSku()`
- Commerce: `getSellingTerms()`, `evaluateSellability()`
- Sourcing: TBD in Phase 1
- Ingestion: TBD in Phase 1

**Cross-Context Rules**:
- No ORM navigation across contexts
- No repository sharing
- Mutations through owner's API only
- Documented FKs only

---

**Last Updated**: 2026-09-29

# ADR-006: Product Workflow Architecture

**Status**: Accepted  
**Date**: 2026-09-29

## Context

Products entering the Shena Care catalog come from multiple sources:
- Supplier product lists (CSV, API)
- Package image scanning (OCR)
- Barcode lookup
- Manual admin entry

Without a controlled workflow, we face several problems:
- **Duplicate products** created by different suppliers for the same item
- **Inconsistent data quality** (missing facts, unverified claims)
- **No provenance** (where did this information come from?)
- **Manual effort** duplicated across similar products
- **Safety risk** (unverified warnings, hallucinated ingredients)

We need a **controlled gateway** that ensures every product is:
1. Normalized
2. Deduplicated
3. Researched
4. Enriched with generated content
5. Reviewed (when needed)
6. Published to Catalog only when ready

## Decision

We implement a **Product Workflow** architecture with a new **Ingestion** module that serves as the **only** path for creating catalog products.

### Core Principles

1. **No Direct Catalog Creation**  
   Suppliers, barcodes, and package images do NOT directly create `catalog.products` or `catalog.skus`. They create candidates that flow through the workflow.

2. **Workflow is the Gateway**  
   ```
   Raw Input → Ingestion → ProductCandidate → Workflow → Catalog Publication
   ```

3. **Deduplication Before Enrichment**  
   Run fingerprint matching early to avoid expensive AI work on duplicates.

4. **Double Deduplication**  
   - First pass: before research (cheap, fast)
   - Second pass: after enrichment (catches research-revealed identity)

5. **Provenance Matters**  
   Track where facts came from (manufacturer site, verified packaging, trusted retailer).

6. **Generated Content ≠ Truth**  
   AI-generated descriptions are derived from canonical facts, not sources of truth themselves.

7. **Human Review for Ambiguity**  
   Automatic publication when confidence is high; human review for conflicts, low confidence, or safety-sensitive claims.

### Workflow Stages

```
┌─────────────────────────────────────────────────────────────┐
│ RAW INPUT                                                   │
│ • Supplier CSV/API                                          │
│ • Package Image (OCR)                                       │
│ • Barcode Scan                                              │
│ • Manual Entry                                              │
└────────────────────────┬────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│ INTAKE & NORMALIZATION                                      │
│ • Create IntakeJob                                          │
│ • Parse raw data → RawSupplierItem                          │
│ • Normalize brand, name, size, unit                         │
│ • Create ProductCandidate                                   │
└────────────────────────┬────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│ FINGERPRINTING (FIRST PASS)                                 │
│ • Generate ProductFingerprint                               │
│ • Hash: brand + name + size + unit + barcode                │
│ • Match against existing SKUs                               │
│ • Match against other candidates in this batch              │
└────────────────────────┬────────────────────────────────────┘
                         ↓
                    ┌────┴────┐
                    │ Match?  │
                    └────┬────┘
           ┌─────────────┼─────────────┐
           │ EXACT       │ NO MATCH    │ CONFLICT
           ↓             ↓             ↓
   ┌───────────┐  ┌──────────────┐  ┌──────────────┐
   │ Update    │  │ RESEARCH &   │  │ HUMAN        │
   │ Supplier  │  │ ENRICHMENT   │  │ REVIEW       │
   │ Offer     │  │              │  │ REQUIRED     │
   └───────────┘  └──────┬───────┘  └──────────────┘
                         ↓
                  ┌─────────────────────────────────┐
                  │ • Research trusted sources      │
                  │ • Extract canonical facts       │
                  │ • Store provenance (Evidence)   │
                  │ • Collect verified media        │
                  └──────┬──────────────────────────┘
                         ↓
                  ┌─────────────────────────────────┐
                  │ CONTENT GENERATION              │
                  │ • Generate customer-facing text │
                  │ • Generate product title        │
                  │ • Generate descriptions         │
                  │ • Generate SEO content          │
                  │ • Version: model + prompt       │
                  └──────┬──────────────────────────┘
                         ↓
                  ┌─────────────────────────────────┐
                  │ MEDIA GENERATION (Future)       │
                  │ • Generate hero images          │
                  │ • Generate lifestyle visuals    │
                  │ • Tag as generated              │
                  └──────┬──────────────────────────┘
                         ↓
                  ┌─────────────────────────────────┐
                  │ FINGERPRINTING (SECOND PASS)    │
                  │ • Re-run fingerprint with       │
                  │   research-revealed facts       │
                  │ • Catch late duplicates         │
                  └──────┬──────────────────────────┘
                         ↓
                    ┌────┴────┐
                    │ Review  │
                    │ Needed? │
                    └────┬────┘
                ┌────────┴────────┐
                │ YES             │ NO
                ↓                 ↓
         ┌─────────────┐   ┌─────────────┐
         │ HUMAN       │   │ AUTO        │
         │ REVIEW      │   │ PUBLISH     │
         └──────┬──────┘   └──────┬──────┘
                └────────┬─────────┘
                         ↓
                  ┌─────────────────────────────────┐
                  │ CATALOG PUBLICATION             │
                  │ • Create Product                │
                  │ • Create SKU                    │
                  │ • Create ProductMedia           │
                  │ • Set isPublished = true        │
                  └──────┬──────────────────────────┘
                         ↓
                  ┌─────────────────────────────────┐
                  │ SOURCING                        │
                  │ • Create/Update SupplierOffer   │
                  │ • Link to SKU                   │
                  └─────────────────────────────────┘
```

### Module Responsibilities

#### Ingestion Module (`ingestion.*`)

**Owns**:
- IntakeJob
- RawSupplierItem
- ProductCandidate
- ProductFingerprint
- CandidateMatch
- CandidateEvidence
- GeneratedContentVersion
- GeneratedMediaAsset
- ReviewDecision

**Responsibilities**:
- Intake coordination
- Normalization
- Fingerprinting and deduplication
- Research orchestration
- AI enrichment
- Review workflow
- Publication to Catalog (through Catalog's API)

**Does NOT Own**:
- Final Product/SKU (owned by Catalog)
- SupplierOffer (owned by Sourcing)

#### Catalog Module (`catalog.*`)

**Owns**:
- Brand, Product, SKU, ProductMedia
- Canonical product truth

**Responsibilities**:
- Publish Product/SKU from approved candidates
- Validate published data quality
- Serve published products to customers

**Does NOT Own**:
- Workflow state
- Candidate processing
- AI-generated content versions (Ingestion owns versions, Catalog receives final approved content)

#### Sourcing Module (`sourcing.*`)

**Owns**:
- Supplier
- SupplierOffer

**Responsibilities**:
- Create/update SupplierOffer after SKU publication
- Link suppliers to SKUs
- Track supplier cost and availability

**Does NOT Own**:
- Product/SKU creation (Catalog owns)
- Workflow (Ingestion owns)

### Review Triggers

**Automatic Publication** when:
- Exact match to existing SKU (only update SupplierOffer)
- High confidence (> 0.90)
- No conflicting signals
- No safety-sensitive claims
- Category is low-risk (e.g., basic moisturizer)

**Human Review Required** when:
- Match result is `CONFLICT`
- Confidence score < 0.90
- Safety warnings present
- Ingredient list differs from manufacturer source
- Barcode matches but size/variant differs
- Category is high-risk (e.g., retinol, chemical exfoliant)

### AI Integration Strategy

**FastAPI Service** for:
- Structured extraction from research sources
- Product content generation
- Image generation (future)
- Embedding/similarity calculations (future)

**NestJS Ingestion Module** for:
- Workflow orchestration
- State management
- Validation
- Persistence
- Business rules

**Flow**:
```
NestJS Ingestion
  → HTTP call to FastAPI
  → FastAPI returns structured JSON
  → NestJS validates
  → NestJS persists to database
```

**Important**: FastAPI does NOT mutate catalog/commerce/sourcing state directly.

## Consequences

### Positive

- **No Duplicates**: Fingerprint matching catches duplicate products before catalog publication
- **Data Quality**: Research and enrichment ensure consistent, high-quality product data
- **Provenance**: Track where facts came from for audit and regeneration
- **Regenerable Content**: Content is versioned; can regenerate when facts or style changes
- **Safety**: Human review for safety-sensitive products
- **Scalability**: AI enrichment enables processing large supplier catalogs
- **Efficiency**: Deduplication before research avoids expensive AI work on duplicates

### Negative

- **Complexity**: Multi-stage workflow adds coordination overhead
- **Latency**: Products don't appear instantly; workflow takes time
- **AI Costs**: Content generation and research have per-product costs
- **Review Burden**: High-confidence products still need occasional spot checks
- **State Management**: Workflow state machine requires careful implementation

### Risks

1. **Workflow Bottlenecks**: Review backlog could delay product availability
   - *Mitigation*: High automatic approval rate for low-risk products

2. **AI Hallucination**: Generated content could invent false claims
   - *Mitigation*: Content derives from canonical facts; facts require provenance

3. **Fingerprint False Positives**: Incorrect duplicate detection
   - *Mitigation*: Conflict detection + human review

4. **Research Quality**: Scraped data could be incorrect
   - *Mitigation*: Prioritize manufacturer sources; track confidence scores

## Alternatives Considered

### Direct Catalog Creation

**Rejected**: Suppliers create Product/SKU directly, deduplication happens later.

**Why**: Duplicates pollute catalog, customer sees inconsistent products, cleanup is expensive.

### Event-Driven Workflow

**Rejected**: Use Kafka/RabbitMQ for workflow coordination.

**Why**: Unnecessary complexity for modular monolith. Use direct service calls and database state.

### Manual-Only Workflow

**Rejected**: No AI enrichment, all products require full manual entry.

**Why**: Doesn't scale. Large supplier catalogs would require massive manual effort.

### AI-Only Workflow

**Rejected**: Full automation, no human review.

**Why**: Safety risk. Beauty products have regulatory requirements and safety concerns.

## Implementation Notes

### Phase 0: ER Model Stabilization

- Document entities and relationships
- Create database migrations
- No workflow logic yet

### Phase 1: Manual Workflow with AI Content

**Simplified first pass**:
- Supplier intake creates RawSupplierItem
- Normalization creates ProductCandidate
- Fingerprint matching (one pass)
- **Manual research** (human fills facts)
- AI content generation (title, description)
- Manual review (admin UI)
- Catalog publication
- SupplierOffer creation

**Skip for MVP**:
- Automated research/scraping
- Second fingerprint pass
- AI media generation
- CandidateEvidence separate table (use JSONB)

**Duration**: 2-3 weeks  
**Pilot**: 10-20 real products

### Phase 2: Automated Research

- Research service scrapes trusted sources
- Evidence storage with confidence scoring
- Second fingerprint pass after research
- Provenance tracking

### Phase 3: AI Media Generation

- Generate hero images from verified package photos
- Generate lifestyle visuals
- Track generation metadata

## Success Criteria

1. **No duplicate products** in catalog after workflow implementation
2. **80%+ automatic approval rate** for low-risk products
3. **<5 minutes review time** for products requiring human review
4. **Regenerable content** (can re-run content generation when style changes)
5. **Provenance tracking** for all canonical facts
6. **Zero safety incidents** from missing/incorrect warnings

## References

- ADR-002: Context Ownership
- ADR-003: Product and SKU Identity
- ER_MODEL.md: Complete entity definitions
- ARCHITECTURE_REVIEW.md: Alignment analysis

# Entity-Relationship Model

**Last Updated**: 2026-09-29  
**Status**: Phase 0 - Stabilization

## Overview

This document defines the complete ER model for Shena Care, organized by business context ownership. The model supports the Product Workflow architecture where products flow through a controlled pipeline before publication to the Catalog.

---

## Ownership Summary

| Context | Owns | Purpose |
|---------|------|---------|
| **Catalog** | Canonical product truth | What is this product/SKU? |
| **Commerce** | Sellability and pricing | Can we sell this SKU and at what price? |
| **Sourcing** | Supplier relationships | Where can we obtain this SKU? |
| **Ingestion** | Product workflow | How do products enter the catalog? |

---

## 1. Catalog Context

**Schema**: `catalog.*`  
**Responsibility**: Canonical product identity and facts

### 1.1 Entities

#### Brand
```
catalog.brands
├── id                UUID PRIMARY KEY
├── name              VARCHAR UNIQUE NOT NULL
├── slug              VARCHAR UNIQUE NOT NULL
├── description       TEXT
├── logo_url          VARCHAR
├── website_url       VARCHAR
├── is_active         BOOLEAN DEFAULT true
├── created_at        TIMESTAMP
└── updated_at        TIMESTAMP
```

**Purpose**: Brand master data (CeraVe, La Roche-Posay, The Ordinary)

**Relationships**:
- `1:N → Product`

---

#### Category
```
catalog.categories
├── id                UUID PRIMARY KEY
├── name              VARCHAR NOT NULL
├── slug              VARCHAR UNIQUE NOT NULL
├── parent_id         UUID REFERENCES categories(id)
├── description       TEXT
├── sort_order        INTEGER DEFAULT 0
├── is_active         BOOLEAN DEFAULT true
├── created_at        TIMESTAMP
└── updated_at        TIMESTAMP
```

**Purpose**: Product taxonomy (Cleansers, Moisturizers, Serums, Sunscreens)

**Relationships**:
- `1:N → Product`
- `N:1 → Category` (self-referencing for hierarchy)

**Examples**:
- Cleansers
  - Foaming Cleansers
  - Oil Cleansers
- Moisturizers
  - Face Creams
  - Body Lotions

---

#### ProductLine
```
catalog.product_lines
├── id                UUID PRIMARY KEY
├── brand_id          UUID REFERENCES brands(id) NOT NULL
├── name              VARCHAR NOT NULL
├── slug              VARCHAR UNIQUE NOT NULL
├── description       TEXT
├── is_active         BOOLEAN DEFAULT true
├── created_at        TIMESTAMP
└── updated_at        TIMESTAMP
```

**Purpose**: Brand sub-collections (CeraVe Hydrating Line, CeraVe Foaming Line)

**Status**: **DEFERRED** until product lines are needed

**Relationships**:
- `N:1 → Brand`
- `1:N → Product`

---

#### Product
```
catalog.products
├── id                UUID PRIMARY KEY
├── brand_id          UUID REFERENCES brands(id) NOT NULL
├── category_id       UUID REFERENCES categories(id)
├── product_line_id   UUID REFERENCES product_lines(id)
├── name              VARCHAR NOT NULL
├── slug              VARCHAR UNIQUE NOT NULL
├── description       TEXT
├── usage             TEXT
├── warnings          TEXT
├── is_published      BOOLEAN DEFAULT true
├── created_at        TIMESTAMP
└── updated_at        TIMESTAMP
```

**Purpose**: Customer-facing product identity (e.g., "CeraVe Moisturizing Cream")

**Key Rules**:
- Only published products are customer-visible
- Product is size/variant-agnostic
- Slug provides stable URL identity
- One product → multiple SKUs

**Relationships**:
- `N:1 → Brand`
- `N:1 → Category`
- `N:1 → ProductLine` (optional)
- `1:N → SKU`
- `1:N → ProductMedia`
- `N:N → Ingredient` (via ProductIngredient)

---

#### SKU
```
catalog.skus
├── id                UUID PRIMARY KEY
├── product_id        UUID REFERENCES products(id) NOT NULL
├── code              VARCHAR UNIQUE NOT NULL
├── variant_name      VARCHAR NOT NULL
├── size              DECIMAL(10,3)
├── size_unit         VARCHAR
├── barcode           VARCHAR UNIQUE
├── is_active         BOOLEAN DEFAULT true
├── created_at        TIMESTAMP
└── updated_at        TIMESTAMP
```

**Purpose**: Specific sellable variant (e.g., "6 oz Jar", "12 oz Pump")

**Key Rules**:
- SKU is the unit of commerce (what customers buy)
- Barcode is an identifier, NOT primary key
- Multiple SKUs per product
- Inactive SKUs are hidden but not deleted

**Relationships**:
- `N:1 → Product`
- `1:N → Commerce.Listing`
- `1:N → Commerce.SellingPrice`
- `1:N → Sourcing.SupplierOffer`
- `1:N → SKUBarcode` (future)

**Example**:
```
Product: CeraVe Moisturizing Cream
├── SKU 1: code=CRV-MC-177, variant="6 oz Jar", barcode=360600...
├── SKU 2: code=CRV-MC-539, variant="19 oz Tub", barcode=360600...
└── SKU 3: code=CRV-MC-354, variant="12 oz Pump", barcode=360600...
```

---

#### SKUBarcode (Future)
```
catalog.sku_barcodes
├── id                UUID PRIMARY KEY
├── sku_id            UUID REFERENCES skus(id) NOT NULL
├── barcode_type      VARCHAR NOT NULL (EAN, UPC, JAN, etc.)
├── barcode_value     VARCHAR NOT NULL
├── is_primary        BOOLEAN DEFAULT false
├── verified_at       TIMESTAMP
├── created_at        TIMESTAMP
└── updated_at        TIMESTAMP

UNIQUE(sku_id, barcode_type, barcode_value)
```

**Purpose**: Multiple barcode support (regional variations, corrections)

**Status**: **DEFERRED** to Phase 1 (use `skus.barcode` for MVP)

---

#### ProductMedia
```
catalog.product_media
├── id                UUID PRIMARY KEY
├── product_id        UUID REFERENCES products(id) NOT NULL
├── type              VARCHAR NOT NULL (image, video)
├── origin_type       VARCHAR NOT NULL (verified, generated, derived)
├── url               VARCHAR NOT NULL
├── alt_text          VARCHAR
├── sort_order        INTEGER DEFAULT 0
├── is_primary        BOOLEAN DEFAULT false
├── generation_metadata JSONB
├── created_at        TIMESTAMP
```

**Purpose**: Product images and videos

**Origin Types**:
- `verified`: Manufacturer/supplier packshot, verified packaging
- `generated`: AI-generated lifestyle/hero image
- `derived`: Processed from verified source (cropped, background-removed)

**Generation Metadata** (for generated/derived):
```json
{
  "model": "claude-sonnet-5-5",
  "promptVersion": "v2.1",
  "generatedAt": "2026-09-29T10:30:00Z",
  "sourceMediaId": "uuid-of-source-image"
}
```

**Relationships**:
- `N:1 → Product`

---

#### Ingredient (Future)
```
catalog.ingredients
├── id                UUID PRIMARY KEY
├── name              VARCHAR UNIQUE NOT NULL
├── scientific_name   VARCHAR
├── description       TEXT
├── safety_notes      TEXT
├── is_active         BOOLEAN DEFAULT true
├── created_at        TIMESTAMP
└── updated_at        TIMESTAMP
```

**Purpose**: Ingredient master data (Hyaluronic Acid, Niacinamide, Ceramides)

**Status**: **DEFERRED** until product formulas are available

---

#### ProductIngredient (Future)
```
catalog.product_ingredients
├── id                UUID PRIMARY KEY
├── product_id        UUID REFERENCES products(id) NOT NULL
├── ingredient_id     UUID REFERENCES ingredients(id) NOT NULL
├── concentration     DECIMAL(5,2)
├── sort_order        INTEGER
├── created_at        TIMESTAMP

UNIQUE(product_id, ingredient_id)
```

**Purpose**: Product formulation (ordered ingredient list)

**Status**: **DEFERRED** until product formulas are available

---

## 2. Commerce Context

**Schema**: `commerce.*`  
**Responsibility**: Sellability and pricing policy

### 2.1 Entities

#### Listing
```
commerce.listings
├── id                UUID PRIMARY KEY
├── sku_id            UUID UNIQUE NOT NULL
├── is_listed         BOOLEAN DEFAULT true
├── listed_at         TIMESTAMP
├── unlisted_at       TIMESTAMP
├── created_at        TIMESTAMP
└── updated_at        TIMESTAMP

INDEX(sku_id)
FK: sku_id → catalog.skus(id)
```

**Purpose**: Controls which SKUs are available for purchase

**Key Rules**:
- One listing per SKU (1:1 relationship)
- Listing does NOT imply inventory availability
- Unlisting hides from catalog but preserves history

**Relationships**:
- `1:1 → Catalog.SKU` (cross-context FK)

---

#### SellingPrice
```
commerce.selling_prices
├── id                UUID PRIMARY KEY
├── sku_id            UUID NOT NULL
├── amount            DECIMAL(10,2) NOT NULL
├── currency          VARCHAR(3) NOT NULL
├── compare_at_amount DECIMAL(10,2)
├── valid_from        TIMESTAMP NOT NULL
├── valid_until       TIMESTAMP
├── is_active         BOOLEAN DEFAULT true
├── created_at        TIMESTAMP
└── updated_at        TIMESTAMP

INDEX(sku_id, valid_from)
FK: sku_id → catalog.skus(id)
```

**Purpose**: Time-based pricing for SKUs

**Key Rules**:
- Temporal model (valid_from/valid_until)
- Multiple price records per SKU (price history)
- `compare_at_amount` for discount display
- Active price = most recent valid price

**Relationships**:
- `N:1 → Catalog.SKU` (cross-context FK)

---

## 3. Sourcing Context

**Schema**: `sourcing.*`  
**Responsibility**: Supplier relationships and commercial terms

### 3.1 Entities

#### Supplier
```
sourcing.suppliers
├── id                UUID PRIMARY KEY
├── name              VARCHAR UNIQUE NOT NULL
├── code              VARCHAR UNIQUE NOT NULL
├── contact_name      VARCHAR
├── contact_email     VARCHAR
├── contact_phone     VARCHAR
├── payment_terms     VARCHAR
├── currency          VARCHAR(3)
├── minimum_order_value DECIMAL(10,2)
├── is_active         BOOLEAN DEFAULT true
├── created_at        TIMESTAMP
└── updated_at        TIMESTAMP
```

**Purpose**: Supplier master data

**Examples**: 
- Local distributor (Cairo Beauty Supplies)
- International distributor (L'Oréal Egypt)
- Direct from brand

---

#### SupplierOffer
```
sourcing.supplier_offers
├── id                UUID PRIMARY KEY
├── supplier_id       UUID REFERENCES suppliers(id) NOT NULL
├── sku_id            UUID NOT NULL
├── supplier_sku_code VARCHAR
├── cost_amount       DECIMAL(10,2) NOT NULL
├── cost_currency     VARCHAR(3) NOT NULL
├── minimum_order_qty INTEGER DEFAULT 1
├── lead_time_days    INTEGER
├── is_available      BOOLEAN DEFAULT true
├── valid_from        TIMESTAMP NOT NULL
├── valid_until       TIMESTAMP
├── created_at        TIMESTAMP
└── updated_at        TIMESTAMP

INDEX(supplier_id, sku_id)
FK: supplier_id → sourcing.suppliers(id)
FK: sku_id → catalog.skus(id)
```

**Purpose**: Supplier pricing and availability per SKU

**Key Rules**:
- SupplierOffer → SKU (not Product)
- Multiple suppliers can offer the same SKU
- Customer never sees SupplierOffer directly
- Sourcing logic selects supplier based on cost, availability, lead time

**Relationships**:
- `N:1 → Supplier`
- `N:1 → Catalog.SKU` (cross-context FK)

**Example**:
```
SKU: CeraVe Moisturizing Cream 6oz (CRV-MC-177)
├── SupplierOffer 1: Cairo Beauty Supplies, cost=120 EGP, lead_time=2 days
├── SupplierOffer 2: L'Oréal Egypt, cost=110 EGP, lead_time=7 days
└── SupplierOffer 3: Direct Import, cost=100 EGP, lead_time=30 days
```

---

## 4. Ingestion Context

**Schema**: `ingestion.*`  
**Responsibility**: Product workflow orchestration

### 4.1 Workflow Overview

```
Supplier Data
  ↓
IntakeJob → SourceArtifact (optional)
  ↓
RawSupplierItem (raw data)
  ↓
ProductCandidate (normalized)
  ↓
ProductFingerprint → CandidateMatch
  ↓
├─ Existing SKU → Update SupplierOffer
└─ New Product → Research → Content Generation → Review → Publish
```

### 4.2 Entities

#### IntakeJob
```
ingestion.intake_jobs
├── id                UUID PRIMARY KEY
├── source_type       VARCHAR NOT NULL (supplier_csv, manual_entry, barcode_scan, package_image)
├── supplier_id       UUID REFERENCES sourcing.suppliers(id)
├── status            VARCHAR NOT NULL (pending, processing, completed, failed)
├── raw_data          JSONB
├── items_total       INTEGER
├── items_processed   INTEGER
├── items_matched     INTEGER
├── items_new         INTEGER
├── started_at        TIMESTAMP
├── completed_at      TIMESTAMP
├── created_at        TIMESTAMP
└── updated_at        TIMESTAMP
```

**Purpose**: Track bulk import jobs

**Source Types**:
- `supplier_csv`: Supplier product list
- `manual_entry`: Admin manual input
- `barcode_scan`: Mobile/scanner input
- `package_image`: OCR from package photo

---

#### SourceArtifact (Optional for MVP)
```
ingestion.source_artifacts
├── id                UUID PRIMARY KEY
├── intake_job_id     UUID REFERENCES intake_jobs(id) NOT NULL
├── artifact_type     VARCHAR NOT NULL (csv_file, image, api_payload)
├── storage_url       VARCHAR NOT NULL
├── mime_type         VARCHAR
├── file_size_bytes   BIGINT
├── created_at        TIMESTAMP
```

**Purpose**: Retain raw input files for audit trail

**Status**: Store in `intake_jobs.raw_data JSONB` for MVP

---

#### RawSupplierItem
```
ingestion.raw_supplier_items
├── id                UUID PRIMARY KEY
├── intake_job_id     UUID REFERENCES intake_jobs(id) NOT NULL
├── supplier_id       UUID REFERENCES sourcing.suppliers(id)
├── raw_data          JSONB NOT NULL
├── supplier_sku_code VARCHAR
├── supplier_barcode  VARCHAR
├── supplier_name     VARCHAR
├── supplier_size     VARCHAR
├── supplier_price    DECIMAL(10,2)
├── created_at        TIMESTAMP

INDEX(intake_job_id)
```

**Purpose**: One row per supplier item before normalization

**Example Raw Data**:
```json
{
  "sku": "SUP-12345",
  "name": "Cerave Foaming Cleanser 236 ML",
  "barcode": "3606000537514",
  "price": 185.00,
  "currency": "EGP",
  "availability": "in_stock",
  "image_url": "https://..."
}
```

---

#### ProductCandidate
```
ingestion.product_candidates
├── id                UUID PRIMARY KEY
├── raw_item_id       UUID REFERENCES raw_supplier_items(id)
├── workflow_stage    VARCHAR NOT NULL (normalized, fingerprinted, matched, researched, enriched, reviewed, published, rejected)
├── match_result      VARCHAR (exact_match, likely_match, no_match, conflict)
├── matched_sku_id    UUID
├── normalized_brand  VARCHAR
├── normalized_name   VARCHAR
├── normalized_size   DECIMAL(10,3)
├── normalized_unit   VARCHAR
├── barcode           VARCHAR
├── category_id       UUID
├── product_data      JSONB
├── evidence          JSONB
├── confidence_score  DECIMAL(3,2)
├── created_at        TIMESTAMP
└── updated_at        TIMESTAMP

INDEX(workflow_stage)
INDEX(matched_sku_id)
```

**Purpose**: Normalized candidate product before publication

**Workflow Stages**:
1. `normalized` - Basic normalization done
2. `fingerprinted` - Fingerprint generated
3. `matched` - Deduplication complete
4. `researched` - Research evidence gathered
5. `enriched` - AI content generated
6. `reviewed` - Human review done
7. `published` - Catalog Product/SKU created
8. `rejected` - Review rejected

**Match Results**:
- `exact_match`: Barcode + brand + size match existing SKU
- `likely_match`: Strong similarity, needs review
- `no_match`: New product
- `conflict`: Conflicting signals (barcode matches but size differs)

**Product Data** (JSONB):
```json
{
  "description": "...",
  "usage": "...",
  "warnings": "...",
  "ingredients": [...],
  "claims": ["fragrance-free", "non-comedogenic"],
  "package_info": {...}
}
```

**Evidence** (JSONB):
```json
{
  "sources": [
    {
      "type": "manufacturer_website",
      "url": "https://...",
      "retrieved_at": "2026-09-29T10:00:00Z",
      "confidence": 0.95
    }
  ]
}
```

---

#### ProductFingerprint
```
ingestion.product_fingerprints
├── id                UUID PRIMARY KEY
├── candidate_id      UUID REFERENCES product_candidates(id)
├── fingerprint_version VARCHAR NOT NULL (v1, v2, etc.)
├── brand_normalized  VARCHAR NOT NULL
├── name_normalized   VARCHAR NOT NULL
├── size_normalized   DECIMAL(10,3)
├── unit_normalized   VARCHAR
├── barcode_verified  VARCHAR
├── fingerprint_hash  VARCHAR NOT NULL
├── created_at        TIMESTAMP

INDEX(fingerprint_hash)
INDEX(barcode_verified)
```

**Purpose**: Versioned deduplication fingerprint

**Fingerprint Algorithm** (v1):
```
hash(
  brand_normalized +
  name_normalized +
  size_normalized +
  unit_normalized +
  barcode_verified
)
```

**Rules**:
- Normalization: lowercase, remove special chars, standardize units
- Version the algorithm so fingerprints can be regenerated

---

#### CandidateMatch
```
ingestion.candidate_matches
├── id                UUID PRIMARY KEY
├── candidate_id      UUID REFERENCES product_candidates(id) NOT NULL
├── matched_sku_id    UUID NOT NULL
├── match_type        VARCHAR NOT NULL (exact, likely, conflict)
├── confidence_score  DECIMAL(3,2)
├── matching_signals  JSONB
├── created_at        TIMESTAMP

INDEX(candidate_id)
FK: matched_sku_id → catalog.skus(id)
```

**Purpose**: Links candidates to existing SKUs

**Matching Signals** (JSONB):
```json
{
  "barcode_match": true,
  "brand_match": true,
  "name_similarity": 0.92,
  "size_match": true,
  "visual_similarity": 0.88
}
```

---

#### GeneratedContentVersion
```
ingestion.generated_content_versions
├── id                UUID PRIMARY KEY
├── candidate_id      UUID REFERENCES product_candidates(id) NOT NULL
├── content_type      VARCHAR NOT NULL (title, short_desc, long_desc, benefits, usage, seo_title, keywords)
├── content_text      TEXT NOT NULL
├── model_name        VARCHAR NOT NULL
├── prompt_version    VARCHAR NOT NULL
├── generation_metadata JSONB
├── is_active         BOOLEAN DEFAULT false
├── created_at        TIMESTAMP

INDEX(candidate_id, content_type)
```

**Purpose**: AI-generated product text (versioned, regenerable)

**Content Types**:
- `title`: Customer-facing product title
- `short_desc`: 1-2 sentence summary
- `long_desc`: Full product description
- `benefits`: Key benefits list
- `usage`: How to use
- `seo_title`: SEO-optimized title
- `keywords`: Search keywords

**Generation Metadata**:
```json
{
  "model": "claude-sonnet-5-5",
  "promptVersion": "v2.1",
  "temperature": 0.7,
  "tokens_used": 450,
  "generated_at": "2026-09-29T10:30:00Z"
}
```

---

#### GeneratedMediaAsset
```
ingestion.generated_media_assets
├── id                UUID PRIMARY KEY
├── candidate_id      UUID REFERENCES product_candidates(id) NOT NULL
├── asset_type        VARCHAR NOT NULL (hero_image, lifestyle_image, texture_visual)
├── storage_url       VARCHAR NOT NULL
├── source_media_id   UUID
├── model_name        VARCHAR NOT NULL
├── prompt_version    VARCHAR NOT NULL
├── generation_metadata JSONB
├── is_active         BOOLEAN DEFAULT false
├── created_at        TIMESTAMP

INDEX(candidate_id, asset_type)
```

**Purpose**: AI-generated product images (versioned, regenerable)

**Asset Types**:
- `hero_image`: Primary marketing image
- `lifestyle_image`: Product in use context
- `texture_visual`: Close-up texture representation

---

#### ReviewDecision
```
ingestion.review_decisions
├── id                UUID PRIMARY KEY
├── candidate_id      UUID REFERENCES product_candidates(id) NOT NULL
├── reviewer_id       UUID (future: link to accounts.users)
├── decision          VARCHAR NOT NULL (approved, rejected, needs_revision)
├── feedback          TEXT
├── created_at        TIMESTAMP

INDEX(candidate_id)
```

**Purpose**: Human review outcomes

**Decisions**:
- `approved`: Ready to publish
- `rejected`: Do not publish
- `needs_revision`: Send back for correction

---

## 5. Key Relationships

### 5.1 Cross-Context Foreign Keys (Documented)

```
commerce.listings.sku_id → catalog.skus.id
commerce.selling_prices.sku_id → catalog.skus.id
sourcing.supplier_offers.sku_id → catalog.skus.id
ingestion.candidate_matches.matched_sku_id → catalog.skus.id
```

**Rationale**: See ADR-005

**Constraints**:
- NO CASCADE DELETES
- IDs are stable UUIDs
- Mutations go through owning module's API

### 5.2 Within-Context Relationships

**Catalog**:
- Brand 1:N Product
- Category 1:N Product
- Product 1:N SKU
- Product 1:N ProductMedia

**Sourcing**:
- Supplier 1:N SupplierOffer

**Ingestion**:
- IntakeJob 1:N RawSupplierItem
- RawSupplierItem 1:1 ProductCandidate
- ProductCandidate 1:1 ProductFingerprint
- ProductCandidate 1:N CandidateMatch
- ProductCandidate 1:N GeneratedContentVersion
- ProductCandidate 1:N GeneratedMediaAsset
- ProductCandidate 1:N ReviewDecision

---

## 6. Implementation Phases

### Phase 0 (Current)
- ✅ Brand, Product, SKU, ProductMedia
- ✅ Listing, SellingPrice
- ⚠️ Add Category
- ⚠️ Extend ProductMedia with origin_type

### Phase 1 (Next)
- Supplier, SupplierOffer
- IntakeJob, RawSupplierItem
- ProductCandidate
- ProductFingerprint, CandidateMatch
- GeneratedContentVersion, GeneratedMediaAsset
- ReviewDecision

### Phase 2 (Future)
- SKUBarcode (multi-barcode support)
- Ingredient, ProductIngredient
- ProductLine
- SourceArtifact (audit trail)
- CandidateEvidence (separate table)

---

## 7. Deferred Decisions

- **Barcode Strategy**: Use single `skus.barcode` field for MVP; move to `sku_barcodes` table when conflicts emerge
- **Evidence Storage**: Store in `product_candidates.evidence JSONB` for MVP; separate table if provenance becomes complex
- **Source Artifacts**: Store in `intake_jobs.raw_data JSONB` for MVP; separate table if file storage is needed
- **Product Lines**: Only add when brand data includes explicit line grouping

---

## 8. Validation Rules

### 8.1 Catalog Rules
- Product slug must be unique
- Product must have at least one active SKU to be sellable
- SKU code must be unique across all SKUs
- Barcode uniqueness is enforced but nullable

### 8.2 Commerce Rules
- Listing is 1:1 with SKU
- Active selling price must have valid_from <= now < valid_until
- Only one active price per SKU at any moment

### 8.3 Sourcing Rules
- SupplierOffer must reference valid SKU
- Multiple suppliers can offer same SKU
- Customer never sees supplier identity or cost

### 8.4 Ingestion Rules
- ProductCandidate workflow stage must progress forward
- Match result CONFLICT blocks automatic publication
- Review decision APPROVED required before publication
- Generated content must retain model + prompt version

---

## Next Steps

1. Generate visual ER diagram from this specification
2. Create migrations for Phase 1 entities
3. Implement Sourcing and Ingestion modules
4. Build workflow orchestration
5. Pilot with 10-20 real products

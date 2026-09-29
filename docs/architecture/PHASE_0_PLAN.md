# Phase 0: ER Model Stabilization & Catalog Extensions

**Status**: Ready to Implement  
**Duration**: 1-2 weeks  
**Goal**: Stabilize the data model foundation before Product Workflow implementation

---

## Overview

Before implementing the Product Workflow (Ingestion module), we need to:
1. Extend the existing Catalog module with missing foundational entities
2. Document the complete ER model
3. Create database schemas for future modules
4. Ensure the foundation is solid

This phase is **data model only** — no workflow logic, no AI integration, no FastAPI.

---

## Deliverables

### 1. Add Category Entity to Catalog ✅

**Purpose**: Product taxonomy for browsing and filtering

**Schema**:
```sql
CREATE TABLE catalog.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR NOT NULL,
  slug VARCHAR UNIQUE NOT NULL,
  parent_id UUID REFERENCES catalog.categories(id),
  description TEXT,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_categories_parent_id ON catalog.categories(parent_id);
CREATE INDEX idx_categories_slug ON catalog.categories(slug);
```

**Seed Categories**:
```
Cleansers
├── Foaming Cleansers
├── Oil Cleansers
├── Micellar Water
└── Cleansing Balms

Moisturizers
├── Face Creams
├── Face Lotions
├── Body Lotions
└── Night Creams

Serums & Treatments
├── Vitamin C Serums
├── Hyaluronic Acid Serums
├── Retinol Treatments
└── Niacinamide Serums

Sunscreens
├── Face Sunscreens
├── Body Sunscreens
└── Tinted Sunscreens

Toners & Essences
Masks
Exfoliants
Eye Care
Lip Care
```

**Migration**:
```typescript
// 1706000001000-AddCategories.ts
export class AddCategories1706000001000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE catalog.categories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR NOT NULL,
        slug VARCHAR UNIQUE NOT NULL,
        parent_id UUID REFERENCES catalog.categories(id),
        description TEXT,
        sort_order INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT now(),
        updated_at TIMESTAMP DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_categories_parent_id 
      ON catalog.categories(parent_id)
    `);

    await queryRunner.query(`
      CREATE INDEX idx_categories_slug 
      ON catalog.categories(slug)
    `);

    // Add category_id to products
    await queryRunner.query(`
      ALTER TABLE catalog.products
      ADD COLUMN category_id UUID 
      REFERENCES catalog.categories(id)
    `);

    await queryRunner.query(`
      CREATE INDEX idx_products_category_id 
      ON catalog.products(category_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE catalog.products DROP COLUMN category_id
    `);
    
    await queryRunner.query(`DROP TABLE catalog.categories`);
  }
}
```

**Entity**:
```typescript
// apps/api/src/modules/catalog/entities/category.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { Product } from './product.entity';

@Entity({ schema: 'catalog', name: 'categories' })
export class Category {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ unique: true })
  slug: string;

  @Column({ nullable: true })
  parentId: string;

  @ManyToOne(() => Category, category => category.children, { nullable: true })
  @JoinColumn({ name: 'parentId' })
  parent: Category;

  @OneToMany(() => Category, category => category.parent)
  children: Category[];

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ default: 0 })
  sortOrder: number;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => Product, product => product.category)
  products: Product[];
}
```

**Update Product Entity**:
```typescript
// apps/api/src/modules/catalog/entities/product.entity.ts
// Add:
@Column({ nullable: true })
categoryId: string;

@ManyToOne(() => Category, category => category.products)
@JoinColumn({ name: 'categoryId' })
category: Category;
```

---

### 2. Extend ProductMedia with Origin Tracking ✅

**Purpose**: Distinguish verified supplier photos from AI-generated images

**Migration**:
```typescript
// 1706000002000-ExtendProductMedia.ts
export class ExtendProductMedia1706000002000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE catalog.product_media
      ADD COLUMN origin_type VARCHAR NOT NULL DEFAULT 'verified'
      CHECK (origin_type IN ('verified', 'generated', 'derived'))
    `);

    await queryRunner.query(`
      ALTER TABLE catalog.product_media
      ADD COLUMN generation_metadata JSONB
    `);

    await queryRunner.query(`
      CREATE INDEX idx_product_media_origin_type 
      ON catalog.product_media(origin_type)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE catalog.product_media 
      DROP COLUMN generation_metadata
    `);
    
    await queryRunner.query(`
      ALTER TABLE catalog.product_media 
      DROP COLUMN origin_type
    `);
  }
}
```

**Update Entity**:
```typescript
// apps/api/src/modules/catalog/entities/product-media.entity.ts
export enum MediaType {
  IMAGE = 'image',
  VIDEO = 'video',
}

export enum MediaOriginType {
  VERIFIED = 'verified',    // Supplier/manufacturer photo
  GENERATED = 'generated',  // AI-generated image
  DERIVED = 'derived',      // Processed from verified (cropped, bg-removed)
}

@Entity({ schema: 'catalog', name: 'product_media' })
export class ProductMedia {
  // ... existing fields ...

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
}
```

---

### 3. Create Sourcing Schema Stub ✅

**Purpose**: Prepare for Sourcing module in Phase 1

**Migration**:
```typescript
// 1706000003000-CreateSourcingSchema.ts
export class CreateSourcingSchema1706000003000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create sourcing schema
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS sourcing`);

    // Supplier table
    await queryRunner.query(`
      CREATE TABLE sourcing.suppliers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR UNIQUE NOT NULL,
        code VARCHAR UNIQUE NOT NULL,
        contact_name VARCHAR,
        contact_email VARCHAR,
        contact_phone VARCHAR,
        payment_terms VARCHAR,
        currency VARCHAR(3) DEFAULT 'EGP',
        minimum_order_value DECIMAL(10,2),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT now(),
        updated_at TIMESTAMP DEFAULT now()
      )
    `);

    // SupplierOffer table
    await queryRunner.query(`
      CREATE TABLE sourcing.supplier_offers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        supplier_id UUID NOT NULL REFERENCES sourcing.suppliers(id),
        sku_id UUID NOT NULL,
        supplier_sku_code VARCHAR,
        cost_amount DECIMAL(10,2) NOT NULL,
        cost_currency VARCHAR(3) NOT NULL DEFAULT 'EGP',
        minimum_order_qty INTEGER DEFAULT 1,
        lead_time_days INTEGER,
        is_available BOOLEAN DEFAULT true,
        valid_from TIMESTAMP NOT NULL DEFAULT now(),
        valid_until TIMESTAMP,
        created_at TIMESTAMP DEFAULT now(),
        updated_at TIMESTAMP DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_supplier_offers_supplier_id 
      ON sourcing.supplier_offers(supplier_id)
    `);

    await queryRunner.query(`
      CREATE INDEX idx_supplier_offers_sku_id 
      ON sourcing.supplier_offers(sku_id)
    `);

    await queryRunner.query(`
      CREATE INDEX idx_supplier_offers_validity 
      ON sourcing.supplier_offers(supplier_id, sku_id, valid_from)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS sourcing.supplier_offers`);
    await queryRunner.query(`DROP TABLE IF EXISTS sourcing.suppliers`);
    await queryRunner.query(`DROP SCHEMA IF EXISTS sourcing`);
  }
}
```

**Note**: Entities will be created in Phase 1. This migration just prepares the schema.

---

### 4. Create Ingestion Schema Stub ✅

**Purpose**: Prepare for Ingestion module in Phase 1

**Migration**:
```typescript
// 1706000004000-CreateIngestionSchema.ts
export class CreateIngestionSchema1706000004000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS ingestion`);

    // IntakeJob table
    await queryRunner.query(`
      CREATE TABLE ingestion.intake_jobs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        source_type VARCHAR NOT NULL CHECK (source_type IN ('supplier_csv', 'manual_entry', 'barcode_scan', 'package_image')),
        supplier_id UUID,
        status VARCHAR NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
        raw_data JSONB,
        items_total INTEGER DEFAULT 0,
        items_processed INTEGER DEFAULT 0,
        items_matched INTEGER DEFAULT 0,
        items_new INTEGER DEFAULT 0,
        started_at TIMESTAMP,
        completed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT now(),
        updated_at TIMESTAMP DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_intake_jobs_status 
      ON ingestion.intake_jobs(status)
    `);

    await queryRunner.query(`
      CREATE INDEX idx_intake_jobs_supplier_id 
      ON ingestion.intake_jobs(supplier_id)
    `);

    // RawSupplierItem table
    await queryRunner.query(`
      CREATE TABLE ingestion.raw_supplier_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        intake_job_id UUID NOT NULL REFERENCES ingestion.intake_jobs(id),
        supplier_id UUID,
        raw_data JSONB NOT NULL,
        supplier_sku_code VARCHAR,
        supplier_barcode VARCHAR,
        supplier_name VARCHAR,
        supplier_size VARCHAR,
        supplier_price DECIMAL(10,2),
        created_at TIMESTAMP DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_raw_supplier_items_job_id 
      ON ingestion.raw_supplier_items(intake_job_id)
    `);

    await queryRunner.query(`
      CREATE INDEX idx_raw_supplier_items_barcode 
      ON ingestion.raw_supplier_items(supplier_barcode)
    `);

    // ProductCandidate table
    await queryRunner.query(`
      CREATE TABLE ingestion.product_candidates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        raw_item_id UUID REFERENCES ingestion.raw_supplier_items(id),
        workflow_stage VARCHAR NOT NULL DEFAULT 'normalized'
          CHECK (workflow_stage IN ('normalized', 'fingerprinted', 'matched', 'researched', 'enriched', 'reviewed', 'published', 'rejected')),
        match_result VARCHAR 
          CHECK (match_result IN ('exact_match', 'likely_match', 'no_match', 'conflict')),
        matched_sku_id UUID,
        normalized_brand VARCHAR,
        normalized_name VARCHAR,
        normalized_size DECIMAL(10,3),
        normalized_unit VARCHAR,
        barcode VARCHAR,
        category_id UUID,
        product_data JSONB,
        evidence JSONB,
        confidence_score DECIMAL(3,2),
        created_at TIMESTAMP DEFAULT now(),
        updated_at TIMESTAMP DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_product_candidates_workflow_stage 
      ON ingestion.product_candidates(workflow_stage)
    `);

    await queryRunner.query(`
      CREATE INDEX idx_product_candidates_match_result 
      ON ingestion.product_candidates(match_result)
    `);

    await queryRunner.query(`
      CREATE INDEX idx_product_candidates_matched_sku 
      ON ingestion.product_candidates(matched_sku_id)
    `);

    // ProductFingerprint table
    await queryRunner.query(`
      CREATE TABLE ingestion.product_fingerprints (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        candidate_id UUID REFERENCES ingestion.product_candidates(id),
        fingerprint_version VARCHAR NOT NULL DEFAULT 'v1',
        brand_normalized VARCHAR NOT NULL,
        name_normalized VARCHAR NOT NULL,
        size_normalized DECIMAL(10,3),
        unit_normalized VARCHAR,
        barcode_verified VARCHAR,
        fingerprint_hash VARCHAR NOT NULL,
        created_at TIMESTAMP DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_product_fingerprints_hash 
      ON ingestion.product_fingerprints(fingerprint_hash)
    `);

    await queryRunner.query(`
      CREATE INDEX idx_product_fingerprints_barcode 
      ON ingestion.product_fingerprints(barcode_verified)
    `);

    // CandidateMatch table
    await queryRunner.query(`
      CREATE TABLE ingestion.candidate_matches (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        candidate_id UUID NOT NULL REFERENCES ingestion.product_candidates(id),
        matched_sku_id UUID NOT NULL,
        match_type VARCHAR NOT NULL CHECK (match_type IN ('exact', 'likely', 'conflict')),
        confidence_score DECIMAL(3,2),
        matching_signals JSONB,
        created_at TIMESTAMP DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_candidate_matches_candidate_id 
      ON ingestion.candidate_matches(candidate_id)
    `);

    // GeneratedContentVersion table
    await queryRunner.query(`
      CREATE TABLE ingestion.generated_content_versions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        candidate_id UUID NOT NULL REFERENCES ingestion.product_candidates(id),
        content_type VARCHAR NOT NULL 
          CHECK (content_type IN ('title', 'short_desc', 'long_desc', 'benefits', 'usage', 'seo_title', 'keywords')),
        content_text TEXT NOT NULL,
        model_name VARCHAR NOT NULL,
        prompt_version VARCHAR NOT NULL,
        generation_metadata JSONB,
        is_active BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_generated_content_candidate_id 
      ON ingestion.generated_content_versions(candidate_id, content_type)
    `);

    // GeneratedMediaAsset table
    await queryRunner.query(`
      CREATE TABLE ingestion.generated_media_assets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        candidate_id UUID NOT NULL REFERENCES ingestion.product_candidates(id),
        asset_type VARCHAR NOT NULL 
          CHECK (asset_type IN ('hero_image', 'lifestyle_image', 'texture_visual')),
        storage_url VARCHAR NOT NULL,
        source_media_id UUID,
        model_name VARCHAR NOT NULL,
        prompt_version VARCHAR NOT NULL,
        generation_metadata JSONB,
        is_active BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_generated_media_candidate_id 
      ON ingestion.generated_media_assets(candidate_id, asset_type)
    `);

    // ReviewDecision table
    await queryRunner.query(`
      CREATE TABLE ingestion.review_decisions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        candidate_id UUID NOT NULL REFERENCES ingestion.product_candidates(id),
        reviewer_id UUID,
        decision VARCHAR NOT NULL CHECK (decision IN ('approved', 'rejected', 'needs_revision')),
        feedback TEXT,
        created_at TIMESTAMP DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_review_decisions_candidate_id 
      ON ingestion.review_decisions(candidate_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS ingestion.review_decisions`);
    await queryRunner.query(`DROP TABLE IF EXISTS ingestion.generated_media_assets`);
    await queryRunner.query(`DROP TABLE IF EXISTS ingestion.generated_content_versions`);
    await queryRunner.query(`DROP TABLE IF EXISTS ingestion.candidate_matches`);
    await queryRunner.query(`DROP TABLE IF EXISTS ingestion.product_fingerprints`);
    await queryRunner.query(`DROP TABLE IF EXISTS ingestion.product_candidates`);
    await queryRunner.query(`DROP TABLE IF EXISTS ingestion.raw_supplier_items`);
    await queryRunner.query(`DROP TABLE IF EXISTS ingestion.intake_jobs`);
    await queryRunner.query(`DROP SCHEMA IF EXISTS ingestion`);
  }
}
```

**Note**: Entities will be created in Phase 1. This migration just prepares the schema and tables.

---

### 5. Update Seed Data with Categories ✅

**Update**:
```typescript
// apps/api/src/platform/database/seed.ts
// Add category seeding before products

// Create categories
const cleansersCategory = categoryRepo.create({
  name: 'Cleansers',
  slug: 'cleansers',
  sortOrder: 1,
});
await categoryRepo.save(cleansersCategory);

const moisturizersCategory = categoryRepo.create({
  name: 'Moisturizers',
  slug: 'moisturizers',
  sortOrder: 2,
});
await categoryRepo.save(moisturizersCategory);

const sunscreensCategory = categoryRepo.create({
  name: 'Sunscreens',
  slug: 'sunscreens',
  sortOrder: 3,
});
await categoryRepo.save(sunscreensCategory);

// Assign categories to products
ceraveCleanser.category = cleansersCategory;
ceraveMoisturizer.category = moisturizersCategory;
laRocheSunscreen.category = sunscreensCategory;
```

---

### 6. Update Documentation ✅

**Files to Update**:
- ✅ `docs/architecture/ER_MODEL.md` (already created)
- ✅ `docs/architecture/006-product-workflow-architecture.md` (already created)
- ✅ `docs/architecture/007-ai-integration-strategy.md` (already created)
- ⚠️ `docs/architecture/README.md` (add new ADRs to index)
- ⚠️ `README.md` (update with Phase 0 status)

---

## Task Checklist

### Database Migrations
- [ ] Create migration: `1706000001000-AddCategories.ts`
- [ ] Create migration: `1706000002000-ExtendProductMedia.ts`
- [ ] Create migration: `1706000003000-CreateSourcingSchema.ts`
- [ ] Create migration: `1706000004000-CreateIngestionSchema.ts`
- [ ] Test migrations: `npm run migration:run`
- [ ] Test rollback: `npm run migration:revert`

### Entities
- [ ] Create `Category` entity in `apps/api/src/modules/catalog/entities/`
- [ ] Update `Product` entity with `categoryId` and relation
- [ ] Update `ProductMedia` entity with `originType` and `generationMetadata`
- [ ] Update `CatalogModule` to include `Category` in TypeORM config

### Seed Data
- [ ] Add category seeding to `apps/api/src/platform/database/seed.ts`
- [ ] Assign categories to existing products
- [ ] Test seed: `npm run seed`

### Testing
- [ ] Verify category relations work
- [ ] Verify product-category assignment works
- [ ] Verify media origin tracking works
- [ ] Verify new schemas exist (sourcing, ingestion)
- [ ] Run existing tests: `npm test`

### Documentation
- [ ] Update `docs/architecture/README.md` with new ADRs
- [ ] Update root `README.md` with Phase 0 status
- [ ] Review all ADRs for consistency

---

## Acceptance Criteria

✅ **Phase 0 Complete When**:
1. All 4 migrations run successfully
2. Category entity exists and works
3. ProductMedia has origin tracking
4. Sourcing and Ingestion schemas exist (empty, ready for Phase 1)
5. Seed data includes categories
6. All existing tests pass
7. Documentation updated

---

## Next Phase

**Phase 1**: Implement Sourcing + Ingestion modules with simplified workflow (2-3 weeks)

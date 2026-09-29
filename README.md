# Shena Care - Beauty & Skincare Platform

A modular monolith e-commerce platform for beauty and skincare products, built with NestJS, Next.js, and PostgreSQL.

## Architecture

This application is built as a **modular monolith** with clear business boundaries that can be selectively extracted into microservices if needed in the future.

### Business Contexts

- **Catalog** - Product identity, SKUs, brand information, and product knowledge ✅ **IMPLEMENTED**
- **Commerce** - Listings, pricing, cart, orders, and payment records ✅ **IMPLEMENTED** (Listing/Pricing only)
- **Ingestion** - Product workflow: intake, normalization, deduplication, enrichment 🚧 **PHASE 1**
- **Sourcing** - Supplier relationships, offers, and supply planning 🚧 **PHASE 1**
- **Fulfillment** - Inventory, reservations, and order fulfillment (future)
- **Care** - Customer care profiles and routine management (future)
- **Guidance** - AI-powered recommendations and conversations (future)
- **Accounts** - Identity, authentication, and access control (future)

### Database Strategy

Single PostgreSQL database with logical schemas per business context:
- `catalog.*` - Product, SKU, Brand, Category, ProductMedia ✅ **IMPLEMENTED**
- `commerce.*` - Listing, SellingPrice, Cart, Order (future) ✅ **IMPLEMENTED** (Listing/Pricing only)
- `sourcing.*` - Supplier, SupplierOffer 🚧 **PHASE 1** (schema ready)
- `ingestion.*` - Product workflow entities 🚧 **PHASE 1** (schema ready)

Cross-context foreign keys are allowed selectively where both modules are co-located and the relationship is structurally important, but:
- No cross-context ORM navigation
- No repository sharing
- No cross-context cascade deletes
- Mutations go through owner's application API

## Project Structure

```
shena-care/
├── apps/
│   ├── api/                    # NestJS backend
│   │   └── src/
│   │       ├── modules/        # Business modules
│   │       │   ├── catalog/    # Product catalog
│   │       │   └── commerce/   # Commerce & pricing
│   │       ├── application/    # Cross-cutting concerns
│   │       │   └── composition/ # Product views
│   │       └── platform/       # Infrastructure
│   │           └── database/   # DB config & migrations
│   └── web/                    # Next.js frontend
│       └── src/
│           ├── app/            # Next.js app router
│           └── features/       # Feature-oriented modules
└── docs/
    └── architecture/           # Architecture decisions
```

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm 8+
- PostgreSQL 14+

### Installation

1. Install dependencies:
```bash
pnpm install
```

2. Set up environment variables:
```bash
# Backend
cp apps/api/.env.example apps/api/.env

# Frontend
cp apps/web/.env.example apps/web/.env
```

3. Create PostgreSQL database:
```bash
createdb shenacare
```

4. Run migrations:
```bash
pnpm migration:run
```

5. Seed the database:
```bash
pnpm seed
```

### Development

Run both backend and frontend:
```bash
pnpm dev
```

Or run separately:
```bash
# Backend (http://localhost:3001)
cd apps/api && pnpm dev

# Frontend (http://localhost:3000)
cd apps/web && pnpm dev
```

### Testing

```bash
# Run all tests
pnpm test

# Run linting
pnpm lint

# Type checking
pnpm typecheck
```

## API Endpoints

### Products & Composition

- `GET /products` - List products with commerce data (Filters: `category`, `brand`, `productLine`, `page`, `limit`)
- `GET /products/:slugOrId` - Get composed product details by slug or ID
- `POST /products` - Create new catalog product
- `PATCH /products/:id` - Update catalog product

### SKUs

- `GET /products/:productId/skus` - List SKUs for a product
- `POST /products/:productId/skus` - Create SKU under product
- `PATCH /products/skus/:skuId` - Update SKU details

### Product Media

- `GET /products/:productId/media` - List media items for a product
- `POST /products/:productId/media` - Add media item to product (`originType`: `verified`, `generated`, `derived`)
- `PATCH /products/media/:mediaId` - Update media item
- `DELETE /products/media/:mediaId` - Remove media item

### Brands & Product Lines

- `GET /brands` - List active brands (supports `?includeInactive=true`)
- `GET /brands/:slugOrId` - Get brand details with product lines and products
- `POST /brands` - Create brand
- `PATCH /brands/:id` - Update brand
- `GET /brands/:brandId/product-lines` - List product lines for a brand
- `POST /brands/:brandId/product-lines` - Create product line under brand
- `GET /brands/product-lines/:id` - Get product line by ID
- `PATCH /brands/product-lines/:id` - Update product line

### Categories

- `GET /categories` - List category hierarchy tree (`Skin Care`, `Hair Care` roots + leaf categories)
- `GET /categories/:slugOrId` - Get category details with assigned products

## Module Boundaries

Each business module exposes an explicit public API through `public.ts`:

### Catalog Public API (`catalog/public.ts`)
```typescript
// Services
CatalogService.getPublishedProduct(slugOrId: string)
CatalogService.getProduct(slugOrId: string)
CatalogService.getPublishedProducts(filters?)
CatalogService.createProduct(dto: CreateProductDto)
CatalogService.updateProduct(id: string, dto: UpdateProductDto)
CatalogService.getPublishedSku(skuId: string)
CatalogService.validateSku(skuId: string)
CatalogService.createSku(productId: string, dto: CreateSkuDto)
CatalogService.updateSku(id: string, dto: UpdateSkuDto)
CatalogService.getSkus(productId: string)
CatalogService.addMedia(productId: string, dto: CreateProductMediaDto)
CatalogService.updateMedia(id: string, dto: UpdateProductMediaDto)
CatalogService.deleteMedia(id: string)
CatalogService.getMedia(productId: string)

BrandService.getBrands(includeInactive?: boolean)
BrandService.getBrand(slugOrId: string)
BrandService.createBrand(dto: CreateBrandDto)
BrandService.updateBrand(id: string, dto: UpdateBrandDto)
BrandService.getProductLines(brandId: string)
BrandService.getProductLine(slugOrId: string)
BrandService.createProductLine(brandId: string, dto: CreateProductLineDto)
BrandService.updateProductLine(id: string, dto: UpdateProductLineDto)

CategoryService.getCategories()
CategoryService.getCategory(slugOrId: string)
```

### Commerce Public API (`commerce/public.ts`)
```typescript
CommerceService.getSellingTerms(skuId: string)
CommerceService.evaluateSellability(skuId: string)
CommerceService.createListing(skuId: string)
CommerceService.createSellingPrice(...)
```

### Composition Layer (`application/composition`)
```typescript
ProductViewService.getProductView(slugOrId: string)
ProductViewService.getProductViews(filters?)
```

## Architecture Principles

1. **Module ownership** - Each table/entity has exactly one owning module
2. **Explicit contracts** - Modules communicate through public APIs, never internal repositories
3. **No shared entities** - ORM entities never cross module boundaries
4. **Composed queries** - ProductView combines Catalog and Commerce data through composition layer
5. **Simple when possible** - Only introduce domain/application/infrastructure separation when complexity justifies it

## Development Decisions

See [docs/architecture/](docs/architecture/) for Architecture Decision Records (ADRs).

### Key Documentation
- [ADR Index](docs/architecture/README.md) - All architecture decisions
- [ER Model](docs/architecture/ER_MODEL.md) - Complete data model
- [Product Workflow](docs/architecture/006-product-workflow-architecture.md) - Controlled product intake pipeline
- [AI Integration](docs/architecture/007-ai-integration-strategy.md) - FastAPI + NestJS coordination
- [Phase 0 Plan](docs/architecture/PHASE_0_PLAN.md) - Current implementation phase

### Implementation Status

**Phase 0** (Current): ER Model Stabilization 🚧
- Add Category entity to Catalog
- Extend ProductMedia with origin tracking
- Create Sourcing and Ingestion schemas
- Update seed data

**Phase 1** (Next): Product Workflow with 10-20 Real Products
- Implement Sourcing module (Supplier, SupplierOffer)
- Implement Ingestion module (simplified workflow)
- Build supplier intake and review UI
- Deploy FastAPI service for AI enrichment

## License

Proprietary

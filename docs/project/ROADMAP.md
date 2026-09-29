# Shena Care — Backend-First Implementation Roadmap

This roadmap defines the sequential backend-first milestones for Shena Care. Each phase must be verified with automated regression tests before proceeding to the next.

---

## Phase Execution Order

### [Done] B0 — Verified Backend Baseline
- NestJS + Prisma + PostgreSQL multi-schema architecture setup.
- Initial Catalog and Commerce modules.
- ProductView composition layer.
- Baseline architecture boundary tests and integration test suite passing.

### [Done] B1 — Catalog Core v1
- Hierarchical Category model with root (`Skin Care`, `Hair Care`) and leaf taxonomy.
- Primary Category assignment on Product.
- ProductMedia tracking with `MediaOriginType` (`verified`, `generated`, `derived`).
- Brand & ProductLine management APIs with strict slug and uniqueness validation.
- Product + SKU + Media write and management operations.
- Catalog read APIs, filtering (by category tree, brand, product line), and pagination.

### [Done] B2 — Commerce & Sellability v1
- [x] Define and implement explicit Commerce sellability rules (`isListed` + valid `SellingPrice` + active SKU — GLO-101).
- [x] Listing management APIs: list/unlist commands with timestamps (GLO-102).
- [x] SellingPrice management commands and historical price intervals (`validFrom`, `validUntil` — GLO-103).
- [x] Close Commerce Core v1 with composition + regression tests (GLO-104).

### [Done] B3 — Sourcing & Availability v1
- [x] Implement Supplier + SupplierOffer management APIs (GLO-105).
- [x] Sourcing module domain rules and `sourcing` PostgreSQL schema.
- [x] Supplier and SupplierOffer management APIs (cost, observed timestamps, evidence).
- [x] Availability fresh resolution without exposing supplier concepts to customer APIs (GLO-106).

### [Done] B4 — Ordering Core v1
- [x] Ordering module domain rules and `ordering` PostgreSQL schema (GLO-107).
- [x] Cart and checkout validation against real-time Commerce sellability (GLO-108).
- [x] Order creation, item snapshots, status state machine, and Cash On Delivery (COD) flow (GLO-109).

### [Done] B5 — Fulfillment & Delivery v1
- [x] Fulfillment module domain rules and `fulfillment` PostgreSQL schema (GLO-110).
- [x] Hub modeled as `FulfillmentLocation` (GLO-111).
- [x] Receiving allocations, packing readiness, shipment dispatch, and delivery status transitions (GLO-112).

### [Done] B6 — Product Ingestion & Catalog Ops
- [x] Ingestion module and workflow pipeline (`ingestion` schema).
- [x] Supplier catalog intake, candidate matching, and automated/manual review gate before publishing to Catalog.

### [Active] B7 — Care & AI
- [ ] Care module for routine profiles and customer skin/hair concerns (GLO-114).
- [ ] Shared FastAPI AI service integration under `services/ai` for advisory recommendations and routine proposals (GLO-115).

### B8 — Customer & Operations Interfaces
- Stable backend API contract consumption for storefront UI (browsing, detail, checkout).
- Operations and Admin management interfaces consuming owner APIs.

### B9 — Release Readiness
- End-to-end smoke testing across full user and operational journeys.
- Observability, audit logging, database backup/restore procedures, and staging release readiness.

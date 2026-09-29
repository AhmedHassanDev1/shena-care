# Shena Care — Architectural Decision Records (ADRs)

This document summarizes key architectural decisions established in the repository along with their rationale.

---

### ADR 001: Modular Monolith over Premature Microservices
- **Decision**: Build the application backend as a modular monolith within NestJS.
- **Rationale**: A startup/MVP requires rapid iteration, transactional reliability, and simple deployment. Distributed microservices introduce network latency, distributed transactions, and high operational overhead prematurely. Clean internal module boundaries preserve the option to extract microservices later if scale demands it.

---

### ADR 002: Strict Public API Contracts via `public.ts`
- **Decision**: Every business module exposes its functionality exclusively through an explicit `public.ts` contract. Direct imports of module internals are banned.
- **Rationale**: Enforcing a single entry point prevents tightly coupled spaghetti code between modules. Automated architecture tests continuously verify that module boundaries remain unbreached.

---

### ADR 003: Two-Tier Product and SKU Identity Separation
- **Decision**: Differentiate between `Product` (merchandising concept) and `Sku` (concrete physical/sellable item).
- **Rationale**: A single product (e.g., CeraVe Moisturizing Cream) often has multiple sizes, barcodes, and packages. Decoupling Product from SKU ensures accurate inventory, pricing, and barcode lookups without duplicating brand and educational content.

---

### ADR 004: PostgreSQL Multi-Schema Isolation
- **Decision**: Partition database tables into domain schemas (`catalog`, `commerce`, `sourcing`, `ingestion`) within a single PostgreSQL database.
- **Rationale**: Logical schemas enforce domain ownership at the database level while keeping operational maintenance, transactions, backups, and local development simple and unified.

---

### ADR 005: Cross-Context Foreign Key Boundaries
- **Decision**: Allow cross-schema database foreign keys for referential integrity, but prohibit cross-context ORM relation navigation and cascading deletes.
- **Rationale**: Ensures referential data integrity at the database layer (preventing orphaned references across modules) while preventing memory-level entity coupling and hidden cross-module cascade side effects.

---

### ADR 006: Internal Sourcing & Non-Marketplace Customer Model
- **Decision**: Suppliers and supplier offers are strictly internal sourcing records; they are never exposed to customers.
- **Rationale**: Shena Care is a curated, trusted beauty platform with its own customer promise, not an unvetted third-party marketplace. Customers buy from Shena Care, not from independent vendors.

---

### ADR 007: Hub-Based Operations (`FulfillmentLocation`)
- **Decision**: Model order fulfillment around dedicated physical hubs (`FulfillmentLocation`).
- **Rationale**: Consistent quality control, consolidated packaging, and reliable local delivery require physical receiving, quality inspection, and dispatch through controlled hubs rather than vendor drop-shipping.

---

### ADR 008: Externalized AI Service (`services/ai`) with Strict Advisory Role
- **Decision**: Run AI workloads in a dedicated FastAPI service under `services/ai` as an advisory component. AI cannot directly mutate authoritative database state.
- **Rationale**: Python provides superior tooling for LLMs and data extraction. Restricting AI to proposal and draft generation ensures that hallucinated or unverified data can never corrupt trusted Catalog, Commerce, Order, or Care records.

---

### ADR 009: Merchandising Category Hierarchy Scope
- **Decision**: Structure Category as a simple merchandising hierarchy supporting both `Skin Care` and `Hair Care` roots with primary leaf assignments in v1. Keep skin concerns, routines, and ingredients as independent dimensions.
- **Rationale**: Prevents category taxonomy explosion and avoids rigid classification traps. Merchandising browsing stays clean while clinical concerns and ingredients remain flexible, multi-dimensional attributes.

# Shena Care — System Architecture

This document outlines the current architectural rules, boundary ownership, and component relationships of the Shena Care system.

---

## 1. Architectural Foundations

### NestJS Modular Monolith
The backend is structured as a **Modular Monolith** using NestJS. It balances operational simplicity and fast feedback with clean domain separation. Domain contexts are organized into autonomous internal modules that can be maintained independently and could be extracted into standalone services in the future without domain refactoring.

### Prisma + PostgreSQL Multi-Schema
A single PostgreSQL database is organized into distinct logical schemas per business domain:
- `catalog.*`: Defines product identity, SKUs, brand taxonomy, product lines, categories, and media.
- `commerce.*`: Manages listings, time-bound selling prices, and commercial rules.
- `sourcing.*`: Tracks internal supplier relationships, supplier offers, and cost/availability evidence.
- `ingestion.*`: Handles raw product intake, candidate deduplication, and workflow review gates.

Each table is strictly owned by exactly one module. Cross-context foreign keys are permitted only for database-level referential integrity; cross-context ORM relation navigation and cascade operations across schema boundaries are prohibited.

---

## 2. Module Communication & Public Contracts

- **Explicit Public Contracts**:
  Every business module exposes an explicit public boundary file (`public.ts`).
- **Isolation Enforcement**:
  Other modules and cross-cutting layers (such as `application/composition`) are only permitted to import from `module/public.ts`. Direct imports from internal module services, repositories, or entities are strictly forbidden and guarded by automated architecture tests (`test/architecture/module-boundaries.spec.ts`).

---

## 3. Domain Context Ownership

| Domain Module | Primary Ownership & Responsibilities | Key Rules |
| :--- | :--- | :--- |
| **Catalog** | Product identity, SKUs, Brands, ProductLines, Categories, ProductMedia. | Authoritative source of product identity. Does not manage price, inventory, or suppliers. |
| **Commerce** | `Listing`, `SellingPrice`, and commercial sellability resolution. | `isListed` does not equal available. Sellability requires active listing + valid selling price. |
| **Sourcing** | `Supplier`, `SupplierOffer`, and sourcing availability evidence. | Suppliers and raw wholesale costs are strictly internal and never exposed to customers. |
| **Fulfillment** | Hub operational execution, inventory allocation, packing, and dispatch. | Hub is modeled as `FulfillmentLocation`. Centralized operational control. |
| **Ingestion** | Controlled intake pipeline, candidate matching, and data enrichment. | Acts as a gated input funnel into Catalog; does not own published product truth. |
| **Care** | Customer routine profiles, step sequences, and progress check-ins. | Separated from Cart/Order state. Routines propose items; user confirms cart additions. |

---

## 4. Hub Operations & Fulfillment Modeling

- Fulfillment execution centers around the **Hub model**, represented as a `FulfillmentLocation`.
- The platform does not operate as an open marketplace or direct third-party dropship system.
- Incoming stock allocations from suppliers are received, verified, packed, and dispatched through controlled hub locations.

---

## 5. AI Service Integration Strategy

- **FastAPI Sidecar (`services/ai`)**:
  Shared AI workloads (ingredient analysis, text extraction, product classification, routine recommendations) are hosted in a dedicated FastAPI Python service.
- **Strict Advisory Role**:
  The AI service is an advisory/enrichment engine. It **never directly mutates** trusted database state in Catalog, Commerce, Orders, or Care.
- **Gated Ingestion & Review**:
  AI suggestions are generated as drafts or proposals (e.g. `RoutineProposal` in Care or candidate metadata in Ingestion). Writes to core trusted domain records occur only after human operator review or explicit customer acceptance.

---

## 6. Tiered Responsibility (Backend vs. Frontend)

- **Backend Owns Business Rules**:
  All business validations, pricing calculations, state machines, ownership checks, and sellability determinations are calculated deterministically on the backend.
- **Frontend Consumes Backend Contracts**:
  The Next.js frontend (`apps/web`) acts solely as a consumer of backend API contracts. It renders UI state and user flows without duplicating domain logic or pricing calculations.

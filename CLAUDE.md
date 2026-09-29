# Shena Care — Development & Engineering Guidelines

This repository follows a strict **Modular Monolith** architecture with a backend-first development discipline. All agents and contributors must follow these stable rules.

---

## 1. Core Architecture Rules

1. **Modular Monolith by Default**:
   - The application is a single deployable NestJS service with clean internal boundaries.
   - Do not introduce microservices, distributed queues, or new infrastructure without a validated requirement.

2. **Public API Contracts Only (`public.ts`)**:
   - Every module (`modules/catalog`, `modules/commerce`, etc.) must expose an explicit `public.ts`.
   - Other modules and the composition layer (`application/composition`) must **only** import from `module/public.ts`.
   - Never import internal files, services, entities, or repositories across module boundaries.
   - Enforced by automated architecture tests in `test/architecture/module-boundaries.spec.ts`.

3. **Multi-Schema Database Isolation (Prisma + PostgreSQL)**:
   - PostgreSQL logical schemas separate bounded contexts:
     - `catalog.*`: Product identity, SKUs, Brand, ProductLine, Category, ProductMedia.
     - `commerce.*`: Listings, SellingPrice, Cart, Orders.
     - `sourcing.*`: Supplier, SupplierOffer, supply evidence.
     - `ingestion.*`: Raw intake, candidate matching, content drafts.
   - No ORM relation navigation across context boundaries.
   - Mutations go through the owner module's service/API.

4. **Context Ownership & Boundaries**:
   - **Catalog** owns product identity and merchandising categorization.
   - **Commerce** owns listing status, active prices, and commercial sellability.
   - **Sourcing** owns supplier relations and availability evidence (suppliers are internal and never exposed to customers).
   - **Fulfillment** owns Hub operations (`FulfillmentLocation`).
   - **Guidance & AI** (`services/ai`) is advisory/supportive; it never directly mutates trusted core state.

5. **Backend Owns Business Rules**:
   - All validation, pricing resolution, sellability calculations, and constraints live on the backend.
   - Frontend (`apps/web`) is a consumer of backend contracts and must not duplicate business logic.

---

## 2. Backend Feature Workflow (Vertical Slice)

Every backend feature must be implemented as a verified vertical slice in this exact sequence:

1. **Domain Rule / Schema**: Define domain logic and update `schema.prisma`.
2. **Migration**: Generate and verify migration (`npx prisma migrate dev`).
3. **Owner Service / Use Case**: Implement business logic inside the owning module.
4. **Public Contract**: Export interfaces and DTOs in the module's `public.ts`.
5. **DTOs & Validation**: Validate inputs using `class-validator` and NestJS `ValidationPipe`.
6. **Controller / HTTP**: Expose REST endpoints in the composition layer (`application/composition`).
7. **Automated Testing**: Write unit and integration tests (`apps/api/test/integration/`).
8. **Verification**: Verify clean compilation, linting, and Postman request collections.

A feature is **Done** only when schema, business rules, validation, tests, and documentation are all in place.

---

## 3. Commands & Development Reference

### Backend (`apps/api`)
- **Run dev server**: `npm run dev`
- **Build production bundle**: `npm run build`
- **Run tests**: `npm test` (configured with `jest --runInBand`)
- **Type check**: `npm run typecheck` (`tsc --noEmit`)
- **Lint**: `npm run lint` (`eslint "{src,test}/**/*.ts"`)
- **Database migration**: `npx prisma migrate dev`
- **Generate Prisma client**: `npm run prisma:generate`
- **Seed database**: `npm run seed`

### Test Runner Guidelines
- Run tests with `--runInBand` to avoid database transaction lock contention.
- Maintain 100% pass rate for architecture boundaries and integration suites before committing.

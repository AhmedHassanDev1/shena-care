# Current Task: GLO-94 — Add Category hierarchy + primary Product category

## Goal
Add a simple hierarchical Category model to Catalog and assign each Product one primary category.

---

## Scope
- Category model inside the `catalog` PostgreSQL schema.
- Optional self-referencing `parentId`.
- name, slug, isActive, createdAt, updatedAt.
- Add `categoryId` and relation to Product.
- Add appropriate constraints and indexes.
- Create and run Prisma migration.
- Generate Prisma Client.
- Update affected seed/tests.
- Run tests.
- Start NestJS and verify there are no regressions.

---

## Out of Scope
- Category CRUD APIs.
- Frontend.
- Suppliers.
- Commerce changes.
- AI.
- Ingestion.
- Unrelated refactoring.

---

## Definition of Done
- Migration succeeds.
- Prisma Client generates.
- Seed/data remains valid.
- Tests pass.
- NestJS starts without errors.

---
name: nestjs-domain-workflow
description: Implement ShinaCare NestJS domain changes involving services, DTOs, module contracts or Prisma-backed business rules.
---

# NestJS domain workflow

Read CLAUDE.md section 1 and locate the owning module with `repo-navigation`.
Preserve the vertical slice: domain rule/schema when needed, migration when needed,
owner service/use case, public contract, validated DTO, controller and relevant tests.
Do not add a migration or composition endpoint to changes that do not need one.

Cross-module consumers use `modules/<domain>/public.ts`. Composition orchestrates
owner APIs; it does not acquire another module's repositories or mutate its tables.
Consult `authorization-review`, `api-security-testing` and `prisma-database-security`
for affected access/data boundaries, and `high-risk-change-review` for critical flows.
Use `secure-code` and `secrets-and-sensitive-data` for implementation safeguards.

Keep backend authority for pricing, sellability and inventory. Preserve allocation,
order/checkout idempotency, custody/barcodes, delivery/COD reconciliation, ingestion
review/publish gates, event handlers and API compatibility.

Use existing pnpm scripts: `pnpm --filter api typecheck`, `lint`, `build`, and
`test --runTestsByPath <test-path>`. Confirm argument forwarding with the installed
runner; Jest paths are relative to `apps/api`. Use `lean-testing` to choose the scope.
Generate clients with `prisma:generate`; create migrations using `migration:generate`
only against an isolated local database. Never use `migration:revert` as routine cleanup:
it runs `prisma migrate reset`. Do not mutate shared databases.

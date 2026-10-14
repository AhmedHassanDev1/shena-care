---
name: repo-navigation
description: Locate ShinaCare domain owners, entry points and contracts before a change spanning unfamiliar backend or storefront code.
---

# Navigate ShinaCare

Start with Git status and the target package manifest. Use `rg --files <scope>` and
`rg -n '<symbol|route|event>' <scope>`; exclude dependencies, builds, caches and data exports.

- Backend entry: `apps/api/src/app.module.ts`. Domains live in `src/modules/`;
  cross-domain HTTP composition is in `src/application/composition/`, infrastructure
  in `src/platform/`. Follow `public.ts` and Nest imports/providers before internals.
- Database: `apps/api/prisma/schema.prisma` and `prisma/migrations/`. Locate the owner
  schema and scalar IDs; do not infer cross-context ORM navigation is permitted.
- Storefront: `apps/web/src/app/` routes, `features/` compositions/hooks,
  `components/ui/` and `components/navigation/` shared UI, `lib/` typed API consumers.
  Read `apps/web/design-system/README.md` only for visual changes.
- Business Workspace: `apps/business/app/`, `components/`, `lib/`; separate framework
  versions and design stack. Lack of storefront imports does not make it unused.
- AI: `services/ai/app/`, `tests/`, `pyproject.toml`; advisory contracts, no trusted-state writes.
- No shared package is currently implemented under `packages/`. Verify before creating one.

Trace one relevant request or event through controller, service, owner contract and test.
Search `docs/project/`, `docs/architecture/` or `docs/frontend/` for the specific domain;
historical status labels may lag implementation. Return paths and ownership boundaries,
not a repository-wide source dump. Do not access Linear to fill navigation gaps.

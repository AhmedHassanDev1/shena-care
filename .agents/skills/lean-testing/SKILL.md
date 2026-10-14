---
name: lean-testing
description: Select proportionate ShinaCare verification for a code or cleanup diff, expanding regression coverage when critical commerce or security behavior changes.
---

# Proportionate verification

Read actual package scripts and the diff before choosing checks. Use the existing
TDD skill for feature/bug behavior and verification-before-completion for evidence.
Do not add mirror tests for documentation or generated-cache removal.

- Documentation/skills: validate metadata, referenced paths, script names, Git diff
  and credential absence. Validate new skills with skill-creator's `quick_validate.py`
  and installed Codex `skills/list` discovery when available.
- Storefront logic/import/dependency change: focused Jest paths plus typecheck/lint;
  build for routes, configuration or dependencies. Visual changes add token/design,
  route/RTL and viewport checks from `nextjs-frontend-workflow`.
- Backend logic: focused owner unit/integration paths, architecture tests, typecheck,
  lint and build. Pricing, checkout, allocation, authorization, fulfillment and COD
  changes expand to affected cross-domain integration tests and full API regression.
- AI cache/source change: run `AI_PROVIDER=mock python -m pytest` in `services/ai`
  with an interpreter containing the declared dependencies. Check the virtual environment
  first; this workstation also has a usable system Python. Avoid real provider calls.

API Jest's setup requires a DATABASE_URL ending in `_test`, including architecture
and mocked unit tests. Those DB-free suites can use an unreachable local placeholder
with TEST_BYPASS_AUTH=false. Never use a placeholder for DB-backed suites. Full
regression requires an isolated disposable PostgreSQL database with migrations/seed;
inspect test setup before running it. Keep the guard and all legitimate tests intact.

Use pnpm filters with exact test paths; if the local pnpm launcher is broken, report
it and use the existing npm package scripts for validation without reinstalling the
workspace or changing locks. An alternate pnpm runtime can automatically prepare this
mixed installation even for `exec`; inspect that behavior before invoking it.
Save complete logs locally; show bounded summaries with
exit codes, counts and failure locations. Compare failures against a pre-change baseline.
Expand or repeat checks only after relevant edits, failures or unresolved concerns.

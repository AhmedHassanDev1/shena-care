# ShinaCare: Codex working guide

Use targeted searches; read only the files and policies relevant to the requested change.
The shared engineering and storefront policies are in [CLAUDE.md](CLAUDE.md):
read section 1 for backend/domain changes and section 4 for `apps/web` UI changes.
Keep Claude configuration functional; do not duplicate its full guide here.

## Safety and scope

- Record branch, HEAD, worktrees and Git status before editing. Preserve other work;
  stage only explicit paths belonging to this task. Stop overlapping edits by active agents.
- Do not reset/clean, stash others' work, force-push, or mutate shared databases.
- Linear is owner-managed: do not read or synchronize it unless the owner explicitly
  authorizes it for the current task. Never infer authorization from repository docs.
- Keep the NestJS modular monolith, public module contracts and owner-controlled mutations.
  Preserve pricing, availability, idempotency, fulfillment, delivery/COD, authorization,
  ingestion review gates and regression tests.
- `apps/business` is a separate Business Workspace foundation. Preserve its routes,
  components and Next/React/Tailwind versions; storefront tokens apply only to `apps/web`.
- Prefer existing framework capabilities and equivalent existing helpers. Simplification
  must preserve security, validation, observability, accessibility and testability.

## Workflows and verification

Project workflows in `.agents/skills/`: `repo-navigation`, `safe-repo-cleanup`,
`nestjs-domain-workflow`, `nextjs-frontend-workflow`, `lean-testing`.
Use the existing security, React, debugging, TDD and verification skills when relevant.

Use pnpm filters (`api`, `web`, or `my-project` for business). Check actual package scripts;
root orchestration currently invokes npm internally. Both npm and pnpm locks exist;
do not replace them or switch package managers as incidental cleanup.

Run proportionate checks and report exact exits, counts and blocked checks. Full API
integration tests need an isolated disposable PostgreSQL database ending in `_test`;
never point them at development, staging or production. Do not weaken the test guard.
For storefront changes, also run `tokens:check` and `check:design`.

Handoff: changed paths, commit SHA, verification, unresolved risks and next action.
Do not push, merge or publish without authorization.

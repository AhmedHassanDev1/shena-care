---
name: nextjs-frontend-workflow
description: Integrate ShinaCare storefront routes, typed API calls or React Query flows while preserving the approved UI and Arabic RTL behavior.
---

# Storefront integration

Scope this workflow to `apps/web`. Read CLAUDE.md section 4 and
`apps/web/design-system/README.md` for visual changes. `apps/business` has a separate
Next/React/Tailwind stack; do not apply storefront tokens or copy components into it.

Trace the route in `src/app/`, feature composition/hooks in `src/features/`, and API
consumer in `src/lib/api-client.ts` and the domain helpers that use it. Reuse typed backend contracts,
query keys and shared components rather than reimplementing pricing or sellability.
Apply the installed `vercel-react-best-practices` skill where relevant.

Preserve loading, empty/error, unauthorized, unavailable and price-change states.
Keep Arabic-first RTL, logical CSS, English behavior, isolated LTR phone/OTP fields
and `<bdi>` for numeric/Latin runs. Preserve keyboard use and accessible labels.

Edit canonical `design-system/tokens.json` for new design values; regenerate with
`pnpm --filter web tokens`. Never hand-edit generated styles/scales. Fix shared UI
centrally; feature pages compose it without reskinning.

Verify with `pnpm --filter web tokens:check`, `check:design`, `typecheck`, `lint`, `test`
and `build` as relevant. UI changes also need `check:ui-reset` and visual checks at
375, 768 and 1280px in Arabic and English. Report blocked checks explicitly.

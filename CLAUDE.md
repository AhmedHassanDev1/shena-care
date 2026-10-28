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

---

## 4. Frontend Design System (`apps/web` only)

The storefront uses **SAHEL V2 (package SAHEL V18)** as its only design system — approved package `docs/design/sahel-v18/` (read its `README.md` precedence rules: boards over docs, Authentication Addendum over V17 for sign-in, FloatingNav over the drawn tab bar, `03-tokens/tokens.json` canonical, `99-archive/` never). Full guide: [`apps/web/design-system/README.md`](apps/web/design-system/README.md). Scope: `apps/web` — never `apps/business`. No parallel themes, legacy aliases or compatibility layers.

### Where things live
- **Canonical tokens:** `apps/web/design-system/tokens.json` — byte-identical to `docs/design/sahel-v18/03-tokens/tokens.json`. `tokens.app.json` holds only values the V18 package states elsewhere (board-only colours pending design confirmation, mobile display sizes, board type/radius/spacing ramps, control sizes, board shadows, motion, breakpoints); it can never redefine a canonical name.
- **Generated runtime styles:** `npm run tokens` (`scripts/build-tokens.mjs`) → `src/styles/tokens.generated.css` + `src/styles/design-scales.generated.ts`. Both are committed; never edit them. `predev`/`prebuild` regenerate them. Tailwind reads the same JSON through `design-system/tailwind-preset.ts` and *replaces* its default colours/radii/shadows/type scales, so `tailwind.config.ts` holds no design values and raw palette classes do not exist.
- **Fonts:** Beiruti (display), IBM Plex Sans Arabic (text), Instrument Serif italic (campaign line only), self-hosted from `@fontsource` in `src/app/layout.tsx`; `<html lang dir>` is set from the locale (Arabic RTL first).
- **Shared components:** `src/components/ui/*` (Button / AsyncButton with Shutter Loading, IconButton, TextField / PhoneField / TextAreaField, OtpInput, SearchField, Chip, StatusChip, MessageBox, QuantityStepper, ProductTile, Timeline, Toast, Sheet, Dialog, Skeleton, Icon, Wordmark, SectionHeader) and the shell `src/features/shell/*` (SiteHeader, FloatingNav, FocusHeader, SiteFooter, StorefrontShell, CartLink). The shared product card is `src/features/catalog/components/ProductCard.tsx`.

### Adoption rules
1. No hex, raw palette classes, legacy "Kohl & Malachite" names, arbitrary `text-[…]`/`bg-[…]`/`rounded-[…]`/`shadow-[…]`/`font-[…]`/`leading-[…]`/`tracking-[…]`, `lucide-react`, or physical `left/right` utilities in TSX (enforced by `npm run check:design`).
2. Use SAHEL names: colours `bone|linen|sand|dune|night|ink-2|ink-3|line|line-2|blue*|coral*|saffron*|ok|err*`, type `text-display-hero|display-1|display-2|display-3|title|body|product-name|brand|price|label|campaign` plus the board ramp (`text-13`, `leading-22`), radii `rounded-image|input|card|sheet|pill`, shadows `shadow-elevation-1|2|3` and the inset outlines.
3. Shutter Loading only on async buttons in the pending state (`Button loading` / `AsyncButton`); cards, images, pages and infinite scroll keep skeletons and written status.
4. Fix shared components centrally; pages may only lay out (grid, spacing, order), never re-skin a shared component.
5. Logical CSS, `<bdi>`/`dir="ltr"` for Latin runs, phone/OTP isolated LTR. Errors/success always carry words.
6. **Digits (scoped):** in the *Arabic storefront* prices, totals, quantities, counts and dates use Arabic-Indic digits with the Arabic thousands separator («٣٬٣٢٠ ج.م», «١٨ أكتوبر ٢٠٢٦») via `src/lib/i18n/format.ts` (Intl, never manual digit replacement). The English storefront and `apps/business` keep Western digits. Phone numbers, OTP codes, SKU codes and order/transaction references stay Western and LTR; numbers inside English product names are left as written; API payloads, stored values and calculations never use display formatting.
7. New design value → `tokens.json` only when SAHEL adds it; otherwise `tokens.app.json` with its V18 source (+ contrast pair in `src/styles/contrast-pairs.json`), then `npm run tokens`.

### Verification (run from `apps/web`)
- `npm run tokens:check` — generated files in sync with `tokens.json` + `tokens.app.json`
- `npm run check:design` — WCAG contrast pairs + hex / palette / icon / direction / legacy-name guardrails
- `npm run typecheck` · `npm run lint` · `npm test`
- `npm run check:ui-reset` — route/RTL contract (starts its own dev server)
- Visual: compare against `docs/design/sahel-v18/05-boards/png/` at 390 and 1440 (Arabic), plus English spot checks.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- A committed graphify-out/graph.json is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild or its hooks.

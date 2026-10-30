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

The storefront has **one** design system: [`docs/frontend/design-system.md`](docs/frontend/design-system.md) (luxury editorial beauty, smoke-white ground, emerald accent, photography-led, Arabic-first RTL). Read it before touching `apps/web`. Stitch defines the **page structure** of each page; the shared system defines everything visual. Scope: `apps/web` only, never `apps/business`. No parallel themes, legacy aliases, compatibility layers or page-specific styles that conflict with the shared system. The SAHEL V18 documents (`apps/web/design-system/README.md`, `docs/design/sahel-v18`) are deprecated and are not a visual reference.

### Where things live
- **Tokens:** `apps/web/design-system/tokens.json` (+ `tokens.app.json` for values the canonical file lacks) → `npm run tokens` → `src/styles/tokens.generated.css` + `design-scales.generated.ts` (committed, never hand-edited; `predev`/`prebuild` regenerate). Tailwind reads the same JSON through `design-system/tailwind-preset.ts` and *replaces* its default colours/radii/shadows/type, so raw palette classes do not exist. The action colour token is `bottle` (emerald); `blue` no longer exists.
- **Fonts:** Beiruti (display), IBM Plex Sans Arabic (text), Instrument Serif italic (one Latin campaign line, not UI), self-hosted from `@fontsource`.
- **Shared components:** `src/components/layout/*` (`Section`, `SectionHeader`, `PageContainer`), `src/components/ui/*` (Button, Chip, ChipLink, GlassBadge, ArrowLink, MediaFrame, cardVariants, ProductTile, Icon, MessageBox, Skeleton, …), the shell `src/features/shell/*`, and `features/catalog/components/ProductCard.tsx`. The catalog of components and when to use each is in the design-system doc §3.

### Mandatory visual consistency rules
1. No hex, raw palette classes, arbitrary `text-[…]`/`bg-[…]`/`rounded-[…]`/`shadow-[…]`/`font-[…]`/`leading-[…]`/`tracking-[…]`, `lucide-react` (icons are Lucide-style paths added to `components/ui/icon-paths.ts`), or physical `left/right` utilities in TSX (enforced by `npm run check:design`).
2. Compose pages from `Section` / `SectionHeader` and the shared components. A page may lay out (grid, order); it never re-skins a shared component and never invents its own card, chip, badge, button, section-title or image treatment. Need a new pattern? Add it to the shared system and the doc first, then use it.
3. Spacing comes from `Section` rhythm only; do not patch whitespace with per-page padding.
4. Shutter Loading only on async buttons in the pending state; cards, images, pages and lists use skeletons and written status. Every data section implements loading, error (with retry), empty and data states.
5. Motion is purposeful, transform/opacity only, and respects `prefers-reduced-motion`; auto-moving content has a pause control.
6. Logical CSS, `<bdi>`/`dir="ltr"` for Latin runs, phone/OTP isolated LTR. Errors and success always carry words. Every string in both languages (`messages.test.ts`).
7. **Digits (scoped):** in the *Arabic storefront* prices, totals, quantities, counts and dates use Arabic-Indic digits with the Arabic thousands separator via `src/lib/i18n/format.ts` (Intl, never manual replacement). The English storefront and `apps/business` keep Western digits. Phone numbers, OTP codes, SKU codes and order/transaction references stay Western and LTR; API payloads, stored values and calculations never use display formatting.
8. New design value → `tokens.json`/`tokens.app.json` (+ a contrast pair in `src/styles/contrast-pairs.json`), then `npm run tokens`.

### Mandatory asset and data rules
1. **Photography, never drawing:** no SVG or CSS-drawn bottles, packs, faces or scenes, and no cartoon or generic illustration standing in for a photograph. SVG is for icons and UI chrome only.
2. **Products and brands come from the catalog API only.** Never invent, generate or draw a product, pack, label, brand mark or price, and never add fixtures to the storefront. A missing product photo shows `ProductTile`'s labelled placeholder; a missing logo shows the brand name in type.
3. **Every image asset is registered and documented:** campaign photos in `public/images/home` via `features/home/lib/home-images.ts`, logos via `brand-logos.ts`, each listed in `docs/frontend/homepage-image-manifest.md` with source, rights status and the missing-asset list. Missing essential photography is reported there, never silently replaced.
4. Images use `next/image` with real dimensions or `fill` + `sizes`, an `alt` (empty only when adjacent text says the same), `priority` only for the first-screen hero.
5. Never hide an API error, and never loosen a backend rule (availability window, sellability, price) to make a screen look full. If a screen is empty, trace the cause (design-system doc §10) and report it.

### Verification (run from `apps/web`; all must pass, and visual work needs real screenshots)
- `npm run tokens:check` — generated files in sync
- `npm run check:design` — WCAG contrast pairs + hex / palette / icon / direction / legacy-name guardrails, then `check:assets` (referenced files exist, declared image sizes match, every public image is in the manifest, no inline SVG in `features/home`, `<Image>` always has alt)
- `npm run typecheck` · `npm run lint` · `npm test` · `npm run build`
- `npm run check:ui-reset` — route/RTL contract (starts its own dev server)
- Visual: screenshots at 390 and 1440 (Arabic) plus English spot checks, with real catalog data where the page shows it; verify navigation, images, animation, API states and keyboard access.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- A committed graphify-out/graph.json is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild or its hooks.

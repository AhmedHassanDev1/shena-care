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

The storefront uses the **ShinaCare "Kohl & Malachite"** design system. Full guide: [`apps/web/design-system/README.md`](apps/web/design-system/README.md). Scope: `apps/web` — never `apps/business`.

### Where things live
- **Canonical tokens:** `apps/web/design-system/tokens.json` (verbatim from the supplied `ShinaCare-Design-System/tokens/tokens.json`). `roles.json` only maps app role names (`bg-primary`, `text-muted-foreground`…) onto token names.
- **Generated runtime styles:** `npm run tokens` (`scripts/build-tokens.mjs`) → `src/styles/tokens.generated.css` + `src/styles/design-scales.generated.ts`. Both are committed; never edit them. `predev`/`prebuild` regenerate them. Tailwind reads the same JSON through `design-system/tailwind-preset.ts`, so `tailwind.config.ts` holds no design values.
- **Fonts:** Alexandria (display) and IBM Plex Sans Arabic (text) via `next/font` in `src/lib/fonts.ts`; `<html lang dir>` is set from the locale (Arabic RTL first).
- **Shared components:** `src/components/ui/*` (Button, IconButton, Input/TextField/PhoneField, OtpInput, SearchField, Alert, Badge, Card, Skeleton, BeadLoader, Icon, Wordmark, SectionHeader, Rail, ProductNiche, ProductArt, ConcernGlyph…) and `src/components/navigation/*` (BottomNav, WordmarkLink). Home and Auth consume them; feature folders keep only product-specific composition.
- **Reference material** (outside the repo): `ShinaCare-Design-System/` — `docs/*.md` (brand book, layout, motion, imagery, implementation), component READMEs/previews, screens. The reference screens are validation compositions, not approved designs.

### Adoption rules
1. No hex, raw Tailwind palette classes, arbitrary design px, `lucide-react`, or physical `left/right` utilities in TSX (enforced by `npm run check:design`).
2. Use token utilities: colors by role, `text-display-*|title|heading|body*|label|caption|price*`, `rounded-xs|sm|md|lg|pill`, `h-control-s|m|l`, `shape-arch`, `shadow-float|sheet`, `duration-quick|settle`.
3. Shape rule: pressable → pill; product image → arch niche; reading surface → rectangle. Flat by default (hairline border, no shadow).
4. Fix shared components centrally; pages may only lay out (grid, spacing, order), never re-skin a shared component.
5. Logical CSS, `<bdi>` for numbers/Latin runs, phone/OTP isolated LTR, Western digits. Errors/success always carry an icon and words.
6. New design value → `tokens.json` first (+ contrast pair in `src/styles/contrast-pairs.json`), then `npm run tokens`.

### Verification (run from `apps/web`)
- `npm run tokens:check` — generated files in sync with `tokens.json`
- `npm run check:design` — WCAG contrast pairs + hex / palette / icon-library / direction guardrails
- `npm run typecheck` · `npm run lint` · `npm test`
- `npm run check:ui-reset` — route/RTL contract (starts its own dev server)
- Visual: `npm run dev`, then check `/`, `/auth`, `/auth/verify` at 375, 768 and 1280px in Arabic and English.

# Shop by Concern vs Shop by Category — UX direction (for Antigravity)

Status: direction only. Nothing in `apps/web` was changed. Owner of the storefront build: Antigravity.

## The idea: two doors, one shelf

Shoppers arrive in one of two modes, and the storefront should serve both without two navigation trees:

| Mode | Who | Door | Promise |
|---|---|---|---|
| "I have a problem" | new, unsure, comparing | **حسب الاهتمام** (Concern) | "ابدأ من مشكلتك — هنوريك الخطوات" |
| "I know what I need" | repeat, specific | **حسب النوع** (Category) | "رايح على المنتج مباشرة" |

**Concern is the default door. Category is the refine.** A concern page is a *guided shelf*; a category page is a *fast shelf*. Both are the same listing component with different framing, so a shopper can cross over at any point (Concern + Category = "غسول للبشرة الدهنية").

## What each page looks like

**Concern page (`/products?concern=oily-skin`)** — story first, shelf second:
1. Plain title and one sentence of what the page helps with. No cure, treatment or prevention wording (the backend already rejects it in routines).
2. **Ready Routine card** if one is published for this concern (`GET /care/ready-routines?concern=<slug>`): steps count, AM/PM tabs preview, one action "شوف الروتين الكامل". No published routine → no card (never a placeholder).
3. Products **grouped by routine role** (غسول / علاج / مرطّب / واقي شمس), each group titled like a category and linking to it. This is the bridge between the two doors.
4. Footer prompt: "مش متأكد؟ كلّم شينا" → the assistant, pre-filled with the concern.

**Category page (`/products?category=cleansers`)** — shelf only:
1. Grid + filters. **Concern is a filter chip here**, not a second navigation.
2. A quiet line under the title: "بتدوّر على حاجة لمشكلة معيّنة؟ تسوّق حسب الاهتمام".

## Navigation

- Header "تسوّق" opens a two-column panel: right column **الاهتمامات** (6–8, real concerns that have products), left column **الأنواع** (categories). One "كل المنتجات" link underneath.
- Mobile: one bottom sheet with a two-segment switch (اهتمام | نوع); the last used segment is remembered (per-viewer convenience only, `localStorage` in try/catch).
- Home: the existing concern shelf stays the lead; add a slim "أو تسوّق حسب النوع" row beneath it. Do not make two equal hero blocks.

## Rules that keep it honest

- **Show a concern only if it has content** (≥ N sellable products or a published Ready Routine). A dead shelf is worse than a missing one. Hide, don't grey out.
- Concern labels and counts come from `GET /care/concerns` and the discovery API; never invent a concern, product or count. Counts use Arabic-Indic digits via `src/lib/i18n/format.ts`.
- Real product photography only; concern tiles use catalog photos or type, never drawn illustrations.
- One URL model for both doors (`?concern=` + `?category=`), so links, back button and sharing work. Filters combine with AND.
- Every data block keeps loading / error-with-retry / empty / data states; an empty concern says why in words.
- Motion is transform/opacity only and respects `prefers-reduced-motion`.

## Creative moment (small, optional)

On a concern tile, hovering/focusing reveals the routine as a row of step dots ("٤ خطوات · صباحًا ومساءً") — it teaches that concern = a routine, not a bag of products, and it is the one place the two doors visibly meet.

## How to know it works

- Share of sessions entering via Concern vs Category, and crossover rate between them.
- Zero-result and bounce rate on concern pages; add-to-cart rate from the routine card vs the grouped shelf.
- Ready Routine copy-to-My-Routine rate from concern pages.

## Data contracts Antigravity can rely on (all live in the Business API branch)

- `GET /care/concerns` — public taxonomy.
- `GET /care/ready-routines?concern=<slug>` and `GET /care/ready-routines/:id` — published templates only, with per-step product state (`AVAILABLE | UNAVAILABLE | UNPUBLISHED | ...`), prices from Commerce.
- `POST /care/personal-routines/from-template/:id` (signed in) — "save a copy to My Routine".
- Product discovery already accepts `concern`.

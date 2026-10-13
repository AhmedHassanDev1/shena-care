# Home page: API integration gaps

The Home page (`src/features/home/`) always renders the approved design. Where a backend capability does
not exist yet it uses typed fixtures from `src/features/home/mocks/`, switched on only in **design preview**.

## Design preview

`isHomePreview()` (`lib/preview.ts`):

| Build | `NEXT_PUBLIC_HOME_PREVIEW` | Fixtures |
| --- | --- | --- |
| `next dev` | unset | on |
| `next dev` | `false` | off |
| `next build` / production | unset | **off** |
| any | `true` | on |

Fixtures are used only when preview is on. A failed response never turns them on (only a successful, empty one
does, for concerns), and they are never connected to the cart, checkout or any stored routine. With preview off
the Home page shows only real data: the hero campaigns are editorial and always shown; the concerns section shows
the public taxonomy (omitted while it is empty) and the suggested-routines row is omitted.

Products, prices, media and Quick Add always use the real catalog and cart APIs. The only product fixture is the
opt-in, development-only `/?preview=products` shelf described below.

## Gaps

### Suggested routines (`RecommendedRoutines`)

- **Mock source:** `mocks/routines.ts` (`PREVIEW_ROUTINES`; the first three are shown), via the seam `data/routines.ts` (`loadPublishedRoutines`).
- **Expected contract:** a public listing of published routines. Not confirmed; none exists. Today only `GET /care/routines/:id` exists and it requires authentication.
- **Missing capability:** listing, a way to mark routines as published or featured, and a routine detail page in the web app (`routes.routine(id)` points at a route that does not exist).
- **Data mapping:** to `RoutineSummary` (`lib/routines.ts`): `id`, `title`, `description`, `careArea`, `stepCount` (count of routine steps), `href` (routine detail route), optional `imageSrc`, `timeOfDay` and `concern` (display name of the targeted concern) — the card shows the optional fields only when present.
- **Switch to the real API:** return the mapped list from `loadPublishedRoutines`, remove the preview branch, delete `mocks/routines.ts`. `selectSuggestedRoutines` already limits the row to three, unique by id.
- **Interaction:** the rail (swipe, snap, keyboard via the card links) is functional. Card links go to `/routine/builder` because no routine detail exists.

### Shop by concern (`ConcernSection`)

- **Contract (resolved):** `GET /care/concerns` is now **public** (`CareTaxonomyController`, apps/api). It returns
  active concerns only, in the projection `id, name, slug, careArea, description, isActive`, ordered skin then hair.
  Profiles and every write stay guarded (`apps/api/test/integration/care-domain.e2e-spec.ts`). Guests and customers
  see the same discovery options; nothing customer-specific is ever returned.
- **States (`resolveConcernsView`, unit-tested):** loading → chip skeletons; request failed → notice with retry
  (never presented as "no concerns", never replaced by fixtures); real concerns → chips; real list empty → section
  omitted, except in design preview where the labelled fixtures (`mocks/concerns.ts`) fill in.
- **Data blocker:** the seed creates no concerns, so outside design preview the section is omitted until the
  taxonomy is entered (admin `POST /care/concerns`). Well-known slugs (`acne`, `dryness`, `pigmentation`,
  `fine-lines`, `dullness`, `hair-loss`, `dandruff`) get their own glyph and color; others fall back by care area.
- **Missing capability:** a concern filter on `GET /products` and a real `/products` listing. The chips link to
  `/products?concern=<slug>`, which today lands on the redesign-pending scaffold.

### Featured products (`FeaturedProducts`)

States are distinct: loading → streamed skeleton (Suspense); API failure → error notice with retry (never shown
as an empty catalog); genuinely empty catalog → `CatalogEmpty` (no products, no prices); products → grid. Preview
product cards exist only in `next dev` with `/?preview=products`, are labelled, carry no price and cannot be added
to a cart. The development database currently has no published, sellable products, so the grid itself was not
exercised with real data in this pass.

### Photography

Home owns four licensed campaign photographs and shows each once: the two portraits in the hero, the two still
lifes in "Shop by category". The third hero slide, the routine covers and the routine-builder band are drawn from
the brand's own vector motifs (arches, beads, discs). More campaign photography (e.g. a haircare campaign, texture
close-ups) is needed before the hero can carry more photographic slides or the routine cards can be photographic.

### Routine builder band (`BuildRoutineBanner`)

- **Content:** copy and the three steps come from `getDiscoveryContent` (`lib/i18n/messages.ts`); the CTA goes to `/routine/builder`.
- **Missing capability:** the `/routine/builder` screens. The route still renders the redesign-pending scaffold. The care
  workspace API (`care/workspace/drafts` and proposals) exists; the web screens do not.
- **Note:** `getDiscoveryContent` still returns illustrative `questions` (`mocks/builder-preview.ts`) that the band no longer
  renders; derive them from the real questionnaire, or drop them, when the builder is built.

### Other routes the Home page links to

`/products`, `/products/[slug]`, `/cart` and `/account` are still redesign-pending scaffolds (`docs/frontend-reset.md`). The Home page links to the real routes and will work as they are rebuilt.

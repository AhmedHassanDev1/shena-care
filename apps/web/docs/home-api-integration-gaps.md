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

Fixtures are used only when preview is on. A failed, unauthorized or empty real response never turns them on,
and they are never connected to the cart, checkout or any stored routine. With preview off the Home page
shows only real data: the hero falls back to one catalog-browsing slide and the concerns and suggested-routines
sections are omitted.

Products, prices, media and Quick Add always use the real catalog and cart APIs; there is no fixture for them.

## Gaps

### Featured routine hero (`FeaturedRoutineHero`) and suggested routines (`RecommendedRoutines`)

- **Mock source:** `mocks/routines.ts` (`PREVIEW_ROUTINES`: three hero slides, three suggested), via the seam `data/routines.ts` (`loadPublishedRoutines`).
- **Expected contract:** a public listing of published routines. Not confirmed; none exists. Today only `GET /care/routines/:id` exists and it requires authentication.
- **Missing capability:** listing, a way to mark routines as published or featured, and a routine detail page in the web app (`routes.routine(id)` points at a route that does not exist).
- **Data mapping:** to `RoutineSummary` (`lib/routines.ts`): `id`, `title`, `description`, `careArea`, `stepCount` (count of routine steps), `href` (routine detail route), optional `imageSrc`.
- **Switch to the real API:** return the mapped list from `loadPublishedRoutines`, remove the preview branch, delete `mocks/routines.ts`. `splitRoutines` already limits the hero to three and keeps suggested routines distinct by id.
- **Interaction:** the swiper (swipe, buttons, dots, arrow keys, counter) is functional. Slide and card links go to `/routine/builder` because no routine detail exists, so they are visual-only.

### Shop by concern (`ConcernSection`)

- **Mock source:** `mocks/concerns.ts` (`PREVIEW_CONCERNS`), used by `hooks/useConcerns.ts` only when preview is on and there are no real concerns.
- **Expected contract:** `GET /care/concerns` returns `Concern` (`lib/concerns.ts`); it exists but requires a signed-in customer, so guests never get real data. Not confirmed whether it should become public.
- **Missing capability:** public access to active concerns, and a concern filter on `GET /products` (the tile links go to `/products?concern=<slug>`, which the listing does not support).
- **Data mapping:** none beyond the existing shape; icons come from `concernIcon` by slug, with a care-area fallback.
- **Switch to the real API:** once concerns are public, drop the `enabled: isAuthenticated` guard and the preview fallback in `useConcerns`; delete `mocks/concerns.ts`. Add the product filter before enabling the links.
- **Interaction:** visual-only for guests in preview; real data for signed-in customers.

### Routine builder banner and three steps (`RoutineDiscoveryZone`)

- **Mock source:** `mocks/builder-preview.ts` (question cards), copy in `lib/i18n/messages.ts`.
- **Expected contract:** the guided questionnaire. The care workspace API (`care/workspace/drafts` and proposals) exists; the web screens do not. Not confirmed that its questions match the preview cards.
- **Missing capability:** the `/routine/builder` screens. The route still renders the redesign-pending scaffold.
- **Data mapping:** the preview cards must be replaced by (or derived from) the real questions.
- **Switch to the real API:** build the builder route; the CTA already points to it. Then derive `questions` in `getDiscoveryContent` from the real flow, or drop the cards.
- **Interaction:** visual-only. The cards are decorative (`aria-hidden`); no demo questionnaire was built.

### Other routes the Home page links to

`/products`, `/products/[slug]`, `/cart` and `/account` are still redesign-pending scaffolds (`docs/frontend-reset.md`). The Home page links to the real routes and will work as they are rebuilt.

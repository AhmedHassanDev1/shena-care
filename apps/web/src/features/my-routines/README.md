# Routines experience (`features/my-routines`)

Three connected storefront pages on the customer's own routines, built on the existing «My Routine» API
(`/care/personal-routines`). No backend change; no table, endpoint or recommendation rule was touched.

| Page | Route | View |
| --- | --- | --- |
| Make your routine | `/routines/build` (`?product=<slug>` starts with that product) | `RoutineBuilder` |
| My routines | `/account/routine` | `MyRoutinesView` |
| Routine details | `/account/routine/[id]` (`?edit=1` opens the editor) | `RoutineDetailsView` |

The older localStorage tracker and the earlier catalog builder (`features/routine/components/ActiveRoutineTracker.tsx`,
`CatalogRoutineBuilderView.tsx`) are no longer routed; `features/routine/lib/catalog-routine.ts` (`sequenceRoutine`) is reused.

## What talks to which API

| Need | Endpoint | Notes |
| --- | --- | --- |
| List / read / create / replace / delete | `GET/POST /care/personal-routines`, `GET/PUT/DELETE /:id` | Replace sends the whole routine plus `expectedVersion`; the server answers `409 STALE_VERSION` on a clash |
| Products, photos, prices | `GET /products?limit=100` | Photo = `compactImage` (identity packshot) |
| Role and time-of-day hints | `GET /catalog/routine-profiles?skuIds=` | Hint only when the profile says AM/PM; never defaulted |
| Suggestions | `POST /guidance/recommendations` | Engine reason text shown verbatim; safety answers applied server-side |
| Order guidance | `POST /catalog/routine-profiles/sequence` | «Arrange by product type» (reuses the existing capability) |
| Compatibility | `POST /care/routines/check` | Shared `RoutineCompatibilityPanel`; a `BLOCK` issue holds saving |
| Add to cart | `POST /care/personal-routines/:id/cart` | One time of day; lines already in the cart are never doubled |

## Morning / Evening

`lib/period.ts` resolves the default from the browser-local clock (no geolocation): Morning 06:00–17:59, Evening
18:00–05:59 (`ROUTINE_PERIOD_CONFIG`, overridable). The default applies once, on entering a page. A manual choice is kept in
`sessionStorage` so the three pages agree, and nothing flips it afterwards (no timer).

`RoutineStage` paints shutter light: `components/ambient/ambient-sky.css` cross-fades a Morning layer (warm linen ground, alternating soft
shadow/sun slats from the upper-left) and an Evening layer (deep indigo ground, cool luminous slats from the upper-right). CSS only
(gradients and masks), masked to one corner so it fades toward the content, behind content, stops under `prefers-reduced-motion`.
The Evening theme remaps the surface tokens (chalk, linen, ink, stone, cobalt…) to `night-*` tokens on `<html data-routine-theme>`,
so the header, footer, sheets and shared components follow without a second stylesheet. Tokens: `dawn`, `sunlight`, `night-*`
in `tokens.app.json`, with contrast pairs. Note: this app's `sm` breakpoint is 360px; the card's desktop layout uses `md`.

## Editing model

`lib/draft.ts` is pure: add, remove, replace, move between Morning/Evening, nudge, reorder, validate, payload. Builder and
details share `StepsEditor`; every structural change is one entry in `useDraftHistory` (undo).

## Known backend gaps (documented, not faked)

1. **List endpoint has no per-time-of-day counts or product photos.** `GET /care/personal-routines` returns only
   `{title, careArea, origin, version, steps, updatedAt}`, so My routines fetches each routine (≤ 20) to show thumbnails and
   Morning/Evening counts. A `{am, pm, previewSkuIds}` summary on the list would remove up to 20 requests.
2. **No duplicate endpoint.** «Duplicate» is a client `POST` of the same steps with a «(copy)» title. Alternatives and notes are
   kept; the server still re-validates everything.
3. **No PATCH of a single step.** Every edit is a full `PUT`; with up to 30 steps that is fine, but it means one writer wins and
   the other gets `STALE_VERSION` (handled with a Reload action).
4. **No per-step usage guidance of its own.** «How to use» shows the product's catalog `usage` text, labelled as product data,
   plus the customer's own note. Frequency (days of the week) exists only for the engine's `customerUsageSchedule`, not for
   personal routines, so it is not shown.
5. **Writes are slow on the dev database** (a save or duplicate takes several seconds). The UI shows pending states and never
   assumes success.
6. **Validation messages (unsupported-claim screening) come back in English** from the API; the page shows them verbatim.

## Background photographs (asset register)

The Morning/Evening backgrounds are two supplied background-only images, converted to WebP with Next's bundled encoder
(quality 92, 949×462, 8–9 KB each). Source and rights: supplied by the project owner as the approved reference backgrounds (no text,
no product, no people). Missing from `docs/frontend/homepage-image-manifest.md` only because that file is not part of this checkout;
add these two rows when it is merged.

| File | Use | Anchor | Ground colour behind it |
| --- | --- | --- | --- |
| `public/images/routines/morning-light.webp` | Morning sky, Routine pages | upper-left | `dawn` (#E5D9D0, sampled from the far edge) |
| `public/images/routines/evening-light.webp` | Evening sky, Routine pages | upper-right | `night-ground` (#0C1645, sampled from the far edge) |
| `public/images/routines/morning-calm.webp`, `morning-calm-phone.webp` | Calm Morning for the routine pages and Ask Shina: the supplied Morning picture after a 4px diffusion blur, ~35% less colour, a light pull toward warm linen (`<AmbientSky>` without `calm` still uses the original `morning-light*.webp`) | upper-left | `dawn` |
| `public/images/routines/morning-light-phone.webp`, `evening-light-phone.webp` | phone crops of the two above | left / right | same |

Each theme is one fixed full-viewport layer, so it is independent of page length (no tiling, nothing repeats on a long page), with art direction per screen shape:

| Screen | Image | How it is placed |
| --- | --- | --- |
| Landscape / desktop | full picture (949px) | `cover`, anchored to its light corner |
| Tablet portrait (≥768px) | full picture | screen width along the top, lower edge faded into the ground colour |
| Phone portrait (<768px) | purpose-made crop of the lit 56% (531px, `*-phone.webp`) | 130% of screen width (still below source scale, so crisp), strongest light at the upper corner, faded into the ground colour |

All sizes derive from the screen width, so a phone address bar showing or hiding never moves the light. Each fade reaches the solid ground colour just before the image ends (no seam). Tested at 320, 375, 768, 1440 and 1920 wide, landscape 812x375, and a long scrolling page.

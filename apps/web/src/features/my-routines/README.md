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

 resolves the default from the browser-local clock (no geolocation): Morning 06:00–17:59, Evening
18:00–05:59 (, overridable). The default applies once, on entering a page. A manual choice is kept in
 so the three pages agree, and nothing flips it afterwards (no timer).

 paints shutter light:  cross-fades a Morning layer (warm linen ground, alternating soft
shadow/sun slats from the upper-left) and an Evening layer (deep indigo ground, cool luminous slats from the upper-right). CSS only
(gradients and masks), masked to one corner so it fades toward the content, behind content, stops under .
The Evening theme remaps the surface tokens (chalk, linen, ink, stone, cobalt…) to  tokens on ,
so the header, footer, sheets and shared components follow without a second stylesheet. Tokens: , , in , with contrast pairs. Note: this app's  breakpoint is 360px; card desktop layout uses .

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

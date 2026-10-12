import { isHomePreview } from '../lib/preview';
import type { RoutineSummary } from '../lib/routines';
import { PREVIEW_ROUTINES } from '../mocks/routines';

/**
 * Published routines for the home page.
 *
 * Integration seam. The API has no public routine listing yet (`GET /care/routines/:id` is
 * authenticated and nothing lists routines), so in design preview this returns typed fixtures and in
 * every other build it returns nothing: the hero then shows its catalog fallback and the suggested-routines
 * row is omitted. A failed or empty real response never switches fixtures on.
 * TODO(API): Replace preview routine fixtures with the published-routines endpoint when available.
 */
export async function loadPublishedRoutines(): Promise<RoutineSummary[]> {
  return isHomePreview() ? PREVIEW_ROUTINES : [];
}

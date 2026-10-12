import type { RoutineSummary } from '../lib/routines';

/**
 * Published routines for the home page.
 *
 * Integration seam, currently empty on purpose: the API has no public routine listing. Today
 * `GET /care/routines/:id` is authenticated and nothing lists routines, and there is no `published`
 * flag to pick featured ones (apps/api care.controller.ts). Return `RoutineSummary[]` from the future
 * endpoint here and the hero carousel and the recommended-routines section fill in unchanged; until
 * then the hero shows its catalog-browsing fallback and the routines section is omitted.
 */
export async function loadPublishedRoutines(): Promise<RoutineSummary[]> {
  return [];
}

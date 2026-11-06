import { apiClient } from '@/lib/api-client';
import { HOME_IMAGES } from '@/features/home/lib/home-images';
import { routes } from '@/lib/routes';
import { MOCK_ROUTINES } from '../data/routines.mock';
import type { FeaturedRoutineDto, RoutineCardModel } from '../types/routine.types';

/**
 * Maps raw backend FeaturedRoutineDto to the presentation-ready RoutineCardModel.
 */
export function mapDtoToRoutineCard(dto: FeaturedRoutineDto): RoutineCardModel {
  const isHair = dto.blueprint.key.toLowerCase().includes('hair') || dto.blueprint.concernSlug.includes('hair');
  const category = isHair ? 'hair' : 'skin';
  const tier = dto.tiers?.[0];
  const items = tier?.items ?? [];
  const stepsCount = items.length;

  const steps = items.map((it, idx) => ({
    stepNumber: String(idx + 1).padStart(2, '0'),
    labelAr: it.titleAr,
  }));

  const isMorning = dto.blueprint.key.toLowerCase().includes('morning');

  return {
    id: dto.blueprint.id,
    slug: dto.blueprint.key,
    titleAr: dto.blueprint.titleAr,
    subtitleAr: dto.blueprint.descriptionAr ?? '',
    category,
    categoryLabelAr: isHair ? 'الشعر' : 'البشرة',
    periodLabelAr: isMorning ? 'روتين صباحي' : 'روتين عناية',
    periodBadgeAr: isMorning ? 'صباحي' : 'عناية',
    stepsCountBadgeAr: `${stepsCount} خطوات أساسية`,
    stepsCountMobileBadgeAr: `${String(stepsCount).padStart(2, '0')} خطوات`,
    steps,
    imageSrc: isHair ? HOME_IMAGES.routineHair.src : HOME_IMAGES.routineSkin.src,
    imageAlt: dto.blueprint.titleAr,
    detailHref: routes.routineDetail(dto.blueprint.key),
  };
}

/**
 * Dedicated Routine Data Access Layer.
 *
 * Strict Mock Policy:
 * 1. Checks backend API `GET /care/routines/featured`.
 * 2. If backend returns published routines, maps and returns them.
 * 3. In non-production environments (development / test), if the backend is empty or unavailable,
 *    returns deterministic MOCK_ROUTINES for visual fidelity.
 * 4. In production environments, mock data is strictly prohibited and returns an empty list.
 */
export async function getFeaturedRoutines(): Promise<RoutineCardModel[]> {
  try {
    const data = await apiClient.get<FeaturedRoutineDto[]>('/care/routines/featured');
    if (Array.isArray(data) && data.length > 0) {
      return data.map(mapDtoToRoutineCard);
    }
  } catch (err) {
    // API unavailable or error logged
    if (process.env.NODE_ENV !== 'production') {
      console.warn('Routines API unavailable; using development mock routines:', err);
    }
  }

  // Strict Mock Policy Check:
  // Development and local preview modes allow deterministic mock routines.
  // In pure production deployments, mock data is strictly prohibited and returns an empty list.
  const isPreviewOrDev =
    process.env.NODE_ENV !== 'production' ||
    process.env.NEXT_PUBLIC_HOME_PREVIEW === 'true';

  if (isPreviewOrDev) {
    return MOCK_ROUTINES;
  }

  // Pure Production without preview: Never leak mocks into production content
  return [];
}

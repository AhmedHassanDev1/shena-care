import { CircleDot, Droplet, Flame, ShieldCheck, Sun, Waves } from 'lucide-react';
import { routes } from '@/lib/routes';
import type { ConcernLink, RoutineTrack, SkinCareSequence } from '../types/home.types';

/** Concern shortcuts. Ids are the existing `/products?concern=` values; labels come from i18n. */
export const CONCERNS: ConcernLink[] = [
  { id: 'acne', labelKey: 'concernAcne', icon: CircleDot },
  { id: 'dryness', labelKey: 'concernDryness', icon: Droplet },
  { id: 'dark-spots', labelKey: 'concernDarkSpots', icon: Sun },
  { id: 'redness', labelKey: 'concernRedness', icon: Flame },
  { id: 'hair-fall', labelKey: 'concernHairFall', icon: Waves },
  { id: 'sensitive', labelKey: 'concernSensitive', icon: ShieldCheck },
];

/**
 * Routine entry points. The backend has no published routine catalog yet (care routines are created per
 * customer), so the home page shows no ready-made routines, step counts or benefits. Each track lists the
 * questions the routine builder actually asks, in its actual order.
 */
export const ROUTINE_TRACKS: RoutineTrack[] = [
  {
    id: 'skin',
    titleKey: 'routineSkinTitle',
    questionKeys: ['routineQGoal', 'routineQSkinType', 'routineQConstraints', 'routineQBudget'],
    href: routes.routineBuilder,
  },
  {
    id: 'hair',
    titleKey: 'routineHairTitle',
    questionKeys: ['routineQGoal', 'routineQHairType', 'routineQConstraints', 'routineQBudget'],
    href: routes.routineBuilder,
  },
];

/** General educational order of daily skin care. The page labels it as general, not as a recommendation. */
export const SKIN_CARE_ORDER: SkinCareSequence[] = [
  { id: 'morning', labelKey: 'guidanceMorning', stepKeys: ['stepCleanse', 'stepTreat', 'stepMoisturize', 'stepProtect'] },
  { id: 'evening', labelKey: 'guidanceEvening', stepKeys: ['stepCleanse', 'stepTreat', 'stepMoisturize'] },
];

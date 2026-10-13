import { routes } from '@/lib/routes';
import type { RoutineSummary } from '../lib/routines';

/**
 * Design-preview routines (see lib/preview.ts) for the suggested-routines row. They are illustrations, not
 * published routines: no photograph (the card draws its own cover), links go to the routine-builder route
 * (no routine detail page exists yet) and nothing here is ever purchasable.
 * TODO(API): Replace preview routine fixtures with the published-routines endpoint when available.
 */
const preview = (
  id: string,
  title: string,
  description: string,
  careArea: RoutineSummary['careArea'],
  stepCount: number,
  imageSrc: string | null,
  timeOfDay: RoutineSummary['timeOfDay'],
  concern: string | null,
): RoutineSummary => ({
  id: `preview-${id}`,
  title,
  description,
  careArea,
  stepCount,
  imageSrc,
  timeOfDay,
  concern,
  href: routes.routineBuilder,
});

// The first three are the suggested row (one evening, one morning, one hair routine, so the set reads as a range).
export const PREVIEW_ROUTINES: RoutineSummary[] = [
  preview('daily-hydration', 'روتين الترطيب اليومي', 'ترطيب أساسي لبشرتك كل يوم في خطوات قليلة.', 'skin', 3, null, 'pm', 'الجفاف'),
  preview('pigmentation', 'روتين التصبغات', 'عناية يومية مناسبة للبشرة اللي بتظهر عليها تصبغات.', 'skin', 4, null, 'am', 'التصبغات'),
  preview('hair-care', 'روتين العناية بالشعر', 'غسل وترطيب وتغذية لشعرك بخطوات واضحة.', 'hair', 4, null, 'any', 'تساقط الشعر'),
  preview('summer', 'روتين العناية في الصيف', 'خطوات بسيطة تساعدك تهتم ببشرتك في أيام الحرارة.', 'skin', 4, null, 'am', null),
  preview('deep-hydration', 'روتين الترطيب العميق', 'ترطيب مضاعف لبشرة ناعمة ومرتاحة.', 'skin', 3, null, 'pm', 'الجفاف'),
  preview('dry-hair', 'روتين الشعر الجاف', 'عناية لطيفة بالشعر الجاف من الجذور للأطراف.', 'hair', 3, null, 'any', null),
];

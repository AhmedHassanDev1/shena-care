import { routes } from '@/lib/routes';
import type { RoutineSummary } from '../lib/routines';

/**
 * Design-preview routines (see lib/preview.ts): three for the hero swiper and three for the
 * suggested-routines row. They are illustrations, not published routines, so their links go to the
 * routine-builder route (no routine detail page exists yet) and nothing here is ever purchasable.
 * TODO(API): Replace preview routine fixtures with the published-routines endpoint when available.
 */
const preview = (
  id: string,
  title: string,
  description: string,
  careArea: RoutineSummary['careArea'],
  stepCount: number,
  imageSrc: string,
): RoutineSummary => ({
  id: `preview-${id}`,
  title,
  description,
  careArea,
  stepCount,
  imageSrc,
  href: routes.routineBuilder,
});

export const PREVIEW_ROUTINES: RoutineSummary[] = [
  preview('summer', 'روتين العناية في الصيف', 'خطوات بسيطة تساعدك تهتم ببشرتك في أيام الحرارة.', 'skin', 4, '/assets/home/skincare-still-life.webp'),
  preview('daily-hydration', 'روتين الترطيب اليومي', 'ترطيب أساسي لبشرتك كل يوم في خطوات قليلة.', 'skin', 3, '/assets/home/hero-skincare.webp'),
  preview('hair-care', 'روتين العناية بالشعر', 'غسل وترطيب وتغذية لشعرك بخطوات واضحة.', 'hair', 4, '/assets/home/haircare-still-life.webp'),
  preview('pigmentation', 'روتين التصبغات', 'عناية يومية مناسبة للبشرة اللي بتظهر عليها تصبغات.', 'skin', 4, '/assets/home/skincare-still-life.webp'),
  preview('deep-hydration', 'روتين الترطيب العميق', 'ترطيب مضاعف لبشرة ناعمة ومرتاحة.', 'skin', 3, '/assets/home/hero-skincare.webp'),
  preview('dry-hair', 'روتين الشعر الجاف', 'عناية لطيفة بالشعر الجاف من الجذور للأطراف.', 'hair', 3, '/assets/home/haircare-still-life.webp'),
];

import { HOME_IMAGES } from '@/features/home/lib/home-images';
import { routes } from '@/lib/routes';
import type { RoutineCardModel } from '../types/routine.types';

/**
 * Deterministic, authentic mock routines for development and testing.
 * Strictly reproduces the Stitch-approved design (project 9294589212687541881)
 * and references existing curated catalog routines.
 */
export const MOCK_ROUTINES: RoutineCardModel[] = [
  {
    id: 'morning-skin',
    slug: 'morning-radiance',
    titleAr: 'روتين البشرة الصباحي',
    subtitleAr: 'تنظيف لطيف وترطيب منعش وحماية يومية متكاملة من شمس الساحل دون أثر دهني.',
    category: 'skin',
    categoryLabelAr: 'البشرة',
    periodLabelAr: 'روتين صباحي',
    periodBadgeAr: 'صباحي',
    stepsCountBadgeAr: '٣ خطوات أساسية',
    stepsCountMobileBadgeAr: '03 خطوات',
    steps: [
      { stepNumber: '01', labelAr: 'تنظيف' },
      { stepNumber: '02', labelAr: 'ترطيب' },
      { stepNumber: '03', labelAr: 'حماية' },
    ],
    imageSrc: HOME_IMAGES.routineSkin.src,
    imageAlt: 'روتين البشرة الصباحي',
    detailHref: routes.routineDetail('morning-radiance'),
  },
  {
    id: 'dry-hair',
    slug: 'frizz-curl-definition',
    titleAr: 'روتين العناية بالشعر الجاف',
    subtitleAr: 'تغذية عميقة للتموجات وحماية من جفاف الملح ورطوبة الصيف مع ترطيب طبيعي.',
    category: 'hair',
    categoryLabelAr: 'الشعر',
    periodLabelAr: 'روتين أسبوعي',
    periodBadgeAr: 'أسبوعي',
    stepsCountBadgeAr: '٤ خطوات متتالية',
    stepsCountMobileBadgeAr: '04 خطوات',
    steps: [
      { stepNumber: '01', labelAr: 'زيت دافئ' },
      { stepNumber: '02', labelAr: 'غسيل' },
      { stepNumber: '03', labelAr: 'بلسم' },
      { stepNumber: '04', labelAr: 'سيروم' },
    ],
    imageSrc: HOME_IMAGES.routineHair.src,
    imageAlt: 'روتين العناية بالشعر الجاف',
    detailHref: routes.routineDetail('frizz-curl-definition'),
  },
];

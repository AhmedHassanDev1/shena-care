export type RoutineCategory = 'skin' | 'hair';

export interface RoutineStepSummary {
  stepNumber: string; // e.g. "01"
  labelAr: string; // e.g. "تنظيف"
}

export interface RoutineCardModel {
  id: string;
  slug: string;
  titleAr: string;
  subtitleAr: string;
  category: RoutineCategory;
  categoryLabelAr: string; // "البشرة" | "الشعر"
  periodLabelAr: string; // e.g. "روتين صباحي", "روتين أسبوعي"
  periodBadgeAr: string; // e.g. "صباحي", "أسبوعي"
  stepsCountBadgeAr: string; // e.g. "٣ خطوات أساسية", "٤ خطوات متتالية"
  stepsCountMobileBadgeAr: string; // e.g. "03 خطوات"
  steps: RoutineStepSummary[];
  imageSrc: string;
  imageAlt: string;
  detailHref: string;
}

/** Raw DTO shape as returned by GET /care/routines/featured when populated by backend */
export interface FeaturedRoutineDto {
  blueprint: {
    id: string;
    key: string;
    titleAr: string;
    descriptionAr: string | null;
    concernSlug: string;
  };
  preview: boolean;
  warnings?: string[];
  tiers: Array<{
    tier: 'ESSENTIAL' | 'COMPLETE' | 'LUXE';
    totals: { amount: number; currency: string };
    complete: boolean;
    items: Array<{
      roleKey: string;
      titleAr: string;
      isEssential: boolean;
      startWeek: number;
      status: string;
      product: {
        id: string;
        name: string;
        slug: string;
        brandName?: string;
      } | null;
      reasonCodes?: string[];
    }>;
  }>;
}

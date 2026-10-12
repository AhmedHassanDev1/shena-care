import { mainCategorySlugs, routes } from '@/lib/routes';
import type { Messages } from '@/lib/i18n/messages';

/**
 * Whether the guided routine questionnaire exists as a customer journey.
 *
 * It does not yet: `/routine/builder` still renders the redesign-pending scaffold, even though the
 * care workspace API (drafts and proposals) exists. While false, the routine zone describes the journey
 * that really works today (pick a care area, browse available products, add to cart) and links to the
 * catalog instead of promising questions. Flip this when the builder screens ship and the approved
 * "build your routine" copy and question previews appear without further changes.
 */
export const ROUTINE_BUILDER_AVAILABLE = false;

export type DiscoveryIcon = 'products' | 'steps' | 'sparkles' | 'target' | 'checklist' | 'layers' | 'cart';

export interface DiscoveryStep {
  icon: DiscoveryIcon;
  title: string;
  description: string;
}

export interface DiscoveryBenefit {
  icon: DiscoveryIcon;
  label: string;
}

export interface DiscoveryContent {
  /** True when the guided questionnaire exists: question previews are shown only then. */
  guided: boolean;
  title: string;
  description: string;
  benefits: DiscoveryBenefit[];
  cta: { label: string; href: string };
  stepsTitle: string;
  steps: DiscoveryStep[];
  /** Illustrative question cards of the guided journey. Empty when the journey is not available. */
  questions: Array<{ title: string; options: string[] }>;
}

export function getDiscoveryContent(m: Messages, available: boolean = ROUTINE_BUILDER_AVAILABLE): DiscoveryContent {
  if (!available) {
    return {
      guided: false,
      title: m.browseTitle,
      description: m.browseDescription,
      benefits: [
        { icon: 'products', label: m.browseBenefit1 },
        { icon: 'layers', label: m.browseBenefit2 },
        { icon: 'steps', label: m.browseBenefit3 },
      ],
      cta: { label: m.browseCta, href: routes.productsByCategory(mainCategorySlugs.skin) },
      stepsTitle: m.browseStepsTitle,
      steps: [
        { icon: 'target', title: m.browseStep1Title, description: m.browseStep1Description },
        { icon: 'checklist', title: m.browseStep2Title, description: m.browseStep2Description },
        { icon: 'cart', title: m.browseStep3Title, description: m.browseStep3Description },
      ],
      questions: [],
    };
  }

  return {
    guided: true,
    title: m.ctaTitle,
    description: m.ctaDescription,
    benefits: [
      { icon: 'products', label: m.ctaBenefit1 },
      { icon: 'steps', label: m.ctaBenefit2 },
      { icon: 'layers', label: m.ctaBenefit3 },
    ],
    cta: { label: m.ctaButton, href: routes.routineBuilder },
    stepsTitle: m.stepsTitle,
    steps: [
      { icon: 'target', title: m.step1Title, description: m.step1Description },
      { icon: 'checklist', title: m.step2Title, description: m.step2Description },
      { icon: 'sparkles', title: m.step3Title, description: m.step3Description },
    ],
    questions: [
      { title: m.question1Title, options: [m.question1OptionA, m.question1OptionB, m.question1OptionC] },
      { title: m.question2Title, options: [m.question2OptionA, m.question2OptionB, m.question2OptionC] },
      { title: m.question3Title, options: [m.question3OptionA, m.question3OptionB, m.question3OptionC] },
    ],
  };
}

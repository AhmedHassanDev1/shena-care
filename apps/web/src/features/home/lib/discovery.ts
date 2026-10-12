import type { Messages } from '@/lib/i18n/messages';
import { routes } from '@/lib/routes';
import { getBuilderPreviewQuestions } from '../mocks/builder-preview';
import type { PreviewQuestion } from '../mocks/builder-preview';

export type DiscoveryIcon = 'products' | 'steps' | 'layers' | 'target' | 'checklist' | 'sparkles';

export interface DiscoveryContent {
  title: string;
  description: string;
  benefits: Array<{ icon: DiscoveryIcon; label: string }>;
  cta: { label: string; href: string };
  stepsTitle: string;
  steps: Array<{ icon: DiscoveryIcon; title: string; description: string }>;
  questions: PreviewQuestion[];
}

/**
 * The approved routine-discovery copy. The design is always shown; whether the guided builder behind
 * the CTA is finished only affects where that route leads (today `/routine/builder` is still a scaffold,
 * see docs/home-api-integration-gaps.md), never what the section says or looks like.
 */
export function getDiscoveryContent(m: Messages): DiscoveryContent {
  return {
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
    questions: getBuilderPreviewQuestions(m),
  };
}

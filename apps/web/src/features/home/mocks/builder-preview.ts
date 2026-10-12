import type { Messages } from '@/lib/i18n/messages';

export interface PreviewQuestion {
  title: string;
  options: string[];
}

/**
 * Illustrative question cards for the routine-builder banner. They show the shape of the journey,
 * not the real questions, which the guided builder will define.
 * TODO(API): Derive these from the real questionnaire once the builder flow exists.
 */
export function getBuilderPreviewQuestions(m: Messages): PreviewQuestion[] {
  return [
    { title: m.question1Title, options: [m.question1OptionA, m.question1OptionB, m.question1OptionC] },
    { title: m.question2Title, options: [m.question2OptionA, m.question2OptionB, m.question2OptionC] },
    { title: m.question3Title, options: [m.question3OptionA, m.question3OptionB, m.question3OptionC] },
  ];
}

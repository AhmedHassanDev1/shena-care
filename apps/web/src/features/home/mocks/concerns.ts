import type { Concern } from '../lib/concerns';

/**
 * Design-preview concerns (see lib/preview.ts). Not catalog data: nothing links them to products.
 * TODO(API): Replace with a public concerns endpoint when one exists (docs/home-api-integration-gaps.md).
 */
const concern = (slug: string, name: string, careArea: Concern['careArea']): Concern => ({
  id: `preview-${slug}`,
  slug,
  name,
  careArea,
  description: null,
  isActive: true,
});

export const PREVIEW_CONCERNS: Concern[] = [
  concern('acne', 'حبوب البشرة', 'skin'),
  concern('dryness', 'الجفاف', 'skin'),
  concern('pigmentation', 'التصبغات', 'skin'),
  concern('fine-lines', 'التجاعيد والخطوط الدقيقة', 'skin'),
  concern('dullness', 'البشرة الباهتة', 'skin'),
  concern('hair-loss', 'تساقط الشعر', 'hair'),
  concern('dandruff', 'القشرة', 'hair'),
];

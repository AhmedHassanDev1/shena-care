import type { Messages } from '@/lib/i18n/messages';
import { mainCategorySlugs, routes } from '@/lib/routes';

/** Campaign mood = a `data-atmosphere` of the design system (design-system/tokens.extensions.json). */
export type Atmosphere = 'rose' | 'peach' | 'lilac' | 'saffron' | 'malachite';

export interface Campaign {
  id: string;
  atmosphere: Atmosphere;
  eyebrow: string;
  title: string;
  body: string;
  cta: string;
  href: string;
  /** Photography, or `concerns` for the vector concern-constellation artwork (no photo needed). */
  art: { kind: 'photo'; src: string; position: string } | { kind: 'concerns' };
}

/**
 * Hero campaigns: curated editorial entry points, not catalog data. Every link leads to a route that
 * exists today (routine builder, the skin-care listing, the concerns section on this page); none of them
 * advertises a discount, price or stock level.
 *
 * Photography budget: Home owns four photographs and shows each exactly once — the two portraits here,
 * the two still lifes in "Shop by category". The third slide is deliberately graphic so the set never looks
 * like three versions of one picture.
 *
 * `position` is the `object-position` of the unmirrored photo, chosen to centre the face in its frame. Photos are composed with the subject on the
 * right and are flipped in RTL, so the subject always sits on the end side, away from the copy.
 */
export function getCampaigns(m: Messages): Campaign[] {
  return [
    {
      id: 'routine',
      atmosphere: 'peach',
      eyebrow: m.campaign1Eyebrow,
      title: m.campaign1Title,
      body: m.campaign1Body,
      cta: m.campaign1Cta,
      href: routes.routineBuilder,
      art: { kind: 'photo', src: '/assets/home/hero-skincare.webp', position: '92% 20%' },
    },
    {
      id: 'skin',
      atmosphere: 'rose',
      eyebrow: m.campaign2Eyebrow,
      title: m.campaign2Title,
      body: m.campaign2Body,
      cta: m.campaign2Cta,
      href: routes.productsByCategory(mainCategorySlugs.skin),
      art: { kind: 'photo', src: '/assets/home/routine-builder.webp', position: '88% 20%' },
    },
    {
      id: 'concerns',
      atmosphere: 'lilac',
      eyebrow: m.campaign4Eyebrow,
      title: m.campaign4Title,
      body: m.campaign4Body,
      cta: m.campaign4Cta,
      href: '#home-concerns-section',
      art: { kind: 'concerns' },
    },
  ];
}

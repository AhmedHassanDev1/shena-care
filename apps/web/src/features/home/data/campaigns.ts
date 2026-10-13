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
  art: { kind: 'photo'; src: string; mobilePosition: string; desktopPosition: string } | { kind: 'concerns' };
}

/**
 * Hero campaigns: curated editorial entry points, not catalog data. Every link leads to a route that
 * exists today (routine builder, the two category listings, the concerns section on this page); none of
 * them advertises a discount, price or stock level. Each campaign has its own photograph and atmosphere.
 *
 * Positions are `object-position` values for the unmirrored photo (the image is flipped in RTL so the
 * subject sits on the end side, away from the copy).
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
      art: { kind: 'photo', src: '/assets/home/hero-skincare.webp', mobilePosition: '88% 30%', desktopPosition: '78% 30%' },
    },
    {
      id: 'skin',
      atmosphere: 'rose',
      eyebrow: m.campaign2Eyebrow,
      title: m.campaign2Title,
      body: m.campaign2Body,
      cta: m.campaign2Cta,
      href: routes.productsByCategory(mainCategorySlugs.skin),
      art: { kind: 'photo', src: '/assets/home/skincare-still-life.webp', mobilePosition: '76% 55%', desktopPosition: '82% 60%' },
    },
    {
      id: 'hair',
      atmosphere: 'saffron',
      eyebrow: m.campaign3Eyebrow,
      title: m.campaign3Title,
      body: m.campaign3Body,
      cta: m.campaign3Cta,
      href: routes.productsByCategory(mainCategorySlugs.hair),
      art: { kind: 'photo', src: '/assets/home/haircare-still-life.webp', mobilePosition: '84% 55%', desktopPosition: '86% 55%' },
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

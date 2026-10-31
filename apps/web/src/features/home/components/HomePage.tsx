import { StorefrontShell } from '@/features/shell/StorefrontShell';
import { HomeHero } from './HomeHero';
import { ConcernShelf } from './ConcernShelf';
import { SpotlightProducts } from './SpotlightProducts';
import { CategoryEditorial } from './CategoryEditorial';
import { RoutineSection } from './RoutineSection';
import { BrandMarquee } from './BrandMarquee';
import { ShinaStudio } from './ShinaStudio';
import { TrustBadges } from './TrustBadges';

/**
 * Modern Beauty Editorial Homepage:
 * 1. HERO — Full-Bleed Photographic Campaign
 * 2. SHOP BY CONCERN — Refined Horizontal Discovery Strip
 * 3. BESTSELLERS / THE BEAUTY EDIT — Real Product Showcase
 * 4. CATEGORY EDITORIAL — Striking Skincare / Haircare Photographic Spreads
 * 5. CURATED ROUTINES — Premium Regimen Guides
 * 6. BRAND GALLERY — Minimalist Brand Marquee
 * 7. CREATE YOUR ROUTINE — Atmospheric Shina Studio Banner
 * 8. TRUST PILLARS & FOOTER
 */
export function HomePage() {
  return (
    <StorefrontShell nav="home" dock="home" footerServices={false}>
      <HomeHero />
      <ConcernShelf />
      <SpotlightProducts />
      <CategoryEditorial />
      <RoutineSection />
      <BrandMarquee />
      <ShinaStudio />
      <TrustBadges />
    </StorefrontShell>
  );
}

import { StorefrontShell } from '@/features/shell/StorefrontShell';
import { SahelHero } from './SahelHero';
import { ConcernShelf } from './ConcernShelf';
import { SpotlightProducts } from './SpotlightProducts';
import { CategoryEditorial } from './CategoryEditorial';
import { RoutineSection } from './RoutineSection';
import { ShinaStudio } from './ShinaStudio';
import { TrustBadges } from './TrustBadges';
import { BrandMarquee } from './BrandMarquee';

/**
 * Modern Beauty Editorial Homepage:
 * 1. HERO — Full-Bleed Photographic Campaign
 * 2. SHOP BY CONCERN — Refined Horizontal Discovery Strip
 * 3. BESTSELLERS / THE BEAUTY EDIT — Real Product Showcase
 * 4. CATEGORY EDITORIAL — Striking Skincare / Haircare Photographic Spreads
 * 5. CURATED ROUTINES — Premium Regimen Guides
 * 6. CREATE YOUR ROUTINE — Atmospheric Shina Studio Banner
 * 7. TRUST PILLARS — Essential Guarantees
 * 8. BRAND DISCOVERY STRIP — Authentic Magazine Index
 * 9. FOOTER — Sahel Editorial Closing
 */
export function HomePage() {
  return (
    <StorefrontShell nav="home" dock="home" footerServices={false}>
      <SahelHero />
      <ConcernShelf />
      <SpotlightProducts />
      <CategoryEditorial />
      <RoutineSection />
      <ShinaStudio />
      <TrustBadges />
      <BrandMarquee />
    </StorefrontShell>
  );
}

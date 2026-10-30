/**
 * Official brand marks kept in the repository, keyed by catalog brand slug. They are the fallback for brands whose catalog
 * record (GET /brands → `logoUrl`) has no logo yet; a `logoUrl` from the catalog always wins. Sources and the approval
 * status of each mark are listed in docs/frontend/homepage-image-manifest.md. A brand with no entry here and no catalog
 * logo is shown by name in type, never with a drawn or invented mark.
 */
export interface BrandLogo {
  src: string;
  width: number;
  height: number;
}

export const BRAND_LOGOS: Readonly<Record<string, BrandLogo>> = {
  'eva-cosmetics': { src: '/images/brands/eva-cosmetics.png', width: 143, height: 77 },
  'the-hair-addict': { src: '/images/brands/the-hair-addict.png', width: 466, height: 77 },
};

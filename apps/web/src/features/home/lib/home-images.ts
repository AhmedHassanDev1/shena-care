/**
 * Campaign photography used on the homepage. Files live in public/images/home and are described, with provenance and
 * usage notes, in docs/frontend/homepage-image-manifest.md. Dimensions are the real pixel sizes of the optimised files
 * (next/image needs them to reserve space and pick responsive sizes). `position` keeps the subject inside every crop.
 */
export interface HomeImage {
  src: string;
  width: number;
  height: number;
  position: string;
}

export const HOME_IMAGES = {
  hero: { src: '/images/home/hero.jpg', width: 1200, height: 896, position: '55% 35%' },
  routineSkin: { src: '/images/home/routine-skin.jpg', width: 1200, height: 896, position: '78% 55%' },
  routineHair: { src: '/images/home/routine-hair.jpg', width: 1200, height: 896, position: '50% 40%' },
  studio: { src: '/images/home/studio.jpg', width: 1376, height: 768, position: '75% 55%' },
} as const satisfies Record<string, HomeImage>;

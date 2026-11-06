/**
 * Which image shows where is decided by its explicit role, never by file name or upload order.
 * The PDP leads with the approved editorial image; compact references (cards, cart, popovers) always show the identity packshot.
 */
type RoledMedia = { type: string; isPrimary: boolean; sortOrder?: number; role?: string | null };

const GALLERY_RANK: Record<string, number> = { CATEGORY_EDITORIAL: 0, PRIMARY_PACKSHOT: 1, PACKAGING_PROOF: 2, INGREDIENT_STORY: 3, TEXTURE_SENSORY: 4 };
const rank = (item: RoledMedia) => (item.role ? GALLERY_RANK[item.role] ?? 5 : item.isPrimary ? 1 : 5);

export function galleryImages<T extends RoledMedia>(media: T[]): T[] {
  return media.filter((item) => item.type === 'image').sort((a, b) => rank(a) - rank(b) || (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

export function compactImage<T extends RoledMedia>(media: T[]): T | null {
  const images = media.filter((item) => item.type === 'image');
  return images.find((item) => item.role === 'PRIMARY_PACKSHOT') ?? images.find((item) => item.isPrimary) ?? images.find((item) => item.role !== 'CATEGORY_EDITORIAL') ?? images[0] ?? null;
}

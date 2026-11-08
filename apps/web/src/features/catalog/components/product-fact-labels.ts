import type { IconName } from '@/components/ui/icon';
import type { Messages } from '@/lib/i18n/messages';
import { fillMessage } from '@/lib/i18n/messages';
import type { Highlight, SkinType, TargetArea, Texture } from '../lib/product-facts';

/** Words for the catalog fact enums (product-facts.ts), from the message catalogue in both languages. */
export const textureLabel = (m: Messages, value: Texture) => m[`texture${value}`];
export const areaLabel = (m: Messages, value: TargetArea) => m[`area${value}`];
export const skinTypeLabel = (m: Messages, value: SkinType) => m[`skinType${value.charAt(0).toUpperCase()}${value.slice(1)}` as `skinType${Capitalize<SkinType>}`];

export interface HighlightCopy {
  icon: IconName;
  title: string;
  body: string;
}

export function highlightCopy(m: Messages, highlight: Highlight, formatNumber: (n: number) => string): HighlightCopy {
  switch (highlight.kind) {
    case 'spf':
      return { icon: 'sun', title: fillMessage(m.pdpHlSpf, { n: formatNumber(Number(highlight.value)) }), body: m.pdpHlSpfPlain };
    case 'texture':
      return { icon: 'dryness', title: textureLabel(m, highlight.value as Texture), body: m.pdpHlTexture };
    case 'area':
      return { icon: 'pin', title: areaLabel(m, highlight.value as TargetArea), body: m.pdpHlArea };
    case 'fragrance-free':
      return { icon: 'shield', title: m.pdpHlFragranceFree, body: m.pdpHlFragranceFreeBody };
    case 'non-comedogenic':
      return { icon: 'check', title: m.pdpHlNonComedogenic, body: m.pdpHlNonComedogenicBody };
    case 'water':
      return { icon: 'dryness', title: m.pdpHlWater, body: fillMessage(m.pdpHlWaterBody, { n: formatNumber(Number(highlight.value)) }) };
  }
}

import { type ClassValue, clsx } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"
import {
  durationScale,
  easeScale,
  fontSizeScale,
  radiusScale,
  shadowScale,
  sizeScale,
  zScale,
} from "@/styles/design-scales.generated"

/**
 * tailwind-merge must know the design-token scales (generated from design-system/tokens.json). Without this it
 * reads `text-body` as a text *color* and silently drops a real color such as `text-primary-foreground`.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: { spacing: sizeScale },
    classGroups: {
      "font-size": [{ text: fontSizeScale }],
      rounded: [{ rounded: radiusScale }],
      shadow: [{ shadow: shadowScale }],
      duration: [{ duration: durationScale }],
      ease: [{ ease: easeScale }],
      z: [{ z: zScale }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

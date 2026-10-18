import { type ClassValue, clsx } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"
import { colorScale, fontSizeScale, leadingScale, radiusScale, shadowScale } from "@/styles/design-scales.generated"

/**
 * tailwind-merge must know the SAHEL scales (generated from design-system/tokens.json + tokens.app.json).
 * Without this it reads `text-body` as a text *color* and silently drops a real color such as `text-night`.
 */
const twMerge = extendTailwindMerge({
  override: {
    theme: { colors: [...colorScale, "transparent", "current", "inherit"] },
    classGroups: {
      "font-size": [{ text: fontSizeScale }],
      leading: [{ leading: leadingScale }],
      rounded: [{ rounded: radiusScale }],
      shadow: [{ shadow: shadowScale }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

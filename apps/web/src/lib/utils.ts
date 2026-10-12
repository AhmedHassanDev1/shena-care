import { type ClassValue, clsx } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/**
 * tailwind-merge must know the custom design-token scales in tailwind.config.ts. Without this it
 * reads `text-body` as a text *color* and silently drops a real color such as `text-primary-foreground`.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["display", "h1", "h2", "h3", "body-lg", "body", "support", "caption"] }],
      shadow: [{ shadow: ["raised", "overlay", "card", "floating", "cta"] }],
      duration: [{ duration: ["fast", "base"] }],
      ease: [{ ease: ["standard"] }],
      z: [{ z: ["chrome", "overlay"] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

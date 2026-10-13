import * as React from "react"

import { cn } from "@/lib/utils"

export type ArtShape = "bottle" | "dropper" | "tube" | "jar" | "pump"
export type ArtTint = "malachite" | "henna" | "saffron" | "kohl" | "sand"

const TINTS: Record<ArtTint, [string, string]> = {
  malachite: ["var(--malachite)", "var(--malachite-soft)"],
  henna: ["var(--henna)", "var(--henna-soft)"],
  saffron: ["var(--saffron)", "var(--saffron-soft)"],
  kohl: ["var(--ink)", "var(--sand-deep)"],
  sand: ["var(--line-field)", "var(--paper-raised)"],
}

export interface ProductArtProps extends Omit<React.SVGAttributes<SVGSVGElement>, "children"> {
  shape?: ArtShape
  tint?: ArtTint
  /** Intrinsic width in px; the SVG scales with CSS (e.g. `w-[24%] h-auto`). */
  size?: number
  /** Accessible name. Omit when the art is purely decorative (it is then hidden from assistive technology). */
  label?: string
}

/**
 * Illustrative packaging silhouette (design-system `ProductArt`). Decorative stand-in for compositions
 * such as the auth panel — it must never be shown to customers AS a product: real products use
 * photography inside `ProductNiche`.
 */
export function ProductArt({ shape = "bottle", tint = "malachite", size = 120, label, className, ...props }: ProductArtProps) {
  const [deep, soft] = TINTS[tint]
  const body = { fill: "var(--paper-raised)", stroke: "var(--line-field)", strokeWidth: 1.2 }
  const shapes: Record<ArtShape, React.ReactNode> = {
    bottle: (
      <g>
        <rect x="34" y="14" width="22" height="16" rx="3" fill={deep} />
        <rect x="24" y="28" width="42" height="72" rx="10" {...body} />
        <rect x="24" y="52" width="42" height="26" fill={soft} />
        <rect x="32" y="60" width="18" height="3" rx="1.5" fill={deep} />
        <rect x="32" y="67" width="26" height="2" rx="1" fill="var(--line-field)" />
      </g>
    ),
    dropper: (
      <g>
        <rect x="38" y="4" width="14" height="18" rx="7" fill={deep} />
        <rect x="35" y="20" width="20" height="10" rx="2" fill={deep} />
        <rect x="27" y="30" width="36" height="70" rx="8" fill={soft} stroke="var(--line-field)" strokeWidth="1.2" />
        <rect x="33" y="56" width="24" height="24" rx="3" fill="var(--paper-raised)" />
        <rect x="37" y="63" width="12" height="3" rx="1.5" fill={deep} />
      </g>
    ),
    tube: (
      <g>
        <path d="M26 14h38l-5 74H31z" {...body} />
        <rect x="36" y="88" width="18" height="14" rx="3" fill={deep} />
        <path d="M27.6 38h34.8l-1.6 24H29.2z" fill={soft} />
        <rect x="36" y="46" width="16" height="3" rx="1.5" fill={deep} />
      </g>
    ),
    jar: (
      <g>
        <rect x="20" y="44" width="50" height="14" rx="4" fill={deep} />
        <rect x="16" y="56" width="58" height="44" rx="10" {...body} />
        <rect x="16" y="70" width="58" height="16" fill={soft} />
        <rect x="34" y="76" width="22" height="3" rx="1.5" fill={deep} />
      </g>
    ),
    pump: (
      <g>
        <path d="M44 6h18v6H50v8" stroke={deep} strokeWidth="5" fill="none" strokeLinejoin="round" />
        <rect x="38" y="20" width="14" height="10" rx="2" fill={deep} />
        <rect x="22" y="30" width="46" height="70" rx="12" {...body} />
        <rect x="22" y="48" width="46" height="34" fill={soft} />
        <rect x="32" y="58" width="20" height="3" rx="1.5" fill={deep} />
        <rect x="32" y="65" width="26" height="2" rx="1" fill="var(--line-field)" />
      </g>
    ),
  }
  return (
    <svg
      width={size}
      height={size * 1.15}
      viewBox="0 0 90 104"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("block shrink-0", className)}
      {...props}
    >
      {shapes[shape]}
    </svg>
  )
}

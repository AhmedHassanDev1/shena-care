import * as React from "react"

import { cn } from "@/lib/utils"
import { DIRECTIONAL_ICONS, ICON_PATHS, type IconName } from "./icon-paths"

export type { IconName }

export interface IconProps extends Omit<React.SVGAttributes<SVGSVGElement>, "name"> {
  name: IconName
  /** Pixels. `icon-m` (24) is the default; use 18 (`icon-s`) inside chips, badges and inline text. Never below 16. */
  size?: number
  /** Accessible name. Omit for decorative icons (they are hidden from assistive technology). */
  label?: string
  strokeWidth?: number
}

/**
 * The one icon set (design-system `assets/Icons`): 24px grid, 1.75 stroke, inherits `currentColor`.
 * Use forward/back, never left/right — directional glyphs mirror themselves under dir="ltr".
 * `lens` belongs to the assistant, `routine` to routines, `tag` to offers.
 *
 * The path markup comes from the static, repository-owned table in icon-paths.ts, never from user input.
 */
export function Icon({ name, size = 24, label, className, strokeWidth = 1.75, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("inline-block shrink-0 align-middle", DIRECTIONAL_ICONS.includes(name) && "ltr:-scale-x-100", className)}
      dangerouslySetInnerHTML={{ __html: ICON_PATHS[name] }}
      {...props}
    />
  )
}

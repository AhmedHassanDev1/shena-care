import * as React from "react"

import { cn } from "@/lib/utils"
import { DIRECTIONAL_ICONS, ICON_PATHS, type IconName } from "./icon-paths"

export type { IconName }

export interface IconProps extends Omit<React.SVGAttributes<SVGSVGElement>, "name"> {
  name: IconName
  /** Pixels. The boards use 16–24; 22 in chrome (header, nav), 18–20 inside buttons and rows. */
  size?: number
  /** Accessible name. Omit for decorative icons (they are hidden from assistive technology). */
  label?: string
  /** SAHEL line weight is 1.75; chevrons and checks are drawn heavier on the boards. */
  strokeWidth?: number
}

/**
 * The one icon set (SAHEL V18, docs/design/sahel-v18/06-assets/icons): 24px grid, 1.75px rounded line, currentColor.
 * Use forward/back, never left/right — directional glyphs mirror themselves under dir="ltr".
 *
 * The path markup comes from the static, repository-owned table in icon-paths.ts, never from user input.
 */
export function Icon({ name, size = 22, label, className, strokeWidth = 1.75, ...props }: IconProps) {
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

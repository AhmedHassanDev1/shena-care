import * as React from "react"
import Image from "next/image"

import { cn } from "@/lib/utils"

export interface MediaFrameProps {
  src: string
  /** Descriptive alt for informative photos; "" when the photo is decoration next to text that says the same. */
  alt: string
  /** Required: the rendered width per breakpoint, so next/image serves the right size. */
  sizes: string
  /** CSS object-position that keeps the subject inside every crop. */
  position?: string
  priority?: boolean
  /** Slow zoom when an ancestor `.group` is hovered (motion-safe only). */
  zoom?: boolean
  className?: string
}

/**
 * The storefront's photograph treatment: sand ground while loading, cover crop with a stated focal point, optional hover
 * zoom, responsive `sizes`, lazy unless `priority`. Size and radius come from `className` (use radius tokens).
 */
export function MediaFrame({ src, alt, sizes, position = "50% 50%", priority, zoom, className }: MediaFrameProps) {
  return (
    <div className={cn("relative overflow-hidden bg-sand", className)}>
      <Image
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        priority={priority}
        className={cn("object-cover", zoom && "transition-transform duration-slow ease-standard motion-safe:group-hover:scale-105")}
        style={{ objectPosition: position }}
      />
    </div>
  )
}

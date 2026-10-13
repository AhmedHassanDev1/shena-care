import * as React from "react"

import { cn } from "@/lib/utils"

export interface ProductNicheProps extends React.HTMLAttributes<HTMLDivElement> {
  /** `card` = radius-arch (product cards); `gallery` = radius-arch-l (PDP gallery, large panels). */
  scale?: "card" | "gallery"
}

/**
 * The product niche: every product image stands in an arch-topped `sand` well, bottom-aligned with a
 * `sand-deep` floor shadow. The niche — not the photo — carries the shape, so never crop an image into
 * a circle or plain rectangle. Children (the image) are placed in the lower ~80% of the well; a white
 * packshot background blends into the sand (`mix-blend-multiply` on the image), transparent cut-outs
 * are unaffected.
 */
export function ProductNiche({ scale = "card", className, children, ...props }: ProductNicheProps) {
  return (
    <div
      className={cn(
        "relative aspect-[4/5] overflow-hidden bg-sand transition-colors duration-quick ease-out",
        scale === "gallery" ? "shape-arch-l" : "shape-arch",
        className
      )}
      {...props}
    >
      <span aria-hidden="true" className="absolute inset-x-[14%] bottom-[9%] h-1.5 rounded-[50%] bg-sand-deep" />
      <div className="absolute inset-x-[10%] bottom-[10%] top-[12%]">{children}</div>
    </div>
  )
}

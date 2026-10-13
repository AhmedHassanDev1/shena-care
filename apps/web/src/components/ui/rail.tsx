import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Horizontal rail for browsing sets (concerns, brands). It scrolls in the reading direction and bleeds
 * to the screen edge through the page gutter (phones/tablets); from bp-desktop the owner switches it to a
 * grid with `lg:grid`. Use at most two rails in a row before switching to a grid or list.
 */
const Rail = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6 lg:mx-0 lg:overflow-visible lg:px-0",
      "[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
      className
    )}
    {...props}
  />
))
Rail.displayName = "Rail"

export { Rail }

import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * SAHEL page width: content stops at 1200 (max-width incl. a 24px desktop gutter → 1152 of content, as on every
 * 1440 board); the phone gutter is 16 (SAHEL V2 "mobile gutter 16, desktop 24").
 */
export function PageContainer({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("mx-auto w-full max-w-container px-4 lg:px-6", className)} {...props}>
      {children}
    </div>
  )
}

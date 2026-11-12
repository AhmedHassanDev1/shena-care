import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * SAHEL page width: content stops at max-w-container (1360px).
 * Responsive horizontal padding adheres to SAHEL standards:
 * - Mobile (< 640px): 16px (px-4)
 * - Tablet (640–1023px): 24px (md:px-6)
 * - Desktop (≥ 1024px): 40px (lg:px-10)
 */
export function PageContainer({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("mx-auto w-full max-w-container px-4 md:px-6 lg:px-10", className)} {...props}>
      {children}
    </div>
  )
}

import * as React from "react"
import { cn } from "@/lib/utils"

export interface PageContainerProps extends React.HTMLAttributes<HTMLDivElement> {}

/**
 * Page gutter and width from the layout tokens: space-4 on phones, space-6 from tablet (bp-tablet),
 * space-8 from desktop (bp-desktop); content stops growing at `container-max`.
 */
export function PageContainer({ className, children, ...props }: PageContainerProps) {
  return (
    <div className={cn("mx-auto w-full max-w-container px-4 sm:px-6 lg:px-8", className)} {...props}>
      {children}
    </div>
  )
}

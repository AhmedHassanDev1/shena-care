import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Inline message. Tone is carried by three cues at once — the start-edge rule, the icon and the
 * text — never by the background tint alone. Destructive alerts are announced immediately
 * (role="alert"); the others politely (role="status").
 */
const alertVariants = cva(
  "relative flex gap-3 rounded-md border border-s-4 p-4 text-support text-foreground [&>svg]:mt-0.5 [&>svg]:size-5 [&>svg]:shrink-0",
  {
    variants: {
      variant: {
        neutral: "border-border border-s-input bg-card [&>svg]:text-muted-foreground",
        info: "border-info/25 border-s-info bg-info-subtle [&>svg]:text-info",
        success: "border-success/25 border-s-success bg-success-subtle [&>svg]:text-success",
        warning: "border-warning/25 border-s-warning bg-warning-subtle [&>svg]:text-warning",
        destructive: "border-destructive/25 border-s-destructive bg-destructive-subtle [&>svg]:text-destructive",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  }
)

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {}

const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant, role, ...props }, ref) => (
    <div
      ref={ref}
      role={role ?? (variant === "destructive" ? "alert" : "status")}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
)
Alert.displayName = "Alert"

const AlertTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn("font-semibold text-foreground", className)} {...props} />
  )
)
AlertTitle.displayName = "AlertTitle"

const AlertDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("text-support text-foreground", className)} {...props} />
  )
)
AlertDescription.displayName = "AlertDescription"

export { Alert, AlertTitle, AlertDescription, alertVariants }

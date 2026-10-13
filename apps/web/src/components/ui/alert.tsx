import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { Icon, type IconName } from "./icon"

/**
 * Inline notice (design-system `Notice`). Tone is carried by the icon and the words, never by the soft
 * background alone. Destructive notices are announced immediately (role="alert"); the others politely.
 * Henna is reserved for offers, so errors use `danger`.
 */
const alertVariants = cva("relative flex gap-3 rounded-md px-4 py-3 text-body text-foreground [&>svg]:mt-[3px]", {
  variants: {
    variant: {
      neutral: "border border-border bg-card [&>svg]:text-muted-foreground",
      info: "bg-sand [&>svg]:text-muted-foreground",
      success: "bg-success-subtle [&>svg]:text-success",
      warning: "bg-attention-soft [&>svg]:text-attention-ink",
      destructive: "bg-destructive-subtle [&>svg]:text-destructive",
    },
  },
  defaultVariants: {
    variant: "neutral",
  },
})

const defaultIcon: Record<NonNullable<VariantProps<typeof alertVariants>["variant"]>, IconName> = {
  neutral: "info",
  info: "info",
  success: "check-circle",
  warning: "alert",
  destructive: "alert",
}

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {
  /** Override the tone's default icon, or pass `null` for none. */
  icon?: IconName | null
}

const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant, role, icon, children, ...props }, ref) => (
    <div
      ref={ref}
      role={role ?? (variant === "destructive" ? "alert" : "status")}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    >
      {icon === null ? null : <Icon name={icon ?? defaultIcon[variant ?? "neutral"]} size={20} />}
      <div className="grid min-w-0 flex-1 gap-0.5">{children}</div>
    </div>
  )
)
Alert.displayName = "Alert"

const AlertTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn("text-label text-foreground", className)} {...props} />
  )
)
AlertTitle.displayName = "AlertTitle"

const AlertDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("text-body-s text-foreground", className)} {...props} />
  )
)
AlertDescription.displayName = "AlertDescription"

export { Alert, AlertTitle, AlertDescription, alertVariants }

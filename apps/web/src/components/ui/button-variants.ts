import { cva } from "class-variance-authority"

/**
 * Button styling lives outside the "use client" button module so server components can style a link
 * as a button (calling a function exported from a client module is not possible on the server).
 */
export const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium",
    "transition-colors duration-fast ease-standard",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    // Disabled is communicated by surface, text color and cursor — not by opacity alone.
    "disabled:cursor-not-allowed",
    "aria-[busy=true]:cursor-progress",
    "[&_svg]:size-4 [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary-hover disabled:bg-disabled disabled:text-disabled-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary-hover disabled:bg-disabled disabled:text-disabled-foreground",
        outline:
          "border border-input bg-card text-foreground hover:bg-muted disabled:border-border disabled:bg-disabled disabled:text-disabled-foreground",
        ghost: "text-foreground hover:bg-secondary disabled:text-disabled-foreground",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:bg-disabled disabled:text-disabled-foreground",
        link: "h-auto px-0 text-primary underline-offset-4 hover:underline disabled:text-disabled-foreground",
      },
      size: {
        sm: "h-9 px-3 text-support",
        // 44px: minimum comfortable touch target on mobile.
        default: "h-11 px-4 text-body",
        lg: "h-12 px-6 text-body-lg",
        icon: "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

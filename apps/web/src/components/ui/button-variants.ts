import { cva } from "class-variance-authority"

/**
 * Button styling lives outside the "use client" button module so server components can style a link
 * as a button (calling a function exported from a client module is not possible on the server).
 *
 * Shape rule: everything pressable is a pill. Sizes are the control tokens (36 / 44 / 52). Focus is the
 * global ink ring (globals.css); disabled is carried by surface + text color + cursor, never opacity.
 */
export const buttonVariants = cva(
  [
    "relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-pill border-[1.5px] border-transparent text-label",
    "transition-[background-color,border-color,transform] duration-quick ease-out",
    "enabled:active:scale-[0.98] enabled:active:duration-instant",
    "disabled:cursor-not-allowed disabled:border-transparent disabled:bg-disabled disabled:text-disabled-foreground",
    "aria-[busy=true]:cursor-progress",
    "[&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary-hover",
        /** Bordered, neutral: the second action next to a primary one. */
        secondary: "border-input bg-card text-foreground hover:border-foreground disabled:border-transparent",
        /** Alias of `secondary`, kept so existing call sites keep working. */
        outline: "border-input bg-card text-foreground hover:border-foreground disabled:border-transparent",
        /** Soft malachite fill for confirmations that should not shout (e.g. "added"). */
        tonal: "bg-primary-subtle text-guide hover:bg-primary-subtle",
        ghost: "px-3 text-foreground hover:bg-sand disabled:bg-transparent",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        link: "rounded-xs border-0 text-primary underline underline-offset-4 decoration-transparent hover:decoration-current disabled:bg-transparent",
      },
      size: {
        sm: "h-control-s px-4",
        // 44px: the minimum comfortable touch target.
        default: "h-control-m px-5",
        lg: "h-control-l px-6",
        icon: "size-control-m",
      },
    },
    compoundVariants: [
      // A text link keeps its content height and has no horizontal padding, whatever size it was given.
      { variant: "link", className: "h-auto px-0" },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

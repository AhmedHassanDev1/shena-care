import { cn } from "@/lib/utils"

/**
 * Loading placeholder with signature Sahel Shutter Drift (حركة الشيش) animation.
 * Decorative: announce loading separately (aria-busy / a status line).
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn("rounded-image bg-sand/40 skeleton-bone animate-shutter-drift motion-reduce:animate-none", className)}
      {...props}
    />
  )
}

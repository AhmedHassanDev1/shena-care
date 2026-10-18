import { cn } from "@/lib/utils"

/**
 * Loading placeholder that keeps the final layout (cards, images, infinite scroll keep their skeleton and written
 * status — Shutter Loading is for async buttons only). Decorative: announce loading separately (aria-busy / a status line).
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn("rounded-image bg-sand motion-safe:animate-breathe", className)} {...props} />
}

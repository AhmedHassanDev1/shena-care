import { cn } from "@/lib/utils"

/** Loading placeholder. Decorative: announce loading state separately (e.g. aria-busy on the region). */
function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn("rounded-sm bg-secondary motion-safe:animate-pulse", className)}
      {...props}
    />
  )
}

export { Skeleton }
